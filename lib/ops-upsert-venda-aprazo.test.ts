/**
 * Venda a prazo + pagamento misto (GOAL_PDV_VENDA_PRAZO_ENTRADA).
 *
 * Cobre a §4 (MovimentacaoFinanceira) e §6 (ContaReceberTitulo) de
 * `upsertVendaInTransaction`, que é o motor compartilhado por todos os PDVs:
 *  - o valor recebido à vista (total − aPrazo) entra no caixa (MovimentacaoFinanceira);
 *  - o saldo à prazo NÃO entra no caixa — vira ContaReceberTitulo (1 por parcela);
 *  - aPrazo = 0 não cria nenhum título;
 *  - observação e parcelas fluem para o payload do título.
 *
 * Usa um TransactionClient fake em memória (mesmo padrão de ops-upsert-venda.test.ts) —
 * não toca o banco.
 */
import { describe, expect, it } from "vitest"
import { upsertVendaInTransaction, type SalePayload } from "./ops-upsert-venda"

const STORE = "loja-1"

type TituloCriado = { storeId: string; localKey: string; valor: number; descricao: string; payload: any }

/* eslint-disable @typescript-eslint/no-explicit-any */
function makeFakeTx() {
  const financeiro: Array<Record<string, any>> = []
  const titulos: TituloCriado[] = []
  let vendaCounter = 0

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
    itemVenda: { deleteMany: async () => ({ count: 0 }), create: async () => ({}) },
    produto: {
      // Produto vendido é "avulso" (inventoryId virtual) nos testes → sem baixa de estoque.
      findFirst: async () => null,
      findUnique: async () => null,
      update: async () => ({}),
      updateMany: async () => ({ count: 1 }),
    },
    movimentacaoEstoque: { findFirst: async () => null, create: async () => ({}) },
    movimentacaoFinanceira: {
      findFirst: async () => null,
      create: async ({ data }: any) => {
        financeiro.push(data)
        return data
      },
    },
    contaReceberTitulo: {
      upsert: async ({ where, create }: any) => {
        titulos.push({
          storeId: create.storeId,
          localKey: create.localKey,
          valor: create.valor,
          descricao: create.descricao,
          payload: create.payload,
        })
        return { id: where.storeId_localKey.localKey }
      },
    },
  }

  return { tx, financeiro, titulos }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Linha avulsa (virtual) não baixa estoque — isola o teste no fluxo financeiro/à prazo. */
function avulsoSale(over: Partial<SalePayload> = {}): SalePayload {
  return {
    id: "PED-1",
    total: 39.9,
    customerName: "Luiz Carlos",
    lines: [{ inventoryId: "__avulso__1", name: "Item", quantity: 1, unitPrice: 39.9, isAvulso: true }],
    ...over,
  }
}

describe("upsertVendaInTransaction — venda a prazo + misto", () => {
  it("misto: dinheiro 22 + à prazo 17,90 → caixa recebe 22 e Conta a Receber só 17,90", async () => {
    const { tx, financeiro, titulos } = makeFakeTx()
    await upsertVendaInTransaction(
      tx,
      STORE,
      avulsoSale({ paymentBreakdown: { dinheiro: 22, aPrazo: 17.9 } }),
    )

    // Caixa: somente o valor recebido à vista (total − aPrazo).
    expect(financeiro).toHaveLength(1)
    expect(financeiro[0]!.valor).toBeCloseTo(22, 2)

    // Conta a Receber: 1 título com o saldo a prazo (não o total).
    expect(titulos).toHaveLength(1)
    expect(titulos[0]!.valor).toBeCloseTo(17.9, 2)
    expect(titulos[0]!.localKey).toBe("pdv-aprazo-PED-1")
  })

  it("à prazo puro (sem entrada): nada entra no caixa e o título é o total", async () => {
    const { tx, financeiro, titulos } = makeFakeTx()
    await upsertVendaInTransaction(tx, STORE, avulsoSale({ paymentBreakdown: { aPrazo: 39.9 } }))

    expect(financeiro).toHaveLength(0) // saldo a prazo NÃO entra no caixa físico
    expect(titulos).toHaveLength(1)
    expect(titulos[0]!.valor).toBeCloseTo(39.9, 2)
  })

  it("aPrazo = 0 (venda à vista): nenhum título de Conta a Receber é criado", async () => {
    const { tx, financeiro, titulos } = makeFakeTx()
    await upsertVendaInTransaction(tx, STORE, avulsoSale({ paymentBreakdown: { dinheiro: 39.9 } }))

    expect(financeiro).toHaveLength(1)
    expect(financeiro[0]!.valor).toBeCloseTo(39.9, 2)
    expect(titulos).toHaveLength(0)
  })

  it("entrada + 3 parcelas: 1 entrada no caixa e 3 títulos somando o saldo, com observação", async () => {
    const { tx, financeiro, titulos } = makeFakeTx()
    await upsertVendaInTransaction(
      tx,
      STORE,
      avulsoSale({
        total: 100,
        paymentBreakdown: { dinheiro: 40, aPrazo: 60 },
        aPrazoConfig: { parcelas: 3, primeiroVencimento: "10/07/2026", intervalDias: 30, observacao: "combinado dia 10" },
      }),
    )

    expect(financeiro).toHaveLength(1)
    expect(financeiro[0]!.valor).toBeCloseTo(40, 2)

    expect(titulos).toHaveLength(3)
    const somaParcelas = titulos.reduce((s, t) => s + t.valor, 0)
    expect(somaParcelas).toBeCloseTo(60, 2)
    expect(titulos.map((t) => t.localKey)).toEqual([
      "pdv-aprazo-PED-1-1",
      "pdv-aprazo-PED-1-2",
      "pdv-aprazo-PED-1-3",
    ])
    // Observação espelhada no payload de cada título.
    expect(titulos.every((t) => t.payload.observacao === "combinado dia 10")).toBe(true)
  })
})
