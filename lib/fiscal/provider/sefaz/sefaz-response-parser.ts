/**
 * Parser ESTRITO de resposta SOAP 1.2 da SEFAZ (GOAL-016D-B · plano 016D D2 · ADR-0020).
 *
 * Módulo **puro e offline**: recebe bytes (ou string) já obtidos por outra camada e devolve uma
 * classificação. Não abre socket, não lê cofre, não toca banco, não conhece `storeId`.
 *
 * ## A regra que organiza tudo: caminho estrutural, nunca busca global
 *
 * ⛔ Este parser **jamais** procura a primeira ocorrência de `cStat`, `nProt`, `nRec` ou
 * `xMotivo` no documento. Cada valor é lido num **caminho fixo, namespace-qualificado,
 * declarado no contrato do serviço esperado** — e precisa ser **único** naquele caminho.
 *
 * A diferença não é estética. Uma resposta de autorização síncrona contém DOIS `cStat`
 * legítimos: o do lote (`retEnviNFe/cStat` = `104`) e o do documento
 * (`retEnviNFe/protNFe/infProt/cStat` = `100`). Uma busca global "acha" um deles por acidente
 * de ordem, e um chamariz plantado por um intermediário decide o desfecho fiscal. Por isso:
 *
 *  - o `cStat` do lote é lido em `payload/cStat`, e **só** ali;
 *  - `104` não é desfecho: instrui a **descida** determinística ao protocolo interno;
 *  - comentários, CDATA, elementos homônimos em outro namespace e elementos aninhados fora do
 *    caminho **não participam** da classificação;
 *  - dois valores no mesmo caminho ⇒ `AMBIGUOUS_RESPONSE`, nunca "o primeiro vence".
 *
 * ## Fail-closed, sempre para o mesmo lado
 *
 * Resposta ambígua, mal-formada ou estruturalmente divergente termina em **`UNCERTAIN`** —
 * nunca em `REJECTED` (que consumiria o número por desconhecimento) e nunca em `AUTHORIZED`
 * (que daria por autorizado um documento que ninguém leu).
 *
 * ## O parser não inventa XML autorizado
 *
 * `AUTHORIZED` exige `cStat 100` **e** protocolo não vazio **e** um XML autorizado
 * **verificável extraído verbatim da própria resposta**. O parser não monta `nfeProc`
 * concatenando os bytes assinados com o protocolo: isso é produção de documento fiscal, não
 * leitura de resposta. Faltando protocolo ou XML ⇒ `UNCERTAIN/INCOMPLETE_AUTHORIZATION`.
 *
 * ⚠️ E o XML aceito precisa ser **do mesmo documento**: chave, protocolo e `cStat` internos do
 * `nfeProc` são conferidos contra os já lidos, e o `nfeProc` é localizado por caminho
 * estrutural — não por varredura. Sem isso, uma resposta com o `cStat`/`nProt` do documento A
 * carregando o `nfeProc` do documento B autorizaria A com o XML de B, que `markAuthorized`
 * grava de forma **imutável** (achado BLOQUEANTE da revisão independente).
 *
 * ⚠️ **Consequência honesta e conhecida:** nenhum dos Web Services do piloto devolve `nfeProc`
 * na resposta — devolvem `protNFe`. Logo, com respostas reais, um `100` classifica hoje como
 * `INCOMPLETE_AUTHORIZATION`. A montagem do `nfeProc` (bytes assinados + protocolo) é trabalho
 * do slice que fizer o transporte real (016D-C/016D-D) e exige GOAL próprio; antecipá-la aqui
 * seria exatamente "inventar XML autorizado".
 *
 * ## Escopo do documento é do CHAMADOR
 *
 * `chaveAcessoEsperada` é **obrigatória** e validada em runtime (44 dígitos). Ela é a única
 * autoridade de escopo: a chave declarada pela resposta é apenas **conferida** contra ela, e
 * nunca a substitui. Sem esse contexto o parser recusa a leitura inteira
 * (`MISSING_DOCUMENT_CONTEXT`) — porque uma resposta perfeitamente bem-formada de OUTRO
 * documento é indistinguível de uma correta quando não se sabe o que se esperava.
 *
 * ## Segredo e vazamento
 *
 * Nenhuma saída deste módulo contém o corpo da resposta, o envelope, o XML do documento ou
 * qualquer trecho de markup. `xMotivo` é sanitizado (markup removido, tamanho limitado) antes
 * de sair. Mensagens são construídas a partir de constantes + código + `xMotivo` sanitizado.
 *
 * ## Pendências que limitam a FIDELIDADE (não a lógica)
 *
 * **H-9 / H-10** seguem abertas: o `SOAPAction` e o WSDL não estão no repositório e buscá-los
 * seria chamar a SEFAZ, vedado neste GOAL. O nome do wrapper de resposta (`nfeResultMsg`) e os
 * namespaces vêm do MOC 7.00 já versionado. Se o WSDL revelar divergência, muda-se o contrato
 * declarado abaixo — a lógica de classificação é independente do wire.
 */
