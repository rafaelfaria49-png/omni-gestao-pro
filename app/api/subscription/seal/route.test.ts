import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// ============================================================================
// GOAL PLAT-SEC-SEAL-003B — emissão do selo de assinatura.
// ----------------------------------------------------------------------------
// Contrato provado aqui:
//   · anónimo NUNCA obtém Set-Cookie de assinatura (401);
//   · papel inadequado (CAIXA, GERENTE, …) NUNCA obtém selo (403);
//   · o corpo da requisição NÃO escolhe plano, status nem vencimento;
//   · sem `ASSISTEC_SUBSCRIPTION_SECRET` a emissão falha fechada (503);
//   · sem assinatura server-side ativa não há selo — nada é inventado.
//
// `requireAdmin` é REAL (não mockado): o teste exercita a decisão canónica de
// papel, não um mock dela. Só `auth()`, Prisma e o relógio são mockados.
// ============================================================================

const TEST_SECRET = "segredo-de-teste-nao-produtivo"
const AGORA = Date.parse("2026-08-03T12:00:00.000Z")

const h = vi.hoisted(() => ({
  auth: vi.fn(async (): Promise<unknown> => null),
  findUnique: vi.fn(async (): Promise<unknown> => null),
  createSeal: vi.fn(),
}))

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}))
vi.mock("@/auth", () => ({ auth: h.auth }))
vi.mock("@/lib/prisma", () => ({
  prisma: { adminUser: { findUnique: h.findUnique } },
}))
vi.mock("@/lib/trusted-time", () => ({ getTrustedTimeMs: async () => AGORA }))

// Espia a assinatura sem a substituir: o caminho feliz continua a usar o HMAC real.
vi.mock("@/lib/subscription-seal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/subscription-seal")>()
  h.createSeal.mockImplementation(actual.createSubscriptionCookieValue)
  return { ...actual, createSubscriptionCookieValue: h.createSeal }
})

import { POST } from "./route"
import {
  SUBSCRIPTION_COOKIE_NAME,
  verifySubscriptionCookieValue,
} from "@/lib/subscription-seal"

/**
 * `POST()` não declara parâmetro — o corpo é fisicamente inalcançável pela rota.
 * O cast permite enviar um corpo hostil mesmo assim e provar que ele é ignorado.
 */
const postComCorpo = POST as unknown as (req?: Request) => Promise<Response>

function sessao(role: string) {
  return { user: { id: "admin-1", name: "Admin", email: "a@b.c", role } }
}

function corpoHostil() {
  return new Request("http://local/api/subscription/seal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vencimento: "2099-12-31", plano: "diamante", status: "ativa" }),
  })
}

function assinaturaAtiva() {
  return {
    planName: "PRATA",
    subscriptionStatus: "active",
    currentPeriodEnd: new Date("2026-09-10T00:00:00.000Z"),
  }
}

function setCookieDe(res: Response): string | null {
  return res.headers.get("set-cookie")
}

let secretOriginal: string | undefined

beforeEach(() => {
  secretOriginal = process.env.ASSISTEC_SUBSCRIPTION_SECRET
  process.env.ASSISTEC_SUBSCRIPTION_SECRET = TEST_SECRET
  vi.clearAllMocks()
  h.auth.mockResolvedValue(null)
  h.findUnique.mockResolvedValue(null)
})

afterEach(() => {
  // Restaura o ambiente para não vazar entre testes.
  if (secretOriginal === undefined) delete process.env.ASSISTEC_SUBSCRIPTION_SECRET
  else process.env.ASSISTEC_SUBSCRIPTION_SECRET = secretOriginal
  vi.clearAllMocks()
})

describe("POST /api/subscription/seal — autorização", () => {
  it("sem sessão: 401, sem Set-Cookie e sem assinar nada", async () => {
    h.auth.mockResolvedValue(null)

    const res = await POST()

    expect(res.status).toBe(401)
    expect(setCookieDe(res)).toBeNull()
    expect(h.createSeal).not.toHaveBeenCalled()
    expect(h.findUnique).not.toHaveBeenCalled()
  })

  it("sessão CAIXA: 403, sem Set-Cookie e sem assinar nada", async () => {
    h.auth.mockResolvedValue(sessao("CAIXA"))

    const res = await POST()

    expect(res.status).toBe(403)
    expect(setCookieDe(res)).toBeNull()
    expect(h.createSeal).not.toHaveBeenCalled()
  })

  it.each(["GERENTE", "OPERADOR", "VENDEDOR", "TECNICO", ""])(
    "sessão comum sem permissão administrativa (%s): 403",
    async (role) => {
      h.auth.mockResolvedValue(sessao(role))

      const res = await POST()

      expect(res.status).toBe(403)
      expect(setCookieDe(res)).toBeNull()
      expect(h.createSeal).not.toHaveBeenCalled()
    },
  )

  it.each(["ADMIN", "SUPER_ADMIN"])("papel administrativo (%s) emite selo", async (role) => {
    h.auth.mockResolvedValue(sessao(role))
    h.findUnique.mockResolvedValue(assinaturaAtiva())

    const res = await POST()

    expect(res.status).toBe(200)
    expect(setCookieDe(res)).toContain(`${SUBSCRIPTION_COOKIE_NAME}=`)
  })
})

