/**
 * Extração ESTRUTURAL do contrato SOAP a partir do WSDL oficial (GOAL-017 · H-9/H-10).
 *
 * Módulo **puro e offline**: recebe o texto de um WSDL já obtido por outra camada e devolve o
 * contrato de wire, ou uma recusa tipada. Não abre socket, não lê cofre, não toca banco.
 *
 * ## A regra que organiza tudo: cadeia estrutural, nunca heurística
 *
 * ⛔ Este extrator **jamais** deriva `SOAPAction` do nome do serviço, do nome da operação, do
 * `targetNamespace` ou de qualquer convenção. A `SOAPAction` só existe se estiver escrita em
 * `soap12:operation/@soapAction` na cadeia
 * `service → port(soap12:address) → binding → operation`. Ausente ⇒ **H-9 permanece ABERTA**.
 *
 * O motivo é que a convenção `<targetNamespace>/<operação>` é plausível o bastante para passar
 * despercebida e errada o bastante para produzir `SOAPAction` inválida em produção. Um valor
 * inventado que "parece certo" é pior que a pendência declarada: ele fecha H-9 no papel e falha
 * na SEFAZ.
 *
 * ## Ambiguidade nunca é resolvida por preferência
 *
 * Dois `wsdl:service`, dois ports SOAP 1.2, dois bindings homônimos ou duas operações no mesmo
 * binding ⇒ recusa. Não existe "o primeiro vence", "o que casa com o nome do serviço vence" nem
 * "o SOAP 1.2 preferido". Escolher entre bindings ambíguos é exatamente inventar o contrato.
 *
 * ## SOAP 1.1 não fecha evidência de SOAP 1.2
 *
 * O piloto exige SOAP 1.2 (`ADR-0020`/plano 016D D5). Um WSDL que só publique bindings no
 * namespace `.../wsdl/soap/` (1.1) é **incompatível**, não "parcialmente aceitável": a recusa é
 * específica (`port_soap12_ausente`) e H-9/H-10 seguem abertas.
 *
 * ## Vínculo ao serviço esperado
 *
 * O `targetNamespace` do WSDL precisa ser EXATAMENTE `sefazServiceNamespace(servico)` — valor já
 * versionado no catálogo, não inferido do documento. E o `soap12:address/@location` precisa
 * apontar para o host e o path canônicos do alvo. Sem isso, um WSDL de outro serviço (ou de
 * outro ambiente) seria lido como se fosse o pedido.
 */
import { attrOf, childElements, parseXml, type C14nElement } from "@/lib/fiscal/signing/c14n"
import { sefazServiceNamespace, type SefazServico } from "../sefaz-endpoint-catalog"
import type { SefazWsdlTarget } from "./wsdl-acquisition-target"

const WSDL11_NS = "http://schemas.xmlsoap.org/wsdl/"
const SOAP12_WSDL_NS = "http://schemas.xmlsoap.org/wsdl/soap12/"
const SOAP11_WSDL_NS = "http://schemas.xmlsoap.org/wsdl/soap/"
const SOAP_HTTP_TRANSPORT = "http://schemas.xmlsoap.org/soap/http"

/** Mesmo teto da aquisição: um WSDL maior que isto não é um WSDL de serviço NFC-e. */
export const WSDL_MAX_DOCUMENT_BYTES = 256 * 1024

/** WSDL 1.1: estilo ausente significa `document`. Qualquer outro valor é recusado. */
const ESTILO_EXIGIDO = "document"

export type SefazWsdlExtractionErrorCode =
  | "documento_vazio"
  | "documento_excede_limite"
  | "documento_com_dtd"
  | "documento_malformado"
  | "raiz_nao_e_wsdl"
  | "target_namespace_divergente"
  | "service_ausente"
  | "service_ambiguo"
  | "port_soap12_ausente"
  | "port_soap12_ambiguo"
  | "endereco_divergente"
  | "binding_nao_resolvido"
  | "binding_ambiguo"
  | "binding_transporte_invalido"
  | "binding_style_invalido"
  | "operacao_ausente"
  | "operacao_ambigua"
  | "soap_action_ausente"
  | "port_type_nao_resolvido"
  | "mensagem_nao_resolvida"
  | "wrapper_nao_resolvido"

