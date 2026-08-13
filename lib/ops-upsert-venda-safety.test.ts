/**
 * OPS-SALE-SAFETY-P1-001 — Endurecimento da venda persistida.
 *
 * Cobre as duas barreiras P1 adicionadas a `upsertVendaInTransaction`:
 *
 *  1. Caixa servidor obrigatório (`requireCaixaSession`): venda que gera entrada no
 *     caixa (valorImediato > 0) exige `SessaoCaixa` ABERTA válida da loja. Sem
 *     sessão válida → `CaixaSessaoInvalidaError` e NADA é gravado. Nunca abre caixa
 *     automaticamente; nunca usa fallback `loja-1` (a loja vem do argumento).
 *
 *  2. Produto físico não resolvido (`enforceStock`): item com `inventoryId` sem
 *     casamento em `Produto` → `UnresolvedProductError` e NADA é gravado. Linhas
 *     virtuais (O.S./serviço/avulso) seguem isentas; replay legado preserva o histórico.
 *
 * Usa um `TransactionClient` fake em memória — o vitest roda em `node` e proíbe
 * importar `@/lib/prisma`. O `import type` do Prisma em ops-upsert-venda é apagado
 * no runtime, então este teste não toca o banco.
 */
import { describe, expect, it } from "vitest"
import {
  upsertVendaInTransaction,
  UnresolvedProductError,
  CaixaSessaoInvalidaError,
  CaixaOriginalFechadoError,
  type SalePayload,
} from "./ops-upsert-venda"
import { servicoInventoryId } from "./os-pdv-virtual-lines"

type FakeProduct = {
  id: string
  storeId: string
  stock: number
  precoCusto: number
  sku: string | null
  barcode: string | null
  name: string
}

type FakeSessao = {
  id: string
  storeId: string
  status: "ABERTA" | "FECHADA"
  terminalId: string | null
  abertaEm: number
}

function proj(p: FakeProduct) {
  return { id: p.id, stock: p.stock, precoCusto: p.precoCusto, sku: p.sku, name: p.name }
}

