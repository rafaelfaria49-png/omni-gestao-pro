/**
 * Selo de assinatura assinado (HMAC-SHA256) — compatível com Edge (Web Crypto) e Route Handlers.
 * O segredo deve vir de process.env.ASSISTEC_SUBSCRIPTION_SECRET em produção.
 */

export const SUBSCRIPTION_COOKIE_NAME = "assistec_sub_v1"

/**
 * Segredo do selo (PLAT-SEC-SEAL-003B).
 *
 * Sem fallback: variável ausente/vazia devolve `""`, e `verifySubscriptionCookieValue`
 * responde `missing_server_secret` — nenhum selo é aceito, nenhum selo é emitido.
 * Falha fechada, por desenho.
 *
 * Lido a cada chamada (nunca em escopo de módulo) para que o valor não fique
 * congelado no import — o que impediria testar o caminho de segredo ausente.
 *
 * Vive aqui, e não em `lib/api-auth.ts`, para que ler o segredo não arraste a
 * stack de autenticação (`next-auth`) para quem só precisa assinar/verificar.
 */
export function getSubscriptionSecret(): string {
  return process.env.ASSISTEC_SUBSCRIPTION_SECRET?.trim() ?? ""
}

const encoder = new TextEncoder()

function base64UrlEncode(data: BufferSource): string {
  const bytes =
    data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  let binary = ""
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function base64UrlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4))
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  const raw = encoder.encode(secret)
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"])
}

/** Monta o payload canônico assinado. */
export function buildSubscriptionPayload(
  vencimento: string,
  plano: string,
  status: string
): string {
  return `${vencimento}|${plano}|${status}`
}

export async function signSubscriptionPayload(payload: string, secret: string): Promise<string> {
  const key = await importHmacKey(secret)
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload))
  return base64UrlEncode(sig)
}

export async function createSubscriptionCookieValue(
  vencimento: string,
  plano: string,
  status: string,
  secret: string
): Promise<string> {
  const payload = buildSubscriptionPayload(vencimento, plano, status)
  const sig = await signSubscriptionPayload(payload, secret)
  return `${base64UrlEncode(encoder.encode(payload))}.${sig}`
}

export type VerifySubscriptionResult =
  | { ok: true; vencimento: string; plano: string; status: string }
  | { ok: false; reason: string }

export async function verifySubscriptionCookieValue(
  cookieValue: string | undefined,
  secret: string
): Promise<VerifySubscriptionResult> {
  if (!secret) return { ok: false, reason: "missing_server_secret" }
  if (!cookieValue) return { ok: false, reason: "missing_cookie" }
  const parts = cookieValue.split(".")
  if (parts.length !== 2) return { ok: false, reason: "invalid_format" }
  const [payloadB64, sigB64] = parts
  let payloadBytes: Uint8Array
  try {
    payloadBytes = base64UrlDecode(payloadB64)
  } catch {
    return { ok: false, reason: "invalid_payload_encoding" }
  }
  const payload = new TextDecoder().decode(payloadBytes)
  const segments = payload.split("|")
  if (segments.length !== 3) return { ok: false, reason: "invalid_payload" }
  const [vencimento, plano, status] = segments
  const key = await importHmacKey(secret)
  let sigBytes: Uint8Array
  try {
    sigBytes = base64UrlDecode(sigB64)
  } catch {
    return { ok: false, reason: "invalid_sig_encoding" }
  }
  const valid = await crypto.subtle.verify("HMAC", key, sigBytes, encoder.encode(payload))
  if (!valid) return { ok: false, reason: "bad_signature" }
  return { ok: true, vencimento, plano, status }
}

/** Fim do dia (local) para data YYYY-MM-DD — evita ganhar dia por timezone se usarmos 23:59:59 local. */
export function isVencimentoExpired(serverTimeMs: number, vencimentoYmd: string): boolean {
  const end = new Date(`${vencimentoYmd}T23:59:59`)
  return serverTimeMs > end.getTime()
}
