/**
 * Alvos de aquisição de WSDL — derivados do catálogo fechado (GOAL-017 · H-9/H-10).
 *
 * Este módulo NÃO declara URL, host, path ou UF alguma. Ele **projeta** as entradas já
 * versionadas em `SEFAZ_ENDPOINT_CATALOG` para a forma `<endpoint>?wsdl`, e só as entradas
 * `HOMOLOGACAO/SP` marcadas `permitido: true`. Se o catálogo mudar, os alvos mudam junto; não
 * existe segunda fonte de verdade para manter em sincronia.
 *
 * ⛔ Nenhuma função aqui aceita URL, host, domínio, porta, path ou query vindos do chamador.
 * A única entrada é a tupla fechada `(uf, ambiente, serviço, versão)` — a mesma de
 * `selectSefazEndpoint`. Produção e host NF-e são inalcançáveis **por construção**: o primeiro
 * está catalogado como negado, o segundo não existe no catálogo.
 *
 * A query é o literal `?wsdl` e nada mais. `sefazEndpointIntegro` exige `search === ""` no
 * endpoint SOAP; aqui a verificação estrutural é a mesma, com a única diferença de exigir
 * `search === "?wsdl"` — a comparação é por igualdade exata, jamais por `includes`/prefixo.
 */
import {
  SEFAZ_ENDPOINT_CATALOG,
  SEFAZ_LAYOUT_VERSAO,
  sefazEndpointIntegro,
  type SefazAmbienteCatalogo,
  type SefazEndpoint,
  type SefazLayoutVersao,
  type SefazServico,
  type SefazUf,
} from "../sefaz-endpoint-catalog"

/** Sufixo literal do documento WSDL. Único acréscimo permitido sobre a URL catalogada. */
export const SEFAZ_WSDL_QUERY = "wsdl" as const

/** Método da futura aquisição. Fixo: metadados são lidos, nunca transmitidos. */
export const SEFAZ_WSDL_METHOD = "GET" as const

/**
 * Operação canônica esperada para serviços cujo WSDL publica múltiplas operações no mesmo binding SOAP 1.2.
 *
 * `NFeAutorizacao4` publica `nfeAutorizacaoLote` (leiaute padrão XML / enviNFe) e `nfeAutorizacaoLoteZip`
 * (comprimido GZip em Base64). O piloto NFC-e transmite lote XML não-compactado via `nfeAutorizacaoLote`.
 *
 * Serviços sem entrada aqui não toleram ambiguidade: bindings com mais de uma operação falham fechados.
 */
export const SEFAZ_WSDL_EXPECTED_OPERATIONS: Readonly<Partial<Record<SefazServico, string>>> =
  Object.freeze({
    NFeAutorizacao4: "nfeAutorizacaoLote",
  })

export type SefazWsdlTarget = {
  readonly uf: SefazUf
  readonly ambiente: SefazAmbienteCatalogo
  readonly servico: SefazServico
  readonly versao: SefazLayoutVersao
  /** Endpoint canônico do qual este alvo foi projetado. */
  readonly endpoint: SefazEndpoint
  /** `https://<host>/ws/<Serviço>.asmx?wsdl` — projetada, nunca montada a partir de entrada. */
  readonly url: string
  readonly host: string
  readonly path: string
  readonly namespace: string
  /**
   * Operação canônica esperada no binding SOAP 1.2 quando o serviço publica múltiplos métodos.
   * Se ausente, o extrator recusa bindings com mais de uma wsdl:operation.
   */
  readonly expectedOperationName?: string
}

function alvo(endpoint: SefazEndpoint): SefazWsdlTarget {
  const expectedOperationName = SEFAZ_WSDL_EXPECTED_OPERATIONS[endpoint.servico]
  return Object.freeze({
    uf: endpoint.uf,
    ambiente: endpoint.ambiente,
    servico: endpoint.servico,
    versao: endpoint.versao,
    endpoint,
    url: `${endpoint.url}?${SEFAZ_WSDL_QUERY}`,
    host: endpoint.host,
    path: `/ws/${endpoint.servico}.asmx`,
    namespace: endpoint.namespace,
    ...(expectedOperationName ? { expectedOperationName } : {}),
  })
}

/**
 * Allow-list completa e congelada da aquisição: exatamente as entradas de homologação SP do
 * catálogo que já são `permitido` e estruturalmente íntegras.
 *
 * Produção **não** é projetada nem como entrada negada: uma capacidade de rede não precisa de
 * uma linha apontando para produção para recusá-la — precisa de nenhuma linha.
 */
export const SEFAZ_WSDL_ACQUISITION_TARGETS: readonly SefazWsdlTarget[] = Object.freeze(
  SEFAZ_ENDPOINT_CATALOG.filter(
    (endpoint) =>
      endpoint.ambiente === "HOMOLOGACAO" && endpoint.permitido && sefazEndpointIntegro(endpoint),
  ).map(alvo),
)

