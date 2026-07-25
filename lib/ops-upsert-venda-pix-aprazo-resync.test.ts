/**
 * GOAL: PDV-VENDA-PENDENTE-A-PRAZO-SYNC-FIX-001
 *
 * Regressão do cenário reportado: venda com pagamento misto Pix + À Prazo (3 itens)
 * ficando `syncPending` no PDV e falhando o reenvio com
 * "Transaction API error: Transaction not found... refere-se a uma transação antiga já
 * encerrada". A causa raiz não era um bug de uso de `tx` fora da transação (o código em
 * `upsertVendaInTransaction` já aguarda tudo dentro do callback) — era o orçamento de
 * tempo do `$transaction` (defaults do Prisma: `maxWait` 2s / `timeout` 5s) estourando
 * com `DATABASE_URL` usando `connection_limit=1`, dado o número de idas ao banco de uma
 * venda com vários itens + parcelas. A correção real foi elevar `maxWait`/`timeout` na
 * chamada de `prisma.$transaction` em `app/api/ops/venda-persist/route.ts` — fora do
 * alcance deste fake `tx` (que não modela tempo). Este arquivo cobre o que É testável
 * sem banco: que a mesma venda (Pix + À Prazo, 3 itens) persiste corretamente e que um
 * reenvio (retry) da mesma venda — como o botão "Reenviar sync" faz — é idempotente:
 * não duplica venda, não duplica Conta a Receber e não duplica baixa de estoque.
 *
 * Fake `tx` com estado (mais fiel que os outros testes): `venda.upsert` respeita
 * unicidade por `pedidoId`, `contaReceberTitulo.upsert` respeita unicidade por
 * `localKey`, e os guards de `findFirst` refletem registros já gravados por uma
 * chamada anterior — simulando exatamente um reenvio da mesma venda.
 */
import { describe, expect, it } from "vitest"
import { upsertVendaInTransaction, type SalePayload } from "./ops-upsert-venda"

const STORE = "loja-1"

type FakeProduct = {
  id: string
  storeId: string
  stock: number
  precoCusto: number
  sku: string | null
  barcode: string | null
  name: string
}

