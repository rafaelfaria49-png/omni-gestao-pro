/**
 * Reemissão pós-rejeição definitiva (GOAL 019).
 *
 * rejeição → número antigo consumido → inutilização → nova NotaFiscal vigente → novo número.
 * Histórico da nota rejeitada permanece imutável.
 */

import { allocateFiscalNumber } from "../numbering/allocate-fiscal-number"
import type { FiscalNumberingPorts } from "../numbering/numbering.types"
import { JUSTIFICATIVA_REJEICAO_PADRAO, enqueueInutilizacao } from "./enqueue"
import type { InutilizacaoPorts } from "./ports"

export function resolveReissueSnapshotLocalKey(
  storeId: string,
  vendaId: string,
  rejectedNotaId: string,
): string {
  return `nfce-snapshot:${storeId}:${vendaId}:reissue:${rejectedNotaId}`
}

export function buildFiscalReissueDedupeKey(vendaId: string, notaFiscalId: string): string {
  return `fiscal:emissao:v1:venda:${vendaId}:reissue:${notaFiscalId}`
}

export type ReissueResult =
  | {
      ok: true
      rejectedNotaId: string
      newNotaId: string
      newLocalKey: string
      oldNumero: number
      newNumero: number
      inutilizacaoJobId: string
      emissionJobId: string
      emissionJobCreated: boolean
    }
  | { ok: false; code: string; error: string }

export async function reemitirVendaAposRejeicao(
  input: {
    storeId: string
    vendaId: string
    operador: string
    justificativa?: string
    now?: Date
  },
  ports: InutilizacaoPorts,
  numbering: FiscalNumberingPorts,
): Promise<ReissueResult> {
  const storeId = String(input.storeId ?? "").trim()
  const vendaId = String(input.vendaId ?? "").trim()
  const operador = String(input.operador ?? "").trim()
  if (!storeId || !vendaId || !operador) {
    return { ok: false, code: "parametros_invalidos", error: "storeId, vendaId e operador são obrigatórios." }
  }

  const vigente = await ports.findVigente({ storeId, vendaId })
  if (!vigente) {
    return { ok: false, code: "nota_nao_encontrada", error: "NotaFiscal vigente não encontrada." }
  }
  if (vigente.status !== "REJEITADA") {
    return {
      ok: false,
      code: "status_incompativel",
      error: `Reemissão exige nota vigente REJEITADA; encontrada ${vigente.status}.`,
    }
  }
  if (vigente.serie == null || vigente.numero == null) {
    return { ok: false, code: "numeracao_ausente", error: "Nota rejeitada sem série/número; nada a inutilizar." }
  }
  const oldNumero = vigente.numero
  const now = input.now ?? new Date()

  const inutilizacao = await enqueueInutilizacao(
    {
      storeId,
      vendaId,
      notaFiscalId: vigente.id,
      serie: vigente.serie,
      numeroInicial: vigente.numero,
      numeroFinal: vigente.numero,
      justificativa: input.justificativa ?? JUSTIFICATIVA_REJEICAO_PADRAO,
      motivo: "rejeicao_definitiva",
      operador,
      now,
    },
    ports,
  )
  if (!inutilizacao.ok) {
    return { ok: false, code: inutilizacao.code, error: inutilizacao.error }
  }

  const localKey = resolveReissueSnapshotLocalKey(storeId, vendaId, vigente.id)
  const created = await ports.swapReissueVigente({
    storeId,
    vendaId,
    origem: vigente,
    localKey,
  })
  if (!created) {
    return { ok: false, code: "conflito_concorrente", error: "Não foi possível abrir a nova NotaFiscal vigente." }
  }

  const MAX_SUCCESSOR = 8
  let allocation = await allocateFiscalNumber({ storeId, notaFiscalId: created.id }, numbering)
  for (let attempt = 0; attempt < MAX_SUCCESSOR; attempt++) {
    if (!allocation.ok) break
    if (allocation.numero !== oldNumero) break
    const cleared = await ports.clearSuccessorNumero({
      storeId,
      notaFiscalId: created.id,
      expectedNumero: oldNumero,
    })
    if (!cleared) break
    allocation = await allocateFiscalNumber(
      { storeId, notaFiscalId: created.id, maxTentativas: 3 },
      numbering,
    )
  }
  if (!allocation.ok) {
    await ports.restoreRejectedVigente({
      storeId,
      vendaId,
      rejectedNotaId: vigente.id,
      newNotaId: created.id,
    })
    return { ok: false, code: allocation.errorCode, error: allocation.mensagem }
  }
  if (allocation.numero === oldNumero) {
    await ports.restoreRejectedVigente({
      storeId,
      vendaId,
      rejectedNotaId: vigente.id,
      newNotaId: created.id,
    })
    return {
      ok: false,
      code: "numero_reutilizado",
      error: "A reemissão tentou reutilizar o número consumido após esgotar o sucessor.",
    }
  }

  const emission = await ports.upsertEmissionJob({
    storeId,
    vendaId,
    notaFiscalId: created.id,
    dedupeKey: buildFiscalReissueDedupeKey(vendaId, created.id),
    operador,
    now,
  })
  await ports.setVendaFiscalStatus({
    storeId,
    vendaId,
    from: ["REJEITADA"],
    to: "PENDENTE",
  })
  await ports.createLog({
    storeId,
    vendaId,
    notaFiscalId: created.id,
    jobId: emission.id,
    eventoFiscalId: null,
    nivel: "INFO",
    acao: "fiscal.reissue.created",
    mensagem: "Reemissão: nova NotaFiscal vigente com número novo; histórico rejeitado preservado.",
    operador,
    detalhe: {
      rejectedNotaId: vigente.id,
      newNotaId: created.id,
      oldNumero,
      newNumero: allocation.numero,
      inutilizacaoJobId: inutilizacao.jobId,
    },
  })

  return {
    ok: true,
    rejectedNotaId: vigente.id,
    newNotaId: created.id,
    newLocalKey: created.localKey,
    oldNumero,
    newNumero: allocation.numero,
    inutilizacaoJobId: inutilizacao.jobId,
    emissionJobId: emission.id,
    emissionJobCreated: emission.created,
  }
}