/** Contrato de wire completo. Só é produzido quando TODA a cadeia fechou sem ambiguidade. */
export type SefazWsdlContract = {
  readonly servico: SefazServico
  readonly targetNamespace: string
  readonly serviceName: string
  readonly portName: string
  readonly bindingName: string
  /** Sempre `SOAP12_WSDL_NS` num contrato fechado — registrado para a trilha, não presumido. */
  readonly bindingNamespace: typeof SOAP12_WSDL_NS
  readonly soap12: true
  readonly transport: typeof SOAP_HTTP_TRANSPORT
  readonly style: typeof ESTILO_EXIGIDO
  readonly operationName: string
  /** Lido VERBATIM de `soap12:operation/@soapAction`. Nunca derivado de nome. */
  readonly soapAction: string
  /** `soap12:operation/@soapActionRequired`, quando o WSDL o declara. */
  readonly soapActionRequired: boolean | null
  readonly inputMessageName: string
  readonly inputWrapperLocalName: string
  readonly inputWrapperNamespace: string
  readonly outputMessageName: string
  readonly outputWrapperLocalName: string
  readonly outputWrapperNamespace: string
  /** `soap12:address/@location`, já conferida contra o host e o path canônicos do alvo. */
  readonly addressLocation: string
}

export type SefazWsdlExtraction =
  | {
      readonly ok: true
      readonly contrato: SefazWsdlContract
      /** `SOAPAction` presente e lida do documento. */
      readonly fechaH9: true
      /** Binding/port/wrapper SOAP 1.2 completos e não ambíguos. */
      readonly fechaH10: true
    }
  | {
      readonly ok: false
      readonly codigo: SefazWsdlExtractionErrorCode
      readonly mensagem: string
      readonly fechaH9: false
      readonly fechaH10: false
    }

function recusa(
  codigo: SefazWsdlExtractionErrorCode,
  mensagem: string,
): SefazWsdlExtraction {
  return { ok: false, codigo, mensagem, fechaH9: false, fechaH10: false }
}

/** Filhos-elemento diretos com nome local E namespace exatos. Namespace é sempre obrigatório. */
function filhos(pai: C14nElement, nome: string, ns: string): C14nElement[] {
  return childElements(pai, nome, ns).filter((filho) => filho.namespaceUri === ns)
}

type Escopo = ReadonlyMap<string, string>

/**
 * Mapa `elemento → prefixos em vigor`. Necessário porque valores de atributo como
 * `binding="tns:Foo"` são QNames: resolvê-los sem o escopo correto permitiria que duas
 * declarações homônimas em ramos distintos apontassem para o mesmo alvo.
 */
function indexarEscopos(raiz: C14nElement): Map<C14nElement, Escopo> {
  const indice = new Map<C14nElement, Escopo>()
  const visitar = (elemento: C14nElement, herdado: Escopo): void => {
    let escopo = herdado
    let proprio: Map<string, string> | null = null
    for (const attr of elemento.attrs) {
      if (attr.name === "xmlns") {
        proprio ??= new Map(herdado)
        proprio.set("", attr.value)
      } else if (attr.name.startsWith("xmlns:")) {
        proprio ??= new Map(herdado)
        proprio.set(attr.name.slice("xmlns:".length), attr.value)
      }
    }
    if (proprio) escopo = proprio
    indice.set(elemento, escopo)
    for (const filho of elemento.children) {
      if (filho.type === "element") visitar(filho, escopo)
    }
  }
  visitar(raiz, new Map<string, string>())
  return indice
}

type QName = { readonly namespace: string; readonly localName: string }

