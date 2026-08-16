import { beforeEach, describe, expect, it, vi } from "vitest"

const STORE = "loja-1"

const h = vi.hoisted(() => ({
  persist: vi.fn(),
  gate: vi.fn(),
  ensureConnected: vi.fn(async () => undefined),
  auth: vi.fn(async () => ({ user: { id: "user-1", name: "Operador" } })),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {},
  prismaEnsureConnected: h.ensureConnected,
}))
vi.mock("@/lib/ops-api-gate", () => ({
  opsLojaIdFromRequestForWrite: () => STORE,
}))
vi.mock("@/lib/auth/api-enterprise-guard", () => ({
  apiGuardEnterpriseOrOps: vi.fn(async () => null),
}))
vi.mock("@/auth", () => ({ auth: h.auth }))
vi.mock("@/lib/auth/session-operator", () => ({
  getOperatorLabelFromSession: () => "Operador",
}))
vi.mock("@/lib/vendas/sale-writer-v2", () => ({
  persistSaleV2: h.persist,
}))
vi.mock("@/lib/vendas/sale-numbering-runtime-gate", () => ({
  resolveSaleNumberingWriter: h.gate,
}))

import { GET, POST } from "./route"

function req(body: unknown, method = "POST") {
  return new Request("http://local/api/ops/venda-persist/v2?storeId=loja-1", {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.gate.mockReturnValue({ writer: "v2", reason: "flag" })
})

describe("GET /api/ops/venda-persist/v2 — capability probe", () => {
  it("expõe writer v1 ou v2", async () => {
    h.gate.mockReturnValue({ writer: "v1", reason: "default" })
    const res = await GET(req({}, "GET"))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ ok: true, writer: "v1" })
  })
})

describe("POST /api/ops/venda-persist/v2", () => {
  it("declara SALE_WRITER_V1_ACTIVE quando o gate está em v1", async () => {
    h.gate.mockReturnValue({ writer: "v1", reason: "default" })
    const res = await POST(
      req({
        clientSaleId: "cs_attempt_aaaaaa",
        sale: { total: 18, lines: [{ inventoryId: "__avulso__1", name: "X", quantity: 1, unitPrice: 18 }] },
      }),
    )
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ code: "SALE_WRITER_V1_ACTIVE" })
    expect(h.persist).not.toHaveBeenCalled()
  })

  it("exige clientSaleId e não usa pedidoId do cliente como autoridade", async () => {
    const res = await POST(
      req({
        sale: {
          id: "VDA-2026-0615",
          total: 18,
          lines: [{ inventoryId: "__avulso__1", name: "X", quantity: 1, unitPrice: 18 }],
        },
      }),
    )
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: "CLIENT_SALE_ID_REQUIRED" })
    expect(h.persist).not.toHaveBeenCalled()
  })

  it("persiste com clientSaleId mesmo se o cliente mandar um VDA no sale.id", async () => {
    h.persist.mockResolvedValue({
      replayed: false,
      fingerprint: "fp",
      venda: {
        id: "venda-1",
        storeId: STORE,
        pedidoId: "VDA-RC02-2026-000001",
        clientSaleId: "cs_attempt_aaaaaa",
        total: 18,
        at: "2026-08-16T12:00:00.000Z",
        status: "concluida",
      },
    })
    const res = await POST(
      req({
        clientSaleId: "cs_attempt_aaaaaa",
        sale: {
          id: "VDA-2026-0615",
          total: 18,
          lines: [{ inventoryId: "__avulso__1", name: "CONTROLE TV BOX", quantity: 1, unitPrice: 18 }],
        },
      }),
    )
    expect(res.status).toBe(200)
    expect(h.persist).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId: STORE,
        clientSaleId: "cs_attempt_aaaaaa",
      }),
    )
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      venda: { pedidoId: "VDA-RC02-2026-000001" },
    })
  })
})