import { attrOf, childElements, parseXml, textOf, type C14nElement } from "@/lib/fiscal/signing/c14n"
import type {
  FiscalConsultationResult,
  FiscalTransmissionResult,
} from "@/lib/fiscal/emission/uncertain-state.types"
import {
  SEFAZ_CONSEQUENCIA_ESTRUTURAL,
  SEFAZ_CONSEQUENCIA_INDETERMINADA,
  SEFAZ_CSTAT_MATRIX_VERSION,
  lookupSefazCStat,
  type SefazFiscalConsequences,
  type SefazResponseReason,
} from "./sefaz-cstat-matrix"
import { sefazServiceNamespace, type SefazServico } from "./sefaz-endpoint-catalog"

const SOAP12_NS = "http://www.w3.org/2003/05/soap-envelope"
const SOAP11_NS = "http://schemas.xmlsoap.org/soap/envelope/"
/** Namespace do leiaute NF-e/NFC-e 4.00. Comparação por igualdade EXATA — nunca por prefixo. */
const NFE_NS = "http://www.portalfiscal.inf.br/nfe"

/** Wrapper de resposta publicado pelo MOC 7.00 para os serviços do piloto. */
const WRAPPER_RESPOSTA = "nfeResultMsg"

/** Teto de corpo aceito (D5: resposta ≤ 2 MB). Excedeu ⇒ aborta sem parsear. */
export const SEFAZ_MAX_RESPONSE_BYTES = 2 * 1024 * 1024

/** Tamanho máximo do `xMotivo` propagado. O resto é descartado, não truncado silenciosamente. */
const MAX_XMOTIVO = 255

/** Chave de acesso da NF-e/NFC-e: exatamente 44 dígitos. */
const CHAVE_ACESSO = /^\d{44}$/

/**
 * Excede o teto quando medido em **bytes UTF-8**?
 *
 * Dois atalhos evitam materializar a codificação de um corpo absurdo:
 *  - UTF-8 usa no mínimo 1 byte por unidade UTF-16 ⇒ `length > teto` já reprova;
 *  - usa no máximo 3 bytes por unidade (o par substituto vira 4 bytes para 2 unidades) ⇒
 *    `length * 3 <= teto` já aprova.
 * Só a faixa intermediária paga a medição exata.
 */
function excedeTetoUtf8(valor: string): boolean {
  if (valor.length > SEFAZ_MAX_RESPONSE_BYTES) return true
  if (valor.length * 3 <= SEFAZ_MAX_RESPONSE_BYTES) return false
  return new TextEncoder().encode(valor).byteLength > SEFAZ_MAX_RESPONSE_BYTES
}

export type SefazResponseOutcome =
  | "AUTHORIZED"
  | "REJECTED"
  | "PROCESSING"
  | "THROTTLED"
  | "NOT_FOUND"
  | "UNCERTAIN"

/**
 * Contrato ESTRUTURAL de resposta por serviço. Fechado: um serviço sem contrato aqui não é
 * parseável e a resposta cai em `SERVICE_MISMATCH` — em vez de ser lida "no melhor esforço".
 */
type SefazResponseContract = {
  /** Elemento raiz do payload dentro do wrapper, no namespace `NFE_NS`. */
  readonly payloadRoot: string
  /** Caminho do recibo a partir do payload root. `null` ⇒ o serviço não devolve recibo. */
  readonly reciboPath: readonly string[] | null
  /** `true` ⇒ `cStat 104` manda descer a `protNFe/infProt` para achar o desfecho do documento. */
  readonly protocoloNoLote: boolean
}

const CONTRATOS: Readonly<Partial<Record<SefazServico, SefazResponseContract>>> = Object.freeze({
  NFeAutorizacao4: Object.freeze({
    payloadRoot: "retEnviNFe",
    reciboPath: Object.freeze(["infRec", "nRec"]),
    protocoloNoLote: true,
  }),
  NFeRetAutorizacao4: Object.freeze({
    payloadRoot: "retConsReciNFe",
    reciboPath: Object.freeze(["nRec"]),
    protocoloNoLote: true,
  }),
  NFeConsultaProtocolo4: Object.freeze({
    payloadRoot: "retConsSitNFe",
    reciboPath: null,
    protocoloNoLote: false,
  }),
})

/** Serviços com contrato de resposta neste slice. Os demais falham fechado por construção. */
export const SEFAZ_SERVICOS_COM_PARSER: readonly SefazServico[] = Object.freeze(
  Object.keys(CONTRATOS) as SefazServico[],
)

export type SefazResponseClassification = {
  readonly outcome: SefazResponseOutcome
  readonly reason: SefazResponseReason
  /** Serviço que o CHAMADOR esperava — nunca inferido da resposta. */
  readonly servico: SefazServico
  readonly cStat: string | null
  /** Sanitizado: sem markup, sem quebras, ≤ 255 caracteres. */
  readonly xMotivo: string | null
  readonly protocolo: string | null
  readonly recibo: string | null
  /** Só preenchido quando extraído VERBATIM da resposta e revalidado. Nunca montado. */
  readonly xmlAutorizado: string | null
  readonly consequencias: SefazFiscalConsequences
  /** Mensagem estável para trilha. **Nunca** contém markup nem corpo de resposta. */
  readonly mensagem: string
  readonly matrixVersion: typeof SEFAZ_CSTAT_MATRIX_VERSION
}

