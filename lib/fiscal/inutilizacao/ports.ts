/**
 * Portas da inutilização (GOAL 019). Sem Prisma no orquestrador — testável com doubles.
 */

import type { FiscalNumberingGap } from "../numbering/numbering.types"
import type { InutilizacaoJobPayload, InutilizacaoMark, InutilizacaoMotivo } from "./mark"

export type InutilizacaoJobRow = {
  id: string
  storeId: string
  vendaId: string
  notaFiscalId: string | null
  tipo: "INUTILIZACAO"
  status: string
  dedupeKey: string | null
  payload: InutilizacaoJobPayload
  tentativas: number
}

export type InutilizacaoEventoRow = {
  id: string
  notaFiscalId: string
  tipo: "INUTILIZACAO"
  sequencia: number
  status: string
  protocolo: string | null
  cStat: string | null
}

export type InutilizacaoNotaRow = {
  id: string
  storeId: string
  vendaId: string
  status: string
  vigente: boolean
  modelo: string
  ambiente: string
  serie: number | null
  numero: number | null
  localKey: string | null
  snapshotEmitente: unknown
  snapshotDestinatario: unknown
  snapshotPagamento: unknown
  valorTotal: number
  valorDesconto: number
  valorFrete: number
  valorTotalTributos: number
}

export type InutilizacaoConfigRow = {
  cnpj: string
  uf: string
  ambiente: string
  modeloFiscal: string
}

export type InutilizacaoLogInput = {
  storeId: string
  vendaId: string | null
  notaFiscalId: string | null
  jobId: string | null
  eventoFiscalId: string | null
  nivel: "INFO" | "WARN" | "ERROR"
  acao: string
  mensagem: string
  cStat?: string | null
  xMotivo?: string | null
  operador?: string | null
  detalhe?: Record<string, unknown>
}

export type EnqueueInutilizacaoInput = {
  storeId: string
  vendaId: string
  notaFiscalId: string | null
  serie: number
  numeroInicial: number
  numeroFinal: number
  justificativa: string
  motivo: InutilizacaoMotivo
  operador: string
  now?: Date
}

export type InutilizacaoPorts = {
  findJobByDedupe(input: {
    storeId: string
    dedupeKey: string
  }): Promise<InutilizacaoJobRow | null>
  upsertJob(input: {
    storeId: string
    vendaId: string
    notaFiscalId: string | null
    dedupeKey: string
    payload: InutilizacaoJobPayload
    now: Date
  }): Promise<{ job: InutilizacaoJobRow; created: boolean }>
  updateJobPayload(input: {
    jobId: string
    storeId: string
    expectedMark: InutilizacaoMark
    payload: InutilizacaoJobPayload
    status?: string
  }): Promise<boolean>
  findNota(input: { storeId: string; notaFiscalId: string }): Promise<InutilizacaoNotaRow | null>
  findVigente(input: { storeId: string; vendaId: string }): Promise<InutilizacaoNotaRow | null>
  findEvento(input: { notaFiscalId: string }): Promise<InutilizacaoEventoRow | null>
  upsertEvento(input: {
    storeId: string
    notaFiscalId: string
    justificativa: string
    operador: string
    status: "PENDENTE" | "AUTORIZADO" | "REJEITADO"
    protocolo: string | null
    cStat: string | null
    xMotivo: string | null
  }): Promise<{ id: string; created: boolean; reused: boolean }>
  createLog(input: InutilizacaoLogInput): Promise<void>
  demoteVigente(input: {
    storeId: string
    vendaId: string
    notaFiscalId: string
  }): Promise<boolean>
  createReissueNota(input: {
    storeId: string
    vendaId: string
    origem: InutilizacaoNotaRow
    localKey: string
  }): Promise<{ id: string; localKey: string }>
  setVendaFiscalStatus(input: {
    storeId: string
    vendaId: string
    from: string[]
    to: string
  }): Promise<boolean>
  findConfig(input: { storeId: string }): Promise<InutilizacaoConfigRow | null>
  upsertEmissionJob(input: {
    storeId: string
    vendaId: string
    notaFiscalId: string
    dedupeKey: string
    operador: string
    now: Date
  }): Promise<{ id: string; created: boolean }>
}

export function gapToEnqueueInput(
  gap: FiscalNumberingGap,
  justificativa: string,
  operador: string,
  vendaId: string,
): EnqueueInutilizacaoInput {
  return {
    storeId: gap.storeId,
    vendaId,
    notaFiscalId: gap.notaFiscalId,
    serie: gap.serie,
    numeroInicial: gap.numero,
    numeroFinal: gap.numero,
    justificativa,
    motivo: "lacuna_numeracao",
    operador,
  }
}