describe("POST /api/subscription/seal — origem dos dados", () => {
  beforeEach(() => {
    h.auth.mockResolvedValue(sessao("ADMIN"))
  })

  it("plano, status e vencimento vêm do registo server-side", async () => {
    h.findUnique.mockResolvedValue(assinaturaAtiva())

    const res = await POST()
    const cookie = setCookieDe(res) ?? ""
    const valor = decodeURIComponent(
      cookie.split(";")[0]!.slice(`${SUBSCRIPTION_COOKIE_NAME}=`.length),
    )
    const verificado = await verifySubscriptionCookieValue(valor, TEST_SECRET)

    expect(verificado.ok).toBe(true)
    if (!verificado.ok) return
    expect(verificado.plano).toBe("prata")
    expect(verificado.status).toBe("ativa")
    expect(verificado.vencimento).toBe("2026-09-10")
  })

  it("corpo hostil NÃO promove plano, NÃO prolonga vencimento, NÃO altera status", async () => {
    h.findUnique.mockResolvedValue(assinaturaAtiva())

    const res = await postComCorpo(corpoHostil())
    const cookie = setCookieDe(res) ?? ""
    const valor = decodeURIComponent(
      cookie.split(";")[0]!.slice(`${SUBSCRIPTION_COOKIE_NAME}=`.length),
    )
    const verificado = await verifySubscriptionCookieValue(valor, TEST_SECRET)

    expect(verificado.ok).toBe(true)
    if (!verificado.ok) return
    // O corpo pedia diamante/2099-12-31; o servidor impôs prata/2026-09-10.
    expect(verificado.plano).toBe("prata")
    expect(verificado.plano).not.toBe("diamante")
    expect(verificado.vencimento).toBe("2026-09-10")
    expect(verificado.vencimento).not.toBe("2099-12-31")
  })

  it.each([
    ["sem registo de assinatura", null],
    ["cancelada", { planName: "OURO", subscriptionStatus: "canceled", currentPeriodEnd: new Date("2026-09-10T00:00:00.000Z") }],
    ["inadimplente", { planName: "OURO", subscriptionStatus: "past_due", currentPeriodEnd: new Date("2026-09-10T00:00:00.000Z") }],
    ["sem plano", { planName: null, subscriptionStatus: "active", currentPeriodEnd: new Date("2026-09-10T00:00:00.000Z") }],
    ["sem fim de período", { planName: "OURO", subscriptionStatus: "active", currentPeriodEnd: null }],
    ["período já vencido", { planName: "OURO", subscriptionStatus: "active", currentPeriodEnd: new Date("2026-07-01T00:00:00.000Z") }],
  ])("assinatura %s: 403 e nenhum selo", async (_caso, registo) => {
    h.findUnique.mockResolvedValue(registo)

    const res = await POST()

    expect(res.status).toBe(403)
    expect(setCookieDe(res)).toBeNull()
    expect(h.createSeal).not.toHaveBeenCalled()
  })

  it("aceita `trialing` como assinatura corrente", async () => {
    h.findUnique.mockResolvedValue({
      planName: "BRONZE",
      subscriptionStatus: "trialing",
      currentPeriodEnd: new Date("2026-08-20T00:00:00.000Z"),
    })

    const res = await POST()

    expect(res.status).toBe(200)
    expect(setCookieDe(res)).toContain(`${SUBSCRIPTION_COOKIE_NAME}=`)
  })
})

describe("POST /api/subscription/seal — segredo ausente", () => {
  it("falha fechada (503) sem emitir nem assinar", async () => {
    delete process.env.ASSISTEC_SUBSCRIPTION_SECRET
    h.auth.mockResolvedValue(sessao("ADMIN"))
    h.findUnique.mockResolvedValue(assinaturaAtiva())

    const res = await POST()

    expect(res.status).toBe(503)
    expect(setCookieDe(res)).toBeNull()
    expect(h.createSeal).not.toHaveBeenCalled()
  })

  it("segredo só com espaços conta como ausente", async () => {
    process.env.ASSISTEC_SUBSCRIPTION_SECRET = "   "
    h.auth.mockResolvedValue(sessao("ADMIN"))
    h.findUnique.mockResolvedValue(assinaturaAtiva())

    const res = await POST()

    expect(res.status).toBe(503)
    expect(setCookieDe(res)).toBeNull()
  })

  it("não revela o segredo nem detalhes internos na resposta", async () => {
    h.auth.mockResolvedValue(sessao("ADMIN"))
    h.findUnique.mockResolvedValue(assinaturaAtiva())

    const res = await POST()
    const texto = JSON.stringify(await res.json())

    expect(texto).not.toContain(TEST_SECRET)
  })
})

describe("POST /api/subscription/seal — proteções do cookie", () => {
  it("HttpOnly, SameSite=Lax, Path=/ e expiração colada ao período pago", async () => {
    h.auth.mockResolvedValue(sessao("ADMIN"))
    h.findUnique.mockResolvedValue(assinaturaAtiva())

    const cookie = setCookieDe(await POST()) ?? ""

    expect(cookie.toLowerCase()).toContain("httponly")
    expect(cookie.toLowerCase()).toContain("samesite=lax")
    expect(cookie).toContain("Path=/")
    // Expira no fim do período real (2026-09-10), não em 400 dias fixos.
    expect(cookie).toMatch(/Expires=[^;]*10 Sep 2026/i)
  })
})
