import { describe, expect, it, vi } from "vitest"

const STORE = "loja-1"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    venda: {
      findFirst: vi.fn(async ({ where }: { where: { storeId: string; clientSaleId: string } }) => {
        if (where.storeId !== STORE) return null
        if (where.clientSaleId !== "cs_attempt_aaaaaa") return null
        return {
          id: "venda-1",
          storeId: STORE,
          pedidoId: "VDA-RC02-2026-000001",
          clientSaleId: "cs_attempt_aaaaaa",
          total: 18,
          at: new Date("2026-08-16T12:00:00.000Z"),
          clienteNome: null,
          clienteId: null,
          terminalId: null,
          status: "concluida",
        }
      }),
    },
  },
  prismaEnsureConnected: vi.fn(async () => undefined),
}))
vi.mock("@/lib/ops-api-gate", () => ({
  opsLojaIdFromRequest: () => STORE,
}))
vi.mock("@/lib/auth/api-enterprise-guard", () => ({
  apiGuardEnterpriseOrOps: vi.fn(async () => null),
}))

import { GET } from "./route"

describe("GET /api/ops/vendas/by-client-sale-id", () => {
  it("localiza por (storeId, clientSaleId)", async () => {
    const res = await GET(
      new Request(
        "http://local/api/ops/vendas/by-client-sale-id?storeId=loja-1&clientSaleId=cs_attempt_aaaaaa",
      ),
    )
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      venda: { pedidoId: "VDA-RC02-2026-000001", clientSaleId: "cs_attempt_aaaaaa" },
    })
  })

  it("não revela venda de outra loja — 404 idêntico", async () => {
    const res = await GET(
      new Request(
        "http://local/api/ops/vendas/by-client-sale-id?storeId=loja-1&clientSaleId=cs_otherstore01",
      ),
    )
    expect(res.status).toBe(404)
  })
})
