/**
 * GOAL PLAT-AUTH-PIN-CONTAINMENT-001A — contrato do token de autorização de supervisor.
 *
 * O que estes testes garantem (e que o cookie legado NÃO garantia): o valor do cookie
 * é assinado, expira, e só vale para o par (userId, storeId) que o originou.
 *
 * Nenhum PIN aparece neste ficheiro: o módulo sob teste não manipula PIN — a única
 * referência é a lista de valores BLOQUEADOS, exercitada pelo lado negativo.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  ADMIN_AUTHORIZATION_COOKIE,
  BLOCKED_LEGACY_SUPERVISOR_PINS,
  PIN_AUTHORIZATION_MAX_AGE_SECONDS,
  buildPinAuthorizationClearCookieOptions,
  buildPinAuthorizationCookieOptions,
  buildPinRateLimitKey,
  createPinAuthorizationToken,
  isBlockedLegacySupervisorPin,
  logPinAuthorizationEvent,
  resolvePinAuthorizationSecret,
  verifyPinAuthorizationToken,
} from "./pin-authorization"

const SECRET = "segredo-de-teste-pin-containment-001a"
const USER_A = "admin-user-a"
const USER_B = "admin-user-b"
const LOJA_A = "loja-A"
const LOJA_B = "loja-B"
const SUPERVISOR = "supervisor-1"

const T0 = Date.UTC(2026, 7, 5, 12, 0, 0)

async function tokenFor(userId = USER_A, storeId = LOJA_A, nowMs = T0): Promise<string> {
  return createPinAuthorizationToken({ userId, storeId, supervisorId: SUPERVISOR }, SECRET, nowMs)
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe("duração da autorização", () => {
  it("é de 15 minutos — dentro do teto de 30 min exigido pelo GOAL", () => {
    expect(PIN_AUTHORIZATION_MAX_AGE_SECONDS).toBe(15 * 60)
    expect(PIN_AUTHORIZATION_MAX_AGE_SECONDS).toBeLessThanOrEqual(30 * 60)
  })

  it("o cookie NÃO reproduz a duração legada de 7 dias", () => {
    expect(buildPinAuthorizationCookieOptions("t").maxAge).toBe(PIN_AUTHORIZATION_MAX_AGE_SECONDS)
    expect(buildPinAuthorizationCookieOptions("t").maxAge).not.toBe(60 * 60 * 24 * 7)
  })

  it("cookie é HttpOnly, SameSite=strict e Path=/", () => {
    const o = buildPinAuthorizationCookieOptions("t")
    expect(o.name).toBe(ADMIN_AUTHORIZATION_COOKIE)
    expect(o.httpOnly).toBe(true)
    expect(o.sameSite).toBe("strict")
    expect(o.path).toBe("/")
  })

  it("a limpeza usa o mesmo nome e maxAge 0", () => {
    const o = buildPinAuthorizationClearCookieOptions()
    expect(o.name).toBe(ADMIN_AUTHORIZATION_COOKIE)
    expect(o.maxAge).toBe(0)
    expect(o.value).toBe("")
  })
})

describe("vínculo do token", () => {
  it("token válido do próprio par (user, loja) é aceite", async () => {
    const token = await tokenFor()
    const r = await verifyPinAuthorizationToken(token, SECRET, { userId: USER_A, storeId: LOJA_A }, T0 + 1000)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.payload.userId).toBe(USER_A)
      expect(r.payload.storeId).toBe(LOJA_A)
      expect(r.payload.supervisorId).toBe(SUPERVISOR)
    }
  })

  it("autorização de outro utilizador é recusada", async () => {
    const token = await tokenFor(USER_A, LOJA_A)
    const r = await verifyPinAuthorizationToken(token, SECRET, { userId: USER_B, storeId: LOJA_A }, T0 + 1000)
    expect(r).toEqual({ ok: false, reason: "user_mismatch" })
  })

  it("autorização usada em outra loja é recusada", async () => {
    const token = await tokenFor(USER_A, LOJA_A)
    const r = await verifyPinAuthorizationToken(token, SECRET, { userId: USER_A, storeId: LOJA_B }, T0 + 1000)
    expect(r).toEqual({ ok: false, reason: "store_mismatch" })
  })

  it("userId vazio nunca casa — não existe verificação sem sujeito", async () => {
    const token = await tokenFor()
    const r = await verifyPinAuthorizationToken(token, SECRET, { userId: "  " }, T0 + 1000)
    expect(r).toEqual({ ok: false, reason: "user_mismatch" })
  })
})

describe("expiração validada no servidor", () => {
  it("expira exatamente ao fim da janela", async () => {
    const token = await tokenFor()
    const dentro = await verifyPinAuthorizationToken(
      token,
      SECRET,
      { userId: USER_A, storeId: LOJA_A },
      T0 + (PIN_AUTHORIZATION_MAX_AGE_SECONDS - 1) * 1000,
    )
    expect(dentro.ok).toBe(true)

    const fora = await verifyPinAuthorizationToken(
      token,
      SECRET,
      { userId: USER_A, storeId: LOJA_A },
      T0 + PIN_AUTHORIZATION_MAX_AGE_SECONDS * 1000,
    )
    expect(fora).toEqual({ ok: false, reason: "expired" })
  })
})

describe("integridade", () => {
  it("assinatura de outro segredo é recusada", async () => {
    const token = await tokenFor()
    const r = await verifyPinAuthorizationToken(token, "outro-segredo", { userId: USER_A }, T0 + 1000)
    expect(r).toEqual({ ok: false, reason: "invalid_signature" })
  })

  it("payload adulterado (troca de loja) invalida a assinatura", async () => {
    const token = await tokenFor(USER_A, LOJA_A)
    const [, sig] = token.split(".") as [string, string]
    const forjado = Buffer.from(
      JSON.stringify({
        v: "omni.pdv.supervisor-pin-authorization/v1",
        userId: USER_A,
        storeId: LOJA_B,
        supervisorId: SUPERVISOR,
        iat: Math.floor(T0 / 1000),
        exp: Math.floor(T0 / 1000) + 900,
        nonce: "x",
      }),
      "utf8",
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")
    const r = await verifyPinAuthorizationToken(`${forjado}.${sig}`, SECRET, { userId: USER_A }, T0 + 1000)
    expect(r).toEqual({ ok: false, reason: "invalid_signature" })
  })

  it("o id cru do utilizador (formato legado) não é mais um token válido", async () => {
    const r = await verifyPinAuthorizationToken(USER_A, SECRET, { userId: USER_A }, T0)
    expect(r).toEqual({ ok: false, reason: "malformed_token" })
  })

  it("cookie ausente e segredo ausente falham fechado", async () => {
    expect(await verifyPinAuthorizationToken(undefined, SECRET, { userId: USER_A })).toEqual({
      ok: false,
      reason: "missing_cookie",
    })
    expect(await verifyPinAuthorizationToken("a.b", null, { userId: USER_A })).toEqual({
      ok: false,
      reason: "missing_server_secret",
    })
  })
})

describe("segredo do servidor", () => {
  it("resolve de AUTH_SECRET e falha fechado sem nenhuma env", () => {
    expect(resolvePinAuthorizationSecret({ AUTH_SECRET: " abc " })).toBe("abc")
    expect(resolvePinAuthorizationSecret({ NEXTAUTH_SECRET: "def" })).toBe("def")
    expect(resolvePinAuthorizationSecret({ PIN_AUTHORIZATION_SECRET: "z", AUTH_SECRET: "a" })).toBe("z")
    expect(resolvePinAuthorizationSecret({})).toBeNull()
    expect(resolvePinAuthorizationSecret({ AUTH_SECRET: "   " })).toBeNull()
  })
})

describe("PIN legado bloqueado", () => {
  it("todo valor da lista é sempre inválido, com ou sem espaços", () => {
    for (const blocked of BLOCKED_LEGACY_SUPERVISOR_PINS) {
      expect(isBlockedLegacySupervisorPin(blocked)).toBe(true)
      expect(isBlockedLegacySupervisorPin(` ${blocked} `)).toBe(true)
    }
  })

  it("um PIN qualquer fora da lista não é bloqueado por este mecanismo", () => {
    expect(isBlockedLegacySupervisorPin("908172")).toBe(false)
    expect(isBlockedLegacySupervisorPin("")).toBe(false)
  })
})

describe("rate limit — chave (R1: sem ipHash)", () => {
  it("separa orçamentos por utilizador e por loja", () => {
    const base = { userId: USER_A, storeId: LOJA_A, ipHash: "ip1" }
    expect(buildPinRateLimitKey(base)).toBe(buildPinRateLimitKey({ ...base }))
    expect(buildPinRateLimitKey(base)).not.toBe(buildPinRateLimitKey({ ...base, userId: USER_B }))
    expect(buildPinRateLimitKey(base)).not.toBe(buildPinRateLimitKey({ ...base, storeId: LOJA_B }))
  })

  it("R1: ipHash não participa da chave — trocar o IP não abre bucket novo", () => {
    const base = { userId: USER_A, storeId: LOJA_A, ipHash: "ip1" }
    expect(buildPinRateLimitKey(base)).toBe(buildPinRateLimitKey({ ...base, ipHash: "ip2" }))
    expect(buildPinRateLimitKey(base)).toBe(buildPinRateLimitKey({ ...base, ipHash: "" }))
  })

  it("é namespacada v2 — não colide com a chave crua de ipHash do portal do contador", () => {
    const key = buildPinRateLimitKey({ userId: USER_A, storeId: LOJA_A, ipHash: "ip1" })
    expect(key).toMatch(/^pin-supervisor:v2:/)
    expect(key).not.toContain("ip1")
  })
})

describe("log estruturado", () => {
  it("não emite segredo, token nem campos não declarados", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {})
    logPinAuthorizationEvent("pin_auth_failed", {
      ipHash: "abcdef0123456789",
      userId: USER_A,
      storeId: LOJA_A,
      reasonCode: "no_match",
    })
    const line = String(spy.mock.calls[0]?.[0] ?? "")
    const parsed = JSON.parse(line) as Record<string, unknown>
    expect(Object.keys(parsed).sort()).toEqual(
      ["event", "ipHash", "reasonCode", "storeId", "timestamp", "userId"].sort(),
    )
    expect(line).not.toContain(SECRET)
  })
})
