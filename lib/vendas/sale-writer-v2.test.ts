import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  transaction: vi.fn(),
  findFirst: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: h.transaction,
    venda: { findFirst: h.findFirst },
  },
}))

import {
  ClientSaleIdReusedError,
  InvalidClientSaleIdError,
  VendaClientKeyUniqueConflictError,
  upsertVendaInTransaction,
  type SalePayload,
} from "@/lib/ops-upsert-venda"
import { persistSaleV2 } from "./sale-writer-v2"

type FakeProduct = {
  id: string
  storeId: string
  stock: number
  precoCusto: number
  sku: string | null
  barcode: string | null
  name: string
}

const STORE = "loja-rc02"
const CLIENT_A = "cs_attempt_aaaaaa"
const CLIENT_B = "cs_attempt_bbbbbb"

function proj(p: FakeProduct) {
  return { id: p.id, stock: p.stock, precoCusto: p.precoCusto, sku: p.sku, name: p.name }
}

function makeFakeTx(opts?: { products?: FakeProduct[]; existing?: Array<Record<string, unknown>> }) {
  const products = opts?.products ?? []
  const byId = new Map(products.map((p) => [p.id, p]))
  const vendas = [...(opts?.existing ?? [])]
  const ledger: Array<Record<string, unknown>> = []
  const financeiro: Array<Record<string, unknown>> = []
  let vendaCounter = 0
  let allocateCalls = 0

  const tx: Record<string, unknown> = {
    cliente: { findFirst: async () => null },
    venda: {
      findUnique: async ({ where }: { where: { pedidoId?: string } }) =>
        vendas.find((v) => v.pedidoId === where.pedidoId) ?? null,
      findFirst: async ({ where }: { where: { storeId?: string; clientSaleId?: string } }) =>
        vendas.find((v) => v.storeId === where.storeId && v.clientSaleId === where.clientSaleId) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `venda-${++vendaCounter}`,
          status: "concluida",
          terminalId: data.terminalId ?? null,
          clientSaleId: data.clientSaleId ?? null,
          ...data,
        }
        vendas.push(row)
        return row
      },
      update: async () => ({}),
    },
    itemVenda: {
      deleteMany: async () => ({ count: 0 }),
      create: async ({ data }: { data: Record<string, unknown> }) => data,
    },
    produto: {
      findFirst: async ({ where }: { where: { storeId: string; OR?: Array<Record<string, string>> } }) => {
        const ors = where.OR ?? []
        for (const p of products) {
          if (p.storeId !== where.storeId) continue
          for (const cond of ors) {
            if (cond.id !== undefined && p.id === cond.id) return proj(p)
            if (cond.sku !== undefined && p.sku === cond.sku) return proj(p)
            if (cond.barcode !== undefined && p.barcode === cond.barcode) return proj(p)
          }
        }
        return null
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        const p = byId.get(where.id)
        return p ? { stock: p.stock, precoCusto: p.precoCusto } : null
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; storeId: string; stock?: { gte?: number } }
        data: { stock?: { decrement?: number } }
      }) => {
        const p = byId.get(where.id)
        if (!p || p.storeId !== where.storeId) return { count: 0 }
        const gte = where.stock?.gte
        if (typeof gte === "number" && p.stock < gte) return { count: 0 }
        p.stock -= data.stock?.decrement ?? 0
        return { count: 1 }
      },
      update: async ({ where, data }: { where: { id: string }; data: { stock?: { decrement?: number } } }) => {
        const p = byId.get(where.id)
        if (p && data.stock?.decrement != null) p.stock -= data.stock.decrement
        return p ?? {}
      },
    },
    movimentacaoEstoque: {
      findFirst: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        ledger.push(data)
        return data
      },
    },
    movimentacaoFinanceira: {
      findFirst: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        financeiro.push(data)
        return data
      },
    },
  }

  const allocate = async () => {
    allocateCalls += 1
    const seq = allocateCalls
    return {
      pedidoId: `VDA-RC02-2026-${String(seq).padStart(6, "0")}`,
      serieVendaId: "serie-1",
      anoNumero: 2026,
      numeroSequencial: seq,
    }
  }

  return {
    tx: tx as never,
    byId,
    ledger,
    financeiro,
    vendas,
    allocate,
    getAllocateCalls: () => allocateCalls,
  }
}

function sale(over: Partial<SalePayload> = {}): SalePayload {
  return {
    id: "PEND-cs_attempt_aaaaaa",
    at: "2026-08-16T12:00:00.000Z",
    total: 18,
    customerName: "Consumidor",
    paymentBreakdown: { dinheiro: 18 },
    lines: [{ inventoryId: "prod-1", name: "CONTROLE TV BOX", quantity: 1, unitPrice: 18 }],
    ...over,
  }
}

const V2 = (clientSaleId: string, allocate: () => Promise<unknown>) => ({
  enforceStock: true,
  requireCaixaSession: false,
  v2: { clientSaleId, allocate: allocate as never },
})

