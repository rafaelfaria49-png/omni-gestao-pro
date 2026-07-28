import { beforeEach, describe, expect, it, vi } from "vitest"

const STORE = "loja-1"

const h = vi.hoisted(() => ({
  transaction: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  count: vi.fn(async () => 1),
  ensureConnected: vi.fn(async () => undefined),
  auth: vi.fn(async () => ({ user: { id: "user-1" } })),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: h.transaction,
    venda: {
      findUnique: h.findUnique,
      update: h.update,
      count: h.count,
    },
  },
  prismaEnsureConnected: h.ensureConnected,
}))
vi.mock("@/lib/ops-api-gate", () => ({
  requireOpsSubscription: vi.fn(async () => ({ ok: true })),
  opsLojaIdFromRequestForWrite: () => STORE,
}))
vi.mock("@/auth", () => ({ auth: h.auth }))
vi.mock("@/lib/auth/enterprise-permissions", () => ({
  canAccessStore: () => true,
}))

import { POST } from "./route"
import { VendaCreateUniqueConflictError } from "@/lib/ops-upsert-venda"

function sale(total = 100) {
  return {
    id: "VDA-2026-0999",
    at: "2026-07-28T14:00:00.000Z",
    total,
    sessaoId: "sessao-1",
    terminalId: "PDV1",
    lines: [{ inventoryId: "__avulso__1", name: "Item", quantity: 1, unitPrice: total }],
    paymentBreakdown: { pix: total },
  }
}

function winner(total = 100) {
  const payload = sale(total)
  return {
    id: "venda-vencedora",
    storeId: STORE,
    pedidoId: payload.id,
    payload,
    total,
    at: new Date(payload.at),
    clienteNome: null,
    clienteId: null,
    terminalId: payload.terminalId,
    status: "concluida",
  }
}

function req(body: unknown) {
  return new Request("http://local/api/ops/sync-legacy-vendas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.transaction.mockRejectedValue(
    new VendaCreateUniqueConflictError("VDA-2026-0999", { code: "P2002" }),
  )
  h.findUnique.mockResolvedValue(winner())
  h.count.mockResolvedValue(1)
})

describe("POST /api/ops/sync-legacy-vendas — replay concorrente create-only", () => {
  it("contabiliza o vencedor idêntico como aplicado após releitura externa", async () => {
    const response = await POST(req({ sales: [sale()] }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ok: true, salesReceived: 1, salesApplied: 1 })
    expect(body.warnings).toBeUndefined()
    expect(h.findUnique).toHaveBeenCalledTimes(1)
    expect(h.update).not.toHaveBeenCalled()
  })

  it("não sobrescreve o vencedor diferente e o devolve como warning", async () => {
    h.findUnique.mockResolvedValue(winner(99))

    const response = await POST(req({ sales: [sale(100)] }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ok: true, salesReceived: 1, salesApplied: 0 })
    expect(body.warnings).toEqual([
      "Este número já identifica outra venda nesta loja. Nada foi alterado.",
    ])
    expect(h.findUnique).toHaveBeenCalledTimes(1)
    expect(h.update).not.toHaveBeenCalled()
  })
})
