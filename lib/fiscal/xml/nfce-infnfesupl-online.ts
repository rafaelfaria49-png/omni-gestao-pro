/**
 * Montagem pura de `infNFeSupl` para QR NFC-e v3 **online** (GOAL 021B).
 *
 * `chave` e `tpAmb` vêm do mesmo build canônico que produz `infNFe` — este módulo
 * recusa chaves/ambientes paralelos. URLs entram só por injeção do caller (P-URL-SP
 * aberto: nenhum host SEFAZ-SP é literal aqui). Sem CSC. Sem QR offline. Sem rede.
 */

import { encodeNfceQrV3OnlineUrl } from "@/lib/fiscal/danfce/qr-v3"
import {
  assertQrCodeLength,
  infNFeSuplNode,
  rejectNfceQr,
  rejectParallelQrFields,
  requireInjectedQrUrls,
  type NfceInfNFeSupl,
} from "./nfce-infnfesupl"
import type { NfceQrOnlineV3Config } from "./nfce-xml.types"

export type NfceInfNFeSuplOnline = NfceInfNFeSupl

/**
 * Resolve `qrCode` + `urlChave` a partir da chave/`tpAmb` do XML e das URLs injetadas.
 * Fail-closed: configuração presente sem URL válida, `tpEmis=9`, ou chave/tpAmb paralelos.
 */
export function resolveNfceInfNFeSuplOnline(input: {
  readonly chave: string
  readonly tpAmb: 1 | 2
  readonly config: NfceQrOnlineV3Config
}): NfceInfNFeSuplOnline {
  const config = input.config
  if (config == null || typeof config !== "object") {
    rejectNfceQr("qr_online_invalido", "QR NFC-e v3 online exige configuração injetada pelo caller.", "qrOnlineV3")
  }
  rejectParallelQrFields(config, ["chave", "tpAmb"], "qr_online_invalido", "qrOnlineV3")
  const urls = requireInjectedQrUrls(config, "qr_online_invalido", "qrOnlineV3")

  const encoded = encodeNfceQrV3OnlineUrl({
    chave: input.chave,
    tpAmb: input.tpAmb,
    baseUrl: urls.qrCodeBaseUrl,
  })
  if (!encoded.ok) {
    if (encoded.code === "tp_emis_incompativel") {
      rejectNfceQr(
        "qr_online_invalido",
        "QR NFC-e v3 online recusa tpEmis incompatível (tpEmis=9 fora deste caminho).",
        "tpEmis",
      )
    }
    if (encoded.code === "url_base_invalida") {
      rejectNfceQr("qr_online_invalido", "qrCodeBaseUrl injetada inválida.", "qrOnlineV3.qrCodeBaseUrl")
    }
    rejectNfceQr("qr_online_invalido", `QR NFC-e v3 online recusado (${encoded.code}).`, "qrOnlineV3")
  }

  assertQrCodeLength(encoded.url, "qr_online_invalido", "qrOnlineV3.qrCodeBaseUrl")
  return Object.freeze({ qrCode: encoded.url, urlChave: urls.urlChave })
}

/** Filho de `NFe`, nunca de `infNFe`. Ordem XSD: `qrCode` → `urlChave`. Sem Signature. */
export const infNFeSuplOnlineNode = infNFeSuplNode
