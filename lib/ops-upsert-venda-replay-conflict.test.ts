import { describe, expect, it } from "vitest"
import {
  CaixaOriginalFechadoError,
  PedidoIdConflitoMesmaLojaError,
  PedidoIdDeOutraLojaError,
  VendaCreateUniqueConflictError,
  upsertVendaInTransaction,
  type SalePayload,
} from "./ops-upsert-venda"

const STORE = "loja-1"
const LIVE = { enforceStock: true, requireCaixaSession: true } as const

type FakeVenda = {
  id: string
  storeId: string
  pedidoId: string
  payload: unknown
  total: number
  at: Date
  clienteNome: string | null
  clienteId: string | null
  terminalId: string | null
  status: string
}

function sale(over: Partial<SalePayload> = {}): SalePayload {
  return {
    id: "VDA-2026-0900",
    at: "2026-07-28T14:00:00.000Z",
    total: 100,
    customerCpf: "123.456.789-00",
    customerName: "Cliente Replay",
    sessaoId: "sessao-1",
    terminalId: "PDV1",
    linkedOsId: "os-1",
    lines: [
      {
        inventoryId: "SKU-1",
        name: "Produto",
        quantity: 2,
        unitPrice: 50,
        lineTotal: 100,
        accessorySelection: {
          version: 1,
          deviceModelKey: "apple:iphone-15",
          deviceBrand: "Apple",
          deviceModelName: "iPhone 15",
          colorKey: "preto",
        },
      },
    ],
    paymentBreakdown: { dinheiro: 60, aPrazo: 20, creditoVale: 20 },
    aPrazoConfig: {
      parcelas: 1,
      primeiroVencimento: "27/08/2026",
      intervalDias: 30,
    },
    ...over,
  }
}