/** Remove markup e ruído de qualquer texto vindo da resposta antes de ele sair do parser. */
function textoSeguro(valor: string): string {
  return valor
    .replace(/<[^>]*>/g, " ")
    .replace(/[<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_XMOTIVO)
}

function classificacao(input: {
  outcome: SefazResponseOutcome
  reason: SefazResponseReason
  servico: SefazServico
  mensagem: string
  cStat?: string | null
  xMotivo?: string | null
  protocolo?: string | null
  recibo?: string | null
  xmlAutorizado?: string | null
  consequencias?: SefazFiscalConsequences
}): SefazResponseClassification {
  return {
    outcome: input.outcome,
    reason: input.reason,
    servico: input.servico,
    cStat: input.cStat ?? null,
    xMotivo: input.xMotivo ?? null,
    protocolo: input.protocolo ?? null,
    recibo: input.recibo ?? null,
    xmlAutorizado: input.xmlAutorizado ?? null,
    consequencias: input.consequencias ?? SEFAZ_CONSEQUENCIA_ESTRUTURAL,
    mensagem: input.mensagem,
    matrixVersion: SEFAZ_CSTAT_MATRIX_VERSION,
  }
}

function incerto(
  servico: SefazServico,
  reason: SefazResponseReason,
  mensagem: string,
  extras: { cStat?: string | null; xMotivo?: string | null; consequencias?: SefazFiscalConsequences } = {},
): SefazResponseClassification {
  return classificacao({ outcome: "UNCERTAIN", reason, servico, mensagem, ...extras })
}

/** Decodificação ESTRITA: `fatal` recusa sequência inválida em vez de trocá-la por U+FFFD. */
function decodificarUtf8Estrito(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes)
  } catch {
    return null
  }
}

function comecaComBom(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
}

/**
 * Filhos-elemento diretos com nome local E namespace exatos.
 *
 * Envolve `childElements` para garantir que o namespace SEMPRE seja exigido: a versão sem
 * namespace casaria `<cStat xmlns="qualquer-coisa">`, que é precisamente o chamariz que este
 * parser existe para ignorar.
 */
function filhos(pai: C14nElement, nome: string, ns: string): C14nElement[] {
  return childElements(pai, nome, ns).filter((filho) => filho.namespaceUri === ns)
}

type UnicoResultado =
  | { readonly ok: true; readonly elemento: C14nElement }
  | { readonly ok: false; readonly reason: "ausente" | "ambiguo" }

/** Exige EXATAMENTE um filho no caminho. Zero e "mais de um" são falhas distintas. */
function unico(pai: C14nElement, nome: string, ns: string): UnicoResultado {
  const encontrados = filhos(pai, nome, ns)
  if (encontrados.length === 0) return { ok: false, reason: "ausente" }
  if (encontrados.length > 1) return { ok: false, reason: "ambiguo" }
  return { ok: true, elemento: encontrados[0]! }
}

/** Percorre um caminho exigindo unicidade em cada passo. Qualquer desvio devolve `null`. */
function textoNoCaminho(raiz: C14nElement, caminho: readonly string[]): string | null {
  let atual = raiz
  for (const passo of caminho) {
    const encontrado = unico(atual, passo, NFE_NS)
    if (!encontrado.ok) return null
    atual = encontrado.elemento
  }
  // Valor precisa ser texto puro: um elemento com filhos-elemento não é um valor escalar.
  if (atual.children.some((filho) => filho.type === "element")) return null
  const valor = textOf(atual).trim()
  return valor.length > 0 ? valor : null
}

/**
 * Identificadores fiscais (`nProt`, `nRec`) são NUMÉRICOS no leiaute 4.00.
 *
 * A validação é estrita de propósito, e não uma sanitização. Estes valores são persistidos —
 * `nProt` vai para `NotaFiscal.protocolo`, que é **imutável** depois de gravado — e viajam para
 * `FiscalLog`. Um `nProt` contendo `&lt;x&gt;` chega aqui já decodificado como `<x>` e passaria
 * markup adiante. Formato inesperado ⇒ `null` ⇒ o desfecho cai fechado, em vez de gravar lixo
 * numa coluna que nunca mais pode ser corrigida.
 */
function numeroFiscal(valor: string | null): string | null {
  return valor && /^\d{1,20}$/.test(valor) ? valor : null
}

/**
 * Extrai o XML autorizado — **vinculado ao documento que a resposta acabou de classificar**.
 *
 * ⚠️ Uma versão anterior varria o texto inteiro atrás de `<nfeProc>` e o devolvia sem conferir
 * a quem ele pertencia. A revisão independente demonstrou o ataque: uma resposta com
 * `cStat=100` e `nProt` do documento A, carregando um `nfeProc` do documento **B**, produzia
 * `AUTHORIZED` com o XML de B — que `markAuthorized` gravaria de forma **imutável** na nota de
 * A. O erro era o mesmo que o parser combate no `cStat`: leitura global em vez de caminho
 * estrutural.
 *
 * Agora o `nfeProc` é localizado como **filho direto do payload** e só é aceito quando todos os
 * seus identificadores internos batem com os já lidos: mesmo protocolo, mesma chave, mesmo
 * `cStat`, e `infNFe/@Id` igual a `NFe` + chave. Qualquer divergência devolve `null` — e o
 * `100` vira `INCOMPLETE_AUTHORIZATION`.
 *
 * O recorte final é por índice sobre o texto decodificado, **não** re-serialização: os bytes do
 * XML autorizado precisam sair exatamente como entraram (ADR-0017/0018).
 */
