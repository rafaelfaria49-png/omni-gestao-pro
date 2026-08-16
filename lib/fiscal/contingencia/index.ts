/**
 * Contingência off-line NFC-e 65 / SP — policy e contratos puros (GOAL 020A).
 *
 * Ponto único de import. Sem XML, SOAP, numerador, Prisma ou rede.
 */
export {
  CONTINGENCIA_CAPABILITIES_FORA,
  CONTINGENCIA_ESTADOS,
  CONTINGENCIA_EVENTOS,
  CONTINGENCIA_FONTES_NORMATIVAS,
  CONTINGENCIA_MODALIDADE,
  CONTINGENCIA_MODELO,
  CONTINGENCIA_MODELO_CODIGO,
  CONTINGENCIA_TP_EMIS,
  CONTINGENCIA_TZ,
  CONTINGENCIA_UF_PILOTO,
  NEXT_BUSINESS_DAY,
  REBUILD_AND_RESIGN_REQUIRED,
  SIGNED_XML_IN_PLACE_PATCH_FORBIDDEN,
} from "./types"
export type {
  ContingenciaAmbiente,
  ContingenciaBusinessDayResolver,
  ContingenciaDocumentoEstado,
  ContingenciaEvento,
  ContingenciaFonteNormativa,
  ContingenciaRequestInput,
  ContingenciaRequestValidado,
  ContingenciaTransitionResult,
  ContingenciaValidationError,
  ContingenciaValidationResult,
  ConsumerPresentationDependency,
  ExactBytesContract,
  ExactBytesRequirement,
  NormalToOfflineDecision,
  NormalToOfflineInput,
  NumeroInutilizacaoDecision,
  NumeroReuseDecision,
  ReconciliacaoNecessaria,
  SerieEspecialPolicy,
  SignedXmlPatchPolicy,
  TransmissionDeadlineKind,
  TransmissionDeadlinePolicy,
  TransmissionDeadlineResult,
  UnknownEvaluation,
  XmlMutationConsequence,
} from "./types"

export {
  canInutilizarNumeroContingencia,
  canReuseNumeroForContingencia,
  consumerPresentationDependency,
  decideNormalToOffline,
  exactBytesRequirement,
  evaluateUnknown,
  resolveContingenciaTransmissionDeadline,
  serieEspecialPolicy,
  signedXmlInPlacePatchPolicy,
  transmissionDeadlinePolicy,
  validateContingenciaRequest,
} from "./policy"

export { allowedTransition, applyContingenciaEvent } from "./state-machine"
