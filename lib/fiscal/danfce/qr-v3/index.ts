/**
 * Encoder puro e determinístico do QR Code NFC-e versão 3 (GOAL 021A).
 *
 * Não gera XML, não insere `infNFeSupl`, não altera exactBytes, não renderiza DANFC-e,
 * não abre certificado/PFX/EnvVault/Prisma e não acessa rede.
 */
export { QR_V3_NVERSAO, QR_V3_OFFLINE_TP_EMIS, QR_V3_ONLINE_TP_EMIS, QR_V3_XSD, composeQrV3Url } from "./canonical"
export { encodeNfceQrV3Offline, encodeNfceQrV3OfflineUrl, buildNfceQrV3OfflineCanonical, createQrV3OfflinePemSigner, verifyQrV3OfflineSignature } from "./offline"
export { encodeNfceQrV3Online, encodeNfceQrV3OnlineUrl } from "./online"
export { QR_V3_VERSAO } from "./types"
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
} from "./types"