function extrairXmlAutorizadoVinculado(input: {
  payload: C14nElement
  texto: string
  cStat: string
  protocolo: string
  chaveAcesso: string
}): string | null {
  const nfeProc = unico(input.payload, "nfeProc", NFE_NS)
  if (!nfeProc.ok) return null

  const protNFe = unico(nfeProc.elemento, "protNFe", NFE_NS)
  if (!protNFe.ok) return null
  const infProt = unico(protNFe.elemento, "infProt", NFE_NS)
  if (!infProt.ok) return null
  if (numeroFiscal(textoNoCaminho(infProt.elemento, ["nProt"])) !== input.protocolo) return null
  if (textoNoCaminho(infProt.elemento, ["chNFe"]) !== input.chaveAcesso) return null
  if (textoNoCaminho(infProt.elemento, ["cStat"]) !== input.cStat) return null

  const nfe = unico(nfeProc.elemento, "NFe", NFE_NS)
  if (!nfe.ok) return null
  const infNFe = unico(nfe.elemento, "infNFe", NFE_NS)
  if (!infNFe.ok) return null
  if (attrOf(infNFe.elemento, "Id") !== `NFe${input.chaveAcesso}`) return null

  return recortarNfeProcVerbatim(input.texto)
}

/** Recorte literal do `nfeProc`. Ambiguidade textual (zero ou duas ocorrências) ⇒ `null`. */
function recortarNfeProcVerbatim(texto: string): string | null {
  const aberturas = [...texto.matchAll(/<nfeProc(?=[\s/>])/g)]
  const fechamentos = [...texto.matchAll(/<\/nfeProc\s*>/g)]
  if (aberturas.length !== 1 || fechamentos.length !== 1) return null
  const inicio = aberturas[0]!.index
  const fim = fechamentos[0]!.index
  if (inicio === undefined || fim === undefined || fim <= inicio) return null
  const recorte = texto.slice(inicio, fim + fechamentos[0]![0].length)
  try {
    const raiz = parseXml(recorte)
    if (raiz.name !== "nfeProc" || raiz.namespaceUri !== NFE_NS) return null
  } catch {
    return null
  }
  return recorte
}

/**
 * Classifica uma resposta SOAP 1.2 da SEFAZ contra o serviço ESPERADO pelo chamador.
 *
 * O `servico` é o contexto tipado de quem fez a chamada; ele nunca é inferido da resposta —
 * inferi-lo permitiria que a própria resposta escolhesse por qual contrato seria lida.
 */