/** Fake tx com estado persistente entre chamadas — simula o banco real para testar reenvio. */
function makeStatefulFakeDb(products: FakeProduct[]) {
  const byId = new Map(products.map((p) => [p.id, p]))
  const vendas = new Map<string, { id: string; pedidoId: string }>()
  const titulos = new Map<string, { id: string; localKey: string; valor: number }>()
  const movimentacoesEstoque: Array<{ documento: string; produtoId: string }> = []
  const movimentacoesFinanceiras: Array<{ referenciaId: string; valor: number }> = []
  let vendaSeq = 0
  let tituloSeq = 0

  /* eslint-disable @typescript-eslint/no-explicit-any */
  function makeTx(): any {
    return {
      cliente: { findFirst: async () => null },
      venda: {
        // Guard de colisão entre lojas (PDV-PEDIDO-ID-COLISAO-MULTILOJA-FIX-001):
        // fake single-store, então toda venda existente pertence a `STORE`.
        findUnique: async ({ where }: any) => {
          const existing = vendas.get(where.pedidoId)
          return existing ? { id: existing.id, storeId: STORE, pedidoId: where.pedidoId } : null
        },
        upsert: async ({ where, create }: any) => {
          const existing = vendas.get(where.pedidoId)
          if (existing) return { id: existing.id }
          const id = `venda-${++vendaSeq}`
          vendas.set(where.pedidoId, { id, pedidoId: create.pedidoId })
          return { id }
        },
        update: async () => ({}),
      },
      itemVenda: { deleteMany: async () => ({ count: 0 }), create: async () => ({}) },
      produto: {
        findFirst: async ({ where }: any) => {
          const ors: Array<Record<string, string>> = where.OR ?? []
          for (const p of products) {
            if (p.storeId !== where.storeId) continue
            for (const cond of ors) {
              if (cond.id !== undefined && p.id === cond.id)
                return { id: p.id, stock: p.stock, precoCusto: p.precoCusto, sku: p.sku, name: p.name }
              if (cond.sku !== undefined && p.sku === cond.sku)
                return { id: p.id, stock: p.stock, precoCusto: p.precoCusto, sku: p.sku, name: p.name }
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
      },
      movimentacaoEstoque: {
        findFirst: async ({ where }: any) =>
          movimentacoesEstoque.find(
            (m) => m.documento === where.documento && m.produtoId === where.produtoId,
          ) ?? null,
        create: async ({ data }: any) => {
          movimentacoesEstoque.push({ documento: data.documento, produtoId: data.produtoId })
          return data
        },
      },
      movimentacaoFinanceira: {
        findFirst: async ({ where }: any) =>
          movimentacoesFinanceiras.find((m) => m.referenciaId === where.referenciaId) ?? null,
        create: async ({ data }: any) => {
          movimentacoesFinanceiras.push({ referenciaId: data.referenciaId, valor: data.valor })
          return data
        },
      },
      contaReceberTitulo: {
        upsert: async ({ where, create }: any) => {
          const key = where.storeId_localKey.localKey
          const existing = titulos.get(key)
          if (existing) return { id: existing.id }
          const id = `titulo-${++tituloSeq}`
          titulos.set(key, { id, localKey: key, valor: create.valor })
          return { id }
        },
      },
    }
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return { makeTx, vendas, titulos, movimentacoesEstoque, movimentacoesFinanceiras, byId }
}

function produto(over: Partial<FakeProduct> = {}): FakeProduct {
  return { id: "prod-1", storeId: STORE, stock: 10, precoCusto: 5, sku: "SKU-1", barcode: null, name: "Produto A", ...over }
}

/** Venda VDA-2026-0448: 3 itens, total 114,98, Pix 57,49 + À Prazo 57,49, com cliente. */
function pixAPrazoSale(over: Partial<SalePayload> = {}): SalePayload {
  return {
    id: "VDA-2026-0448",
    total: 114.98,
    customerName: "VIVIANE FARIA DE LIMA",
    paymentBreakdown: { pix: 57.49, aPrazo: 57.49 } as SalePayload["paymentBreakdown"],
    lines: [
      { inventoryId: "prod-1", name: "Produto A", quantity: 1, unitPrice: 38.33 },
      { inventoryId: "prod-2", name: "Produto B", quantity: 1, unitPrice: 38.33 },
      { inventoryId: "prod-3", name: "Produto C", quantity: 1, unitPrice: 38.32 },
    ],
    ...over,
  }
}

describe("upsertVendaInTransaction — Pix + À Prazo (regressão VDA-2026-0448)", () => {
  it("persiste: Pix vira caixa, À Prazo vira 1 Conta a Receber, estoque baixa nos 3 itens", async () => {
    const db = makeStatefulFakeDb([produto({ id: "prod-1" }), produto({ id: "prod-2" }), produto({ id: "prod-3" })])
    await upsertVendaInTransaction(db.makeTx(), STORE, pixAPrazoSale(), undefined, {
      enforceStock: true,
      requireCaixaSession: false,
    })

    expect(db.vendas.size).toBe(1)
    expect(db.movimentacoesFinanceiras).toHaveLength(1)
    expect(db.movimentacoesFinanceiras[0]!.valor).toBeCloseTo(57.49, 2)
    expect(db.titulos.size).toBe(1)
    expect([...db.titulos.values()][0]!.valor).toBeCloseTo(57.49, 2)
    expect(db.movimentacoesEstoque).toHaveLength(3)
    expect(db.byId.get("prod-1")!.stock).toBe(9)
  })

  it("reenvio (retry) da mesma venda é idempotente: sem duplicar venda, CR ou baixa de estoque", async () => {
    const db = makeStatefulFakeDb([produto({ id: "prod-1" }), produto({ id: "prod-2" }), produto({ id: "prod-3" })])
    const sale = pixAPrazoSale()

    // 1ª tentativa (a que teria falhado por timeout de transação no servidor real).
    await upsertVendaInTransaction(db.makeTx(), STORE, sale, undefined, {
      enforceStock: true,
      requireCaixaSession: false,
    })
    // Reenvio manual ("Reenviar sync") — mesmo pedidoId, nova transação.
    await upsertVendaInTransaction(db.makeTx(), STORE, sale, undefined, {
      enforceStock: true,
      requireCaixaSession: false,
    })

    expect(db.vendas.size).toBe(1) // sem venda duplicada (upsert por pedidoId)
    expect(db.titulos.size).toBe(1) // sem título duplicado (upsert por localKey)
    expect(db.movimentacoesFinanceiras).toHaveLength(1) // sem entrada financeira duplicada
    expect(db.movimentacoesEstoque).toHaveLength(3) // sem baixa de estoque duplicada
    expect(db.byId.get("prod-1")!.stock).toBe(9) // não baixou 2x
  })

  it("venda 100% Pix (sem à prazo) continua funcionando normalmente", async () => {
    const db = makeStatefulFakeDb([produto({ id: "prod-1" })])
    await upsertVendaInTransaction(
      db.makeTx(),
      STORE,
      pixAPrazoSale({
        id: "VDA-PIX-SIMPLES",
        total: 38.33,
        paymentBreakdown: { pix: 38.33 } as SalePayload["paymentBreakdown"],
        lines: [{ inventoryId: "prod-1", name: "Produto A", quantity: 1, unitPrice: 38.33 }],
      }),
      undefined,
      { enforceStock: true, requireCaixaSession: false },
    )

    expect(db.movimentacoesFinanceiras).toHaveLength(1)
    expect(db.movimentacoesFinanceiras[0]!.valor).toBeCloseTo(38.33, 2)
    expect(db.titulos.size).toBe(0)
  })
})
