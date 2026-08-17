import { beforeEach, describe, expect, it, vi } from "vitest"

const STORE = "loja-1"
const CLIENT = "cs_attempt_bbbbbb"

const h = vi.hoisted(() => ({
  persist: vi.fn(),
  gate: vi.fn(),
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  vendaUpdate: vi.fn(),
  vendaUpdateMany: vi.fn(),
  vendaDelete: vi.fn(),
  vendaDeleteMany: vi.fn(),
  vendaUpsert: vi.fn(),
  vendaCreate: vi.fn(),
  sessaoFindFirst: vi.fn(),
  produtoFindFirst: vi.fn(),
  ensureConnected: vi.fn(async () => undefined),
  requireAdmin: vi.fn(),
  canAccessStore: vi.fn(() => true),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    venda: {
      findFirst: h.findFirst,
      findUnique: h.findUnique,
      update: h.vendaUpdate,
      updateMany: h.vendaUpdateMany,
      delete: h.vendaDelete,
      deleteMany: h.vendaDeleteMany,
      upsert: h.vendaUpsert,
      create: h.vendaCreate,
    },
    sessaoCaixa: { findFirst: h.sessaoFindFirst },
    produto: { findFirst: h.produtoFindFirst },
  },
  prismaEnsureConnected: h.ensureConnected,
}))
vi.mock("@/lib/ops-api-gate", () => ({
  opsLojaIdFromRequestForWrite: () => STORE,
}))
vi.mock("@/lib/require-admin", () => ({
  requireAdmin: h.requireAdmin,
}))
vi.mock("@/lib/auth/enterprise-permissions", () => ({
  canAccessStore: h.canAccessStore,
}))
vi.mock("@/lib/auth/session-operator", () => ({
  getOperatorLabelFromSession: () => "Admin",
}))
vi.mock("@/lib/vendas/sale-writer-v2", () => ({
  persistSaleV2: h.persist,
}))
vi.mock("@/lib/vendas/sale-numbering-runtime-gate", () => ({
  resolveSaleNumberingWriter: h.gate,
}))

import { POST } from "./route"

const occupant = {
  id: "venda-a",
  storeId: STORE,
  pedidoId: "VDA-2026-0615",
  clientSaleId: "cs_attempt_aaaaaa",
  payload: {
    id: "VDA-2026-0615",
    total: 240,
    at: "2026-06-15T10:00:00.000Z",
    customerName: "Cliente A",
    lines: [{ inventoryId: "p1", name: "Outro", quantity: 1, unitPrice: 240 }],
    paymentBreakdown: { pix: 240 },
  },
  total: 240,
  at: new Date("2026-06-15T10:00:00.000Z"),
  clienteNome: "Cliente A",
  clienteId: null,
  terminalId: null,
  status: "concluida",
}

/**
 * Venda local em quarentena. `sessaoId` é obrigatório para a recuperação de uma
 * venda com receita à vista: sem sessão original identificável o núcleo bloqueia,
 * porque lançar no caixa de hoje deixaria o dinheiro invisível em toda conferência
 * (a `MovimentacaoFinanceira` usa a data ORIGINAL da venda). Ver o teste
 * "bloqueia venda à vista sem sessão original".
 */
const localSale = {
  id: "VDA-2026-0615",
  total: 18,
  at: "2026-06-15T18:00:00.000Z",
  customerName: "Consumidor",
  sessaoId: "sess-original-1",
  lines: [{ inventoryId: "p-tvbox", name: "CONTROLE TV BOX", quantity: 1, unitPrice: 18 }],
  paymentBreakdown: { dinheiro: 18 },
}