describe("upsertVendaInTransaction — Writer V2", () => {
  it("ignora pedidoId do cliente e aloca número server-side", async () => {
    const { tx, allocate, byId } = makeFakeTx({
      products: [
        {
          id: "prod-1",
          storeId: STORE,
          stock: 4,
          precoCusto: 5,
          sku: "TVBOX",
          barcode: null,
          name: "CONTROLE TV BOX",
        },
      ],
    })
    const result = await upsertVendaInTransaction(
      tx,
      STORE,
      sale({ id: "VDA-2026-0615" }),
      undefined,
      V2(CLIENT_A, allocate),
    )
    expect(result.replayed).toBe(false)
    expect(result.venda.pedidoId).toBe("VDA-RC02-2026-000001")
    expect(result.venda.clientSaleId).toBe(CLIENT_A)
    expect(byId.get("prod-1")!.stock).toBe(3)
  })

  it("replay do mesmo clientSaleId não aloca nem baixa estoque de novo", async () => {
    const fake = makeFakeTx({
      products: [
        {
          id: "prod-1",
          storeId: STORE,
          stock: 4,
          precoCusto: 5,
          sku: "TVBOX",
          barcode: null,
          name: "CONTROLE TV BOX",
        },
      ],
    })
    const first = await upsertVendaInTransaction(fake.tx, STORE, sale(), undefined, V2(CLIENT_A, fake.allocate))
    const second = await upsertVendaInTransaction(fake.tx, STORE, sale(), undefined, V2(CLIENT_A, fake.allocate))
    expect(first.venda.pedidoId).toBe(second.venda.pedidoId)
    expect(second.replayed).toBe(true)
    expect(fake.getAllocateCalls()).toBe(1)
    expect(fake.byId.get("prod-1")!.stock).toBe(3)
    expect(fake.ledger).toHaveLength(1)
  })

  it("reutilizar clientSaleId com fatos diferentes falha fechado", async () => {
    const fake = makeFakeTx({
      products: [
        {
          id: "prod-1",
          storeId: STORE,
          stock: 10,
          precoCusto: 5,
          sku: "TVBOX",
          barcode: null,
          name: "CONTROLE TV BOX",
        },
      ],
    })
    await upsertVendaInTransaction(fake.tx, STORE, sale(), undefined, V2(CLIENT_A, fake.allocate))
    await expect(
      upsertVendaInTransaction(fake.tx, STORE, sale({ total: 99 }), undefined, V2(CLIENT_A, fake.allocate)),
    ).rejects.toBeInstanceOf(ClientSaleIdReusedError)
    expect(fake.byId.get("prod-1")!.stock).toBe(9)
  })

  it("duas tentativas distintas recebem números distintos", async () => {
    const fake = makeFakeTx({
      products: [
        {
          id: "prod-1",
          storeId: STORE,
          stock: 10,
          precoCusto: 5,
          sku: "TVBOX",
          barcode: null,
          name: "CONTROLE TV BOX",
        },
      ],
    })
    const a = await upsertVendaInTransaction(fake.tx, STORE, sale(), undefined, V2(CLIENT_A, fake.allocate))
    const b = await upsertVendaInTransaction(
      fake.tx,
      STORE,
      sale({ id: "PEND-cs_attempt_bbbbbb" }),
      undefined,
      V2(CLIENT_B, fake.allocate),
    )
    expect(a.venda.pedidoId).toBe("VDA-RC02-2026-000001")
    expect(b.venda.pedidoId).toBe("VDA-RC02-2026-000002")
    expect(a.venda.clientSaleId).not.toBe(b.venda.clientSaleId)
    expect(fake.byId.get("prod-1")!.stock).toBe(8)
  })

  it("rejeita clientSaleId inválido antes de alocar", async () => {
    const fake = makeFakeTx()
    await expect(
      upsertVendaInTransaction(fake.tx, STORE, sale(), undefined, V2("VDA-2026-0615", fake.allocate)),
    ).rejects.toBeInstanceOf(InvalidClientSaleIdError)
    expect(fake.getAllocateCalls()).toBe(0)
  })
})

describe("persistSaleV2 — retry e replay concorrente", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const confirmed = {
    replayed: false,
    fingerprint: "fp",
    venda: {
      id: "venda-1",
      storeId: STORE,
      pedidoId: "VDA-RC02-2026-000001",
      clientSaleId: CLIENT_A,
      total: 18,
      at: "2026-08-16T12:00:00.000Z",
      clienteNome: "Consumidor",
      clienteId: null,
      terminalId: null,
      status: "concluida",
    },
  }

  it("retenta transação só em P2034", async () => {
    h.transaction.mockRejectedValueOnce({ code: "P2034" }).mockResolvedValueOnce(confirmed)
    const result = await persistSaleV2({ storeId: STORE, sale: sale(), clientSaleId: CLIENT_A })
    expect(result.venda.pedidoId).toBe("VDA-RC02-2026-000001")
    expect(h.transaction).toHaveBeenCalledTimes(2)
  })

  it("replay por unique (storeId, clientSaleId) não cria segunda venda", async () => {
    h.transaction.mockRejectedValueOnce(new VendaClientKeyUniqueConflictError(CLIENT_A, { code: "P2002" }))
    h.findFirst.mockResolvedValueOnce({
      id: "venda-1",
      storeId: STORE,
      pedidoId: "VDA-RC02-2026-000001",
      clientSaleId: CLIENT_A,
      payload: sale(),
      total: 18,
      at: new Date("2026-08-16T12:00:00.000Z"),
      clienteNome: "Consumidor",
      clienteId: null,
      terminalId: null,
      status: "concluida",
    })
    const result = await persistSaleV2({ storeId: STORE, sale: sale(), clientSaleId: CLIENT_A })
    expect(result.replayed).toBe(true)
    expect(result.venda.pedidoId).toBe("VDA-RC02-2026-000001")
    expect(h.transaction).toHaveBeenCalledTimes(1)
  })
})
