/**
 * Montagem pura de `infNFeSupl` para QR NFC-e v3 **offline** (`tpEmis=9`, GOAL 021C).
 *
 * Campos 1–7 (chave, versão, tpAmb, dia, vNF, tpId, idDest) vêm do mesmo build que produz
 * `infNFe`. O caller injeta só URLs e a assinatura RSA-SHA-1 do payload QR (signer ou Base64).
 * Essa assinatura NÃO é o XMLDSig. Sem CSC. Sem DigestValue XML. Sem rede. Sem EnvVault.
 */

import { encodeNfceQrV3OfflineUrl } from "@/lib/fiscal/danfce/qr-v3"
import type { QrV3Destinatario } from "@/lib/fiscal/danfce/qr-v3/types"
import {
  assertQrCodeLength,
  infNFeSuplNode,
  rejectNfceQr,
  rejectParallelQrFields,
  requireInjectedQrUrls,
  type NfceInfNFeSupl,
} from "./nfce-infnfesupl"
import type { NfceQrOfflineV3Config } from "./nfce-xml.types"

export type NfceInfNFeSuplOffline = NfceInfNFeSupl

const PARALLEL_OFFLINE = ["chave", "tpAmb", "dhEmi", "vNF", "destinatario", "tpId", "idDest"] as const

/**
 * Resolve `qrCode` + `urlChave` offline. Fail-closed se faltar URL/assinatura, se `tpEmis≠9`,
 * ou se o caller tentar injetar chave/tpAmb/dhEmi/vNF/destinatário paralelos.
 */
export function resolveNfceInfNFeSuplOffline(input: {
  readonly chave: string
  readonly tpAmb: 1 | 2
  readonly dhEmi: string
  readonly vNF: string
  readonly destinatario: QrV3Destinatario
  readonly config: NfceQrOfflineV3Config
}): NfceInfNFeSuplOffline {
  const config = input.config
  if (config == null || typeof config !== "object") {
    rejectNfceQr("qr_offline_invalido", "QR NFC-e v3 offline exige configuração injetada pelo caller.", "qrOfflineV3")
  }
  rejectParallelQrFields(config, PARALLEL_OFFLINE, "qr_offline_invalido", "qrOfflineV3")
  const urls = requireInjectedQrUrls(config, "qr_offline_invalido", "qrOfflineV3")

  const encoded = encodeNfceQrV3OfflineUrl({
    chave: input.chave,
    tpAmb: input.tpAmb,
    dhEmi: input.dhEmi,
    vNF: input.vNF,
    destinatario: input.destinatario,
    baseUrl: urls.qrCodeBaseUrl,
    sign: config.sign,
    assinaturaBase64: config.assinaturaBase64,
  })
  if (!encoded.ok) {
    if (encoded.code === "tp_emis_incompativel") {
      rejectNfceQr(
        "qr_offline_invalido",
        "QR NFC-e v3 offline exige tpEmis=9 (contingência). Outros tpEmis ficam no caminho online.",
        "tpEmis",
      )
    }
    if (encoded.code === "url_base_invalida") {
      rejectNfceQr("qr_offline_invalido", "qrCodeBaseUrl injetada inválida.", "qrOfflineV3.qrCodeBaseUrl")
    }
    if (encoded.code === "assinatura_ausente" || encoded.code === "assinatura_invalida") {
      rejectNfceQr(
        "qr_offline_invalido",
        "QR NFC-e v3 offline exige signer injetado ou assinatura Base64 da concatenação 1–7.",
        "qrOfflineV3",
      )
    }
    rejectNfceQr("qr_offline_invalido", `QR NFC-e v3 offline recusado (${encoded.code}).`, "qrOfflineV3")
  }

  assertQrCodeLength(encoded.url, "qr_offline_invalido", "qrOfflineV3.qrCodeBaseUrl")
  return Object.freeze({ qrCode: encoded.url, urlChave: urls.urlChave })
}

export const infNFeSuplOfflineNode = infNFeSuplNode
