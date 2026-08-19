/**
 * Pipeline Oficial de Emissão Fiscal (GOAL_007) — ponto único de import.
 *
 * DORMENTE: orquestra apenas o provider STUB_HOMOLOGACAO (sem emissão real, sem XML/DANFE/
 * QRCode, sem rede). A única escrita de negócio é `Venda.fiscalStatus`; trilha em FiscalLog.
 * Roda só quando chamado explicitamente — nada automático.
 */
export * from "./emission.types"
export { runEmissionPipeline } from "./emission-pipeline"
export { emitirNotaFiscalVenda } from "./emission-service"
export { recordFiscalEmissionLog, type RecordFiscalEmissionLogParams } from "./emission-log"
export { reconstructSnapshotFromNota, type NotaFiscalRow, type NotaItemRow } from "./snapshot-reader"
export * from "./uncertain-state.types"
export * from "./uncertain-state-coordinator"
export * from "./uncertain-state-job-executor"
export * from "./prisma-uncertain-state-persistence"
export {
  createFinalizedNfcePreparer,
  NfceQrConfigMissingError,
} from "./finalized-nfce-preparer"
export type {
  FinalizedNfceCertificateResolver,
  FinalizedNfcePreparerDependencies,
  NfceFinalizationSource,
  NfceQrUrlConfig,
} from "./finalized-nfce-preparer"
export {
  createPersistedNfceFinalizationSourceResolver,
  NfceFinalizationSourceError,
} from "./nfce-finalization-source-resolver"
export type { NfceFinalizationSourceErrorCode } from "./nfce-finalization-source-resolver"
