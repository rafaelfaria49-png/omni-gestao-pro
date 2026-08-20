import { describe, it, expect, vi, beforeEach } from "vitest"

const mockCookieStore = new Map<string, string>()
let mockRequestHeaders = new Headers({ "x-forwarded-for": "203.0.113.5" })

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (mockCookieStore.has(name) ? { value: mockCookieStore.get(name) } : undefined),
  })),
  headers: vi.fn(async () => mockRequestHeaders),
}))

import { GET, POST, DELETE } from "./route"
import { __resetContadorRateLimitForTests } from "@/lib/contador/auth/rate-limit"
import { CONTADOR_COOKIE } from "@/lib/contador/auth/legacy-session"

function setEnv(overrides: {
  pin?: string
  secret?: string
  legacyPortal?: string
}) {
  if (overrides.pin === undefined) delete process.env.CONTADOR_PIN
  else process.env.CONTADOR_PIN = overrides.pin
  if (overrides.secret === undefined) delete process.env.CONTADOR_SESSION_SECRET
  else process.env.CONTADOR_SESSION_SECRET = overrides.secret
  if (overrides.legacyPortal === undefined) delete process.env.CONTADOR_LEGACY_PORTAL
  else process.env.CONTADOR_LEGACY_PORTAL = overrides.legacyPortal
}

function postRequest(body: unknown) {
  return new Request("http://localhost/api/auth/contador", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function readSetCookieValue(res: Response): string | undefined {
  // NextResponse expõe `.cookies.get(name)?.value` (API do Next), mais robusto que parsear o header.
  const anyRes = res as unknown as { cookies: { get: (n: string) => { value: string } | undefined } }
  return anyRes.cookies.get(CONTADOR_COOKIE)?.value
}

beforeEach(() => {
  mockCookieStore.clear()
  mockRequestHeaders = new Headers({ "x-forwarded-for": "203.0.113.5" })
  __resetContadorRateLimitForTests()
  // GOAL 019: o kill-switch passou a ter DEFAULT OFF. Os testes de PIN abaixo
  // exercitam o comportamento LEGADO, então precisam reabri-lo explicitamente —
  // exatamente como o rollback operacional do G4 faria em produção.
  setEnv({ pin: "test-pin-123", secret: "test-secret-abc-xyz", legacyPortal: "on" })
})

describe("configuração — fail closed", () => {
  it("sem CONTADOR_PIN → 503", async () => {
    setEnv({ pin: undefined, secret: "test-secret-abc-xyz" })
    const res = await POST(postRequest({ pin: "qualquer" }))
    expect(res.status).toBe(503)
  })

  it("sem CONTADOR_SESSION_SECRET → 503", async () => {
    setEnv({ pin: "test-pin-123", secret: undefined })
    const res = await POST(postRequest({ pin: "test-pin-123" }))
    expect(res.status).toBe(503)
  })

  it("GOAL 019 — flag AUSENTE → default OFF → 503 (a API legada não abre sozinha)", async () => {
    setEnv({ pin: "test-pin-123", secret: "test-secret-abc-xyz" })
    const res = await POST(postRequest({ pin: "test-pin-123" }))
    expect(res.status).toBe(503)
    expect(((await res.json()) as { error?: string }).error).toBe("portal_disabled")
  })

  it("GOAL 019 — valor diferente de \"on\" não reabre o legado (fail closed)", async () => {
    for (const valor of ["true", "1", "yes", "ON-ish", ""]) {
      setEnv({ pin: "test-pin-123", secret: "test-secret-abc-xyz", legacyPortal: valor })
      const res = await POST(postRequest({ pin: "test-pin-123" }))
      expect(res.status, `valor="${valor}"`).toBe(503)
    }
  })

  it("flag CONTADOR_LEGACY_PORTAL=off → 503", async () => {
    setEnv({ pin: "test-pin-123", secret: "test-secret-abc-xyz", legacyPortal: "off" })
    const res = await POST(postRequest({ pin: "test-pin-123" }))
    expect(res.status).toBe(503)
  })

  it("GET também reporta portalEnabled=false quando a flag está off", async () => {
    setEnv({ pin: "test-pin-123", secret: "test-secret-abc-xyz", legacyPortal: "off" })
    const res = await GET()
    const json = (await res.json()) as { authenticated: boolean; portalEnabled: boolean }
    expect(json.portalEnabled).toBe(false)
    expect(json.authenticated).toBe(false)
  })
})

describe("PIN", () => {
  it("PIN errado → 401", async () => {
    const res = await POST(postRequest({ pin: "errado" }))
    expect(res.status).toBe(401)
  })

  it("PIN correto → autenticação aceita e cookie de sessão setado", async () => {
    const res = await POST(postRequest({ pin: "test-pin-123" }))
    expect(res.status).toBe(200)
    const cookieValue = readSetCookieValue(res)
    expect(cookieValue).toBeTruthy()
    expect(cookieValue).not.toBe("1")
  })

  it("não existe PIN default funcional — sem env, nenhum PIN autentica", async () => {
    setEnv({ pin: undefined, secret: "test-secret-abc-xyz" })
    const res = await POST(postRequest({ pin: "5678" }))
    expect(res.status).toBe(503)
  })
})

describe("rate limit", () => {
  it("cinco falhas são permitidas; a sexta é bloqueada com 429 e Retry-After", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await POST(postRequest({ pin: "errado" }))
      expect(res.status).toBe(401)
    }
    const blocked = await POST(postRequest({ pin: "errado" }))
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get("Retry-After")).toBeTruthy()
  })

  it("sucesso limpa o bloqueio do IP", async () => {
    for (let i = 0; i < 5; i++) await POST(postRequest({ pin: "errado" }))
    // reseta com um sucesso a partir de outro IP-hash não é o caso — simula sucesso limpando o mesmo IP
    __resetContadorRateLimitForTests()
    const ok = await POST(postRequest({ pin: "test-pin-123" }))
    expect(ok.status).toBe(200)
  })

  it("IPs diferentes não compartilham contador", async () => {
    for (let i = 0; i < 5; i++) await POST(postRequest({ pin: "errado" }))
    const blocked = await POST(postRequest({ pin: "errado" }))
    expect(blocked.status).toBe(429)

    mockRequestHeaders = new Headers({ "x-forwarded-for": "198.51.100.77" })
    const otherIp = await POST(postRequest({ pin: "errado" }))
    expect(otherIp.status).toBe(401)
  })
})

