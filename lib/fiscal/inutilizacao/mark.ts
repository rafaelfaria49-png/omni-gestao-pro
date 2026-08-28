/**
 * Marcação local "a inutilizar" (GOAL 019).
 *
 * Persistida no payload do job `FiscalJobTipo.INUTILIZACAO`. A baixa só ocorre após
 * desfecho fiscal definitivo com protocolo válido (cStat 102). Falha/rejeição do
 * pedido deixa a marca e o número permanece fora do pool.
 */

import { TPROT_PATTERN } from "./types"

export const INUTILIZACAO_DEDUPE_VERSION = 1 as const

export const INUTILIZACAO_MARK = {
  A_INUTILIZAR: "A_INUTILIZAR",
  INUTILIZADO: "INUTILIZADO",
} as const

export type InutilizacaoMark = (typeof INUTILIZACAO_MARK)[keyof typeof INUTILIZACAO_MARK]

export type InutilizacaoMotivo = "rejeicao_definitiva" | "lacuna_numeracao" | "admin"

export type InutilizacaoJobPayload = {
  version: typeof INUTILIZACAO_DEDUPE_VERSION
  operation: "INUTILIZACAO"
  mark: InutilizacaoMark
  storeId: string
  modelo: "NFCE"
  ambiente: "HOMOLOGACAO"
  serie: number
  numeroInicial: number
  numeroFinal: number
  justificativa: string
  motivo: InutilizacaoMotivo
  notaFiscalId: string | null
  vendaId: string
  protocolo: string | null
  cStat: string | null
  xMotivo: string | null
  inutilizadoEm: string | null
  requestedAt: string
  requestedBy: string
}

export function buildInutilizacaoDedupeKey(input: {
  storeId: string
  modelo: string
  ambiente: string
  serie: number
  numeroInicial: number
  numeroFinal: number
}): string {
  return [
    "fiscal:inutilizacao",
    `v${INUTILIZACAO_DEDUPE_VERSION}`,
    input.storeId,
    input.modelo,
    input.ambiente,
    String(input.serie),
    String(input.numeroInicial),
    String(input.numeroFinal),
  ].join(":")
}

export function asInutilizacaoPayload(value: unknown): InutilizacaoJobPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (row.operation !== "INUTILIZACAO") return null
  if (row.mark !== INUTILIZACAO_MARK.A_INUTILIZAR && row.mark !== INUTILIZACAO_MARK.INUTILIZADO) {
    return null
  }
  const serie = Number(row.serie)
  const numeroInicial = Number(row.numeroInicial)
  const numeroFinal = Number(row.numeroFinal)
  if (!Number.isInteger(serie) || !Number.isInteger(numeroInicial) || !Number.isInteger(numeroFinal)) {
    return null
  }
  return {
    version: INUTILIZACAO_DEDUPE_VERSION,
    operation: "INUTILIZACAO",
    mark: row.mark,
    storeId: String(row.storeId ?? ""),
    modelo: "NFCE",
    ambiente: "HOMOLOGACAO",
    serie,
    numeroInicial,
    numeroFinal,
    justificativa: String(row.justificativa ?? ""),
    motivo: (row.motivo as InutilizacaoMotivo) || "admin",
    notaFiscalId: typeof row.notaFiscalId === "string" ? row.notaFiscalId : null,
    vendaId: String(row.vendaId ?? ""),
    protocolo: typeof row.protocolo === "string" ? row.protocolo : null,
    cStat: typeof row.cStat === "string" ? row.cStat : null,
    xMotivo: typeof row.xMotivo === "string" ? row.xMotivo : null,
    inutilizadoEm: typeof row.inutilizadoEm === "string" ? row.inutilizadoEm : null,
    requestedAt: String(row.requestedAt ?? ""),
    requestedBy: String(row.requestedBy ?? ""),
  }
}

/**
 * Protocolo autoritativo para baixar a marca. Resposta simulada nunca baixa.
 * SEFAZ: TProt (15 ou 17 dígitos) e cStat 102.
 */
export function protocoloInutilizacaoValido(
  protocolo: string | null | undefined,
  simulado: boolean,
): boolean {
  if (simulado) return false
  const value = String(protocolo ?? "").trim()
  return TPROT_PATTERN.test(value)
}

export function podeBaixarMarcacao(input: {
  cStat: string | null | undefined
  protocolo: string | null | undefined
  simulado: boolean
}): boolean {
  if (input.simulado) return false
  return String(input.cStat ?? "").trim() === "102" && protocoloInutilizacaoValido(input.protocolo, false)
}
