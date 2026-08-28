/**
 * Ação administrativa de inutilização (justificativa + status auditável).
 */

import { enqueueInutilizacao } from "./enqueue"
import type { InutilizacaoPorts } from "./ports"

export type AdminInutilizacaoInput = {
  storeId: string
  vendaId: string
  notaFiscalId?: string | null
  serie: number
  numeroInicial: number
  numeroFinal: number
  justificativa: string
  actor: string
  now?: Date
}

export async function solicitarInutilizacaoAdministrativa(
  input: AdminInutilizacaoInput,
  ports: InutilizacaoPorts,
) {
  const actor = String(input.actor ?? "").trim()
  if (!actor) {
    return { ok: false as const, code: "parametros_invalidos", error: "Operador administrativo obrigatório." }
  }
  const result = await enqueueInutilizacao(
    {
      storeId: input.storeId,
      vendaId: input.vendaId,
      notaFiscalId: input.notaFiscalId ?? null,
      serie: input.serie,
      numeroInicial: input.numeroInicial,
      numeroFinal: input.numeroFinal,
      justificativa: input.justificativa,
      motivo: "admin",
      operador: actor,
      now: input.now,
    },
    ports,
  )
  if (!result.ok) return result
  const job = await ports.findJobByDedupe({ storeId: input.storeId, dedupeKey: result.dedupeKey })
  return {
    ok: true as const,
    jobId: result.jobId,
    created: result.created,
    dedupeKey: result.dedupeKey,
    mark: result.mark,
    status: job?.status ?? "PENDENTE",
  }
}
