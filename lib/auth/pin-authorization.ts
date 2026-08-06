/**
 * Autorização temporária de supervisor por PIN — GOAL PLAT-AUTH-PIN-CONTAINMENT-001A.
 *
 * Contexto (auditoria PLAT-STAFF-AUTH-PDV-CASH-HANDOVER-AUDIT-001, P0 #1): o
 * `POST /api/auth/admin` era público, sem sessão e sem rate limit, e emitia um cookie
 * administrativo de 7 dias cujo valor era o **id cru** do supervisor — um booleano
 * disfarçado, sem assinatura, sem expiração verificada no servidor e sem vínculo com
 * quem pediu nem com a loja onde a ação aconteceria.
 *
 * Este módulo fecha o contrato da autorização (sem migration, sem tocar em `User.pin`):
 *
 *  - **assinatura**: HMAC-SHA256 sobre os bytes exatos do payload transmitido;
 *  - **expiração**: `exp` em epoch-seconds, verificado SEMPRE no servidor — o `maxAge`
 *    do cookie é conveniência de browser, nunca a fonte da verdade;
 *  - **escopo**: `userId` (sessão NextAuth do solicitante) + `storeId` (unidade
 *    autorizada por `canAccessStore`) são vinculados na emissão e reconferidos em
 *    cada consumo — reuso cross-user e cross-store morre aqui;
 *  - **separação de domínio**: a chave é derivada de `AUTH_SECRET` por HMAC do schema,
 *    logo não é o segredo do NextAuth e um token daqui não vale em nenhum outro
 *    contexto do repositório.
 *
 * Web Crypto (e não `node:crypto`) de propósito: `lib/api-auth.ts` consome estas
 * funções e é importado por muitas rotas; manter tudo Edge-safe evita quebrar o bundle
 * e deixa a porta aberta para o `proxy.ts` verificar o token no futuro.
 *
 * O PIN NUNCA entra aqui: este módulo não recebe, não compara, não serializa e não
 * regista PIN algum. A única referência a PIN é a lista de valores legados BLOQUEADOS.
 */

/** Schema versionado — mudar o contrato invalida todos os tokens antigos. */
export const PIN_AUTHORIZATION_SCHEMA = "omni.pdv.supervisor-pin-authorization/v1" as const

/**
 * Nome do cookie. Mantido do fluxo legado de propósito: `proxy.ts` (gate de
 * `/logs-sistema`) e `lib/api-auth.ts` já o leem, e renomeá-lo derrubaria esses
 * caminhos sem ganho de segurança — o que muda é o CONTEÚDO, que deixa de ser um id
 * cru e passa a ser um token assinado e expirável.
 */
export const ADMIN_AUTHORIZATION_COOKIE = "assistec_admin_session"

/**
 * Duração da autorização administrativa: **15 minutos**.
 *
 * O GOAL admite até 30 min e prefere 15. A autorização é uma co-assinatura pontual
 * (cancelar item, liberar desconto, abrir o resumo do caixa), não uma sessão de
 * trabalho — 7 dias, como no legado, transformava uma aprovação única em acesso
 * administrativo persistente no terminal.
 */
export const PIN_AUTHORIZATION_MAX_AGE_SECONDS = 15 * 60

/** Nome da env com precedência sobre `AUTH_SECRET`, se algum dia for provisionada. */
export const ENV_KEY_PIN_AUTHORIZATION_SECRET = "PIN_AUTHORIZATION_SECRET" as const

/**
 * PINs legados conhecidos que NUNCA autenticam, mesmo que voltem a existir em banco
 * por seed, restore ou erro de cadastro.
 *
 * `"1234"` é o valor semeado por `scripts/seed-supervisor-pin.ts` e documentado em
 * `docs/ai/SUPERVISOR_PIN_GOAL_REPORT.md` — ou seja, é público, não é segredo. A
 * Fase 12 da auditoria confirmou **0 registros** com ele em produção; a lista existe
 * para que o risco não possa voltar silenciosamente.
 */
export const BLOCKED_LEGACY_SUPERVISOR_PINS: readonly string[] = ["1234"] as const

/** Valor canónico do PIN semeado — usado também para recusar uma rotação de volta a ele. */
export const LEGACY_DEFAULT_SUPERVISOR_PIN = BLOCKED_LEGACY_SUPERVISOR_PINS[0]!

/** `true` quando o valor recebido é um PIN legado bloqueado. Nunca regista o valor. */
export function isBlockedLegacySupervisorPin(pin: string): boolean {
  return BLOCKED_LEGACY_SUPERVISOR_PINS.includes(pin.trim())
}

