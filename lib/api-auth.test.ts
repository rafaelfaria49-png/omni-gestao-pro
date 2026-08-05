import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createSubscriptionCookieValue } from "@/lib/subscription-seal"

// ============================================================================
// GOAL 003D-lite — o gate legado deixou de aceitar selo.
// ----------------------------------------------------------------------------
// `getVerifiedSubscriptionFromCookies` é consumido por ~15 rotas (ops, cadastros,
// marketing, marketplace, financeiro…). Prova-se aqui que:
//   · um selo isolado, por mais bem assinado que esteja, NUNCA devolve ok:true;
//   · a decisão passou a ser sessão NextAuth + utilizador ativo;
//   · utilizador inexistente/desativado é recusado.
// `getSessionEntitlement` é REAL (só `auth()` e Prisma são mockados).
// ============================================================================

const TEST_SECRET = "segredo-de-teste-nao-produtivo"

/** Antigo fallback publicado, montado por partes — o literal não pode existir na árvore. */
const FALLBACK_ANTIGO = ["assistec", "dev", "secret", "change", "in", "production"].join("-")

const h = vi.hoisted(() => ({
  cookieValue: undefined as string | undefined,
  adminCookie: undefined as string | undefined,
  auth: vi.fn(async (): Promise<unknown> => null),
  findUnique: vi.fn(async (): Promise<unknown> => null),
}))

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      if (name === "assistec_sub_v1" && h.cookieValue !== undefined) return { value: h.cookieValue }
      if (name === ADMIN_AUTHORIZATION_COOKIE && h.adminCookie !== undefined) {
        return { value: h.adminCookie }
      }
      return undefined
    },
  }),
}))
vi.mock("@/auth", () => ({ auth: h.auth }))
vi.mock("@/lib/prisma", () => ({ prisma: { adminUser: { findUnique: h.findUnique } } }))

import { getVerifiedSubscriptionFromCookies, isAdminSession } from "@/lib/api-auth"
import {
  ADMIN_AUTHORIZATION_COOKIE,
  PIN_AUTHORIZATION_MAX_AGE_SECONDS,
  createPinAuthorizationToken,
} from "@/lib/auth/pin-authorization"

const USER_ATIVO = { active: true, planName: "PRATA", role: "CAIXA" }

function sessao(role = "CAIXA", id = "user-1") {
  return { user: { id, role } }
}

let secretOriginal: string | undefined

beforeEach(() => {
  secretOriginal = process.env.ASSISTEC_SUBSCRIPTION_SECRET
  process.env.ASSISTEC_SUBSCRIPTION_SECRET = TEST_SECRET
  h.cookieValue = undefined
  h.adminCookie = undefined
  vi.clearAllMocks()
  h.auth.mockResolvedValue(null)
  h.findUnique.mockResolvedValue(null)
})

afterEach(() => {
  if (secretOriginal === undefined) delete process.env.ASSISTEC_SUBSCRIPTION_SECRET
  else process.env.ASSISTEC_SUBSCRIPTION_SECRET = secretOriginal
  h.cookieValue = undefined
  vi.clearAllMocks()
})

describe("getVerifiedSubscriptionFromCookies — selo isolado nunca autentica", () => {
  it("sem sessão e sem selo: recusado", async () => {
    expect(await getVerifiedSubscriptionFromCookies()).toEqual({ ok: false })
  })

  it("selo VÁLIDO sem sessão: recusado (regressão do bypass anónimo)", async () => {
    h.cookieValue = await createSubscriptionCookieValue(
      "2099-12-31",
      "diamante",
      "ativa",
      TEST_SECRET,
    )

    expect(await getVerifiedSubscriptionFromCookies()).toEqual({ ok: false })
    // Nem sequer chega a consultar o utilizador: não há sessão.
    expect(h.findUnique).not.toHaveBeenCalled()
  })

  it("selo forjado com o antigo fallback e sem sessão: recusado", async () => {
    h.cookieValue = await createSubscriptionCookieValue(
      "2099-12-31",
      "diamante",
      "ativa",
      FALLBACK_ANTIGO,
    )

    expect(await getVerifiedSubscriptionFromCookies()).toEqual({ ok: false })
  })

  it("selo malformado sem sessão: recusado sem exceção não tratada", async () => {
    h.cookieValue = "!!!.@@@"

    await expect(getVerifiedSubscriptionFromCookies()).resolves.toEqual({ ok: false })
  })
})

