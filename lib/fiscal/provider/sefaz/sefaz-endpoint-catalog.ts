/**
 * Catálogo fechado de endpoints SEFAZ (GOAL-016D-A · plano 016D D3 · ADR-0020).
 *
 * Mapa ESTÁTICO e IMUTÁVEL `(uf, ambiente, serviço, versão) → URL`. Só entram aqui dados
 * oficiais JÁ VERSIONADOS no repositório (`docs/fiscal/FISCAL_SEFAZ_DOSSIE_UF_001.md §1`,
 * reconferidos no plano 016D §3.1). Nenhuma URL é construída por concatenação de entrada,
 * derivada de request/banco/resposta, nem descoberta em runtime.
 *
 * Anti-SSRF (D6 regra 4): host EXATO (nunca sufixo/regex), protocolo fixo `https:`, zero
 * redirecionamento, zero proxy dinâmico. O host da NFC-e (`nfce.fazenda.sp.gov.br`) é
 * DISTINTO do host da NF-e (`nfe.fazenda.sp.gov.br`) — confundir os dois é erro clássico e
 * está coberto por teste.
 *
 * Produção consta APENAS como explicitamente NEGADA (`permitido: false`), para que uma
 * tentativa produza erro auditado e específico em vez de "endpoint desconhecido" genérico.
 * Liberar produção exige o gate G-F12 e ADR própria — não este slice.
 *
 * ⚠️ `SOAPAction` NÃO é definida aqui: o MOC 7.00 não a publica (ela vem do WSDL) e este
 * GOAL não consulta `?wsdl`. Pendências H-9/H-10 permanecem abertas.
 */

/** UFs com catálogo publicado. O piloto (ADR-0016) é SP. */
export type SefazUf = "SP"

export type SefazAmbienteCatalogo = "HOMOLOGACAO" | "PRODUCAO"

/** Os seis Web Services NFC-e 4.00 publicados pela SEFAZ-SP. */
export type SefazServico =
  | "NFeAutorizacao4"
  | "NFeRetAutorizacao4"
  | "NFeConsultaProtocolo4"
  | "NFeStatusServico4"
  | "NFeInutilizacao4"
  | "NFeRecepcaoEvento4"

/** Versão do leiaute NFC-e publicada por SP (NT2016.002). */
export const SEFAZ_LAYOUT_VERSAO = "4.00" as const
export type SefazLayoutVersao = typeof SEFAZ_LAYOUT_VERSAO

/** Namespace WSDL canônico do MOC 7.00: `.../nfe/wsdl/<NomeDoWebService>`. */
export function sefazServiceNamespace(servico: SefazServico): string {
  return `http://www.portalfiscal.inf.br/nfe/wsdl/${servico}`
}

export type SefazEndpoint = {
  readonly uf: SefazUf
  readonly ambiente: SefazAmbienteCatalogo
  readonly servico: SefazServico
  readonly versao: SefazLayoutVersao
  /** URL oficial completa. Selecionada do mapa — nunca montada a partir de entrada. */
  readonly url: string
  /** Host exato esperado (comparação por igualdade, jamais por sufixo). */
  readonly host: string
  readonly namespace: string
  /** `false` ⇒ endpoint catalogado para ser NEGADO com erro explícito. */
  readonly permitido: boolean
  /** Motivo estável da negação (só quando `permitido === false`). */
  readonly motivoNegacao: string | null
}

const HOST_HOMOLOGACAO_SP = "homologacao.nfce.fazenda.sp.gov.br"
const HOST_PRODUCAO_SP = "nfce.fazenda.sp.gov.br"

const MOTIVO_PRODUCAO = "Ambiente de produção bloqueado — exige o gate G-F12 e ADR própria."

function entrada(
  ambiente: SefazAmbienteCatalogo,
  servico: SefazServico,
  host: string,
  permitido: boolean,
): SefazEndpoint {
  return Object.freeze({
    uf: "SP" as const,
    ambiente,
    servico,
    versao: SEFAZ_LAYOUT_VERSAO,
    url: `https://${host}/ws/${servico}.asmx`,
    host,
    namespace: sefazServiceNamespace(servico),
    permitido,
    motivoNegacao: permitido ? null : MOTIVO_PRODUCAO,
  })
}

