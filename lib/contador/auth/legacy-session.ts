/**
 * Sessão do portal legado do Contador (`/contador`, `/login-contador`).
 * HMAC-SHA256 via Web Crypto — compatível com Edge (proxy.ts) e Route Handlers (Node).
 * Não usar node:crypto aqui: este módulo é importado pelo proxy (Edge runtime).
 * Payload não carrega PIN, usuário, loja ou qualquer dado fiscal — apenas emissão/expiração/nonce.
 */

export const CONTADOR_COOKIE = "assistec_contador_session"
export const CONTADOR_SESSION_MAX_AGE_SECONDS = 60 * 60 * 12 // 12h

const encoder = new TextEncoder()

function base64UrlEncode(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data
  let binary = ""
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function base64UrlDecode(value: string): Uint8Array {
  const pad = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4))
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/") + pad
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

function randomNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return base64UrlEncode(bytes)
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ])
}

type ContadorSessionPayload = { issuedAt: number; expiresAt: number; nonce: string }

export async function createContadorSessionToken(secret: string, nowMs: number = Date.now()): Promise<string> {
  const payload: ContadorSessionPayload = {
    issuedAt: nowMs,
    expiresAt: nowMs + CONTADOR_SESSION_MAX_AGE_SECONDS * 1000,
    nonce: randomNonce(),
  }
  const payloadB64 = base64UrlEncode(encoder.encode(JSON.stringify(payload)))
  const key = await importHmacKey(secret)
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payloadB64))
  return `${payloadB64}.${base64UrlEncode(sig)}`
}

export type VerifyContadorSessionResult = { ok: true } | { ok: false; reason: string }

export async function verifyContadorSessionToken(
  token: string | undefined | null,
  secret: string,
  nowMs: number = Date.now()
): Promise<VerifyContadorSessionResult> {
  if (!secret) return { ok: false, reason: "missing_server_secret" }
  if (!token) return { ok: false, reason: "missing_cookie" }
  const parts = token.split(".")
  if (parts.length !== 2) return { ok: false, reason: "malformed_token" }
  const [payloadB64, sigB64] = parts

  let sigBytes: Uint8Array
  try {
    sigBytes = base64UrlDecode(sigB64!)
  } catch {
    return { ok: false, reason: "malformed_token" }
  }

  const key = await importHmacKey(secret)
  const valid = await crypto.subtle.verify("HMAC", key, sigBytes, encoder.encode(payloadB64))
  if (!valid) return { ok: false, reason: "invalid_signature" }

  let payload: ContadorSessionPayload
  try {
    const json = new TextDecoder().decode(base64UrlDecode(payloadB64!))
    payload = JSON.parse(json) as ContadorSessionPayload
  } catch {
    return { ok: false, reason: "malformed_token" }
  }
  if (
    typeof payload.issuedAt !== "number" ||
    typeof payload.expiresAt !== "number" ||
    typeof payload.nonce !== "string"
  ) {
    return { ok: false, reason: "malformed_token" }
  }
  if (nowMs > payload.expiresAt) return { ok: false, reason: "expired" }

  return { ok: true }
}

type CookieOptions = {
  name: string
  value: string
  httpOnly: boolean
  secure: boolean
  sameSite: "lax"
  path: string
  maxAge: number
}

export function buildContadorSessionCookieOptions(token: string): CookieOptions {
  return {
    name: CONTADOR_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: CONTADOR_SESSION_MAX_AGE_SECONDS,
  }
}

export function buildContadorLogoutCookieOptions(): CookieOptions {
  return {
    name: CONTADOR_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  }
}

/**
 * Kill-switch do portal legado — DEFAULT OFF a partir do GOAL 019 (gate G4).
 *
 * Até o 018 o default era `on`: o legado seguia vivo enquanto o portal v2 não
 * estivesse pronto. Com o G4 aprovado (redirect `/contador` → portal v2), a posição
 * padrão inverteu — só o valor EXATO `"on"` reabre o legado. Ausente, vazia ou
 * qualquer outro valor mantém desligado, que é o estado seguro: um endpoint de PIN
 * global emitindo sessão para uma página que já não atende é passivo puro.
 *
 * Reabrir é ato deliberado e reversível (`CONTADOR_LEGACY_PORTAL=on`), documentado
 * no runbook como o rollback operacional do G4.
 */
export function resolveLegacyPortalEnabled(): boolean {
  return (process.env.CONTADOR_LEGACY_PORTAL ?? "off").trim().toLowerCase() === "on"
}

/** Hash não-reversível do IP para correlação em log — nunca logar o IP bruto. */
export async function hashIp(ip: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`contador-ip-v1:${ip}`))
  const bytes = new Uint8Array(digest)
  let hex = ""
  for (const b of bytes) hex += b.toString(16).padStart(2, "0")
  return hex.slice(0, 16)
}

/** Extração defensiva do IP do cliente a partir de headers (x-forwarded-for / x-real-ip). */
export function extractClientIp(headers: { get(name: string): string | null }): string {
  const xff = headers.get("x-forwarded-for")
  if (xff) {
    const first = xff.split(",")[0]?.trim()
    if (first) return first
  }
  const real = headers.get("x-real-ip")?.trim()
  if (real) return real
  return "unknown"
}

export type ContadorAuthEventName =
  | "contador_auth_attempt"
  | "contador_auth_success"
  | "contador_auth_failed"
  | "contador_auth_rate_limited"
  | "contador_auth_logout"
  | "contador_auth_disabled"

export type ContadorAuthLogFields = {
  ipHash: string
  reasonCode?: string
  path?: string
}

/** Log estruturado (JSON de uma linha). Nunca inclui PIN, cookie completo, secret ou IP bruto. */
export function logContadorAuthEvent(event: ContadorAuthEventName, fields: ContadorAuthLogFields): void {
  console.log(
    JSON.stringify({
      event,
      timestamp: new Date().toISOString(),
      ipHash: fields.ipHash,
      ...(fields.reasonCode ? { reasonCode: fields.reasonCode } : {}),
      ...(fields.path ? { path: fields.path } : {}),
    })
  )
}