export type SefazWsdlTargetErrorCode = "alvo_desconhecido" | "alvo_nao_permitido" | "alvo_invalido"

export type SefazWsdlTargetLookup =
  | { readonly ok: true; readonly alvo: SefazWsdlTarget }
  | {
      readonly ok: false
      readonly codigo: SefazWsdlTargetErrorCode
      readonly mensagem: string
    }

/**
 * Última barreira estrutural, executada mesmo sobre a lista projetada. Ela existe pelo mesmo
 * motivo de `sefazEndpointIntegro`: se alguém editar o catálogo para um host, protocolo ou path
 * inseguro, a projeção não deve herdar o defeito em silêncio.
 */
export function sefazWsdlTargetIntegro(target: SefazWsdlTarget): boolean {
  if (!sefazEndpointIntegro(target.endpoint)) return false
  if (target.ambiente !== "HOMOLOGACAO" || target.uf !== "SP") return false
  if (target.host !== target.endpoint.host) return false
  if (target.expectedOperationName !== SEFAZ_WSDL_EXPECTED_OPERATIONS[target.servico]) return false

  let parsed: URL
  try {
    parsed = new URL(target.url)
  } catch {
    return false
  }
  return (
    parsed.protocol === "https:" &&
    parsed.hostname === target.host &&
    parsed.host === target.host && // rejeita porta explícita
    parsed.username === "" &&
    parsed.password === "" &&
    parsed.pathname === target.path &&
    parsed.pathname === `/ws/${target.servico}.asmx` &&
    parsed.search === `?${SEFAZ_WSDL_QUERY}` &&
    parsed.hash === ""
  )
}

/**
 * Seleciona o alvo pela tupla fechada. Um `ambiente` que exista no catálogo mas não na
 * allow-list de aquisição (produção) recebe código PRÓPRIO e auditável — não o genérico
 * "desconhecido" —, para que a trilha registre a tentativa pelo que ela foi.
 */
export function selectSefazWsdlTarget(input: {
  uf: string
  ambiente: string
  servico: string
  versao?: string
}): SefazWsdlTargetLookup {
  const versao = input.versao ?? SEFAZ_LAYOUT_VERSAO

  const permitido = SEFAZ_WSDL_ACQUISITION_TARGETS.find(
    (candidato) =>
      candidato.uf === input.uf &&
      candidato.ambiente === input.ambiente &&
      candidato.servico === input.servico &&
      candidato.versao === versao,
  )
  if (permitido) {
    if (!sefazWsdlTargetIntegro(permitido)) {
      return {
        ok: false,
        codigo: "alvo_invalido",
        mensagem: "Alvo WSDL projetado não passou na verificação estrutural (host/protocolo/query).",
      }
    }
    return { ok: true, alvo: permitido }
  }

  // Existe no catálogo SOAP, mas está fora da allow-list de aquisição (produção, ou entrada
  // catalogada como negada). Recusa específica, antes de qualquer preparo de rede.
  const catalogado = SEFAZ_ENDPOINT_CATALOG.some(
    (endpoint) =>
      endpoint.uf === input.uf &&
      endpoint.ambiente === input.ambiente &&
      endpoint.servico === input.servico &&
      endpoint.versao === versao,
  )
  if (catalogado) {
    return {
      ok: false,
      codigo: "alvo_nao_permitido",
      mensagem: "Endpoint catalogado fora da allow-list de aquisição de WSDL (somente HOMOLOGACAO/SP).",
    }
  }

  return {
    ok: false,
    codigo: "alvo_desconhecido",
    mensagem: "Combinação de UF, ambiente, serviço e versão não consta do catálogo oficial.",
  }
}

/**
 * Re-resolve um alvo recebido como objeto e devolve a entrada CANÔNICA da allow-list.
 *
 * Um objeto forjado com `url`/`host` livres não atravessa: o destino efetivo vem sempre da
 * projeção do catálogo, e cada campo do candidato é conferido contra ela por igualdade.
 */
export function canonicalSefazWsdlTarget(candidato: SefazWsdlTarget): SefazWsdlTarget | null {
  const canonico = SEFAZ_WSDL_ACQUISITION_TARGETS.find(
    (entrada) =>
      entrada.uf === candidato.uf &&
      entrada.ambiente === candidato.ambiente &&
      entrada.servico === candidato.servico &&
      entrada.versao === candidato.versao,
  )
  if (
    !canonico ||
    !sefazWsdlTargetIntegro(canonico) ||
    candidato.url !== canonico.url ||
    candidato.host !== canonico.host ||
    candidato.path !== canonico.path ||
    candidato.namespace !== canonico.namespace ||
    candidato.expectedOperationName !== canonico.expectedOperationName
  ) {
    return null
  }
  return canonico
}
