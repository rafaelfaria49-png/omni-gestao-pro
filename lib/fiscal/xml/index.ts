/**
 * Gerador de XML NFC-e 4.00 (BL-FISCAL-004) — ponto único de import. DORMENTE.
 *
 * Camada PURA que serializa o Snapshot Fiscal congelado em XML `infNFe` 4.00, consumindo a
 * tributação já calculada (`snapshot.tributacao`). NÃO assina, NÃO transmite, NÃO gera DANFE,
 * NÃO integra provider e NÃO tem chamador produtivo. Sem Prisma/fetch/Next/React.
 *
 * Escopo F3: NFC-e Simples Nacional B2C, operação interna, sem ST/DIFAL/FCP/IPI/ISS
 * (mesma fronteira do motor F2 — fora disso a tributação vem `ok=false` e o builder bloqueia).
 */
export {
  buildNfceXml,
  buildNfceXmlResult,
  buildNfceXmlAssinavel,
  buildNfceXmlAssinavelResult,
} from "./nfce-xml-builder"
export { validateNfceSnapshot } from "./nfce-xml-validation"
export {
  montarChaveAcesso,
  calcularDigitoVerificadorChave,
  cNfDeterministico,
  codigoUf,
  aammDe,
  formatDhEmi,
} from "./nfce-chave-acesso"
export {
  serializeXml,
  serializeXmlDocument,
  serializeXmlEmbeddable,
  assertEmbeddableXml,
  xmlEmbeddableViolation,
  XmlEmbeddableContractError,
  escapeXmlText,
  escapeXmlAttr,
  leaf,
  leafRequired,
  group,
} from "./xml-writer"
export {
  NFCE_XML_VERSAO,
  NFCE_MODELO,
  NFCE_XMLNS,
  NFCE_VER_PROC,
  NfceXmlError,
} from "./nfce-xml.types"
export type {
  NfceXmlContext,
  NfceXmlErrorCode,
  NfceQrOnlineV3Config,
  NfceValidationIssue,
  NfceValidationResult,
  BuildNfceXmlResult,
} from "./nfce-xml.types"
export type { XmlNode, XmlAttrs, XmlEmbeddableViolation } from "./xml-writer"
