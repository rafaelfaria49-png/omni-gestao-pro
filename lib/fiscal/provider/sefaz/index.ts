/**
 * Adapter SEFAZ-SP de homologação — **offline** (GOAL-016D-A · ADR-0020).
 *
 * Ponto único de import do adapter. DORMENTE: nenhum caller produtivo, nenhuma rede.
 * `SEFAZ_DIRETO` NÃO é registrado no `REGISTRY` de `FiscalProvider` (ADR-0020 §2.2) — este
 * adapter só existe por **instanciação server-side direta** em módulo autorizado.
 */
export {
  SEFAZ_ENDPOINT_CATALOG,
  SEFAZ_LAYOUT_VERSAO,
  selectSefazEndpoint,
  sefazEndpointIntegro,
  sefazServiceNamespace,
  type SefazAmbienteCatalogo,
  type SefazEndpoint,
  type SefazEndpointLookup,
  type SefazEndpointLookupErrorCode,
  type SefazLayoutVersao,
  type SefazServico,
  type SefazUf,
} from "./sefaz-endpoint-catalog"

export {
  SEFAZ_SOAP12_CONTENT_TYPE,
  buildSefazSoap12Envelope,
  extractFiscalBytes,
  type SefazSoapEnvelope,
} from "./sefaz-envelope"

export {
  SefazOfflineRefusingTransport,
  sefazOfflineRefusingTransport,
  type SefazTransport,
  type SefazTransportClassification,
  type SefazTransportErrorCode,
  type SefazTransportFailure,
  type SefazTransportOutcome,
  type SefazTransportRequest,
  type SefazTransportSuccess,
} from "./sefaz-transport.types"

export {
  SEFAZ_HTTPS_MAX_RESPONSE_BYTES,
  SEFAZ_MAX_CONNECTION_TIMEOUT_MS,
  SEFAZ_MAX_TOTAL_DEADLINE_MS,
  SefazSoapTransport,
  boundSefazTransportDeadlines,
  type LoadA1MtlsMaterialPort,
  type SefazSoapTransportOptions,
  type SefazTransportDeadlines,
} from "./sefaz-soap-transport"

export type {
  SefazOneShotAttemptContext,
  SefazOneShotAttemptPort,
} from "./sefaz-runtime-ports"

export {
  SEFAZ_GUARD_ORDER,
  readTpAmbFromSignedXml,
  runSefazPreTransportGuards,
  type SefazGuardCode,
  type SefazGuardFailure,
  type SefazGuardFiscalConfig,
  type SefazGuardMode,
  type SefazGuardOutcome,
  type SefazGuardPorts,
  type SefazGuardSuccess,
  type SefazXsdAttestation,
} from "./sefaz-guards"

export {
  SEFAZ_CSTAT_MATRIX,
  SEFAZ_CSTAT_MATRIX_VERSION,
  SEFAZ_CONSEQUENCIA_ESTRUTURAL,
  SEFAZ_CONSEQUENCIA_INDETERMINADA,
  lookupSefazCStat,
  type SefazCStatEntry,
  type SefazCStatLookup,
  type SefazCStatOutcome,
  type SefazFiscalConsequences,
  type SefazResponseReason,
} from "./sefaz-cstat-matrix"

export {
  SEFAZ_MAX_RESPONSE_BYTES,
  SEFAZ_SERVICOS_COM_PARSER,
  parseSefazSoapResponse,
  toFiscalConsultationResult,
  toFiscalTransmissionResult,
  type SefazResponseClassification,
  type SefazResponseOutcome,
} from "./sefaz-response-parser"

export {
  SEFAZ_DEFAULT_CONNECTION_TIMEOUT_MS,
  SEFAZ_DEFAULT_TOTAL_DEADLINE_MS,
  SEFAZ_DEFAULT_TIMEOUT_MS,
  SefazAdapterBlockedError,
  SefazDiretoProvider,
  type SefazAdapterBlockCode,
  type SefazDiretoProviderOptions,
} from "./sefaz-direto-provider"
