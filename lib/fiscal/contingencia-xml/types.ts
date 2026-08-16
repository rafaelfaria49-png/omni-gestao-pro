/**
 * Contratos do rebuild OFFLINE de XML NFC-e em contingência (GOAL 020B).
 *
 * Camada de reconstrução + assinatura + freeze. Sem persistência, transmissão,
 * numerador, Prisma ou rede. Reusa o builder/signer/chave canônicos.
 */
import type { FiscalCertificateMaterial } from "../signing/signer.types"
import type { VendaFiscalSnapshot } from "../venda-fiscal-snapshot"
import type { NormalToOfflineInput } from "../contingencia/types"
import { CONTINGENCIA_TP_EMIS } from "../contingencia/types"

export const CONTINGENCIA_XML_XJUST_MIN = 15
export const CONTINGENCIA_XML_XJUST_MAX = 256

export type ContingenciaXmlErrorCode =
  | "SIGNED_XML_IN_PLACE_PATCH_FORBIDDEN"
  | "pedido_invalido"
  | "conversao_proibida"
  | "nNF_ausente"
  | "serie_ausente"
  | "cNF_ausente"
  | "cNF_invalido"
  | "x_just_tamanho_invalido"
  | "uf_emitente_nao_piloto"
  | "xsd_invalido"
  | "xsd_engine_ausente"
  | "assinatura_invalida"
  | "id_inconsistente"

export class ContingenciaXmlError extends Error {
  readonly code: ContingenciaXmlErrorCode
  constructor(code: ContingenciaXmlErrorCode, message: string) {
    super(message)
    this.name = "ContingenciaXmlError"
    this.code = code
  }
}

export type ContingenciaXmlSignerInput = {
  certificado: FiscalCertificateMaterial
  senha?: string
  /** Instante injetado — o rebuild não chama Date.now(). */
  agora: Date
}

export type ContingenciaXmlOfflineInput = {
  snapshot: VendaFiscalSnapshot
  /** Série já determinada pelo fluxo normal. Não alocada aqui. */
  serie: number
  /** nNF já determinado. Não incrementado nem reservado aqui. */
  nNF: number
  /** cNF de 8 dígitos já determinado. Não gerado aqui. */
  cNF: string
  /** Preservado. Default: `snapshot.venda.data`. Independente de dhCont. */
  dhEmi?: string | Date
  dhCont: string
  xJust: string
  ambiente?: "HOMOLOGACAO" | "PRODUCAO" | null
  signer: ContingenciaXmlSignerInput
  /**
   * Qualquer valor aqui é tentativa de patch in-place de XML assinado.
   * Sempre recusada — o rebuild só parte do snapshot canônico.
   */
  xmlAssinadoParaPatch?: string
  /** Quando presente, aplica `decideNormalToOffline` antes do rebuild. */
  conversao?: NormalToOfflineInput
}

export type ContingenciaXmlOfflineResult = {
  readonly exactBytes: Uint8Array
  readonly sha256: string
  readonly chave: string
  readonly infNFeId: string
  readonly tpEmis: typeof CONTINGENCIA_TP_EMIS
  readonly dhCont: string
  readonly xJust: string
  readonly dhEmi: string
  readonly nNF: number
  readonly serie: number
  readonly cNF: string
  readonly cDV: string
  /** UTF-8 dos exactBytes — não é reserialização. */
  readonly xml: string
  readonly frozen: true
  readonly rebuildForbidden: true
}

export type ContingenciaXsdOfflineResult =
  | { ok: true }
  | { ok: false; code: "xsd_invalido" | "xsd_engine_ausente"; issues: string[] }