/** Fake mínimo do Prisma.TransactionClient para a venda + gate de caixa. */
function makeFakeTx(opts?: { products?: FakeProduct[]; sessoes?: FakeSessao[] }) {
  const products = opts?.products ?? []
  const sessoes = opts?.sessoes ?? []
  const byId = new Map(products.map((p) => [p.id, p]))
  const ledger: Array<Record<string, unknown>> = []
  const financeiro: Array<Record<string, unknown>> = []
  const titulos: Array<Record<string, unknown>> = []
  const itemRows: Array<Record<string, unknown>> = []
  const vendaPayloads: Array<Record<string, unknown>> = []
  /** Registra cada consulta de sessão para inspecionar o scoping (anti loja-1). */
  const sessaoQueries: Array<Record<string, unknown>> = []
  let vendaCounter = 0
  let vendaUpserts = 0

  const tx: any = {
    cliente: { findFirst: async () => null },
    venda: {
      // Guard de colisão entre lojas (PDV-PEDIDO-ID-COLISAO-MULTILOJA-FIX-001): fake sem
      // vendas pré-existentes → nenhum `pedidoId` tem dono, o guard passa direto.
      findUnique: async () => null,
      upsert: async ({ create }: any) => {
        vendaUpserts += 1
        vendaPayloads.push(create.payload as Record<string, unknown>)
        return { id: `venda-${++vendaCounter}` }
      },
      update: async () => ({}),
    },
    itemVenda: {
      deleteMany: async () => ({ count: 0 }),
      create: async ({ data }: any) => {
        itemRows.push(data)
        return data
      },
    },
    produto: {
      findFirst: async ({ where }: any) => {
        const ors: Array<Record<string, string>> = where.OR ?? []
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
      findUnique: async ({ where }: any) => {
        const p = byId.get(where.id)
        return p ? { stock: p.stock, precoCusto: p.precoCusto } : null
      },
      updateMany: async ({ where, data }: any) => {
        const p = byId.get(where.id)
        if (!p || p.storeId !== where.storeId) return { count: 0 }
        const gte = where.stock?.gte
        if (typeof gte === "number" && p.stock < gte) return { count: 0 }
        p.stock -= data.stock?.decrement ?? 0
        return { count: 1 }
      },
      update: async ({ where, data }: any) => {
        const p = byId.get(where.id)
        if (p && data.stock?.decrement != null) p.stock -= data.stock.decrement
        return p ?? {}
      },
    },
    movimentacaoEstoque: {
      findFirst: async () => null,
      create: async ({ data }: any) => {
        ledger.push(data)
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
    contaReceberTitulo: {
      upsert: async ({ create }: any) => {
        titulos.push(create)
        return { id: `tit-${titulos.length}` }
      },
    },
    // Espelha o filtro real do gate de caixa (id?/storeId/status/terminalId?).
    sessaoCaixa: {
      findFirst: async ({ where, orderBy }: any) => {
        sessaoQueries.push(where)
        let matches = sessoes.filter((s) => {
          if (where.id !== undefined && s.id !== where.id) return false
          if (where.storeId !== undefined && s.storeId !== where.storeId) return false
          if (where.status !== undefined && s.status !== where.status) return false
          if (where.terminalId !== undefined && s.terminalId !== where.terminalId) return false
          return true
        })
        if (orderBy?.abertaEm === "desc") {
          matches = [...matches].sort((a, b) => b.abertaEm - a.abertaEm)
        }
        const m = matches[0]
        // Espelha `select: { id: true, status: true }` do branch com `sessaoId` (produção
        // precisa do `status` para distinguir sessão FECHADA de sessão inexistente).
        return m ? { id: m.id, status: m.status } : null
      },
    },
  }
  return {
    tx,
    byId,
    ledger,
    financeiro,
    titulos,
    itemRows,
    vendaPayloads,
    sessaoQueries,
    getVendaUpserts: () => vendaUpserts,
  }
}

const STORE = "loja-1"

function produto(over: Partial<FakeProduct> = {}): FakeProduct {
  return {
    id: "prod-1",
    storeId: STORE,
    stock: 5,
    precoCusto: 10,
    sku: "SKU-1",
    barcode: null,
    name: "Produto",
    ...over,
  }
}

function sessao(over: Partial<FakeSessao> = {}): FakeSessao {
  return { id: "sess-1", storeId: STORE, status: "ABERTA", terminalId: null, abertaEm: 1000, ...over }
}

/** Venda à vista padrão (dinheiro) com 1 produto resolvível. */
function vendaProduto(over: Partial<SalePayload> = {}): SalePayload {
  return {
    id: "PED-1",
    total: 100,
    paymentBreakdown: { dinheiro: 100 },
    lines: [{ inventoryId: "prod-1", name: "Produto", quantity: 1, unitPrice: 100 }],
    ...over,
  }
}

const LIVE = { enforceStock: true, requireCaixaSession: true } as const

describe("upsertVendaInTransaction — caixa servidor obrigatório (P1)", () => {
  it("rejeita venda à vista sem nenhuma sessão de caixa aberta", async () => {
    const { tx, ledger, financeiro, getVendaUpserts } = makeFakeTx({
      products: [produto()],
      sessoes: [],
    })
    await expect(
      upsertVendaInTransaction(tx, STORE, vendaProduto(), undefined, LIVE),
    ).rejects.toBeInstanceOf(CaixaSessaoInvalidaError)
    // Nada gravado: o gate roda ANTES do upsert da venda (passo 1).
    expect(getVendaUpserts()).toBe(0)
    expect(ledger).toHaveLength(0)
    expect(financeiro).toHaveLength(0)
  })

  it("rejeita venda com sessaoId inexistente", async () => {
    const { tx } = makeFakeTx({ products: [produto()], sessoes: [sessao({ id: "sess-real" })] })
    await expect(
      upsertVendaInTransaction(tx, STORE, vendaProduto({ sessaoId: "sess-fantasma" }), undefined, LIVE),
    ).rejects.toBeInstanceOf(CaixaSessaoInvalidaError)
  })

  it("rejeita venda com sessaoId de sessão já fechada (código específico CAIXA_ORIGINAL_FECHADO, sem flag)", async () => {
    // GOAL PDV-VENDA-PENDENTE-SESSAO-FECHADA-RETROATIVA-002: sessão existe e é DESTA loja,
    // só que fechada — erro específico, distinto de "sessão inexistente/de outra loja".
    const { tx, getVendaUpserts } = makeFakeTx({
      products: [produto()],
      sessoes: [sessao({ id: "sess-1", status: "FECHADA" })],
    })
    await expect(
      upsertVendaInTransaction(tx, STORE, vendaProduto({ sessaoId: "sess-1" }), undefined, LIVE),
    ).rejects.toBeInstanceOf(CaixaOriginalFechadoError)
    expect(getVendaUpserts()).toBe(0)
  })

  it("rejeita venda com sessaoId de OUTRA loja", async () => {
    const { tx } = makeFakeTx({
      products: [produto()],
      // Sessão aberta existe, mas pertence a loja-2.
      sessoes: [sessao({ id: "sess-1", storeId: "loja-2" })],
    })
    await expect(
      upsertVendaInTransaction(tx, STORE, vendaProduto({ sessaoId: "sess-1" }), undefined, LIVE),
    ).rejects.toBeInstanceOf(CaixaSessaoInvalidaError)
  })

  it("aceita venda à vista com sessaoId aberto e válido da loja", async () => {
    const { tx, byId, ledger, financeiro, getVendaUpserts } = makeFakeTx({
      products: [produto({ stock: 5 })],
      sessoes: [sessao({ id: "sess-1" })],
    })
    await upsertVendaInTransaction(tx, STORE, vendaProduto({ sessaoId: "sess-1" }), undefined, LIVE)
    expect(getVendaUpserts()).toBe(1)
    expect(byId.get("prod-1")!.stock).toBe(4)
    expect(ledger).toHaveLength(1)
    expect(financeiro).toHaveLength(1)
  })

  it("aceita venda sem sessaoId quando há sessão aberta da loja (resolve a mais recente)", async () => {
    const { tx, financeiro } = makeFakeTx({
      products: [produto({ stock: 5 })],
      sessoes: [sessao({ id: "sess-antiga", abertaEm: 1 }), sessao({ id: "sess-nova", abertaEm: 999 })],
    })
    // sessaoId ausente → o gate usa a sessão aberta mais recente da loja.
    await upsertVendaInTransaction(tx, STORE, vendaProduto(), undefined, LIVE)
    expect(financeiro).toHaveLength(1)
  })

  it("NÃO usa fallback loja-1: venda de loja-2 com sessão aberta só em loja-1 é rejeitada", async () => {
    const { tx, sessaoQueries } = makeFakeTx({
      products: [produto({ storeId: "loja-2" })],
      sessoes: [sessao({ id: "sess-1", storeId: STORE })], // aberta em loja-1, não em loja-2
    })
    await expect(
      upsertVendaInTransaction(tx, "loja-2", vendaProduto(), undefined, LIVE),
    ).rejects.toBeInstanceOf(CaixaSessaoInvalidaError)
    // A consulta de sessão foi escopada por loja-2 — nunca por loja-1.
    expect(sessaoQueries.every((q) => q.storeId === "loja-2")).toBe(true)
  })

  it("venda 100% à prazo (valorImediato = 0) NÃO exige caixa", async () => {
    const { tx, financeiro, titulos } = makeFakeTx({ products: [], sessoes: [] })
    const aprazo: SalePayload = {
      id: "PED-AP",
      total: 100,
      paymentBreakdown: { aPrazo: 100 },
      customerName: "Cliente Fiado",
      // Linha de serviço (O.S.): virtual, não toca estoque.
      lines: [{ inventoryId: "__os_servico__os-9", name: "Serviço", quantity: 1, unitPrice: 100 }],
    }
    await expect(
      upsertVendaInTransaction(tx, STORE, aprazo, undefined, LIVE),
    ).resolves.toBeUndefined()
    // Sem entrada no caixa; título a receber criado.
    expect(financeiro).toHaveLength(0)
    expect(titulos).toHaveLength(1)
  })

  it("replay legado (sem requireCaixaSession) não consulta caixa", async () => {
    const { tx, financeiro, sessaoQueries } = makeFakeTx({ products: [produto()], sessoes: [] })
    // Sem opção requireCaixaSession → gate desligado mesmo sem sessão aberta.
    await upsertVendaInTransaction(tx, STORE, vendaProduto(), undefined, { enforceStock: true })
    expect(sessaoQueries).toHaveLength(0)
    expect(financeiro).toHaveLength(1)
  })
})

describe("upsertVendaInTransaction — produto físico não resolvido (P1)", () => {
  it("enforceStock: item físico sem casamento em Produto é rejeitado e nada é gravado", async () => {
    const { tx, ledger, financeiro } = makeFakeTx({ products: [], sessoes: [sessao()] })
    const sale = vendaProduto({
      sessaoId: "sess-1",
      lines: [{ inventoryId: "ghost-999", name: "Fantasma", quantity: 1, unitPrice: 100 }],
    })
    await expect(
      upsertVendaInTransaction(tx, STORE, sale, undefined, LIVE),
    ).rejects.toBeInstanceOf(UnresolvedProductError)
    expect(ledger).toHaveLength(0)
    expect(financeiro).toHaveLength(0)
  })

  it("enforceStock: erro carrega os inventoryIds não resolvidos", async () => {
    const { tx } = makeFakeTx({ products: [], sessoes: [] })
    try {
      await upsertVendaInTransaction(
        tx,
        STORE,
        vendaProduto({ lines: [{ inventoryId: "ghost-1", name: "X", quantity: 1, unitPrice: 100 }] }),
        undefined,
        { enforceStock: true }, // isola o teste do gate de caixa
      )
      throw new Error("deveria ter lançado")
    } catch (e) {
      expect(e).toBeInstanceOf(UnresolvedProductError)
      const err = e as UnresolvedProductError
      expect(err.code).toBe("PRODUTO_NAO_RESOLVIDO")
      expect(err.inventoryIds).toContain("ghost-1")
    }
  })

  it("enforceStock: linha de serviço/virtual sem produto continua permitida", async () => {
    const { tx, ledger, financeiro } = makeFakeTx({ products: [], sessoes: [sessao()] })
    const sale: SalePayload = {
      id: "PED-OS",
      total: 100,
      paymentBreakdown: { dinheiro: 100 },
      sessaoId: "sess-1",
      lines: [{ inventoryId: "__os_servico__os-1", name: "Serviço O.S.", quantity: 1, unitPrice: 100 }],
    }
    await expect(
      upsertVendaInTransaction(tx, STORE, sale, undefined, LIVE),
    ).resolves.toBeUndefined()
    // Virtual não baixa estoque; entrada à vista no caixa registrada.
    expect(ledger).toHaveLength(0)
    expect(financeiro).toHaveLength(1)
  })

  it("replay legado (sem enforceStock): produto não resolvido NÃO derruba a venda (warn only)", async () => {
    const { tx, financeiro } = makeFakeTx({ products: [], sessoes: [] })
    await expect(
      upsertVendaInTransaction(
        tx,
        STORE,
        vendaProduto({ lines: [{ inventoryId: "ghost-1", name: "X", quantity: 1, unitPrice: 100 }] }),
      ),
    ).resolves.toBeUndefined()
    // Comportamento histórico preservado: venda/financeiro gravados, sem baixa de estoque.
    expect(financeiro).toHaveLength(1)
  })
})

describe("upsertVendaInTransaction — serviço real do PDV Assistência", () => {
  const linhaServico = {
    inventoryId: servicoInventoryId("svc-1"),
    name: "Transferência de Dados",
    quantity: 1,
    unitPrice: 80,
    lineTotal: 80,
    itemType: "servico" as const,
    serviceId: "svc-1",
    serviceCategory: "Software e Dados",
    warrantyDays: 0,
    serviceTerms: "",
    custoUnitario: 0,
  }

  it("finaliza venda somente com serviço sem Produto, estoque ou O.S. e preserva metadata no payload", async () => {
    const { tx, ledger, financeiro, itemRows, vendaPayloads } = makeFakeTx({
      products: [],
      sessoes: [sessao()],
    })
    await upsertVendaInTransaction(
      tx,
      STORE,
      {
        id: "PED-SVC",
        total: 80,
        sessaoId: "sess-1",
        paymentBreakdown: { pix: 80 },
        lines: [linhaServico],
      },
      undefined,
      LIVE,
    )

    expect(ledger).toHaveLength(0)
    expect(financeiro).toHaveLength(1)
    expect(itemRows).toHaveLength(1)
    expect(itemRows[0]).toMatchObject({
      inventoryId: "__servico__svc-1",
      nome: "Transferência de Dados",
      quantidade: 1,
      precoUnitario: 80,
    })
    const persistedLines = vendaPayloads[0]?.lines as Array<Record<string, unknown>>
    expect(persistedLines[0]).toMatchObject({
      itemType: "servico",
      serviceId: "svc-1",
      serviceCategory: "Software e Dados",
      warrantyDays: 0,
    })
    expect(persistedLines[0]?.isAvulso).not.toBe(true)
    expect("ordemServico" in tx).toBe(false)
  })

  it("carrinho misto baixa somente o produto e mantém o serviço virtual", async () => {
    const { tx, byId, ledger, itemRows } = makeFakeTx({
      products: [produto({ stock: 3 })],
      sessoes: [sessao()],
    })
    await upsertVendaInTransaction(
      tx,
      STORE,
      {
        id: "PED-MISTO",
        total: 180,
        sessaoId: "sess-1",
        paymentBreakdown: { dinheiro: 180 },
        lines: [
          { inventoryId: "prod-1", name: "Produto", quantity: 1, unitPrice: 100, itemType: "produto" },
          linhaServico,
        ],
      },
      undefined,
      LIVE,
    )

    expect(byId.get("prod-1")?.stock).toBe(2)
    expect(ledger).toHaveLength(1)
    expect(itemRows).toHaveLength(2)
  })

  it("item avulso real continua explícito e não baixa estoque", async () => {
    const { tx, ledger, vendaPayloads } = makeFakeTx({ products: [], sessoes: [sessao()] })
    await upsertVendaInTransaction(
      tx,
      STORE,
      {
        id: "PED-AVULSO",
        total: 25,
        sessaoId: "sess-1",
        paymentBreakdown: { dinheiro: 25 },
        lines: [{
          inventoryId: "__avulso__line-1",
          name: "Item avulso",
          quantity: 1,
          unitPrice: 25,
          itemType: "avulso",
          isAvulso: true,
        }],
      },
      undefined,
      LIVE,
    )
    expect(ledger).toHaveLength(0)
    const persistedLines = vendaPayloads[0]?.lines as Array<Record<string, unknown>>
    expect(persistedLines[0]).toMatchObject({ itemType: "avulso", isAvulso: true })
  })
})
