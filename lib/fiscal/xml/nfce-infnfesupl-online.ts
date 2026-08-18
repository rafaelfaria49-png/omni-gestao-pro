/**
 * Montagem pura de `infNFeSupl` para QR NFC-e v3 **online** (GOAL 021B).
 *
 * `chave` e `tpAmb` vêm do mesmo build canônico que produz `infNFe` — este módulo
 * recusa chaves/ambientes paralelos. URLs entram só por injeção do caller (P-URL-SP
 * aberto: nenhum host SEFAZ-SP é literal aqui). Sem CSC. Sem QR offline. Sem rede.
 */

import { encodeNfceQrV3OnlineUrl } from "@/lib/fiscal/danfce/qr-v3"
import { NfceXmlError, type NfceQrOnlineV3Config } from "./nfce-xml.types"
import { group, leafRequired, type XmlNode } from "./xml-writer"

/** TString (`tiposBasico_v4.00.xsd`) + min/max de `urlChave` em `leiauteNFe_v4.00.xsd`. */
const URL_CHAVE_TSTRING = /^([!-ÿ]{1}[ -ÿ]{0,}[!-ÿ]{1}|[!-ÿ]{1})$/
const URL_CHAVE_MIN = 21
const URL_CHAVE_MAX = 85
const QR_CODE_MIN = 60
const QR_CODE_MAX = 1000

export type NfceInfNFeSuplOnline = {
  readonly qrCode: string
  readonly urlChave: string
}

function reject(message: string, campo: string): never {
  throw new NfceXmlError("qr_online_invalido", message, null, campo)
}

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
    reject("QR NFC-e v3 online exige configuração injetada pelo caller.", "qrOnlineV3")
  }
  if (Object.prototype.hasOwnProperty.call(config, "chave") || Object.prototype.hasOwnProperty.call(config, "tpAmb")) {
    reject(
      "chave e tpAmb do QR online derivam do XML canônico; não são aceitos em paralelo.",
      "qrOnlineV3",
    )
  }

  const qrCodeBaseUrl = config.qrCodeBaseUrl
  if (typeof qrCodeBaseUrl !== "string" || qrCodeBaseUrl.trim() === "") {
    reject(
      "QR NFC-e v3 online exige qrCodeBaseUrl injetada pelo caller (P-URL-SP aberto).",
      "qrOnlineV3.qrCodeBaseUrl",
    )
  }

  const urlChave = config.urlChave
  if (typeof urlChave !== "string" || urlChave === "") {
    reject(
      "QR NFC-e v3 online exige urlChave injetada pelo caller (P-URL-SP aberto).",
      "qrOnlineV3.urlChave",
    )
  }
  if (urlChave.length < URL_CHAVE_MIN || urlChave.length > URL_CHAVE_MAX || !URL_CHAVE_TSTRING.test(urlChave)) {
    reject(
      `urlChave injetada fora do contrato XSD (TString, ${URL_CHAVE_MIN}–${URL_CHAVE_MAX} caracteres).`,
      "qrOnlineV3.urlChave",
    )
  }

  const encoded = encodeNfceQrV3OnlineUrl({
    chave: input.chave,
    tpAmb: input.tpAmb,
    baseUrl: qrCodeBaseUrl,
  })
  if (!encoded.ok) {
    if (encoded.code === "tp_emis_incompativel") {
      reject("QR NFC-e v3 online recusa tpEmis incompatível (tpEmis=9 fora deste caminho).", "tpEmis")
    }
    if (encoded.code === "url_base_invalida") {
      reject("qrCodeBaseUrl injetada inválida.", "qrOnlineV3.qrCodeBaseUrl")
    }
    reject(`QR NFC-e v3 online recusado (${encoded.code}).`, "qrOnlineV3")
  }

  const qrCode = encoded.url
  if (qrCode.length < QR_CODE_MIN || qrCode.length > QR_CODE_MAX) {
    reject("qrCode gerado fora do comprimento XSD (60–1000).", "qrOnlineV3.qrCodeBaseUrl")
  }

  return Object.freeze({ qrCode, urlChave })
}

/** Filho de `NFe`, nunca de `infNFe`. Ordem XSD: `qrCode` → `urlChave`. Sem Signature. */
export function infNFeSuplOnlineNode(supl: NfceInfNFeSuplOnline): XmlNode {
  return group("infNFeSupl", [leafRequired("qrCode", supl.qrCode), leafRequired("urlChave", supl.urlChave)])
}