function makeDb(options?: { createP2002?: boolean; sessionStatus?: "ABERTA" | "FECHADA" }) {
  const vendas = new Map<string, FakeVenda>()
  const items: Array<Record<string, unknown>> = []
  const stock = { value: 10, updates: 0 }
  const estoque: Array<Record<string, unknown>> = []
  const financeiro: Array<Record<string, unknown>> = []
  const titulos: Array<Record<string, unknown>> = []
  const credit = { saldo: 100, updates: 0 }
  const usosCredito: Array<Record<string, unknown>> = []
  let itemDeletes = 0
  let vendaSeq = 0
  const session = { status: options?.sessionStatus ?? "ABERTA" }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const makeTx = (): any => ({
    cliente: { findFirst: async () => null },
    venda: {
      findUnique: async ({ where }: any) => vendas.get(where.pedidoId) ?? null,
      create: async ({ data }: any) => {
        if (options?.createP2002 || vendas.has(data.pedidoId)) throw { code: "P2002" }
        const created: FakeVenda = {
          id: `venda-${++vendaSeq}`,
          storeId: data.storeId,
          pedidoId: data.pedidoId,
          payload: data.payload,
          total: data.total,
          at: data.at,
          clienteNome: data.clienteNome ?? null,
          clienteId: data.clienteId ?? null,
          terminalId: data.terminalId ?? null,
          status: "concluida",
        }
        vendas.set(created.pedidoId, created)
        return created
      },
      update: async () => ({}),
    },
    itemVenda: {
      deleteMany: async () => {
        itemDeletes += 1
        return { count: 0 }
      },
      create: async ({ data }: any) => {
        items.push(data)
        return data
      },
    },
    produto: {
      findFirst: async ({ where }: any) => {
        const matches = (where.OR ?? []).some(
          (candidate: Record<string, string>) =>
            candidate.id === "produto-1" ||
            candidate.sku === "SKU-1" ||
            candidate.barcode === "SKU-1",
        )
        return matches
          ? { id: "produto-1", stock: stock.value, precoCusto: 20, sku: "SKU-1", name: "Produto" }
          : null
      },
      findUnique: async () => ({ stock: stock.value, precoCusto: 20 }),
      updateMany: async ({ where, data }: any) => {
        if (stock.value < (where.stock?.gte ?? 0)) return { count: 0 }
        stock.value -= data.stock.decrement
        stock.updates += 1
        return { count: 1 }
      },
    },
    movimentacaoEstoque: {
      findFirst: async () => null,
      create: async ({ data }: any) => {
        estoque.push(data)
        return data
      },
    },
    movimentacaoFinanceira: {
      findFirst: async () => null,
      create: async ({ data }: any) => {
        financeiro.push(data)
        return data
      },
    },
    clienteCredito: {
      findMany: async () => [
        {
          id: "credito-1",
          saldoAtual: credit.saldo,
          status: "ativo",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ],
      update: async ({ data }: any) => {
        credit.saldo = data.saldoAtual
        credit.updates += 1
        return data
      },
    },
    usoCreditoCliente: {
      create: async ({ data }: any) => {
        usosCredito.push(data)
        return data
      },
    },
    contaReceberTitulo: {
      upsert: async ({ create }: any) => {
        titulos.push(create)
        return { id: `titulo-${titulos.length}` }
      },
    },
    sessaoCaixa: {
      findFirst: async ({ where }: any) => {
        if (where.id && where.id !== "sessao-1") return null
        return { id: "sessao-1", status: session.status }
      },
    },
  })
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return {
    makeTx,
    vendas,
    items,
    itemDeletes: () => itemDeletes,
    stock,
    estoque,
    financeiro,
    titulos,
    credit,
    usosCredito,
    session,
  }
}

describe("upsertVendaInTransaction — replay e conflito fail-closed", () => {
  it("cria uma única vez e retorna a venda criada", async () => {
    const db = makeDb()
    const result = await upsertVendaInTransaction(db.makeTx(), STORE, sale(), "Operador", LIVE)
    expect(result).toMatchObject({
      replayed: false,
      venda: { pedidoId: "VDA-2026-0900", storeId: STORE, total: 100 },
    })
    expect(db.vendas).toHaveLength(1)
    expect(db.items).toHaveLength(1)
  })

  it("replay idêntico retorna replayed=true e executa zero efeitos novamente", async () => {
    const db = makeDb()
    const request = sale()
    const first = await upsertVendaInTransaction(db.makeTx(), STORE, request, "Operador A", LIVE)
    const snapshot = JSON.stringify([...db.vendas.values()][0])

    const replay = await upsertVendaInTransaction(
      db.makeTx(),
      STORE,
      { ...request, syncPending: true, syncBlockedCode: "CAIXA_ORIGINAL_FECHADO" } as SalePayload,
      "Outro operador resolvido",
      LIVE,
    )

    expect(replay.replayed).toBe(true)
    expect(replay.venda.id).toBe(first.venda.id)
    expect(JSON.stringify([...db.vendas.values()][0])).toBe(snapshot)
    expect(db.itemDeletes()).toBe(0)
    expect(db.items).toHaveLength(1)
    expect(db.stock).toEqual({ value: 8, updates: 1 })
    expect(db.estoque).toHaveLength(1)
    expect(db.financeiro).toHaveLength(1)
    expect(db.titulos).toHaveLength(1)
    expect(db.usosCredito).toHaveLength(1)
    expect(db.credit).toEqual({ saldo: 80, updates: 1 })
  })

  it.each([
    ["total", { total: 101 }],
    ["linhas", { lines: [{ inventoryId: "SKU-1", name: "Produto", quantity: 1, unitPrice: 100 }] }],
    ["pagamento", { paymentBreakdown: { pix: 60, aPrazo: 20, creditoVale: 20 } }],
  ])("mesmo pedidoId com %s diferente falha sem escrever", async (_label, change) => {
    const db = makeDb()
    await upsertVendaInTransaction(db.makeTx(), STORE, sale(), undefined, LIVE)
    const snapshot = JSON.stringify({
      venda: [...db.vendas.values()][0],
      items: db.items,
      stock: db.stock,
      estoque: db.estoque,
      financeiro: db.financeiro,
      titulos: db.titulos,
      credit: db.credit,
      usos: db.usosCredito,
    })

    const error = await upsertVendaInTransaction(
      db.makeTx(),
      STORE,
      sale(change as Partial<SalePayload>),
      undefined,
      { ...LIVE, allowClosedOriginalSession: true },
    ).catch((caught) => caught)

    expect(error).toBeInstanceOf(PedidoIdConflitoMesmaLojaError)
    expect(error.code).toBe("PEDIDO_ID_CONFLITO_MESMA_LOJA")
    expect(error.message).toBe("Este número já identifica outra venda nesta loja. Nada foi alterado.")
    expect(JSON.stringify({
      venda: [...db.vendas.values()][0],
      items: db.items,
      stock: db.stock,
      estoque: db.estoque,
      financeiro: db.financeiro,
      titulos: db.titulos,
      credit: db.credit,
      usos: db.usosCredito,
    })).toBe(snapshot)
  })

  it("colisão cross-store preserva o guard publicado e não executa efeitos", async () => {
    const db = makeDb()
    await upsertVendaInTransaction(db.makeTx(), STORE, sale(), undefined, LIVE)
    db.vendas.get("VDA-2026-0900")!.storeId = "loja-2"

    const error = await upsertVendaInTransaction(db.makeTx(), STORE, sale(), undefined, LIVE).catch(
      (caught) => caught,
    )
    expect(error).toBeInstanceOf(PedidoIdDeOutraLojaError)
    expect(db.stock.updates).toBe(1)
    expect(db.financeiro).toHaveLength(1)
    expect(db.usosCredito).toHaveLength(1)
  })

  it("P2002 no Venda.create aborta antes dos efeitos e exige releitura externa", async () => {
    const db = makeDb({ createP2002: true })
    const error = await upsertVendaInTransaction(db.makeTx(), STORE, sale(), undefined, LIVE).catch(
      (caught) => caught,
    )
    expect(error).toBeInstanceOf(VendaCreateUniqueConflictError)
    expect(error.code).toBe("P2002")
    expect(db.items).toHaveLength(0)
    expect(db.stock.updates).toBe(0)
    expect(db.estoque).toHaveLength(0)
    expect(db.financeiro).toHaveLength(0)
    expect(db.titulos).toHaveLength(0)
    expect(db.usosCredito).toHaveLength(0)
  })

  it("CAIXA_ORIGINAL_FECHADO continua legítimo; replay confirmado não reabre efeitos", async () => {
    const db = makeDb({ sessionStatus: "FECHADA" })
    await expect(
      upsertVendaInTransaction(db.makeTx(), STORE, sale(), undefined, LIVE),
    ).rejects.toBeInstanceOf(CaixaOriginalFechadoError)
    expect(db.vendas).toHaveLength(0)

    const created = await upsertVendaInTransaction(db.makeTx(), STORE, sale(), undefined, {
      ...LIVE,
      allowClosedOriginalSession: true,
    })
    const replay = await upsertVendaInTransaction(db.makeTx(), STORE, sale(), undefined, LIVE)
    expect(created.replayed).toBe(false)
    expect(replay.replayed).toBe(true)
    expect(db.financeiro).toHaveLength(1)
  })

  it("preserva accessorySelection saneada no create", async () => {
    const db = makeDb()
    await upsertVendaInTransaction(db.makeTx(), STORE, sale(), undefined, LIVE)
    const payload = db.vendas.get("VDA-2026-0900")!.payload as SalePayload
    expect(payload.lines?.[0]?.accessorySelection).toMatchObject({
      version: 1,
      deviceModelKey: "apple:iphone-15",
      colorKey: "preto",
      colorLabel: "Preto",
    })
  })
})
