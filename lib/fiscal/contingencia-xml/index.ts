/**
 * Rebuild OFFLINE + assinatura do XML NFC-e em contingência (GOAL 020B).
 *
 * Ponto único de import. Sem persistência, SOAP, numerador, Prisma ou rede.
 */
export {
  CONTINGENCIA_XML_XJUST_MAX,
  CONTINGENCIA_XML_XJUST_MIN,
  ContingenciaXmlError,
} from "./types"
export type {
  ContingenciaXmlErrorCode,
  ContingenciaXmlOfflineInput,
  ContingenciaXmlOfflineResult,
  ContingenciaXmlSignerInput,
  ContingenciaXsdOfflineResult,
} from "./types"

export { patchSignedNfceXmlInPlace, rebuildNfceContingenciaXmlOffline } from "./rebuild"
export { officialNfceSchemaPath, validateNfceXmlXsdOffline } from "./xsd-offline"
