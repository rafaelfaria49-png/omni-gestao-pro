/**
 * DT-B — Anti-Negativo no PDV.
 *
 * Cobre a baixa de estoque de `upsertVendaInTransaction` (lib/ops-upsert-venda.ts, §3):
 *  - com `enforceStock: true` (fluxo PDV ao vivo) o saldo nunca vai abaixo de zero e a
 *    venda falha de forma explícita (`InsufficientStockError`);
 *  - sem `enforceStock` (default — replay legado) o comportamento histórico é preservado
 *    (decremento sem checagem de sinal);
 *  - agregação de linhas do mesmo produto e idempotência continuam corretas.
 *
 * Usa um TransactionClient fake em memória — o vitest.config roda em `node` e proíbe
 * importar `@/lib/prisma`/`@/generated/prisma` (pesados/ligados a banco). O `import type`
 * do Prisma em ops-upsert-venda é apagado no runtime, então este teste não toca o banco.
 */
import { describe, expect, it } from "vitest"
import {
  upsertVendaInTransaction,
  InsufficientStockError,
  type SalePayload,
} from "./ops-upsert-venda"

type FakeProduct = {
  id: string
  storeId: string
  stock: number
  precoCusto: number
  sku: string | null
  barcode: string | null
  name: string
}

function proj(p: FakeProduct) {
  return { id: p.id, stock: p.stock, precoCusto: p.precoCusto, sku: p.sku, name: p.name }
}

/** Fake mínimo do Prisma.TransactionClient para os métodos usados em §3 da venda. */
function makeFakeTx(
  products: FakeProduct[],
  opts?: { movimentacaoJaExiste?: boolean },
) {
  const byId = new Map(products.map((p) => [p.id, p]))
  const ledger: Array<Record<string, unknown>> = []
  const financeiro: Array<Record<string, unknown>> = []
  let vendaCounter = 0

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const tx: any = {
    cliente: { findFirst: async () => null },
    venda: {
      // Guard de colisão entre lojas (PDV-PEDIDO-ID-COLISAO-MULTILOJA-FIX-001): fake sem
      // vendas pré-existentes → nenhum `pedidoId` tem dono, o guard passa direto.
      findUnique: async () => null,
      create: async ({ data }: any) => ({
        id: `venda-${++vendaCounter}`,
        ...data,
        terminalId: data.terminalId ?? null,
        status: "concluida",
      }),
      update: async () => ({}),
    },
    itemVenda: {
      deleteMany: async () => ({ count: 0 }),
      create: async () => ({}),
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
      // Baixa atômica guardada: respeita `stock: { gte }` como o Postgres faria no WHERE.
      updateMany: async ({ where, data }: any) => {
        const p = byId.get(where.id)
        if (!p || p.storeId !== where.storeId) return { count: 0 }
        const gte = where.stock?.gte
        if (typeof gte === "number" && p.stock < gte) return { count: 0 }
        p.stock -= data.stock?.decrement ?? 0
        return { count: 1 }
      },
      // Baixa incondicional legada.
      update: async ({ where, data }: any) => {
        const p = byId.get(where.id)
        if (p && data.stock?.decrement != null) p.stock -= data.stock.decrement
        return p ?? {}
      },
    },
    movimentacaoEstoque: {
      findFirst: async () => (opts?.movimentacaoJaExiste ? { id: "mov-existente" } : null),
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
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return { tx, byId, ledger, financeiro }
}

function baseSale(over: Partial<SalePayload> = {}): SalePayload {
  return {
    id: "PED-1",
    total: 100,
    paymentBreakdown: { dinheiro: 100 },
    lines: [{ inventoryId: "prod-1", name: "Produto", quantity: 3, unitPrice: 33.33 }],
    ...over,
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

describe("upsertVendaInTransaction — anti-negativo (DT-B)", () => {
  it("enforceStock: baixa normal quando há saldo suficiente (5 → vende 3 → 2)", async () => {
    const { tx, byId, ledger } = makeFakeTx([produto({ stock: 5 })])
    await upsertVendaInTransaction(tx, STORE, baseSale(), undefined, { enforceStock: true })
    expect(byId.get("prod-1")!.stock).toBe(2)
    expect(ledger).toHaveLength(1)
    expect(ledger[0]!.estoqueDepois).toBe(2)
  })

  it("enforceStock: saldo exato é permitido (3 → vende 3 → 0)", async () => {
    const { tx, byId } = makeFakeTx([produto({ stock: 3 })])
    await upsertVendaInTransaction(tx, STORE, baseSale(), undefined, { enforceStock: true })
    expect(byId.get("prod-1")!.stock).toBe(0)
  })

  it("enforceStock: bloqueia venda que deixaria negativo (2 → vende 3 → falha, estoque intacto)", async () => {
    const { tx, byId, ledger } = makeFakeTx([produto({ stock: 2 })])
    await expect(
      upsertVendaInTransaction(tx, STORE, baseSale(), undefined, { enforceStock: true }),
    ).rejects.toBeInstanceOf(InsufficientStockError)
    // Sem baixa parcial: o saldo não foi tocado e nenhum ledger foi gravado.
    expect(byId.get("prod-1")!.stock).toBe(2)
    expect(ledger).toHaveLength(0)
  })

  it("enforceStock: erro carrega produto, disponível e solicitado", async () => {
    const { tx } = makeFakeTx([produto({ stock: 2, name: "Caneca" })])
    try {
      await upsertVendaInTransaction(tx, STORE, baseSale(), undefined, { enforceStock: true })
      throw new Error("deveria ter lançado")
    } catch (e) {
      expect(e).toBeInstanceOf(InsufficientStockError)
      const err = e as InsufficientStockError
      expect(err.code).toBe("ESTOQUE_INSUFICIENTE")
      expect(err.produtoNome).toBe("Caneca")
      expect(err.disponivel).toBe(2)
      expect(err.solicitado).toBe(3)
    }
  })

  it("enforceStock: oversell agregado de 2 linhas do mesmo produto é bloqueado (2+2 > 3)", async () => {
    const { tx, byId } = makeFakeTx([produto({ stock: 3 })])
    const sale = baseSale({
      lines: [
        { inventoryId: "prod-1", name: "Produto", quantity: 2, unitPrice: 10 },
        { inventoryId: "prod-1", name: "Produto", quantity: 2, unitPrice: 10 },
      ],
    })
    await expect(
      upsertVendaInTransaction(tx, STORE, sale, undefined, { enforceStock: true }),
    ).rejects.toBeInstanceOf(InsufficientStockError)
    expect(byId.get("prod-1")!.stock).toBe(3)
  })

  it("enforceStock: re-sync idempotente não falha mesmo com saldo baixo (movimentação já existe)", async () => {
    const { tx, byId, ledger } = makeFakeTx([produto({ stock: 2 })], { movimentacaoJaExiste: true })
    await upsertVendaInTransaction(tx, STORE, baseSale(), undefined, { enforceStock: true })
    // Baixa já aplicada anteriormente — o guard de idempotência pula sem mexer no saldo.
    expect(byId.get("prod-1")!.stock).toBe(2)
    expect(ledger).toHaveLength(0)
  })

  it("default (replay legado, sem enforceStock): preserva o comportamento histórico (2 → vende 3 → -1)", async () => {
    const { tx, byId, ledger } = makeFakeTx([produto({ stock: 2 })])
    await upsertVendaInTransaction(tx, STORE, baseSale())
    expect(byId.get("prod-1")!.stock).toBe(-1)
    expect(ledger).toHaveLength(1)
    expect(ledger[0]!.estoqueDepois).toBe(-1)
  })
})