export function parseSefazSoapResponse(input: {
  servico: SefazServico
  body: Uint8Array | string
  /**
   * Chave de acesso do documento que o chamador está processando. **Obrigatória.**
   *
   * É a única autoridade de escopo do parser. Sem ela não existe prova de que a resposta —
   * por mais bem-formada que esteja — pertence ao documento em curso, e um `AUTHORIZED`
   * poderia carimbar a nota errada. A chave declarada DENTRO da resposta nunca substitui esta:
   * ela é apenas conferida contra esta.
   */
  chaveAcessoEsperada: string
}): SefazResponseClassification {
  const { servico } = input

  const contrato = CONTRATOS[servico]
  if (!contrato) {
    return incerto(
      servico,
      "SERVICE_MISMATCH",
      `Serviço ${servico} não possui contrato de resposta neste slice; classificação recusada.`,
    )
  }

  // ── 0. Contexto do documento, antes de qualquer leitura da resposta ──────────────────────
  // Validação em runtime, não só no tipo: o parser é alcançável de fronteiras onde o
  // compilador não protege (JSON, `any`, chamador JS).
  if (typeof input.chaveAcessoEsperada !== "string" || !CHAVE_ACESSO.test(input.chaveAcessoEsperada)) {
    return incerto(
      servico,
      "MISSING_DOCUMENT_CONTEXT",
      "Chave de acesso esperada ausente ou inválida; classificação recusada sem contexto do documento.",
    )
  }
  const chaveAcessoEsperada = input.chaveAcessoEsperada

  // ── 1. Bytes → texto, sob regras estritas ────────────────────────────────────────────────
  let texto: string
  if (typeof input.body === "string") {
    if (input.body.charCodeAt(0) === 0xfeff) {
      return incerto(servico, "MALFORMED_RESPONSE", "Resposta SEFAZ inicia com BOM inesperado.")
    }
    /**
     * ⚠️ O teto é de **bytes**, não de caracteres. `string.length` conta unidades UTF-16: um
     * corpo de 1,5 milhão de caracteres CJK ocupa ~4,5 MB em UTF-8 e passaria por um teste
     * baseado em `length`. A verificação ocorre ANTES do parse — o custo do XXE/bilhão de
     * risadas está justamente em parsear, não em medir.
     */
    if (excedeTetoUtf8(input.body)) {
      return incerto(
        servico,
        "MALFORMED_RESPONSE",
        "Resposta SEFAZ excede o limite de corpo aceito; leitura abortada.",
      )
    }
    texto = input.body
  } else {
    if (input.body.length === 0) {
      return incerto(servico, "MALFORMED_RESPONSE", "Resposta SEFAZ vazia.")
    }
    if (input.body.length > SEFAZ_MAX_RESPONSE_BYTES) {
      return incerto(
        servico,
        "MALFORMED_RESPONSE",
        "Resposta SEFAZ excede o limite de corpo aceito; leitura abortada.",
      )
    }
    if (comecaComBom(input.body)) {
      return incerto(servico, "MALFORMED_RESPONSE", "Resposta SEFAZ inicia com BOM inesperado.")
    }
    const decodificado = decodificarUtf8Estrito(input.body)
    if (decodificado === null) {
      return incerto(servico, "MALFORMED_RESPONSE", "Resposta SEFAZ não é UTF-8 válido.")
    }
    texto = decodificado
  }
  if (texto.trim().length === 0) {
    return incerto(servico, "MALFORMED_RESPONSE", "Resposta SEFAZ vazia.")
  }

  // ── 2. Construções proibidas, verificadas ANTES do parser ────────────────────────────────
  // `parseXml` já recusa DTD/ENTITY; a checagem explícita existe para produzir um motivo
  // específico e para não depender de detalhe interno de outro módulo.
  if (/<!DOCTYPE\b/i.test(texto) || /<!ENTITY\b/i.test(texto)) {
    return incerto(
      servico,
      "MALFORMED_RESPONSE",
      "Resposta SEFAZ declara DTD ou entidade; leitura recusada.",
    )
  }
  /**
   * ⛔ CDATA é recusada por completo. Nenhuma resposta legítima dos serviços do piloto a usa, e
   * ela é o veículo natural de um chamariz: `<![CDATA[<cStat>100</cStat>]]>` some do DOM como
   * elemento e reaparece como texto. Recusar a resposta inteira é fail-closed (vira `UNCERTAIN`)
   * e dispensa raciocinar sobre onde a seção estava.
   */
  if (texto.includes("<![CDATA[")) {
    return incerto(
      servico,
      "MALFORMED_RESPONSE",
      "Resposta SEFAZ contém seção CDATA; leitura recusada por ambiguidade.",
    )
  }

  // ── 3. Parse sem reparo silencioso ───────────────────────────────────────────────────────
  let envelope: C14nElement
  try {
    envelope = parseXml(texto)
  } catch {
    return incerto(servico, "MALFORMED_RESPONSE", "Resposta SEFAZ não é XML bem-formado.")
  }

  // ── 4. Envelope e Body SOAP 1.2, exatamente um de cada ───────────────────────────────────
  if (envelope.name !== "Envelope" || envelope.namespaceUri !== SOAP12_NS) {
    const soap11 = envelope.name === "Envelope" && envelope.namespaceUri === SOAP11_NS
    return incerto(
      servico,
      "MALFORMED_RESPONSE",
      soap11
        ? "Resposta usa SOAP 1.1; o piloto exige SOAP 1.2."
        : "Resposta SEFAZ não tem um Envelope SOAP 1.2 na raiz.",
    )
  }
  const body = unico(envelope, "Body", SOAP12_NS)
  if (!body.ok) {
    return incerto(
      servico,
      body.reason === "ambiguo" ? "AMBIGUOUS_RESPONSE" : "MALFORMED_RESPONSE",
      body.reason === "ambiguo"
        ? "Envelope SOAP com mais de um Body; leitura ambígua recusada."
        : "Envelope SOAP sem Body.",
    )
  }

  // ── 5. SOAP Fault é identificado EXPLICITAMENTE, antes de procurar wrapper ───────────────
  // Um Fault convivendo com wrapper é ambíguo por definição; o Fault vence e o desfecho é
  // incerto — nunca se lê `cStat` de um corpo que já se declarou falho.
  if (filhos(body.elemento, "Fault", SOAP12_NS).length > 0) {
    return incerto(servico, "SOAP_FAULT", "Resposta SEFAZ é um SOAP Fault; desfecho desconhecido.")
  }

  // ── 6. Wrapper e namespace compatíveis com o serviço INFORMADO ──────────────────────────
  const wrapperNs = sefazServiceNamespace(servico)
  const elementosDoBody = childElements(body.elemento)
  if (elementosDoBody.length !== 1) {
    return incerto(
      servico,
      elementosDoBody.length === 0 ? "MALFORMED_RESPONSE" : "AMBIGUOUS_RESPONSE",
      elementosDoBody.length === 0
        ? "Body SOAP vazio."
        : "Body SOAP com mais de um elemento; leitura ambígua recusada.",
    )
  }
  const wrapper = elementosDoBody[0]!
  if (wrapper.name !== WRAPPER_RESPOSTA || wrapper.namespaceUri !== wrapperNs) {
    return incerto(
      servico,
      "SERVICE_MISMATCH",
      `Resposta não é ${WRAPPER_RESPOSTA} do serviço ${servico}; wrapper ou namespace divergente.`,
    )
  }

  // ── 7. Payload esperado do serviço ───────────────────────────────────────────────────────
  const elementosDoWrapper = childElements(wrapper)
  if (elementosDoWrapper.length !== 1) {
    return incerto(
      servico,
      elementosDoWrapper.length === 0 ? "MALFORMED_RESPONSE" : "AMBIGUOUS_RESPONSE",
      elementosDoWrapper.length === 0
        ? `${WRAPPER_RESPOSTA} sem payload.`
        : `${WRAPPER_RESPOSTA} com mais de um payload; leitura ambígua recusada.`,
    )
  }
  const payload = elementosDoWrapper[0]!
  if (payload.name !== contrato.payloadRoot || payload.namespaceUri !== NFE_NS) {
    return incerto(
      servico,
      "SERVICE_MISMATCH",
      `Payload da resposta não é ${contrato.payloadRoot} no namespace NF-e.`,
    )
  }

  return classificarPayload({ servico, contrato, payload, texto, chaveAcessoEsperada })
}

