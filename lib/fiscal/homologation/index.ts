/**
 * Piloto de homologação NFC-e — composição dormente (GOAL 022).
 *
 * Importar este módulo não registra cron, rota, webhook nem worker.
 */
export {
  createDormantSefazGuardPorts,
  createNfceHomologationPilotWiring,
  refuseDormantA1CertificateResolution,
  NFCE_HOMOLOGATION_PILOT_QR_URLS,
} from "./nfce-homologation-pilot-wiring"
export type {
  NfceHomologationPilotWiring,
  NfceHomologationPilotWiringOptions,
} from "./nfce-homologation-pilot-wiring"
