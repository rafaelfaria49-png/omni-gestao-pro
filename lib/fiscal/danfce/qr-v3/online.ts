/**
 * Encoder puro do QR Code NFC-e v3 **online**.
 *
 * Payload: `chave|3|tpAmb`. Sem CSC, sem hash, sem dia/vNF/dest/assinatura.
 * `tpEmis` da chave ∈ {1,3,4} (XSD QRCODE V3 ONLINE). URL base não é literal.
 */
import {
  QR_V3_ONLINE_TP_EMIS,
  composeQrV3Url,
  fail,
  parseChaveAcesso,
  parseTpAmb,
  tpEmisDaChave,
} from "./canonical"
import { QR_V3_VERSAO, type QrV3Err, type QrV3OnlineInput, type QrV3OnlineOk } from "./types"

export function encodeNfceQrV3Online(input: QrV3OnlineInput): QrV3OnlineOk | QrV3Err {
  const chave = parseChaveAcesso(input.chave)
  if (!chave) return fail("chave_invalida")
  const tpAmb = parseTpAmb(input.tpAmb)
  if (!tpAmb) return fail("tp_amb_invalido")
  const tpEmis = tpEmisDaChave(chave)
  if (!tpEmis || !QR_V3_ONLINE_TP_EMIS.has(tpEmis)) return fail("tp_emis_incompativel")

  const payload = `${chave}|${QR_V3_VERSAO}|${tpAmb}`
  return Object.freeze({
    ok: true,
    versao: QR_V3_VERSAO,
    tpAmb,
    chave,
    payload,
    p: payload,
  })
}

export function encodeNfceQrV3OnlineUrl(
  input: QrV3OnlineInput & { readonly baseUrl: string },
): { readonly ok: true; readonly url: string; readonly encoded: QrV3OnlineOk } | QrV3Err {
  const encoded = encodeNfceQrV3Online(input)
  if (!encoded.ok) return encoded
  const url = composeQrV3Url(input.baseUrl, encoded.p)
  if (typeof url !== "string") return url
  return { ok: true, url, encoded }
}