describe("getVerifiedSubscriptionFromCookies — decisão por sessão", () => {
  it("sessão de funcionário SEM qualquer selo: autorizado (sem lockout)", async () => {
    h.auth.mockResolvedValue(sessao("CAIXA"))
    h.findUnique.mockResolvedValue(USER_ATIVO)
    h.cookieValue = undefined

    const r = await getVerifiedSubscriptionFromCookies()

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.status).toBe("ativa")
    expect(r.plano).toBe("prata")
  })

  it("sessão com selo EXPIRADO no cookie: o selo é irrelevante", async () => {
    h.auth.mockResolvedValue(sessao("VENDEDOR"))
    h.findUnique.mockResolvedValue(USER_ATIVO)
    h.cookieValue = await createSubscriptionCookieValue(
      "2020-01-01",
      "bronze",
      "suspensa",
      TEST_SECRET,
    )

    const r = await getVerifiedSubscriptionFromCookies()

    expect(r.ok).toBe(true)
    if (!r.ok) return
    // Vem da sessão, não do cookie suspenso/vencido.
    expect(r.status).toBe("ativa")
  })

  it("utilizador desativado: recusado mesmo com sessão", async () => {
    h.auth.mockResolvedValue(sessao("CAIXA"))
    h.findUnique.mockResolvedValue({ ...USER_ATIVO, active: false })

    expect(await getVerifiedSubscriptionFromCookies()).toEqual({ ok: false })
  })

  it("utilizador inexistente: recusado mesmo com sessão", async () => {
    h.auth.mockResolvedValue(sessao("CAIXA"))
    h.findUnique.mockResolvedValue(null)

    expect(await getVerifiedSubscriptionFromCookies()).toEqual({ ok: false })
  })
})

// ============================================================================
// GOAL PLAT-AUTH-PIN-CONTAINMENT-001A — `isAdminSession` deixou de ser "o cookie
// existe?". O consumidor real é `GET /api/audit/logs`; um cookie qualquer, ou o
// cookie legítimo de OUTRO utilizador, não pode mais abrir a trilha de auditoria.
// ============================================================================
describe("isAdminSession — autorização assinada e vinculada", () => {
  const PIN_SECRET = "segredo-de-teste-pin-containment-001a"
  const T0 = Date.UTC(2026, 7, 5, 12, 0, 0)

  beforeEach(() => {
    process.env.AUTH_SECRET = PIN_SECRET
    vi.spyOn(Date, "now").mockReturnValue(T0)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function tokenDe(userId: string): Promise<string> {
    return createPinAuthorizationToken(
      { userId, storeId: "loja-A", supervisorId: "supervisor-1" },
      PIN_SECRET,
      T0,
    )
  }

  it("sem sessão: recusado mesmo com cookie presente", async () => {
    h.auth.mockResolvedValue(null)
    h.adminCookie = await tokenDe("user-1")
    expect(await isAdminSession()).toBe(false)
  })

  it("cookie ausente: recusado", async () => {
    h.auth.mockResolvedValue(sessao("ADMIN", "user-1"))
    expect(await isAdminSession()).toBe(false)
  })

  it("valor arbitrário no cookie (comportamento legado) já não autentica", async () => {
    h.auth.mockResolvedValue(sessao("ADMIN", "user-1"))
    h.adminCookie = "user-1"
    expect(await isAdminSession()).toBe(false)
  })

  it("autorização do próprio utilizador: aceite", async () => {
    h.auth.mockResolvedValue(sessao("ADMIN", "user-1"))
    h.adminCookie = await tokenDe("user-1")
    expect(await isAdminSession()).toBe(true)
  })

  it("autorização de OUTRO utilizador: recusada", async () => {
    h.auth.mockResolvedValue(sessao("ADMIN", "user-2"))
    h.adminCookie = await tokenDe("user-1")
    expect(await isAdminSession()).toBe(false)
  })

  it("autorização expirada: recusada", async () => {
    h.auth.mockResolvedValue(sessao("ADMIN", "user-1"))
    h.adminCookie = await tokenDe("user-1")
    vi.spyOn(Date, "now").mockReturnValue(T0 + PIN_AUTHORIZATION_MAX_AGE_SECONDS * 1000)
    expect(await isAdminSession()).toBe(false)
  })

  it("sem segredo no ambiente: falha fechado", async () => {
    h.auth.mockResolvedValue(sessao("ADMIN", "user-1"))
    h.adminCookie = await tokenDe("user-1")
    delete process.env.AUTH_SECRET
    delete process.env.NEXTAUTH_SECRET
    delete process.env.PIN_AUTHORIZATION_SECRET
    expect(await isAdminSession()).toBe(false)
  })
})