function classificarPayload(input: {
  servico: SefazServico
  contrato: SefazResponseContract
  payload: C14nElement
  texto: string
  chaveAcessoEsperada: string
}): SefazResponseClassification {
  const { servico, contrato, payload } = input

  // ── 8. Exatamente um `cStat` no caminho esperado ─────────────────────────────────────────
  const cStatElemento = unico(payload, "cStat", NFE_NS)
  if (!cStatElemento.ok) {
    return incerto(
      servico,
      cStatElemento.reason === "ambiguo" ? "AMBIGUOUS_RESPONSE" : "MISSING_CSTAT",
      cStatElemento.reason === "ambiguo"
        ? "Resposta traz mais de um cStat no caminho esperado; classificação recusada."
        : "Resposta sem cStat no caminho esperado.",
    )
  }
  const cStatLote = textoNoCaminho(payload, ["cStat"])
  if (!cStatLote || !/^\d{3}$/.test(cStatLote)) {
    return incerto(servico, "MISSING_CSTAT", "cStat ausente ou ilegível no caminho esperado.")
  }

  const entradaLote = lookupSefazCStat(cStatLote, servico)
  if (!entradaLote.ok) {
    return incerto(
      servico,
      entradaLote.reason,
      entradaLote.reason === "UNKNOWN"
        ? `cStat ${cStatLote} não consta da matriz ${SEFAZ_CSTAT_MATRIX_VERSION}; desfecho incerto.`
        : `cStat ${cStatLote} é impossível na resposta de ${servico}; desfecho incerto.`,
      { cStat: cStatLote, xMotivo: lerXMotivo(payload), consequencias: SEFAZ_CONSEQUENCIA_INDETERMINADA },
    )
  }

  // ── 9. `104` não é desfecho: desce ao protocolo do documento ─────────────────────────────
  if (entradaLote.entry.outcome === "LOTE_PROCESSADO") {
    if (!contrato.protocoloNoLote) {
      return incerto(
        servico,
        "SERVICE_MISMATCH",
        `Resposta de ${servico} não comporta protocolo de lote.`,
        { cStat: cStatLote },
      )
    }
    return classificarProtocoloDoLote({
      servico,
      contrato,
      payload,
      texto: input.texto,
      cStatLote,
      chaveAcessoEsperada: input.chaveAcessoEsperada,
    })
  }

  return finalizar({
    servico,
    contrato,
    payload,
    texto: input.texto,
    escopo: payload,
    cStat: cStatLote,
    chaveAcessoEsperada: input.chaveAcessoEsperada,
  })
}

/**
 * Desce a `protNFe/infProt` e reclassifica pelo `cStat` do DOCUMENTO.
 *
 * A descida é estritamente determinística: um único `protNFe`, um único `infProt`, um único
 * `cStat` ali dentro. Qualquer pluralidade é ambiguidade — e ambiguidade é incerteza, não
 * "escolha a primeira".
 */
function classificarProtocoloDoLote(input: {
  servico: SefazServico
  contrato: SefazResponseContract
  payload: C14nElement
  texto: string
  cStatLote: string
  chaveAcessoEsperada: string
}): SefazResponseClassification {
  const { servico, payload } = input
  const protNFe = unico(payload, "protNFe", NFE_NS)
  if (!protNFe.ok) {
    return incerto(
      servico,
      protNFe.reason === "ambiguo" ? "AMBIGUOUS_RESPONSE" : "MISSING_CSTAT",
      protNFe.reason === "ambiguo"
        ? "Lote processado com mais de um protNFe; classificação recusada."
        : "Lote processado sem protNFe; desfecho do documento desconhecido.",
      { cStat: input.cStatLote },
    )
  }
  const infProt = unico(protNFe.elemento, "infProt", NFE_NS)
  if (!infProt.ok) {
    return incerto(
      servico,
      infProt.reason === "ambiguo" ? "AMBIGUOUS_RESPONSE" : "MISSING_CSTAT",
      infProt.reason === "ambiguo"
        ? "protNFe com mais de um infProt; classificação recusada."
        : "protNFe sem infProt; desfecho do documento desconhecido.",
      { cStat: input.cStatLote },
    )
  }
  const cStatElemento = unico(infProt.elemento, "cStat", NFE_NS)
  if (!cStatElemento.ok) {
    return incerto(
      servico,
      cStatElemento.reason === "ambiguo" ? "AMBIGUOUS_RESPONSE" : "MISSING_CSTAT",
      cStatElemento.reason === "ambiguo"
        ? "infProt traz mais de um cStat; classificação recusada."
        : "infProt sem cStat; desfecho do documento desconhecido.",
      { cStat: input.cStatLote },
    )
  }
  const cStatDocumento = textoNoCaminho(infProt.elemento, ["cStat"])
  if (!cStatDocumento || !/^\d{3}$/.test(cStatDocumento)) {
    return incerto(servico, "MISSING_CSTAT", "cStat do protocolo ausente ou ilegível.", {
      cStat: input.cStatLote,
    })
  }
  return finalizar({
    servico,
    contrato: input.contrato,
    payload,
    texto: input.texto,
    escopo: infProt.elemento,
    cStat: cStatDocumento,
    chaveAcessoEsperada: input.chaveAcessoEsperada,
  })
}

