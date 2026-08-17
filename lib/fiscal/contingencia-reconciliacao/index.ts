/**
 * Reconciliação fail-closed da NFC-e em contingência (GOAL 020D).
 *
 * Sem consulta SEFAZ, sem transmissão, sem worker, sem schema.
 */
export {
  CONTINGENCIA_CONSULTA_SERVICO,
  CONTINGENCIA_EVIDENCE_PRECEDENCE,
  CONTINGENCIA_RECONCILIATION_EVIDENCE_KINDS,
  RETRANSMISSION_ELIGIBLE_AFTER_NOT_FOUND,
} from "./types"
export type {
  ContingenciaConsultaSanitizada,
  ContingenciaReconciliationClient,
  ContingenciaReconciliationError,
  ContingenciaReconciliationErrorCode,
  ContingenciaReconciliationEvidenceKind,
  ContingenciaReconciliationOk,
  ContingenciaReconciliationTx,
  ContingenciaRetransmissionEligibility,
  ReconcileNfceContingenciaInput,
  ReconcileNfceContingenciaResult,
} from "./types"

export {
  compareEvidencePrecedence,
  deriveEvidenceKind,
  evidenceRank,
  isCanonicalEvidenceKind,
  isValidFiscalProtocolo,
} from "./evidence"
export { decideContingenciaReconciliation } from "./decision"
export { isDormantContingenciaOutbox, verifyContingenciaExactBytesPair } from "./integrity"
export { reconcileNfceContingenciaOffline } from "./persist"
