/**
 * Identidade idempotente da outbox de contingência (GOAL 020C).
 *
 * A chave de dedupe NÃO inclui sha256: mesma chave com bytes diferentes
 * deve colidir (conflito), não criar um segundo documento/job.
 */
import { CONTINGENCIA_OUTBOX_DEDUPE_VERSION } from "./types"

export function buildContingenciaDocumentoLocalKey(storeId: string, chave: string): string {
  return `nfce-contingencia:${storeId}:${chave}`
}

export function buildContingenciaOutboxDedupeKey(chave: string): string {
  return `fiscal:contingencia-tx:v${CONTINGENCIA_OUTBOX_DEDUPE_VERSION}:chave:${chave}`
}