function lerXMotivo(escopo: C14nElement): string | null {
  const bruto = textoNoCaminho(escopo, ["xMotivo"])
  if (!bruto) return null
  const seguro = textoSeguro(bruto)
  return seguro.length > 0 ? seguro : null
}

/**
 * Aplica a matriz ao `cStat` já localizado no caminho correto e cobra os requisitos por
 * desfecho (protocolo, XML autorizado, recibo). Requisito não atendido **rebaixa** para
 * `UNCERTAIN`; nunca promove nem rejeita.
 */
function finalizar(input: {
  servico: SefazServico
  contrato: SefazResponseContract
  /** Payload root — origem do recibo, que é sempre de lote. */
  payload: C14nElement
  texto: string
  /** Escopo onde o `cStat` vencedor foi lido: o payload root, ou `infProt` após a descida. */
  escopo: C14nElement
  cStat: string
  chaveAcessoEsperada: string
}): SefazResponseClassification {
  const { servico, contrato, payload, escopo, cStat } = input
  const xMotivo = lerXMotivo(escopo)

  const lookup = lookupSefazCStat(cStat, servico)
  if (!lookup.ok) {
    return incerto(
      servico,
      lookup.reason,
      lookup.reason === "UNKNOWN"
        ? `cStat ${cStat} não consta da matriz ${SEFAZ_CSTAT_MATRIX_VERSION}; desfecho incerto.`
        : `cStat ${cStat} é impossível na resposta de ${servico}; desfecho incerto.`,
      { cStat, xMotivo, consequencias: SEFAZ_CONSEQUENCIA_INDETERMINADA },
    )
  }
  const entry = lookup.entry

  // `104` aninhado dentro do próprio protocolo seria recursão sem fim — e é impossível no
  // leiaute. Recusar explicitamente evita depender dessa impossibilidade.
  if (entry.outcome === "LOTE_PROCESSADO") {
    return incerto(servico, "AMBIGUOUS_RESPONSE", "cStat de lote em posição de documento.", {
      cStat,
      xMotivo,
    })
  }

  const protocolo =
    numeroFiscal(textoNoCaminho(escopo, ["nProt"])) ??
    numeroFiscal(textoNoCaminho(payload, ["protNFe", "infProt", "nProt"]))
  const recibo = contrato.reciboPath
    ? numeroFiscal(textoNoCaminho(payload, contrato.reciboPath))
    : null

  /**
   * Chave de acesso declarada pela resposta. Lida nos dois caminhos estruturais possíveis; se
   * ambos existirem e divergirem, a resposta fala de dois documentos ao mesmo tempo e nada
   * nela é confiável.
   */
  const chaveNoEscopo = textoNoCaminho(escopo, ["chNFe"])
  const chaveNoProtocolo = textoNoCaminho(payload, ["protNFe", "infProt", "chNFe"])
  if (chaveNoEscopo && chaveNoProtocolo && chaveNoEscopo !== chaveNoProtocolo) {
    return incerto(servico, "AMBIGUOUS_RESPONSE", "Resposta declara duas chaves de acesso.", {
      cStat,
      xMotivo,
    })
  }
  const chaveAcesso = chaveNoEscopo ?? chaveNoProtocolo

  /**
   * Uma resposta sobre OUTRO documento é divergência estrutural — não importa o quão
   * bem-formada esteja. Defesa contra resposta trocada, cache envenenado ou correlação perdida.
   */
  if (chaveAcesso && chaveAcesso !== input.chaveAcessoEsperada) {
    return incerto(
      servico,
      "DOCUMENT_MISMATCH",
      "Resposta pertence a outra chave de acesso; classificação recusada.",
      { cStat, xMotivo },
    )
  }

  if (entry.exigeProtocolo && !protocolo) {
    return incerto(
      servico,
      "INCOMPLETE_AUTHORIZATION",
      `cStat ${cStat} sem protocolo de autorização legível; desfecho tratado como incerto.`,
      { cStat, xMotivo, consequencias: SEFAZ_CONSEQUENCIA_INDETERMINADA },
    )
  }

  let xmlAutorizado: string | null = null
  if (entry.exigeXmlAutorizado) {
    /**
     * ⚠️ A autoridade do vínculo é `chaveAcessoEsperada` — a chave do CHAMADOR —, nunca a que a
     * resposta declara. `chaveAcesso` já foi provada igual a ela acima; exigi-la presente aqui
     * garante que nenhum `AUTHORIZED` saia de uma resposta que sequer diz de qual documento
     * fala, e usar a do chamador impede que a própria resposta defina o escopo que a valida.
     */
    xmlAutorizado = chaveAcesso
      ? extrairXmlAutorizadoVinculado({
          payload,
          texto: input.texto,
          cStat,
          protocolo: protocolo!,
          chaveAcesso: input.chaveAcessoEsperada,
        })
      : null
    if (!xmlAutorizado) {
      return incerto(
        servico,
        "INCOMPLETE_AUTHORIZATION",
        `cStat ${cStat} sem XML autorizado vinculado ao mesmo documento e protocolo; ` +
          "desfecho tratado como incerto.",
        { cStat, xMotivo, consequencias: SEFAZ_CONSEQUENCIA_INDETERMINADA },
      )
    }
  }

  if (entry.exigeRecibo && !recibo) {
    return incerto(
      servico,
      "PROCESSING_SEM_RECIBO",
      `cStat ${cStat} sem recibo (nRec); não há lote a consultar.`,
      { cStat, xMotivo, consequencias: SEFAZ_CONSEQUENCIA_INDETERMINADA },
    )
  }

  return classificacao({
    outcome: entry.outcome,
    reason: entry.reason,
    servico,
    cStat,
    xMotivo,
    protocolo,
    recibo,
    xmlAutorizado,
    consequencias: entry.consequencias,
    mensagem: `cStat ${cStat} (${entry.rotulo}) classificado como ${entry.outcome}.`,
  })
}