/** Resolve um QName de valor de atributo. Prefixo não declarado ⇒ `null` (nunca "assume tns"). */
function resolverQName(valor: string, escopo: Escopo): QName | null {
  const bruto = valor.trim()
  if (!bruto || /\s/.test(bruto)) return null
  const separador = bruto.indexOf(":")
  if (separador < 0) {
    const padrao = escopo.get("")
    return padrao ? { namespace: padrao, localName: bruto } : null
  }
  const prefixo = bruto.slice(0, separador)
  const localName = bruto.slice(separador + 1)
  if (!prefixo || !localName || localName.includes(":")) return null
  const namespace = escopo.get(prefixo)
  return namespace ? { namespace, localName } : null
}

function excedeTetoUtf8(valor: string): boolean {
  if (valor.length > WSDL_MAX_DOCUMENT_BYTES) return true
  if (valor.length * 3 <= WSDL_MAX_DOCUMENT_BYTES) return false
  return new TextEncoder().encode(valor).byteLength > WSDL_MAX_DOCUMENT_BYTES
}

/** Exige EXATAMENTE um elemento. Zero e "mais de um" são falhas distintas para o chamador. */
function exatamenteUm(elementos: readonly C14nElement[]): C14nElement | "ausente" | "ambiguo" {
  if (elementos.length === 0) return "ausente"
  if (elementos.length > 1) return "ambiguo"
  return elementos[0]!
}

function definicaoPorNome(
  raiz: C14nElement,
  tipo: "binding" | "portType" | "message",
  nome: string,
): C14nElement | "ausente" | "ambiguo" {
  return exatamenteUm(filhos(raiz, tipo, WSDL11_NS).filter((e) => attrOf(e, "name") === nome))
}

/**
 * Extrai o contrato do WSDL para o serviço esperado, conferindo-o contra o alvo canônico.
 *
 * `servico` e `alvo` são o contexto tipado do CHAMADOR; nada aqui é inferido do documento.
 */
