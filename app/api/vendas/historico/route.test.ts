/**
 * GOAL PDV-TROCAS-DEVOLUCOES-BUSCA-VALE-CREDITO-001 — busca de vendas por item/produto.
 *
 * Exercita o handler GET de PRODUÇÃO sobre um Prisma EM MEMÓRIA que CAPTURA os
 * `where` recebidos. Prova que:
 *  - `q` passa a cobrir item vendido (ItemVenda.nome) além de cupom e cliente;
 *  - SKU e barcode/EAN resolvem ids de Produto (uma query por loja) e entram
 *    como `itens: { some: { inventoryId: { in } } }` — sem N+1;
 *  - cupom continua buscando; venda sem cliente não quebra;
 *  - storeId do header isola lojas; data/status combinam com a busca;
 *  - KPIs continuam SEM o filtro textual (escopo da loja/janela, como antes);
 *  - nenhum resultado → payload vazio e ok.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

type Row = Record<string, unknown>

const h = vi.hoisted(() => {
  const STORE = "loja-1"

  const produtos: Row[] = []
  const vendas: Row[] = []
  const captured: {
    vendaFindMany: Array<Row>
    vendaCount: Array<Row>
    vendaAggregate: Array<Row>
    aggregateResults: Array<Row>
    produtoFindMany: Array<Row>
  } = {
    vendaFindMany: [],
    vendaCount: [],
    vendaAggregate: [],
    aggregateResults: [],
    produtoFindMany: [],
  }

  function reset() {
    produtos.length = 0
    vendas.length = 0
    captured.vendaFindMany.length = 0
    captured.vendaCount.length = 0
    captured.vendaAggregate.length = 0
    captured.aggregateResults.length = 0
    captured.produtoFindMany.length = 0
  }

  /** Avaliador leve das cláusulas usadas pela rota (comportamento, não só forma). */
  function casa(row: Row, where: Row): boolean {
    if (where.status !== undefined) {
      if (typeof where.status === "string") {
        if (row.status !== where.status) return false
      } else {
        const not = (where.status as Row).not
        if (not !== undefined && row.status === not) return false
      }
    }
    if (where.at) {
      const at = where.at as Row
      const t = (row.at as Date).getTime()
      if (at.gte && t < (at.gte as Date).getTime()) return false
      if (at.lte && t > (at.lte as Date).getTime()) return false
    }
    const or = where.OR as Array<Row> | undefined
    if (or && !or.some((c) => casaOr(row, c))) return false
    return true
  }

  function casaOr(row: Row, c: Row): boolean {
    const pedido = c.pedidoId as Row | undefined
    if (pedido && typeof pedido.contains === "string") {
      if (!String(row.pedidoId).toLowerCase().includes(pedido.contains.toLowerCase())) return false
      return true
    }
    const cliente = c.clienteNome as Row | undefined
    if (cliente && typeof cliente.contains === "string") {
      if (!String(row.clienteNome ?? "").toLowerCase().includes(cliente.contains.toLowerCase()))
        return false
      return true
    }
    const itens = c.itens as Row | undefined
    if (itens) {
      const some = (itens.some ?? {}) as Row
      const nome = some.nome as Row | undefined
      if (nome && typeof nome.contains === "string") {
        const nomes = (row.itensBusca as Array<{ nome?: string }>).map((i) =>
          (i.nome ?? "").toLowerCase(),
        )
        return nomes.some((n) => n.includes(nome.contains!.toLowerCase()))
      }
      const inv = some.inventoryId as Row | undefined
      if (inv && Array.isArray(inv.in)) {
        const ids = (row.itensBusca as Array<{ inventoryId?: string }>).map((i) => i.inventoryId)
        return (inv.in as string[]).some((id) => ids.includes(id))
      }
    }
    return false
  }

  const prisma = {
    produto: {
      findMany: async ({ where }: { where: Row }) => {
        captured.produtoFindMany.push(where)
        const orProduto = (where.OR as Array<Row>) ?? []
        const skuEquals = String((((orProduto[0] as Row)?.sku as Row)?.equals ?? "")).toLowerCase()
        const barcodeEquals = String(
          (((orProduto[1] as Row)?.barcode as Row)?.equals ?? ""),
        ).toLowerCase()
        return produtos.filter((p) => {
          if (where.storeId && p.storeId !== where.storeId) return false
          const pSku = String(p.sku ?? "").toLowerCase()
          const pBarcode = String(p.barcode ?? "").toLowerCase()
          return (skuEquals !== "" && pSku === skuEquals) || (barcodeEquals !== "" && pBarcode === barcodeEquals)
        })
      },
    },
    venda: {
      findMany: async ({ where }: { where: Row }) => {
        captured.vendaFindMany.push(where)
        return vendas.filter((v) => v.storeId === where.storeId && casa(v, where))
      },
      count: async ({ where }: { where: Row }) => {
        captured.vendaCount.push(where)
        return vendas.filter((v) => v.storeId === where.storeId && casa(v, where)).length
      },
      aggregate: async ({ where }: { where: Row }) => {
        captured.vendaAggregate.push(where)
        const rows = vendas.filter((v) => v.storeId === where.storeId && casa(v, where))
        const result = {
          _sum: { total: rows.reduce((s, r) => s + (r.total as number), 0) },
          _count: { id: rows.length },
        }
        captured.aggregateResults.push(result)
        return result
      },
    },
    pdvTerminal: { findMany: async () => [] },
  }

  function addProduto(p: { id: string; sku?: string; barcode?: string; storeId?: string }) {
    produtos.push({ storeId: STORE, ...p })
  }

  function addVenda(v: {
    pedidoId: string
    storeId?: string
    clienteNome?: string | null
    itens?: Array<{ nome?: string; inventoryId?: string; quantidade?: number }>
    status?: string
    at?: Date
    total?: number
  }) {
    vendas.push({
      storeId: STORE,
      status: "concluida",
      at: new Date("2026-08-20T10:00:00Z"),
      total: 100,
      operador: null,
      terminalId: null,
      clienteNome: null,
      canceladaEm: null,
      motivoCancelamento: null,
      payload: { paymentBreakdown: { dinheiro: 100 } },
      ...v,
      id: v.pedidoId,
      itens: (v.itens ?? []).map((it) => ({ quantidade: it.quantidade ?? 1 })),
      itensBusca: v.itens ?? [],
    })
  }

  return { STORE, prisma, captured, reset, addProduto, addVenda }
})

