/**
 * Criação idempotente do job `INUTILIZACAO` a partir da marcação "a inutilizar".
 */

import {
  INUTILIZACAO_JUSTIFICATIVA_MAX,
  INUTILIZACAO_JUSTIFICATIVA_MIN,
  INUTILIZACAO_MAX_FAIXA,
} from "./types"
import { normalizarJustificativa } from "./validation"
import {
  INUTILIZACAO_DEDUPE_VERSION,
  INUTILIZACAO_MARK,
  buildInutilizacaoDedupeKey,
  type InutilizacaoJobPayload,
} from "./mark"
import type { EnqueueInutilizacaoInput, InutilizacaoPorts } from "./ports"

export const JUSTIFICATIVA_REJEICAO_PADRAO =
  "Numero NFC-e rejeitado pela SEFAZ; faixa inutilizada para nao reutilizar."
export const JUSTIFICATIVA_LACUNA_PADRAO =
  "Numero NFC-e reservado e nao vinculado; faixa inutilizada para nao reutilizar."

export type EnqueueInutilizacaoResult =
  | {
      ok: true
      jobId: string
      created: boolean
      dedupeKey: string
      mark: InutilizacaoJobPayload["mark"]
    }
  | { ok: false; code: string; error: string }

function validarFaixa(numeroInicial: number, numeroFinal: number): string | null {
  if (!Number.isInteger(numeroInicial) || !Number.isInteger(numeroFinal)) {
    return "Faixa de numeração inválida."
  }
  if (numeroInicial < 1 || numeroFinal < numeroInicial) {
    return "Faixa de numeração inválida (inicial >= 1 e final >= inicial)."
  }
  if (numeroFinal - numeroInicial + 1 > INUTILIZACAO_MAX_FAIXA) {
    return `Quantidade máxima a inutilizar é ${INUTILIZACAO_MAX_FAIXA} números.`
  }
  return null
}

export async function enqueueInutilizacao(
  input: EnqueueInutilizacaoInput,
  ports: InutilizacaoPorts,
): Promise<EnqueueInutilizacaoResult> {
  const storeId = String(input.storeId ?? "").trim()
  const vendaId = String(input.vendaId ?? "").trim()
  const operador = String(input.operador ?? "").trim()
  const justificativa = normalizarJustificativa(input.justificativa)
  if (!storeId || !vendaId || !operador) {
    return { ok: false, code: "parametros_invalidos", error: "storeId, vendaId e operador são obrigatórios." }
  }
  if (!Number.isInteger(input.serie) || input.serie < 0) {
    return { ok: false, code: "parametros_invalidos", error: "Série fiscal inválida." }
  }
  const faixaErro = validarFaixa(input.numeroInicial, input.numeroFinal)
  if (faixaErro) return { ok: false, code: "parametros_invalidos", error: faixaErro }
  if (
    justificativa.length < INUTILIZACAO_JUSTIFICATIVA_MIN ||
    justificativa.length > INUTILIZACAO_JUSTIFICATIVA_MAX
  ) {
    return {
      ok: false,
      code: "justificativa_invalida",
      error: `Justificativa deve ter entre ${INUTILIZACAO_JUSTIFICATIVA_MIN} e ${INUTILIZACAO_JUSTIFICATIVA_MAX} caracteres.`,
    }
  }

  const now = input.now ?? new Date()
  const dedupeKey = buildInutilizacaoDedupeKey({
    storeId,
    modelo: "NFCE",
    ambiente: "HOMOLOGACAO",
    serie: input.serie,
    numeroInicial: input.numeroInicial,
    numeroFinal: input.numeroFinal,
  })
  const payload: InutilizacaoJobPayload = {
    version: INUTILIZACAO_DEDUPE_VERSION,
    operation: "INUTILIZACAO",
    mark: INUTILIZACAO_MARK.A_INUTILIZAR,
    storeId,
    modelo: "NFCE",
    ambiente: "HOMOLOGACAO",
    serie: input.serie,
    numeroInicial: input.numeroInicial,
    numeroFinal: input.numeroFinal,
    justificativa,
    motivo: input.motivo,
    notaFiscalId: input.notaFiscalId,
    vendaId,
    protocolo: null,
    cStat: null,
    xMotivo: null,
    inutilizadoEm: null,
    requestedAt: now.toISOString(),
    requestedBy: operador,
  }

  const { job, created } = await ports.upsertJob({
    storeId,
    vendaId,
    notaFiscalId: input.notaFiscalId,
    dedupeKey,
    payload,
    now,
  })
  await ports.createLog({
    storeId,
    vendaId,
    notaFiscalId: input.notaFiscalId,
    jobId: job.id,
    eventoFiscalId: null,
    nivel: "INFO",
    acao: created ? "fiscal.inutilizacao.enqueued" : "fiscal.inutilizacao.enqueue_idempotent",
    mensagem: created
      ? "Número marcado a inutilizar; job INUTILIZACAO criado."
      : "Job INUTILIZACAO já existia (dedupe); marca preservada.",
    operador,
    detalhe: {
      dedupeKey,
      serie: input.serie,
      numeroInicial: input.numeroInicial,
      numeroFinal: input.numeroFinal,
      motivo: input.motivo,
      mark: job.payload.mark,
    },
  })
  return {
    ok: true,
    jobId: job.id,
    created,
    dedupeKey,
    mark: job.payload.mark,
  }
}