export function extractSefazWsdlContract(input: {
  servico: SefazServico
  alvo: SefazWsdlTarget
  documento: string
}): SefazWsdlExtraction {
  const { servico, alvo } = input

  if (alvo.servico !== servico) {
    return recusa(
      "target_namespace_divergente",
      "Alvo canônico e serviço esperado divergem; extração recusada.",
    )
  }

  // ── 1. Texto sob regras estritas, antes do parser ────────────────────────────────────────
  const texto = typeof input.documento === "string" ? input.documento : ""
  if (texto.trim().length === 0) return recusa("documento_vazio", "Documento WSDL vazio.")
  if (excedeTetoUtf8(texto)) {
    return recusa("documento_excede_limite", "Documento WSDL excede o limite aceito.")
  }
  if (/<!DOCTYPE\b/i.test(texto) || /<!ENTITY\b/i.test(texto)) {
    return recusa("documento_com_dtd", "Documento WSDL declara DTD ou entidade; leitura recusada.")
  }

  // ── 2. Parse sem reparo silencioso ───────────────────────────────────────────────────────
  let definitions: C14nElement
  try {
    definitions = parseXml(texto)
  } catch {
    return recusa("documento_malformado", "Documento WSDL não é XML bem-formado.")
  }
  if (definitions.name !== "definitions" || definitions.namespaceUri !== WSDL11_NS) {
    return recusa("raiz_nao_e_wsdl", "Raiz não é wsdl:definitions do WSDL 1.1.")
  }

  // ── 3. Vínculo ao serviço esperado, pelo namespace JÁ versionado no catálogo ─────────────
  const targetNamespace = attrOf(definitions, "targetNamespace")
  const namespaceEsperado = sefazServiceNamespace(servico)
  if (targetNamespace !== namespaceEsperado) {
    return recusa(
      "target_namespace_divergente",
      `targetNamespace do WSDL não corresponde ao namespace oficial de ${servico}.`,
    )
  }

  const escopos = indexarEscopos(definitions)
  const escopoDe = (elemento: C14nElement): Escopo => escopos.get(elemento) ?? new Map()

  // ── 4. Exatamente um wsdl:service ────────────────────────────────────────────────────────
  const service = exatamenteUm(filhos(definitions, "service", WSDL11_NS))
  if (service === "ausente") return recusa("service_ausente", "WSDL sem wsdl:service.")
  if (service === "ambiguo") {
    return recusa("service_ambiguo", "WSDL com mais de um wsdl:service; escolha recusada.")
  }

  // ── 5. Exatamente um port com endereço SOAP 1.2 ──────────────────────────────────────────
  const ports = filhos(service, "port", WSDL11_NS)
  const portsSoap12 = ports.filter((port) => filhos(port, "address", SOAP12_WSDL_NS).length === 1)
  if (portsSoap12.length === 0) {
    const temSoap11 = ports.some((port) => filhos(port, "address", SOAP11_WSDL_NS).length > 0)
    return recusa(
      "port_soap12_ausente",
      temSoap11
        ? "WSDL publica apenas binding SOAP 1.1; o piloto exige SOAP 1.2."
        : "WSDL sem port com endereço SOAP 1.2.",
    )
  }
  if (portsSoap12.length > 1) {
    return recusa(
      "port_soap12_ambiguo",
      "WSDL com mais de um port SOAP 1.2; escolha por heurística recusada.",
    )
  }
  const port = portsSoap12[0]!
  const portName = attrOf(port, "name")

  // ── 6. Endereço publicado × alvo canônico ────────────────────────────────────────────────
  const addressLocation = attrOf(filhos(port, "address", SOAP12_WSDL_NS)[0]!, "location").trim()
  if (!enderecoCompativel(addressLocation, alvo)) {
    return recusa(
      "endereco_divergente",
      "soap12:address/@location não aponta para o host e o path canônicos do alvo.",
    )
  }

  // ── 7. Binding resolvido pelo QName do port ──────────────────────────────────────────────
  const bindingQName = resolverQName(attrOf(port, "binding"), escopoDe(port))
  if (!bindingQName || bindingQName.namespace !== targetNamespace) {
    return recusa("binding_nao_resolvido", "port/@binding ausente, sem prefixo declarado ou fora do targetNamespace.")
  }
  const binding = definicaoPorNome(definitions, "binding", bindingQName.localName)
  if (binding === "ausente") {
    return recusa("binding_nao_resolvido", "wsdl:binding referenciado pelo port não existe.")
  }
  if (binding === "ambiguo") {
    return recusa("binding_ambiguo", "Mais de um wsdl:binding com o mesmo nome; escolha recusada.")
  }
  const bindingName = attrOf(binding, "name")

  // ── 8. O binding precisa ser SOAP 1.2 sobre HTTP, document ───────────────────────────────
  const soapBinding = exatamenteUm(filhos(binding, "binding", SOAP12_WSDL_NS))
  if (soapBinding === "ausente" || soapBinding === "ambiguo") {
    return recusa(
      "port_soap12_ausente",
      soapBinding === "ambiguo"
        ? "Binding com mais de uma extensão soap12:binding; leitura recusada."
        : "Binding referenciado não declara extensão soap12:binding.",
    )
  }
  const transport = attrOf(soapBinding, "transport").trim()
  if (transport !== SOAP_HTTP_TRANSPORT) {
    return recusa("binding_transporte_invalido", "soap12:binding/@transport não é SOAP sobre HTTP.")
  }
  const bindingStyle = attrOf(soapBinding, "style").trim() || ESTILO_EXIGIDO
  if (bindingStyle !== ESTILO_EXIGIDO) {
    return recusa("binding_style_invalido", "soap12:binding/@style não é document.")
  }

  // ── 9. Operação no binding ───────────────────────────────────────────────────────────────
  const operacoes = filhos(binding, "operation", WSDL11_NS)
  if (operacoes.length === 0) {
    return recusa("operacao_ausente", "Binding SOAP 1.2 sem wsdl:operation.")
  }

  let operacao: C14nElement
  if (alvo.expectedOperationName) {
    const matches = operacoes.filter(
      (op) => attrOf(op, "name").trim() === alvo.expectedOperationName,
    )
    if (matches.length === 0) {
      return recusa(
        "operacao_ausente",
        `Operação canônica esperada "${alvo.expectedOperationName}" não encontrada no binding.`,
      )
    }
    if (matches.length > 1) {
      return recusa(
        "operacao_ambigua",
        `Mais de uma wsdl:operation com o nome "${alvo.expectedOperationName}" no binding.`,
      )
    }
    operacao = matches[0]!
  } else {
    if (operacoes.length > 1) {
      return recusa(
        "operacao_ambigua",
        "Binding com mais de uma wsdl:operation; escolha por nome do serviço recusada.",
      )
    }
    operacao = operacoes[0]!
  }
  const operationName = attrOf(operacao, "name").trim()
  if (!operationName) {
    return recusa("operacao_ausente", "wsdl:operation sem atributo name.")
  }

  const soapOperacao = exatamenteUm(filhos(operacao, "operation", SOAP12_WSDL_NS))
  if (soapOperacao === "ausente" || soapOperacao === "ambiguo") {
    return recusa(
      "soap_action_ausente",
      soapOperacao === "ambiguo"
        ? "Operação com mais de uma extensão soap12:operation; SOAPAction ambígua."
        : "Operação sem extensão soap12:operation; SOAPAction não publicada.",
    )
  }
  const estiloOperacao = attrOf(soapOperacao, "style").trim() || bindingStyle
  if (estiloOperacao !== ESTILO_EXIGIDO) {
    return recusa("binding_style_invalido", "soap12:operation/@style não é document.")
  }

  // ── 10. SOAPAction — lida, nunca derivada ────────────────────────────────────────────────
  // Um `soapAction=""` é sintaticamente válido em WSDL, mas não fecha H-9: não há ação a usar.
  const soapAction = attrOf(soapOperacao, "soapAction").trim()
  if (!soapAction) {
    return recusa(
      "soap_action_ausente",
      "soap12:operation não publica soapAction; H-9 permanece aberta (nenhum valor é inferido).",
    )
  }
  const soapActionRequiredBruto = attrOf(soapOperacao, "soapActionRequired").trim()
  const soapActionRequired =
    soapActionRequiredBruto === ""
      ? null
      : soapActionRequiredBruto === "true" || soapActionRequiredBruto === "1"

  // ── 11. portType → messages → wrappers ───────────────────────────────────────────────────
  const portTypeQName = resolverQName(attrOf(binding, "type"), escopoDe(binding))
  if (!portTypeQName || portTypeQName.namespace !== targetNamespace) {
    return recusa("port_type_nao_resolvido", "binding/@type ausente, sem prefixo declarado ou fora do targetNamespace.")
  }
  const portType = definicaoPorNome(definitions, "portType", portTypeQName.localName)
  if (portType === "ausente") {
    return recusa("port_type_nao_resolvido", "wsdl:portType referenciado pelo binding não existe.")
  }
  if (portType === "ambiguo") {
    return recusa("port_type_nao_resolvido", "Mais de um wsdl:portType com o mesmo nome; leitura recusada.")
  }

  const operacaoAbstrata = exatamenteUm(
    filhos(portType, "operation", WSDL11_NS).filter((e) => attrOf(e, "name") === operationName),
  )
  if (operacaoAbstrata === "ausente" || operacaoAbstrata === "ambiguo") {
    return recusa(
      "port_type_nao_resolvido",
      operacaoAbstrata === "ambiguo"
        ? "portType com operações homônimas; leitura recusada."
        : "portType sem a operação declarada no binding.",
    )
  }

  const entrada = resolverWrapper(definitions, operacaoAbstrata, "input", targetNamespace, escopoDe)
  if (!entrada.ok) return recusa(entrada.codigo, entrada.mensagem)
  const saida = resolverWrapper(definitions, operacaoAbstrata, "output", targetNamespace, escopoDe)
  if (!saida.ok) return recusa(saida.codigo, saida.mensagem)

  return {
    ok: true,
    fechaH9: true,
    fechaH10: true,
    contrato: {
      servico,
      targetNamespace,
      serviceName: attrOf(service, "name"),
      portName,
      bindingName,
      bindingNamespace: SOAP12_WSDL_NS,
      soap12: true,
      transport: SOAP_HTTP_TRANSPORT,
      style: ESTILO_EXIGIDO,
      operationName,
      soapAction,
      soapActionRequired,
      inputMessageName: entrada.messageName,
      inputWrapperLocalName: entrada.localName,
      inputWrapperNamespace: entrada.namespace,
      outputMessageName: saida.messageName,
      outputWrapperLocalName: saida.localName,
      outputWrapperNamespace: saida.namespace,
      addressLocation,
    },
  }
}

