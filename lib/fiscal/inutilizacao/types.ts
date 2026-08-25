/**
 * Contrato tipado da fundação OFFLINE de inutilização NFC-e (GOAL 019).
 *
 * Derivado do grafo oficial `PL_010d_v1.03` (`leiauteInutNFe_v4.00.xsd` + `tiposBasico_v4.00.xsd`)
 * e dos entrypoints `inutNFe_v4.00.xsd` / `retInutNFe_v4.00.xsd`. Sem rede SEFAZ.
 */

export const INUTILIZACAO_XMLNS = "http://www.portalfiscal.inf.br/nfe" as const
export const INUTILIZACAO_VERSAO = "4.00" as const
export const INUTILIZACAO_XSERV = "INUTILIZAR" as const
export const INUTILIZACAO_MODELO_NFCE = "65" as const
export const INUTILIZACAO_MAX_FAIXA = 10_000
export const INUTILIZACAO_ANO_MINIMO = 2006
export const INUTILIZACAO_JUSTIFICATIVA_MIN = 15
export const INUTILIZACAO_JUSTIFICATIVA_MAX = 255

/** `TCnpj` vigente no grafo da inutilização (NT 2026.004 / tiposBasico 4.00). */
export const TCNPJ_PATTERN = /^[0-9A-Z]{12}[0-9]{2}$/
/** `TSerie` */
export const TSERIE_PATTERN = /^(0|[1-9][0-9]{0,2})$/
/** `TNF` */
export const TNF_PATTERN = /^[1-9][0-9]{0,8}$/
/** `Tano` */
export const TANO_PATTERN = /^[0-9]{2}$/
/** `TAmb` */
export const TAMB_VALUES = ["1", "2"] as const
/** Id de `infInut` no pedido — `leiauteInutNFe_v4.00.xsd` (CNPJ alfanumérico). */
export const INF_INUT_ID_PATTERN = /^ID[0-9]{4}[0-9A-Z]{12}[0-9]{25}$/
/** `TProt` do mesmo `tiposBasico_v4.00.xsd` incluído pelo leiaute. */
export const TPROT_PATTERN = /^([0-9]{15}|[0-9]{17})$/
/** `TStat` */
export const TSTAT_PATTERN = /^[0-9]{3,4}$/
/** `TString` (usado por `TJust`). */
export const TSTRING_PATTERN = /^[!-ÿ](?:[ -ÿ]*[!-ÿ])?$/

export const TCOD_UF_IBGE = Object.freeze([
  "11", "12", "13", "14", "15", "16", "17",
  "21", "22", "23", "24", "25", "26", "27", "28", "29",
  "31", "32", "33", "35",
  "41", "42", "43",
  "50", "51", "52", "53",
] as const)
export type TCodUfIbge = (typeof TCOD_UF_IBGE)[number]

export type InutilizacaoAmbiente = (typeof TAMB_VALUES)[number]

export type InutilizacaoPedidoInput = {
  readonly tpAmb: InutilizacaoAmbiente
  readonly cUF: string
  readonly ano: string
  readonly cnpj: string
  readonly modelo: string
  readonly serie: string
  readonly nNFIni: string | number
  readonly nNFFin: string | number
  readonly xJust: string
  /**
   * Ano civil de referência (AAAA) para I02b — “ano não pode ser superior ao ano atual”.
   * Injetado pelo chamador; a fundação não lê o relógio sozinha.
   */
  readonly anoCalendario?: number
}

export type InutilizacaoPedidoNormalizado = {
  readonly tpAmb: InutilizacaoAmbiente
  readonly cUF: TCodUfIbge
  readonly ano: string
  readonly cnpj: string
  readonly modelo: typeof INUTILIZACAO_MODELO_NFCE
  readonly serie: string
  readonly nNFIni: string
  readonly nNFFin: string
  readonly nIni: number
  readonly nFin: number
  readonly xJust: string
  readonly id: string
}

export type InutilizacaoIssueCode =
  | "campo_obrigatorio"
  | "ambiente_invalido"
  | "uf_invalida"
  | "ano_invalido"
  | "ano_inferior_minimo"
  | "ano_superior_atual"
  | "cnpj_invalido"
  | "modelo_incompativel"
  | "serie_invalida"
  | "numero_invalido"
  | "intervalo_invalido"
  | "intervalo_excede_limite"
  | "justificativa_invalida"
  | "id_invalido"

export type InutilizacaoIssue = {
  readonly code: InutilizacaoIssueCode
  readonly campo: string
  readonly mensagem: string
}

export type InutilizacaoValidationResult =
  | { readonly ok: true; readonly pedido: InutilizacaoPedidoNormalizado; readonly issues: [] }
  | { readonly ok: false; readonly pedido: null; readonly issues: readonly InutilizacaoIssue[] }

export type InutilizacaoBuildResult =
  | { readonly ok: true; readonly xml: string; readonly id: string; readonly pedido: InutilizacaoPedidoNormalizado }
  | { readonly ok: false; readonly xml: null; readonly id: null; readonly issues: readonly InutilizacaoIssue[] }

export type InutilizacaoOutcome = "SUCCESS" | "REJECTED" | "MALFORMED" | "UNKNOWN"

export type InutilizacaoReason =
  | "INUTILIZACAO_HOMOLOGADA"
  | "REJEICAO_DEFINITIVA"
  | "MALFORMED_RESPONSE"
  | "MISSING_CSTAT"
  | "AMBIGUOUS_RESPONSE"
  | "INCOMPLETE_SUCCESS"
  | "UNKNOWN"

export type InutilizacaoClassification = {
  readonly outcome: InutilizacaoOutcome
  readonly reason: InutilizacaoReason
  readonly cStat: string | null
  readonly xMotivo: string | null
  readonly protocolo: string | null
  readonly rotulo: string
  /**
   * Sempre `false` nesta fundação. UNKNOWN jamais autoriza retry automático.
   * Nenhuma política de retransmissão é criada neste GOAL.
   */
  readonly retryAutomatico: false
}

export class InutilizacaoError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = "InutilizacaoError"
    this.code = code
  }
}