/**
 * Traduz a classificação para o desfecho de **transmissão** do coordenador (ADR-0017).
 *
 * `NOT_FOUND` não existe em transmissão — a matriz já impede `217` fora de consulta, e este
 * rebaixamento é a segunda barreira: um `NOT_FOUND` aqui viraria autorização de retransmissão
 * sem que consulta alguma tivesse ocorrido.
 */
export function toFiscalTransmissionResult(
  classification: SefazResponseClassification,
): FiscalTransmissionResult {
  if (classification.outcome === "AUTHORIZED") {
    return {
      outcome: "AUTHORIZED",
      protocolo: classification.protocolo!,
      cStat: classification.cStat!,
      xMotivo: classification.xMotivo ?? "",
      xmlAutorizado: classification.xmlAutorizado!,
    }
  }
  if (classification.outcome === "REJECTED") {
    return {
      outcome: "REJECTED",
      cStat: classification.cStat!,
      xMotivo: classification.xMotivo ?? "",
      consequences: classification.consequencias,
    }
  }
  if (classification.outcome === "PROCESSING") {
    return {
      outcome: "UNCERTAIN",
      code: "PROCESSING",
      message: classification.mensagem,
      cStat: classification.cStat!,
      xMotivo: classification.xMotivo ?? "",
      recibo: classification.recibo!,
      requiresConsultation: true,
    }
  }
  if (classification.outcome === "THROTTLED") {
    return {
      outcome: "UNCERTAIN",
      code: "THROTTLED",
      message: classification.mensagem,
      cStat: classification.cStat!,
      xMotivo: classification.xMotivo ?? "",
    }
  }
  return { outcome: "UNCERTAIN", code: "UNKNOWN", message: classification.mensagem }
}

/** Traduz a classificação para o desfecho de **consulta** do coordenador (ADR-0017). */
export function toFiscalConsultationResult(
  classification: SefazResponseClassification,
): FiscalConsultationResult {
  if (classification.outcome === "AUTHORIZED") {
    return {
      outcome: "AUTHORIZED",
      protocolo: classification.protocolo!,
      cStat: classification.cStat!,
      xMotivo: classification.xMotivo ?? "",
      xmlAutorizado: classification.xmlAutorizado!,
    }
  }
  if (classification.outcome === "REJECTED") {
    return {
      outcome: "REJECTED",
      cStat: classification.cStat!,
      xMotivo: classification.xMotivo ?? "",
      consequences: classification.consequencias,
    }
  }
  if (classification.outcome === "NOT_FOUND") {
    return {
      outcome: "NOT_FOUND",
      cStat: classification.cStat!,
      xMotivo: classification.xMotivo ?? "",
    }
  }
  if (classification.outcome === "PROCESSING") {
    return {
      outcome: "UNCERTAIN",
      code: "PROCESSING",
      message: classification.mensagem,
      cStat: classification.cStat!,
      xMotivo: classification.xMotivo ?? "",
      recibo: classification.recibo!,
      requiresConsultation: true,
    }
  }
  if (classification.outcome === "THROTTLED") {
    return {
      outcome: "UNCERTAIN",
      code: "THROTTLED",
      message: classification.mensagem,
      cStat: classification.cStat!,
      xMotivo: classification.xMotivo ?? "",
    }
  }
  return { outcome: "UNCERTAIN", code: "UNKNOWN", message: classification.mensagem }
}
