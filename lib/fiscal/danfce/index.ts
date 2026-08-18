/**
 * DANFC-e NFC-e 4.00 — ponto único de import (GOAL 021).
 *
 * Camada de representação e reimpressão sobre o documento fiscal persistido.
 * Não transmite, não abre SOAP, não provisiona A1 real, não toca PDV.
 */
export {
  QR_V3_NVERSAO,
  QR_V3_OFFLINE_TP_EMIS,
  QR_V3_ONLINE_TP_EMIS,
  QR_V3_XSD,
  composeQrV3Url,
} from "./qr-v3/canonical"
export {
  encodeNfceQrV3Offline,
  encodeNfceQrV3OfflineUrl,
  buildNfceQrV3OfflineCanonical,
  createQrV3OfflinePemSigner,
  verifyQrV3OfflineSignature,
} from "./qr-v3/offline"
export { encodeNfceQrV3Online, encodeNfceQrV3OnlineUrl } from "./qr-v3/online"
export { QR_V3_VERSAO } from "./qr-v3/types"
export type {
  QrV3Ambiente,
  QrV3Destinatario,
  QrV3Err,
  QrV3ErrorCode,
  QrV3OfflineCanonicalOk,
  QrV3OfflineInput,
  QrV3OfflineOk,
  QrV3OfflineSigner,
  QrV3OnlineInput,
  QrV3OnlineOk,
  QrV3TpId,
} from "./qr-v3/types"

export {
  NFCE_SP_PUBLIC_URL_CATALOG,
  NFCE_SP_URL_CATALOG_VERSAO,
  NFCE_SP_URL_CONFIRMADO_EM,
  NFCE_SP_URL_FONTE_OFICIAL,
  isOfficialNfceSpQrBaseUrl,
  isOfficialNfceSpUrlChave,
  qrCodeBaseFromPersisted,
  selectNfceSpPublicUrls,
  selectNfceSpPublicUrlsByTpAmb,
} from "./urls-sp"
export type { NfceSpAmbientePublico, NfceSpPublicUrls } from "./urls-sp"

export {
  DANFCE_DOCUMENTO,
  DANFCE_LAYOUT,
  DANFCE_MSG_CONSULTA,
  DANFCE_MSG_CONTINGENCIA,
  DANFCE_MSG_CONTINGENCIA_PENDENTE,
  DANFCE_MSG_HOMOLOGACAO,
  DANFCE_MSG_SEM_PROTOCOLO,
  DANFCE_SUBTITULO,
  DANFCE_TITULO_AUTORIZADO,
  DANFCE_TITULO_CONTINGENCIA,
  DOCUMENTO_NAO_FISCAL_LABEL,
  DOCUMENTO_NAO_FISCAL_NAO_E_DANFCE,
  DanfceParseError,
} from "./types"
export type {
  DanfceAmbiente,
  DanfceConsumidor,
  DanfceEmitente,
  DanfceItem,
  DanfceModel,
  DanfcePagamento,
  DanfceParseErrorCode,
  DanfceReprintLocator,
  DanfceVariante,
} from "./types"

export { parseDanfceFromPersisted } from "./parse-persisted"
export type { PersistedFiscalArtifacts } from "./parse-persisted"
export { danfceFingerprint, loadDanfceForReprint } from "./reprint"
export type { DanfceReprintPorts } from "./reprint"
export { renderDanfceHtml } from "./render-html"
export { escposQrFromPersisted, renderDanfceEscPos } from "./render-escpos"
export { previewDanfceInBrowser, printDanfceWithExistingStack } from "./print"
export { encodeQrModules, renderQrSvg } from "./qr-matrix"
