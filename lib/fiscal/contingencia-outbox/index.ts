/**
 * Persistência transacional + outbox dormente da NFC-e em contingência (GOAL 020C).
 *
 * Sem transmissão, worker, cron, rebuild ou schema.
 */
export {
  CONTINGENCIA_OUTBOX_DEDUPE_VERSION,
  CONTINGENCIA_OUTBOX_ESTADO,
  CONTINGENCIA_OUTBOX_JOB_STATUS_DORMENTE,
  CONTINGENCIA_OUTBOX_JOB_TIPO,
} from "./types"
export type {
  ContingenciaOutboxAmbiente,
  ContingenciaOutboxClient,
  ContingenciaOutboxDeadlinePersistido,
  ContingenciaOutboxExactBytesRef,
  ContingenciaOutboxIssue,
  ContingenciaOutboxPersistError,
  ContingenciaOutboxPersistErrorCode,
  ContingenciaOutboxPersistido,
  ContingenciaOutboxTx,
  PersistNfceContingenciaOutboxInput,
  PersistNfceContingenciaOutboxResult,
} from "./types"

export { buildContingenciaDocumentoLocalKey, buildContingenciaOutboxDedupeKey } from "./identity"
export { persistNfceContingenciaOutbox } from "./persist"
