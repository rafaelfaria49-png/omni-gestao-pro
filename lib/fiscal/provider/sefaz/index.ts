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
  type SefazTransportErrorCode,
  type SefazTransportOutcome,
  type SefazTransportRequest,
} from "./sefaz-transport.types"

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
  SEFAZ_DEFAULT_TIMEOUT_MS,
  SefazAdapterBlockedError,
  SefazDiretoProvider,
  type SefazAdapterBlockCode,
  type SefazDiretoProviderOptions,
} from "./sefaz-direto-provider"