export type PinAuthorizationPayload = Readonly<{
  v: typeof PIN_AUTHORIZATION_SCHEMA
  /** `AdminUser.id` da sessão NextAuth que PEDIU a autorização (o operador). */
  userId: string
  /** Unidade já validada por `canAccessStore` no momento da emissão. */
  storeId: string
  /** `User.id` do supervisor cujo PIN co-assinou. Não é o autor da ação. */
  supervisorId: string
  /** Epoch-seconds. */
  iat: number
  /** Epoch-seconds. */
  exp: number
  nonce: string
}>

export type PinAuthorizationFailure =
  | "missing_server_secret"
  | "missing_cookie"
  | "malformed_token"
  | "invalid_signature"
  | "schema_mismatch"
  | "expired"
  | "user_mismatch"
  | "store_mismatch"

export type PinAuthorizationVerification =
  | { ok: true; payload: PinAuthorizationPayload }
  | { ok: false; reason: PinAuthorizationFailure }

type EnvLike = Record<string, string | undefined>

const encoder = new TextEncoder()

/**
 * Segredo do ambiente, ou `null` — **fail-closed**. Reusa `AUTH_SECRET` (já obrigatório
 * em produção, ver CLAUDE.md) em vez de exigir provisionamento novo, seguindo o
 * precedente de `lib/contador/documentos/intent.ts`.
 */
export function resolvePinAuthorizationSecret(env: EnvLike = process.env): string | null {
  const base = (
    env[ENV_KEY_PIN_AUTHORIZATION_SECRET] ??
    env.AUTH_SECRET ??
    env.NEXTAUTH_SECRET ??
    ""
  ).trim()
  return base.length > 0 ? base : null
}

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

/**
 * Chave derivada com separação de domínio: `HMAC(secret, SCHEMA)` vira a chave real.
 * Comprometer o segredo do NextAuth não entrega esta chave já derivada, e um token
 * deste módulo nunca colide com o do portal do contador ou o de upload do HUB.
 */
async function deriveKey(secret: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const derived = await crypto.subtle.sign("HMAC", base, encoder.encode(PIN_AUTHORIZATION_SCHEMA))
  return crypto.subtle.importKey("raw", derived, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ])
}

/**
 * Emite `<payload>.<assinatura>`. `iat`/`exp` são calculados aqui — nunca aceites do
 * cliente. O payload é serializado UMA vez e é exatamente essa string que se assina e
 * se transmite (assina-se o que se verifica).
 */
export async function createPinAuthorizationToken(
  input: { userId: string; storeId: string; supervisorId: string },
  secret: string,
  nowMs: number = Date.now(),
): Promise<string> {
  const iat = Math.floor(nowMs / 1000)
  const payload: PinAuthorizationPayload = {
    v: PIN_AUTHORIZATION_SCHEMA,
    userId: input.userId,
    storeId: input.storeId,
    supervisorId: input.supervisorId,
    iat,
    exp: iat + PIN_AUTHORIZATION_MAX_AGE_SECONDS,
    nonce: randomNonce(),
  }
  const body = base64UrlEncode(encoder.encode(JSON.stringify(payload)))
  const key = await deriveKey(secret)
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body))
  return `${body}.${base64UrlEncode(sig)}`
}

function isPayloadShape(value: unknown): value is PinAuthorizationPayload {
  if (typeof value !== "object" || value === null) return false
  const p = value as Record<string, unknown>
  return (
    typeof p.userId === "string" &&
    typeof p.storeId === "string" &&
    typeof p.supervisorId === "string" &&
    typeof p.iat === "number" &&
    typeof p.exp === "number" &&
    typeof p.nonce === "string"
  )
}

/**
 * Verifica assinatura, schema, expiração e VÍNCULO.
 *
 * `expected.userId` é obrigatório: uma autorização só vale para a sessão que a pediu.
 * `expected.storeId` é opcional apenas para consumidores que não são escopados por
 * unidade (ver `lib/api-auth.ts`); quando informado, divergência recusa.
 */
