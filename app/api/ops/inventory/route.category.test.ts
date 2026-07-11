import { beforeEach, describe, expect, it, vi } from "vitest"

const STORE = "loja-inventory-category"

const h = vi.hoisted(() => {
  const rows: Array<Record<string, unknown>> = []
  return {
    rows,
    prisma: {
      $connect: vi.fn(async () => undefined),
      produto: { findMany: vi.fn(async () => rows) },
    },
  }
})

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }))
vi.mock("@/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "user-1" } })) }))
vi.mock("@/lib/api-auth", () => ({
  getVerifiedSubscriptionFromCookies: vi.fn(async () => ({ ok: true, status: "ativa", vencimento: "2099-01-01" })),
}))
vi.mock("@/lib/subscription-seal", () => ({ isVencimentoExpired: vi.fn(() => false) }))
vi.mock("@/lib/trusted-time", () => ({ getTrustedTimeMs: vi.fn(async () => Date.now()) }))
vi.mock("@/lib/store-id-from-request", () => ({
  storeIdFromAssistecRequestForRead: vi.fn(() => STORE),
  storeIdFromAssistecRequestForWrite: vi.fn(() => STORE),
}))
vi.mock("@/lib/auth/enterprise-permissions", () => ({ canAccessStore: vi.fn(() => true) }))
vi.mock("@/lib/produto-fiscal", () => ({
  getProdutoFiscal: vi.fn(() => ({})),
  isProdutoFiscalVazio: vi.fn(() => true),
}))

import { GET } from "./route"

beforeEach(() => {
  h.rows.length = 0
  vi.clearAllMocks()
})

describe("GET /api/ops/inventory — projeção de categoria", () => {
  it("projeta a categoria persistida e normaliza produto antigo sem categoria", async () => {
    h.rows.push(
      {
        id: "produto-1",
        storeId: STORE,
        name: "Capa",
        sku: null,
        barcode: null,
        stock: 4,
        precoCusto: 10,
        price: 25,
        category: "  Capinhas  ",
      },
      {
        id: "produto-2",
        storeId: STORE,
        name: "Legado",
        sku: null,
        barcode: null,
        stock: 1,
        precoCusto: 2,
        price: 5,
        category: null,
      },
    )

    const response = await GET(new Request("http://local/api/ops/inventory"))
    const json = await response.json() as { items: Array<{ name: string; category: string }> }

    expect(response.status).toBe(200)
    expect(json.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Capa", category: "Capinhas" }),
      expect.objectContaining({ name: "Legado", category: "" }),
    ]))
  })
})