const SERVICOS: readonly SefazServico[] = Object.freeze([
  "NFeAutorizacao4",
  "NFeRetAutorizacao4",
  "NFeConsultaProtocolo4",
  "NFeStatusServico4",
  "NFeInutilizacao4",
  "NFeRecepcaoEvento4",
])

/**
 * Catálogo completo e congelado. Homologação SP = allow-list do piloto; produção SP =
 * deny-list explícita. Nenhuma outra UF/ambiente/serviço existe neste slice.
 */
export const SEFAZ_ENDPOINT_CATALOG: readonly SefazEndpoint[] = Object.freeze([
  ...SERVICOS.map((servico) => entrada("HOMOLOGACAO", servico, HOST_HOMOLOGACAO_SP, true)),
  ...SERVICOS.map((servico) => entrada("PRODUCAO", servico, HOST_PRODUCAO_SP, false)),
])

export type SefazEndpointLookupErrorCode =
  | "endpoint_desconhecido"
  | "endpoint_nao_permitido"
  | "endpoint_invalido"

export type SefazEndpointLookup =
  | { readonly ok: true; readonly endpoint: SefazEndpoint }
  | {
      readonly ok: false
      readonly codigo: SefazEndpointLookupErrorCode
      readonly mensagem: string
    }

/**
 * Verificação estrutural do endpoint catalogado. Roda mesmo sobre o catálogo estático:
 * é a última barreira caso alguém edite uma entrada para um host/protocolo inseguro.
 *
 * Exportada para que essa última barreira seja testável de forma direta: como o catálogo
 * versionado é (corretamente) todo válido, não há entrada malformada para exercitá-la por
 * `selectSefazEndpoint`, e a barreira ficaria sem cobertura real.
 */
export function sefazEndpointIntegro(endpoint: SefazEndpoint): boolean {
  let parsed: URL
  try {
    parsed = new URL(endpoint.url)
  } catch {
    return false
  }
  return (
    parsed.protocol === "https:" &&
    parsed.hostname === endpoint.host &&
    parsed.host === endpoint.host && // rejeita porta explícita
    parsed.username === "" &&
    parsed.password === "" &&
    parsed.search === "" &&
    parsed.hash === "" &&
    parsed.pathname === `/ws/${endpoint.servico}.asmx`
  )
}

/**
 * Seleciona o endpoint pelo tupla fechada `(uf, ambiente, serviço, versão)`.
 *
 * NÃO aceita URL, host, domínio ou path como entrada — por construção não existe caminho
 * para um chamador injetar destino. Endpoint catalogado como negado devolve
 * `endpoint_nao_permitido` (auditável), não um genérico "desconhecido".
 */
export function selectSefazEndpoint(input: {
  uf: string
  ambiente: string
  servico: string
  versao?: string
}): SefazEndpointLookup {
  const versao = input.versao ?? SEFAZ_LAYOUT_VERSAO
  const endpoint = SEFAZ_ENDPOINT_CATALOG.find(
    (e) =>
      e.uf === input.uf &&
      e.ambiente === input.ambiente &&
      e.servico === input.servico &&
      e.versao === versao,
  )
  if (!endpoint) {
    return {
      ok: false,
      codigo: "endpoint_desconhecido",
      mensagem: "Combinação de UF, ambiente, serviço e versão não consta do catálogo oficial.",
    }
  }
  if (!endpoint.permitido) {
    return {
      ok: false,
      codigo: "endpoint_nao_permitido",
      mensagem: endpoint.motivoNegacao ?? "Endpoint catalogado como negado.",
    }
  }
  if (!sefazEndpointIntegro(endpoint)) {
    return {
      ok: false,
      codigo: "endpoint_invalido",
      mensagem: "Endpoint catalogado não passou na verificação estrutural (host/protocolo).",
    }
  }
  return { ok: true, endpoint }
}