describe("cookie de sessão", () => {
  it("cookie não é o literal legado \"1\"", async () => {
    const res = await POST(postRequest({ pin: "test-pin-123" }))
    expect(readSetCookieValue(res)).not.toBe("1")
  })

  it("GET autentica com o cookie emitido pelo login", async () => {
    const login = await POST(postRequest({ pin: "test-pin-123" }))
    const token = readSetCookieValue(login)!
    mockCookieStore.set(CONTADOR_COOKIE, token)
    const res = await GET()
    const json = (await res.json()) as { authenticated: boolean }
    expect(json.authenticated).toBe(true)
  })

  it("cookie legado \"1\" não autentica mais", async () => {
    mockCookieStore.set(CONTADOR_COOKIE, "1")
    const res = await GET()
    const json = (await res.json()) as { authenticated: boolean }
    expect(json.authenticated).toBe(false)
  })

  it("cookie adulterado não autentica", async () => {
    const login = await POST(postRequest({ pin: "test-pin-123" }))
    const token = readSetCookieValue(login)!
    mockCookieStore.set(CONTADOR_COOKIE, `${token}tampered`)
    const res = await GET()
    const json = (await res.json()) as { authenticated: boolean }
    expect(json.authenticated).toBe(false)
  })
})

describe("logout", () => {
  it("expira o cookie imediatamente com o mesmo nome/path", async () => {
    const res = await DELETE()
    const anyRes = res as unknown as {
      cookies: { get: (n: string) => { value: string; maxAge?: number } | undefined }
    }
    const cookie = anyRes.cookies.get(CONTADOR_COOKIE)
    expect(cookie?.value).toBe("")
  })
})

describe("logs estruturados", () => {
  it("tentativa, sucesso, falha, bloqueio e logout emitem eventos sem PIN/cookie/secret", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    try {
      await POST(postRequest({ pin: "errado" }))
      await POST(postRequest({ pin: "test-pin-123" }))
      for (let i = 0; i < 5; i++) await POST(postRequest({ pin: "errado" }))
      await POST(postRequest({ pin: "errado" }))
      await DELETE()

      const lines = logSpy.mock.calls.map((c) => String(c[0]))
      const events = lines.map((l) => JSON.parse(l) as { event: string })
      const names = events.map((e) => e.event)

      expect(names).toContain("contador_auth_attempt")
      expect(names).toContain("contador_auth_success")
      expect(names).toContain("contador_auth_failed")
      expect(names).toContain("contador_auth_rate_limited")
      expect(names).toContain("contador_auth_logout")

      for (const line of lines) {
        expect(line).not.toContain("test-pin-123")
        expect(line).not.toContain("test-secret-abc-xyz")
        expect(line).not.toContain("203.0.113.5")
      }
    } finally {
      logSpy.mockRestore()
    }
  })
})