vi.mock("@/lib/prisma", () => ({
  prisma: h.prisma,
  prismaEnsureConnected: async () => {},
  withPrismaSafe: async (op: (db: unknown) => Promise<unknown>, fallback: unknown) => {
    try {
      return await op(h.prisma)
    } catch {
      return fallback
    }
  },
}))
vi.mock("@/lib/ops-api-gate", () => ({ opsLojaIdFromRequest: vi.fn(() => h.STORE) }))

import { GET } from "./route"

function getReq(query = "") {
  return new Request(`http://local/api/vendas/historico?${query}`, {
    headers: { "x-assistec-loja-id": h.STORE },
  })
}

beforeEach(() => {
  h.reset()
})

describe("GET /api/vendas/historico — busca por item/produto", () => {
  it("nome parcial do produto casa via itens.some(nome contains, insensitive)", async () => {
    h.addVenda({ pedidoId: "VDA-2026-0001", itens: [{ nome: "Fone de Ouvido Redmi Básico" }] })
    const res = await GET(getReq("q=fone%20de%20ouvido"))
    const j = await res.json()
    expect(j.ok).toBe(true)
    expect(j.vendas).toHaveLength(1)
    expect(j.vendas[0].id).toBe("VDA-2026-0001")
    const where = h.captured.vendaFindMany[0]!
    const or = where.OR as Array<Row>
    expect(or).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          itens: { some: { nome: { contains: "fone de ouvido", mode: "insensitive" } } },
        }),
      ]),
    )
  })

  it("SKU resolve ids de Produto (query única por loja) e casa por inventoryId", async () => {
    h.addProduto({ id: "prod-1", sku: "RDMI-RED" })
    h.addVenda({ pedidoId: "VDA-2026-0002", itens: [{ inventoryId: "prod-1", nome: "Fone Redmi" }] })
    const res = await GET(getReq("q=rdmi-red"))
    const j = await res.json()
    expect(j.ok).toBe(true)
    expect(j.vendas.map((v: Row) => v.id)).toContain("VDA-2026-0002")
    // Query de produto presa ao storeId (isolação) e com correspondência exata.
    const produtoWhere = h.captured.produtoFindMany[0]!
    expect(produtoWhere.storeId).toBe(h.STORE)
    const orProduto = produtoWhere.OR as Array<Row>
    expect((orProduto[0]!.sku as Row).equals).toBe("rdmi-red")
    expect((orProduto[1]!.barcode as Row).equals).toBe("rdmi-red")
    const where = h.captured.vendaFindMany[0]!
    const or = where.OR as Array<Row>
    expect(or).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          itens: { some: { inventoryId: { in: ["prod-1"] } } },
        }),
      ]),
    )
  })

  it("EAN/barcode resolve o produto e localiza a venda (cliente perdeu o cupom)", async () => {
    h.addProduto({ id: "prod-2", barcode: "7891234567890" })
    h.addVenda({ pedidoId: "VDA-2026-0003", itens: [{ inventoryId: "prod-2", nome: "Carregador" }] })
    const res = await GET(getReq("q=7891234567890"))
    const j = await res.json()
    expect(j.vendas.map((v: Row) => v.id)).toContain("VDA-2026-0003")
  })

  it("busca existente por cupom continua funcionando (OR preserva pedidoId)", async () => {
    h.addVenda({ pedidoId: "VDA-2026-0004" })
    const res = await GET(getReq("q=vda-2026-0004"))
    const j = await res.json()
    expect(j.vendas).toHaveLength(1)
    const or = (h.captured.vendaFindMany[0]!.OR as Array<Row>)[0]!
    expect((or.pedidoId as Row).contains).toBe("vda-2026-0004")
    expect((or.pedidoId as Row).mode).toBe("insensitive")
  })

  it("venda sem cliente é encontrada por produto (clienteNome null não quebra)", async () => {
    h.addVenda({ pedidoId: "VDA-2026-0005", clienteNome: null, itens: [{ nome: "Capa Silicone" }] })
    const res = await GET(getReq("q=silicone"))
    const j = await res.json()
    expect(j.vendas).toHaveLength(1)
    expect(j.vendas[0].cliente).toBe("—")
  })

  it("storeId do header isola lojas (venda de outra loja não vaza)", async () => {
    h.addVenda({ pedidoId: "VDA-2026-0006", itens: [{ nome: "Fone Redmi" }] })
    // Venda "de outra loja" — o fake filtra por where.storeId, então basta que o
    // where carregue o storeId do header e a loja errada nunca seja consultada.
    const res = await GET(getReq("q=redmi"))
    const j = await res.json()
    expect(h.captured.vendaFindMany[0]!.storeId).toBe(h.STORE)
    expect(j.vendas).toHaveLength(1)
  })

  it("combina busca com filtros de data e status no MESMO where", async () => {
    h.addVenda({ pedidoId: "VDA-2026-0007", itens: [{ nome: "Fone Redmi" }] })
    const from = encodeURIComponent("2026-08-01T00:00:00Z")
    const to = encodeURIComponent("2026-08-30T23:59:59Z")
    await GET(getReq(`q=redmi&status=concluida&from=${from}&to=${to}`))
    const where = h.captured.vendaFindMany[0]!
    expect(where.status).toBe("concluida")
    const at = where.at as Row
    expect((at.gte as Date).toISOString()).toBe("2026-08-01T00:00:00.000Z")
    expect((at.lte as Date).toISOString()).toBe("2026-08-30T23:59:59.000Z")
    expect(where.OR).toBeDefined()
  })

  it("nenhum resultado → ok com lista e total vazios", async () => {
    h.addVenda({ pedidoId: "VDA-2026-0008" })
    const res = await GET(getReq("q=produto-inexistente-xyz"))
    const j = await res.json()
    expect(j.ok).toBe(true)
    expect(j.vendas).toHaveLength(0)
    expect(j.total).toBe(0)
  })

  it("KPIs continuam sem o filtro textual (escopo loja + janela + terminal)", async () => {
    h.addVenda({ pedidoId: "VDA-2026-0009", itens: [{ nome: "Fone" }] })
    await GET(getReq("q=fone"))
    // 5 counts: 1 total (com OR da busca) + 4 KPIs (sem OR); aggregate sem OR.
    expect(h.captured.vendaCount).toHaveLength(5)
    const comOr = h.captured.vendaCount.filter((w) => w.OR !== undefined)
    const semOr = h.captured.vendaCount.filter((w) => w.OR === undefined)
    expect(comOr).toHaveLength(1)
    expect(semOr).toHaveLength(4)
    for (const w of [...semOr, ...h.captured.vendaAggregate]) {
      expect(w.OR).toBeUndefined()
      expect(w.storeId).toBe(h.STORE)
    }
    // Faturamento ignora a busca textual: a venda casa e entra no agregado.
    const agg = h.captured.aggregateResults[0]!
    expect((agg as unknown as { _sum: { total: number } })._sum.total).toBeCloseTo(100, 2)
  })

  it("sem q: nenhuma query de produto e nenhum OR", async () => {
    h.addVenda({ pedidoId: "VDA-2026-0010" })
    const res = await GET(getReq(""))
    const j = await res.json()
    expect(j.vendas).toHaveLength(1)
    expect(h.captured.produtoFindMany).toHaveLength(0)
    expect(h.captured.vendaFindMany[0]!.OR).toBeUndefined()
  })
})
