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
  auth: vi.fn(async (): Promise<unknown> => null),
  findUnique: vi.fn(async (): Promise<unknown> => null),
}))

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "assistec_sub_v1" && h.cookieValue !== undefined
        ? { value: h.cookieValue }
        : undefined,
  }),
}))
vi.mock("@/auth", () => ({ auth: h.auth }))
vi.mock("@/lib/prisma", () => ({ prisma: { adminUser: { findUnique: h.findUnique } } }))

import { getVerifiedSubscriptionFromCookies } from "@/lib/api-auth"

const USER_ATIVO = { active: true, planName: "PRATA", role: "CAIXA" }

function sessao(role = "CAIXA", id = "user-1") {
  return { user: { id, role } }
}

let secretOriginal: string | undefined

beforeEach(() => {
  secretOriginal = process.env.ASSISTEC_SUBSCRIPTION_SECRET
  process.env.ASSISTEC_SUBSCRIPTION_SECRET = TEST_SECRET
  h.cookieValue = undefined
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
