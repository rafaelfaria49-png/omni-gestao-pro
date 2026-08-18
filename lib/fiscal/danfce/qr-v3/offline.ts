/**
 * Encoder puro do QR Code NFC-e v3 **offline** (`tpEmis=9`).
 *
 * Três passos explícitos:
 * 1. mensagem canônica 1–7 (`chave|3|tpAmb|dia|vNF|tpId|idDest`);
 * 2. RSA-SHA-1 Base64 dessa string (assinatura já pronta **ou** signer injetado);
 * 3. payload final `canonical|assinatura`.
 *
 * Sem CSC. Sem DigestValue XML. Sem PFX/EnvVault/Prisma.
 */
import { createPrivateKey, sign as cryptoSign, verify as cryptoVerify, type KeyLike } from "node:crypto"
import {
  QR_V3_OFFLINE_TP_EMIS,
  canonicalAssinaturaBase64,
  canonicalDestinatario,
  canonicalVnf,
  composeQrV3Url,
  diaDeDhEmi,
  fail,
  parseChaveAcesso,
  parseTpAmb,
  tpEmisDaChave,
} from "./canonical"
import { QR_V3_VERSAO, type QrV3Err, type QrV3OfflineCanonicalOk, type QrV3OfflineInput, type QrV3OfflineOk, type QrV3OfflineSigner } from "./types"

export function buildNfceQrV3OfflineCanonical(
  input: QrV3OfflineInput,
): QrV3OfflineCanonicalOk | QrV3Err {
  const chave = parseChaveAcesso(input.chave)
  if (!chave) return fail("chave_invalida")
  const tpAmb = parseTpAmb(input.tpAmb)
  if (!tpAmb) return fail("tp_amb_invalido")
  if (tpEmisDaChave(chave) !== QR_V3_OFFLINE_TP_EMIS) return fail("tp_emis_incompativel")

  const dia = diaDeDhEmi(input.dhEmi)
  if (!dia) return fail("dh_emi_invalido")
  const vNF = canonicalVnf(input.vNF)
  if (!vNF) return fail("vnf_invalido")
  const dest = canonicalDestinatario(input.destinatario)
  if (!dest) return fail("destinatario_invalido")

  const canonical = [chave, QR_V3_VERSAO, tpAmb, dia, vNF, dest.tpId, dest.idDest].join("|")
  return Object.freeze({
    ok: true,
    versao: QR_V3_VERSAO,
    tpAmb,
    chave,
    dia,
    vNF,
    tpId: dest.tpId,
    idDest: dest.idDest,
    canonical,
  })
}

/**
 * Mesma primitiva RSA-SHA-1 do XMLDSig (`cryptoSign("sha1", utf8, key)` → Base64).
 * Material da chave é injetado; nenhum cofre ou PFX é aberto aqui.
 */
export function createQrV3OfflinePemSigner(privateKeyPem: string): QrV3OfflineSigner {
  const key = createPrivateKey(privateKeyPem)
  return (canonicalUtf8: string) =>
    cryptoSign("sha1", Buffer.from(canonicalUtf8, "utf8"), key).toString("base64")
}

export function verifyQrV3OfflineSignature(
  canonicalUtf8: string,
  assinaturaBase64: string,
  publicKey: KeyLike,
): boolean {
  const signature = canonicalAssinaturaBase64(assinaturaBase64)
  if (!signature) return false
  try {
    return cryptoVerify(
      "sha1",
      Buffer.from(canonicalUtf8, "utf8"),
      publicKey,
      Buffer.from(signature, "base64"),
    )
  } catch {
    return false
  }
}

function resolveAssinatura(
  canonical: string,
  input: QrV3OfflineInput,
): string | QrV3Err {
  if (input.assinaturaBase64 != null && String(input.assinaturaBase64).length > 0) {
    const ready = canonicalAssinaturaBase64(input.assinaturaBase64)
    if (!ready) return fail("assinatura_invalida")
    return ready
  }
  if (typeof input.sign === "function") {
    let produced: string
    try {
      produced = input.sign(canonical)
    } catch {
      return fail("assinatura_invalida")
    }
    const ready = canonicalAssinaturaBase64(produced)
    if (!ready) return fail("assinatura_invalida")
    return ready
  }
  return fail("assinatura_ausente")
}

export function encodeNfceQrV3Offline(input: QrV3OfflineInput): QrV3OfflineOk | QrV3Err {
  const fields = buildNfceQrV3OfflineCanonical(input)
  if (!fields.ok) return fields
  const assinatura = resolveAssinatura(fields.canonical, input)
  if (typeof assinatura !== "string") return assinatura
  const payload = `${fields.canonical}|${assinatura}`
  return Object.freeze({
    ...fields,
    assinatura,
    payload,
    p: payload,
  })
}

export function encodeNfceQrV3OfflineUrl(
  input: QrV3OfflineInput & { readonly baseUrl: string },
): { readonly ok: true; readonly url: string; readonly encoded: QrV3OfflineOk } | QrV3Err {
  const encoded = encodeNfceQrV3Offline(input)
  if (!encoded.ok) return encoded
  const url = composeQrV3Url(input.baseUrl, encoded.p)
  if (typeof url !== "string") return url
  return { ok: true, url, encoded }
}