type WrapperResolvido =
  | {
      readonly ok: true
      readonly messageName: string
      readonly localName: string
      readonly namespace: string
    }
  | {
      readonly ok: false
      readonly codigo: SefazWsdlExtractionErrorCode
      readonly mensagem: string
    }

/** `wsdl:input|output/@message` → `wsdl:message` → única `wsdl:part` com `@element`. */
function resolverWrapper(
  definitions: C14nElement,
  operacaoAbstrata: C14nElement,
  direcao: "input" | "output",
  targetNamespace: string,
  escopoDe: (elemento: C14nElement) => Escopo,
): WrapperResolvido {
  const nodo = exatamenteUm(filhos(operacaoAbstrata, direcao, WSDL11_NS))
  if (nodo === "ausente" || nodo === "ambiguo") {
    return {
      ok: false,
      codigo: "mensagem_nao_resolvida",
      mensagem: `Operação sem wsdl:${direcao} único.`,
    }
  }

  const messageQName = resolverQName(attrOf(nodo, "message"), escopoDe(nodo))
  if (!messageQName || messageQName.namespace !== targetNamespace) {
    return {
      ok: false,
      codigo: "mensagem_nao_resolvida",
      mensagem: `wsdl:${direcao}/@message ausente, sem prefixo declarado ou fora do targetNamespace.`,
    }
  }
  const message = definicaoPorNome(definitions, "message", messageQName.localName)
  if (message === "ausente" || message === "ambiguo") {
    return {
      ok: false,
      codigo: "mensagem_nao_resolvida",
      mensagem:
        message === "ambiguo"
          ? "Mais de uma wsdl:message com o mesmo nome; leitura recusada."
          : "wsdl:message referenciada não existe.",
    }
  }

  const partes = filhos(message, "part", WSDL11_NS).filter((p) => attrOf(p, "element").trim() !== "")
  const parte = exatamenteUm(partes)
  if (parte === "ausente" || parte === "ambiguo") {
    return {
      ok: false,
      codigo: "wrapper_nao_resolvido",
      mensagem:
        parte === "ambiguo"
          ? "wsdl:message com mais de uma part elementar; wrapper ambíguo."
          : "wsdl:message sem part com @element; wrapper não publicado.",
    }
  }

  const elementQName = resolverQName(attrOf(parte, "element"), escopoDe(parte))
  if (!elementQName) {
    return {
      ok: false,
      codigo: "wrapper_nao_resolvido",
      mensagem: "wsdl:part/@element não é um QName resolvível no escopo declarado.",
    }
  }

  return {
    ok: true,
    messageName: attrOf(message, "name"),
    localName: elementQName.localName,
    namespace: elementQName.namespace,
  }
}

/**
 * O endereço publicado tem de ser o alvo canônico: `https`, host EXATO, path EXATO, sem
 * credenciais, sem porta explícita e sem fragmento. A query é ignorada — alguns servidores
 * publicam a URL do serviço, outros a do próprio documento.
 */
function enderecoCompativel(location: string, alvo: SefazWsdlTarget): boolean {
  if (!location) return false
  let parsed: URL
  try {
    parsed = new URL(location)
  } catch {
    return false
  }
  return (
    parsed.protocol === "https:" &&
    parsed.hostname === alvo.host &&
    parsed.host === alvo.host &&
    parsed.username === "" &&
    parsed.password === "" &&
    parsed.pathname === alvo.path &&
    parsed.hash === ""
  )
}