function req(body: unknown) {
  return new Request("http://local/api/ops/vendas/recover-quarantined?storeId=loja-1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

function expectOccupantUntouched() {
  expect(h.vendaUpdate).not.toHaveBeenCalled()
  expect(h.vendaUpdateMany).not.toHaveBeenCalled()
  expect(h.vendaDelete).not.toHaveBeenCalled()
  expect(h.vendaDeleteMany).not.toHaveBeenCalled()
  expect(h.vendaUpsert).not.toHaveBeenCalled()
  expect(h.vendaCreate).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.clearAllMocks()
  h.gate.mockReturnValue({ writer: "v2", reason: "flag" })
  h.requireAdmin.mockResolvedValue({ ok: true, session: { user: { id: "admin-1" } } })
  h.canAccessStore.mockReturnValue(true)
  h.findFirst.mockResolvedValue(null)
  h.findUnique.mockResolvedValue(occupant)
  h.sessaoFindFirst.mockResolvedValue({ status: "ABERTA" })
  h.produtoFindFirst.mockResolvedValue({
    id: "prod-tvbox",
    name: "CONTROLE TV BOX",
    stock: 5,
  })
})

describe("POST /api/ops/vendas/recover-quarantined", () => {
  it("exige motivo e clientSaleId", async () => {
    const res = await POST(req({ sale: localSale, clientSaleId: CLIENT, motivo: "abc" }))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: "MOTIVO_REQUIRED" })
    expect(h.persist).not.toHaveBeenCalled()
  })

  it("não altera o ocupante e cria a venda B com Writer V2", async () => {
    h.persist.mockResolvedValue({
      replayed: false,
      fingerprint: "fp",
      venda: {
        id: "venda-b",
        storeId: STORE,
        pedidoId: "VDA-RC02-2026-000099",
        clientSaleId: CLIENT,
        total: 18,
        at: "2026-06-15T18:00:00.000Z",
        status: "concluida",
      },
    })
    const res = await POST(
      req({
        sale: localSale,
        clientSaleId: CLIENT,
        motivo: "colisao de numero comercial",
        conflictingPedidoId: "VDA-2026-0615",
        conflictCode: "PEDIDO_ID_CONFLITO_MESMA_LOJA",
      }),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.venda.pedidoId).toBe("VDA-RC02-2026-000099")
    expect(json.venda.pedidoId).not.toBe("VDA-2026-0615")
    expect(h.persist).toHaveBeenCalledTimes(1)
    expect(h.findUnique).toHaveBeenCalledWith({
      where: { pedidoId: "VDA-2026-0615" },
      select: expect.anything(),
    })
  })

  it("replay do mesmo clientSaleId devolve a venda B já recuperada", async () => {
    h.findFirst.mockResolvedValue({
      id: "venda-b",
      storeId: STORE,
      pedidoId: "VDA-RC02-2026-000099",
      clientSaleId: CLIENT,
      payload: localSale,
      total: 18,
      at: new Date("2026-06-15T18:00:00.000Z"),
      clienteNome: "Consumidor",
      clienteId: null,
      terminalId: null,
      status: "concluida",
    })
    const res = await POST(
      req({
        sale: localSale,
        clientSaleId: CLIENT,
        motivo: "retry recovery",
        conflictingPedidoId: "VDA-2026-0615",
      }),
    )
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      replayed: true,
      recovered: true,
      venda: { pedidoId: "VDA-RC02-2026-000099" },
    })
    expect(h.persist).not.toHaveBeenCalled()
  })

  it("bloqueia recovery quando o writer V1 está ativo", async () => {
    h.gate.mockReturnValue({ writer: "v1", reason: "flag-absent" })
    const res = await POST(
      req({
        sale: localSale,
        clientSaleId: CLIENT,
        motivo: "colisao de numero comercial",
        conflictCode: "PEDIDO_ID_CONFLITO_MESMA_LOJA",
      }),
    )
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ code: "SALE_WRITER_V1_ACTIVE" })
    expect(h.persist).not.toHaveBeenCalled()
    expectOccupantUntouched()
  })

  it("grava occupantStoreId real em conflito cross-loja e não altera a ocupante", async () => {
    const occupantLojaB = { ...occupant, storeId: "loja-B" }
    h.findUnique.mockResolvedValue(occupantLojaB)
    h.persist.mockResolvedValue({
      replayed: false,
      fingerprint: "fp",
      venda: {
        id: "venda-b",
        storeId: STORE,
        pedidoId: "VDA-RC02-2026-000099",
        clientSaleId: CLIENT,
        total: 18,
        at: "2026-06-15T18:00:00.000Z",
        status: "concluida",
      },
    })
    const res = await POST(
      req({
        sale: localSale,
        clientSaleId: CLIENT,
        motivo: "colisao de numero comercial",
        conflictingPedidoId: "VDA-2026-0615",
        conflictCode: "PEDIDO_ID_DE_OUTRA_LOJA",
      }),
    )
    expect(res.status).toBe(200)
    const call = h.persist.mock.calls[0][0]
    expect(call.storeId).toBe(STORE)
    expect(call.sale.recovery).toMatchObject({
      recoveredFromPedidoId: "VDA-2026-0615",
      motivo: "colisao de numero comercial",
      conflictCode: "PEDIDO_ID_DE_OUTRA_LOJA",
      occupantStoreId: "loja-B",
    })
    expect(call.sale.recovery.occupantStoreId).not.toBe("other")
    expectOccupantUntouched()
  })

  it("bloqueia venda à vista sem sessão original — nunca lança no caixa de hoje", async () => {
    const { sessaoId, ...semSessao } = localSale
    void sessaoId
    const res = await POST(
      req({
        sale: semSessao,
        clientSaleId: CLIENT,
        motivo: "colisao de numero comercial",
        conflictCode: "PEDIDO_ID_CONFLITO_MESMA_LOJA",
      }),
    )
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ code: "MISSING_ORIGINAL_SESSION" })
    expect(h.persist).not.toHaveBeenCalled()
  })

  it("sessão original FECHADA exige confirmação explícita", async () => {
    h.sessaoFindFirst.mockResolvedValue({ status: "FECHADA" })
    const res = await POST(
      req({
        sale: localSale,
        clientSaleId: CLIENT,
        motivo: "colisao de numero comercial",
        conflictCode: "PEDIDO_ID_CONFLITO_MESMA_LOJA",
      }),
    )
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ code: "CAIXA_ORIGINAL_FECHADO" })
    expect(h.persist).not.toHaveBeenCalled()
  })

  it("sessão original FECHADA com confirmação repassa a autorização ao motor", async () => {
    h.sessaoFindFirst.mockResolvedValue({ status: "FECHADA" })
    h.persist.mockResolvedValue({
      replayed: false,
      fingerprint: "fp",
      venda: {
        id: "venda-b",
        storeId: STORE,
        pedidoId: "VDA-RC02-2026-000100",
        clientSaleId: CLIENT,
        total: 18,
        at: "2026-06-15T18:00:00.000Z",
        status: "concluida",
      },
    })
    const res = await POST(
      req({
        sale: localSale,
        clientSaleId: CLIENT,
        motivo: "colisao de numero comercial",
        conflictCode: "PEDIDO_ID_CONFLITO_MESMA_LOJA",
        allowClosedOriginalSession: true,
      }),
    )
    expect(res.status).toBe(200)
    expect(h.persist).toHaveBeenCalledTimes(1)
    expect(h.persist.mock.calls[0][0].options).toMatchObject({
      allowClosedOriginalSession: true,
      enforceStock: true,
      requireCaixaSession: true,
    })
  })
})
