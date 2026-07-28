import { beforeEach, describe, expect, it, vi } from "vitest"

const STORE = "loja-1"

const h = vi.hoisted(() => ({
  transaction: vi.fn(),
  findUnique: vi.fn(),
  ensureConnected: vi.fn(async () => undefined),
  auth: vi.fn(async () => ({ user: { id: "user-1", name: "Operador" } })),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: h.transaction,
    venda: { findUnique: h.findUnique },
  },
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

import { POST } from "./route"
import { VendaCreateUniqueConflictError } from "@/lib/ops-upsert-venda"

function requestSale(total = 100) {
  return {
    id: "VDA-2026-0901",
    at: "2026-07-28T14:00:00.000Z",
    total,
    sessaoId: "sessao-1",
    terminalId: "PDV1",
    lines: [{ inventoryId: "__avulso__1", name: "Item", quantity: 1, unitPrice: total }],
    paymentBreakdown: { pix: total },
  }
}

function winner(options?: { storeId?: string; total?: number }) {
  const payload = requestSale(options?.total ?? 100)
  return {
    id: "venda-vencedora",
    storeId: options?.storeId ?? STORE,
    pedidoId: payload.id,
    payload,
    total: payload.total,
    at: new Date(payload.at),
    clienteNome: null,
    clienteId: null,
    terminalId: payload.terminalId,
    status: "concluida",
  }
}

function req(body: unknown) {
  return new Request("http://local/api/ops/venda-persist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.transaction.mockRejectedValue(
    new VendaCreateUniqueConflictError("VDA-2026-0901", { code: "P2002" }),
  )
  h.findUnique.mockResolvedValue(winner())
})

describe("POST /api/ops/venda-persist — recuperação concorrente P2002", () => {
  it("releitura fora da transação converge para replay quando os fatos são iguais", async () => {
    const response = await POST(req({ sale: requestSale() }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      replayed: true,
      venda: {
        id: "venda-vencedora",
        storeId: STORE,
        pedidoId: "VDA-2026-0901",
        total: 100,
        at: "2026-07-28T14:00:00.000Z",
        clienteNome: null,
        clienteId: null,
        terminalId: "PDV1",
        status: "concluida",
      },
    })
    expect(h.transaction).toHaveBeenCalledTimes(1)
    expect(h.findUnique).toHaveBeenCalledTimes(1)
  })

  it("fatos diferentes no vencedor falham fechados como conflito same-store", async () => {
    h.findUnique.mockResolvedValue(winner({ total: 99 }))
    const response = await POST(req({ sale: requestSale(100), allowClosedOriginalSession: true }))
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body).toEqual({
      error: "Este número já identifica outra venda nesta loja. Nada foi alterado.",
      code: "PEDIDO_ID_CONFLITO_MESMA_LOJA",
    })
  })

  it("vencedor de outra loja preserva PEDIDO_ID_DE_OUTRA_LOJA", async () => {
    h.findUnique.mockResolvedValue(winner({ storeId: "loja-2" }))
    const response = await POST(req({ sale: requestSale() }))
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.code).toBe("PEDIDO_ID_DE_OUTRA_LOJA")
  })

  it("P2002 sem vencedor relido permanece erro técnico fail-closed", async () => {
    h.findUnique.mockResolvedValue(null)
    const response = await POST(req({ sale: requestSale() }))
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.code).toBe("P2002")
  })
})