export async function verifyPinAuthorizationToken(
  token: string | undefined | null,
  secret: string | null,
  expected: { userId: string; storeId?: string | null },
  nowMs: number = Date.now(),
): Promise<PinAuthorizationVerification> {
  if (!secret) return { ok: false, reason: "missing_server_secret" }
  if (!token) return { ok: false, reason: "missing_cookie" }

  const parts = token.split(".")
  if (parts.length !== 2) return { ok: false, reason: "malformed_token" }
  const [body, sigB64] = parts as [string, string]

  let sigBytes: Uint8Array
  try {
    sigBytes = base64UrlDecode(sigB64)
  } catch {
    return { ok: false, reason: "malformed_token" }
  }

  const key = await deriveKey(secret)
  const valid = await crypto.subtle.verify("HMAC", key, sigBytes, encoder.encode(body))
  if (!valid) return { ok: false, reason: "invalid_signature" }

  let payload: unknown
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(body)))
  } catch {
    return { ok: false, reason: "malformed_token" }
  }
  if (!isPayloadShape(payload)) return { ok: false, reason: "malformed_token" }
  if ((payload as { v?: unknown }).v !== PIN_AUTHORIZATION_SCHEMA) {
    return { ok: false, reason: "schema_mismatch" }
  }

  // `exp` é epoch-seconds; comparar com NaN seria fail-OPEN, por isso a checagem é
  // "não é finito OU já passou" e não "passou".
  if (!Number.isFinite(payload.exp) || Math.floor(nowMs / 1000) >= payload.exp) {
    return { ok: false, reason: "expired" }
  }

  const wantedUser = expected.userId.trim()
  if (!wantedUser || payload.userId !== wantedUser) return { ok: false, reason: "user_mismatch" }

  const wantedStore = (expected.storeId ?? "").trim()
  if (wantedStore.length > 0 && payload.storeId !== wantedStore) {
    return { ok: false, reason: "store_mismatch" }
  }

  return { ok: true, payload }
}

type CookieOptions = {
  name: string
  value: string
  httpOnly: boolean
  secure: boolean
  /** `strict`: a autorização nunca acompanha requisição iniciada por outro site. */
  sameSite: "strict"
  path: string
  maxAge: number
}

export function buildPinAuthorizationCookieOptions(token: string): CookieOptions {
  return {
    name: ADMIN_AUTHORIZATION_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: PIN_AUTHORIZATION_MAX_AGE_SECONDS,
  }
}

export function buildPinAuthorizationClearCookieOptions(): CookieOptions {
  return {
    name: ADMIN_AUTHORIZATION_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  }
}

/**
 * Chave do rate limit. Namespacada para não colidir com o portal do contador, que
 * partilha o mesmo motor em memória (`lib/contador/auth/rate-limit.ts`) e usa o
 * `ipHash` cru como chave.
 *
 * Inclui `userId` + `storeId` para que uma loja ou um operador não consuma o
 * orçamento de tentativas de outro. **R1**: de propósito SEM `ipHash` — `x-forwarded-for`
 * é enviado pelo cliente, então derivar a chave dele deixava o mesmo utilizador abrir um
 * bucket novo a cada tentativa só trocando o cabeçalho. `ipHash` continua sendo aceite
 * aqui (o chamador não muda) e continua disponível para auditoria/log, mas nunca mais
 * participa da chave.
 */
export function buildPinRateLimitKey(input: {
  userId: string
  storeId: string
  ipHash: string
}): string {
  return `pin-supervisor:v2:${input.userId}:${input.storeId}`
}

/** Hash não-reversível do IP, só para correlação em log. Nunca logar o IP bruto. */
export async function hashClientIp(ip: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`pin-authorization-ip-v1:${ip}`))
  const bytes = new Uint8Array(digest)
  let hex = ""
  for (const b of bytes) hex += b.toString(16).padStart(2, "0")
  return hex.slice(0, 16)
}

export type PinAuthorizationEvent =
  | "pin_auth_success"
  | "pin_auth_failed"
  | "pin_auth_default_blocked"
  | "pin_auth_rate_limited"
  | "pin_auth_no_session"
  | "pin_auth_store_denied"
  | "pin_auth_store_missing"
  | "pin_auth_misconfigured"
  | "pin_auth_revoked"

/**
 * Log estruturado de uma linha. Aceita apenas identificadores — nunca PIN, hash de PIN,
 * cookie, token, segredo, header `Authorization` ou e-mail.
 */
export function logPinAuthorizationEvent(
  event: PinAuthorizationEvent,
  fields: { ipHash: string; userId?: string; storeId?: string; reasonCode?: string },
): void {
  console.log(
    JSON.stringify({
      event,
      timestamp: new Date().toISOString(),
      ipHash: fields.ipHash,
      ...(fields.userId ? { userId: fields.userId } : {}),
      ...(fields.storeId ? { storeId: fields.storeId } : {}),
      ...(fields.reasonCode ? { reasonCode: fields.reasonCode } : {}),
    }),
  )
}
