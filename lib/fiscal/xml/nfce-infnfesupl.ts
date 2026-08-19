/**
 * Peças compartilhadas de `infNFeSupl` (QR NFC-e v3).
 *
 * `urlChave` segue TString 21–85 do XSD versionado. URLs são injetadas pelo caller
 * a partir do catálogo oficial SP (`lib/fiscal/danfce/urls-sp`, P-URL-SP).
 * O grupo é filho de `NFe`, nunca de `infNFe`. Sem Signature. Sem CDATA.
 */

import { NfceXmlError } from "./nfce-xml.types"
import { group, leafRequired, type XmlNode } from "./xml-writer"

/** TString (`tiposBasico_v4.00.xsd`) + min/max de `urlChave` em `leiauteNFe_v4.00.xsd`. */
const URL_CHAVE_TSTRING = /^([!-ÿ]{1}[ -ÿ]{0,}[!-ÿ]{1}|[!-ÿ]{1})$/
const URL_CHAVE_MIN = 21
const URL_CHAVE_MAX = 85
const QR_CODE_MIN = 60
const QR_CODE_MAX = 1000

export type NfceInfNFeSupl = {
  readonly qrCode: string
  readonly urlChave: string
}

export function rejectNfceQr(code: "qr_online_invalido" | "qr_offline_invalido" | "qr_modo_incompativel", message: string, campo: string): never {
  throw new NfceXmlError(code, message, null, campo)
}

export function rejectParallelQrFields(
  config: object,
  fields: readonly string[],
  code: "qr_online_invalido" | "qr_offline_invalido",
  campo: string,
): void {
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(config, field)) {
      rejectNfceQr(
        code,
        "Campos do QR derivam do XML canônico; não são aceitos em paralelo.",
        campo,
      )
    }
  }
}

export function requireInjectedQrUrls(
  config: { readonly qrCodeBaseUrl?: unknown; readonly urlChave?: unknown },
  code: "qr_online_invalido" | "qr_offline_invalido",
  campoPrefix: string,
): { qrCodeBaseUrl: string; urlChave: string } {
  const qrCodeBaseUrl = config.qrCodeBaseUrl
  if (typeof qrCodeBaseUrl !== "string" || qrCodeBaseUrl.trim() === "") {
    rejectNfceQr(
      code,
      "QR NFC-e v3 exige qrCodeBaseUrl injetada do catálogo oficial SP (lib/fiscal/danfce/urls-sp).",
      `${campoPrefix}.qrCodeBaseUrl`,
    )
  }
  const urlChave = config.urlChave
  if (typeof urlChave !== "string" || urlChave === "") {
    rejectNfceQr(
      code,
      "QR NFC-e v3 exige urlChave injetada do catálogo oficial SP (lib/fiscal/danfce/urls-sp).",
      `${campoPrefix}.urlChave`,
    )
  }
  if (urlChave.length < URL_CHAVE_MIN || urlChave.length > URL_CHAVE_MAX || !URL_CHAVE_TSTRING.test(urlChave)) {
    rejectNfceQr(
      code,
      `urlChave injetada fora do contrato XSD (TString, ${URL_CHAVE_MIN}–${URL_CHAVE_MAX} caracteres).`,
      `${campoPrefix}.urlChave`,
    )
  }
  return { qrCodeBaseUrl, urlChave }
}

export function assertQrCodeLength(qrCode: string, code: "qr_online_invalido" | "qr_offline_invalido", campo: string): void {
  if (qrCode.length < QR_CODE_MIN || qrCode.length > QR_CODE_MAX) {
    rejectNfceQr(code, "qrCode gerado fora do comprimento XSD (60–1000).", campo)
  }
}

/** Filho de `NFe`. Ordem XSD: `qrCode` → `urlChave`. Sem Signature. */
export function infNFeSuplNode(supl: NfceInfNFeSupl): XmlNode {
  return group("infNFeSupl", [leafRequired("qrCode", supl.qrCode), leafRequired("urlChave", supl.urlChave)])
}
