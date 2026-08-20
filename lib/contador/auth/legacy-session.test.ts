import { describe, it, expect } from "vitest"
import {
  CONTADOR_SESSION_MAX_AGE_SECONDS,
  buildContadorLogoutCookieOptions,
  buildContadorSessionCookieOptions,
  createContadorSessionToken,
  extractClientIp,
  hashIp,
  resolveLegacyPortalEnabled,
  verifyContadorSessionToken,
} from "./legacy-session"

const SECRET = "test-session-secret-abcdef"

describe("createContadorSessionToken / verifyContadorSessionToken", () => {
  it("um token recém-criado é aceito", async () => {
    const token = await createContadorSessionToken(SECRET)
    const result = await verifyContadorSessionToken(token, SECRET)
    expect(result.ok).toBe(true)
  })

  it("nunca coloca PIN, usuário, loja ou dado fiscal no payload — só issuedAt/expiresAt/nonce", async () => {
    const token = await createContadorSessionToken(SECRET)
    const [payloadB64] = token.split(".")
    const json = JSON.parse(Buffer.from(payloadB64!.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"))
    expect(Object.keys(json).sort()).toEqual(["expiresAt", "issuedAt", "nonce"])
  })

  it("cookie ausente é rejeitado", async () => {
    const result = await verifyContadorSessionToken(undefined, SECRET)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("missing_cookie")
  })

  it("cookie legado literal \"1\" é rejeitado (formato incompatível)", async () => {
    const result = await verifyContadorSessionToken("1", SECRET)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("malformed_token")
  })

  it("cookie malformado (sem ponto separador) é rejeitado", async () => {
    const result = await verifyContadorSessionToken("nao-e-um-token-valido", SECRET)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("malformed_token")
  })

  it("cookie adulterado (assinatura não bate) é rejeitado", async () => {
    const token = await createContadorSessionToken(SECRET)
    const [payloadB64, sigB64] = token.split(".")
    const tampered = `${payloadB64}x.${sigB64}`
    const result = await verifyContadorSessionToken(tampered, SECRET)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("invalid_signature")
  })

  it("cookie assinado com outro segredo é rejeitado", async () => {
    const token = await createContadorSessionToken(SECRET)
    const result = await verifyContadorSessionToken(token, "outro-segredo-diferente")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("invalid_signature")
  })

  it("cookie expirado é rejeitado", async () => {
    const issuedAt = Date.now() - 13 * 60 * 60 * 1000
    const token = await createContadorSessionToken(SECRET, issuedAt)
    const result = await verifyContadorSessionToken(token, SECRET, issuedAt + 13 * 60 * 60 * 1000)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("expired")
  })

  it("sem segredo configurado, a verificação falha explicitamente", async () => {
    const result = await verifyContadorSessionToken("qualquer.coisa", "")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("missing_server_secret")
  })
})

describe("cookie de sessão", () => {
  it("validade máxima é 12h", () => {
    expect(CONTADOR_SESSION_MAX_AGE_SECONDS).toBe(12 * 60 * 60)
  })

  it("cookie de sessão tem os atributos exigidos e não é o valor legado \"1\"", async () => {
    const token = await createContadorSessionToken(SECRET)
    const cookie = buildContadorSessionCookieOptions(token)
    expect(cookie.value).not.toBe("1")
    expect(cookie.httpOnly).toBe(true)
    expect(cookie.sameSite).toBe("lax")
    expect(cookie.path).toBe("/")
    expect(cookie.maxAge).toBeLessThanOrEqual(CONTADOR_SESSION_MAX_AGE_SECONDS)
  })

  it("cookie de logout expira imediatamente com o mesmo nome/path", () => {
    const logout = buildContadorLogoutCookieOptions()
    const login = buildContadorSessionCookieOptions("x")
    expect(logout.name).toBe(login.name)
    expect(logout.path).toBe(login.path)
    expect(logout.maxAge).toBe(0)
    expect(logout.value).toBe("")
  })
})

describe("resolveLegacyPortalEnabled", () => {
  // GOAL 019 (gate G4): o default INVERTEU — de "on" para "off". Só o valor exato
  // "on" reabre o legado; qualquer outra coisa mantém desligado (fail closed).
  it("default (env ausente) mantém o portal DESLIGADO", () => {
    delete process.env.CONTADOR_LEGACY_PORTAL
    expect(resolveLegacyPortalEnabled()).toBe(false)
  })

  it("\"on\" reabre o portal legado (rollback operacional do G4)", () => {
    process.env.CONTADOR_LEGACY_PORTAL = "on"
    expect(resolveLegacyPortalEnabled()).toBe(true)
    delete process.env.CONTADOR_LEGACY_PORTAL
  })

  it("\"off\" desativa o portal", () => {
    process.env.CONTADOR_LEGACY_PORTAL = "off"
    expect(resolveLegacyPortalEnabled()).toBe(false)
    delete process.env.CONTADOR_LEGACY_PORTAL
  })

  it("é case-insensitive e tolera espaços", () => {
    process.env.CONTADOR_LEGACY_PORTAL = "  ON  "
    expect(resolveLegacyPortalEnabled()).toBe(true)
    process.env.CONTADOR_LEGACY_PORTAL = "  OFF  "
    expect(resolveLegacyPortalEnabled()).toBe(false)
    delete process.env.CONTADOR_LEGACY_PORTAL
  })

  it("valor ambíguo NUNCA reabre o legado", () => {
    for (const valor of ["true", "1", "yes", "enabled", "", "onn"]) {
      process.env.CONTADOR_LEGACY_PORTAL = valor
      expect(resolveLegacyPortalEnabled(), `valor="${valor}"`).toBe(false)
    }
    delete process.env.CONTADOR_LEGACY_PORTAL
  })
})

describe("extractClientIp / hashIp", () => {
  it("usa o primeiro IP de x-forwarded-for", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" })
    expect(extractClientIp(headers)).toBe("203.0.113.9")
  })

  it("cai para x-real-ip quando x-forwarded-for está ausente", () => {
    const headers = new Headers({ "x-real-ip": "198.51.100.4" })
    expect(extractClientIp(headers)).toBe("198.51.100.4")
  })

  it("retorna \"unknown\" de forma defensiva quando nenhum header existe", () => {
    const headers = new Headers()
    expect(extractClientIp(headers)).toBe("unknown")
  })

  it("hashIp nunca retorna o IP em claro e é determinístico para o mesmo IP", async () => {
    const h1 = await hashIp("203.0.113.9")
    const h2 = await hashIp("203.0.113.9")
    const h3 = await hashIp("203.0.113.10")
    expect(h1).toBe(h2)
    expect(h1).not.toBe(h3)
    expect(h1).not.toContain("203.0.113.9")
  })
})
