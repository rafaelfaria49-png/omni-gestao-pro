/**
 * GOAL_FATURAMENTO_VALE_ALINHAMENTO — tratamento de `creditoVale` no motor de venda.
 *
 * Cobre a §4 (MovimentacaoFinanceira) e §5 (ClienteCredito/UsoCreditoCliente) de
 * `upsertVendaInTransaction`. A REGRA OFICIAL ÚNICA é:
 *   entrada à vista no caixa = total − aPrazo − creditoVale  (= `valorAVistaVenda`)
 * O vale NÃO entra no caixa (abate ClienteCredito); o à prazo vira título.
 *
 * Antes do GOAL, o motor gravava `total − aPrazo` (incluía o vale) — divergindo da
 * correção. Estes testes travam a regra alinhada. Fake TransactionClient em memória
 * (mesmo padrão de ops-upsert-venda*.test.ts) — não toca o banco.
 */
import { describe, expect, it } from "vitest"
import { upsertVendaInTransaction, type SalePayload } from "./ops-upsert-venda"

const STORE = "loja-1"
const CPF = "12345678900"

type Credito = { id: string; saldoAtual: number; valorOriginal: number; status: string; createdAt: number }

/* eslint-disable @typescript-eslint/no-explicit-any */
function makeFakeTx(opts?: { creditos?: Array<{ id: string; saldo: number }>; movFinJaExiste?: boolean }) {
  const financeiro: Array<Record<string, any>> = []
  const usosCredito: Array<Record<string, any>> = []
  const titulos: Array<Record<string, any>> = []
  const creditos: Credito[] = (opts?.creditos ?? []).map((c, i) => ({
    id: c.id,
    saldoAtual: c.saldo,
    valorOriginal: c.saldo,
    status: "ativo",
    createdAt: i,
  }))
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
      // Itens avulsos (virtuais) → sem baixa de estoque, isola o fluxo financeiro/vale.
      findFirst: async () => null,
      findUnique: async () => null,
      update: async () => ({}),
      updateMany: async () => ({ count: 1 }),
    },
    movimentacaoEstoque: { findFirst: async () => null, create: async () => ({}) },
    movimentacaoFinanceira: {
      findFirst: async () => (opts?.movFinJaExiste ? { id: "mf-existente" } : null),
      create: async ({ data }: any) => {
        financeiro.push(data)
        return data
      },
    },
    clienteCredito: {
      findMany: async () =>
        creditos
          .filter((c) => c.status === "ativo" && c.saldoAtual > 0)
          .sort((a, b) => a.createdAt - b.createdAt),
      update: async ({ where, data }: any) => {
        const c = creditos.find((x) => x.id === where.id)
        if (c) Object.assign(c, data)
        return c ?? {}
      },
    },
    usoCreditoCliente: {
      create: async ({ data }: any) => {
        usosCredito.push(data)
        return data
      },
    },
    contaReceberTitulo: {
      upsert: async ({ where, create }: any) => {
        titulos.push(create)
        return { id: where.storeId_localKey.localKey }
      },
    },
  }

  return { tx, financeiro, usosCredito, titulos, creditos }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function avulsoSale(over: Partial<SalePayload> = {}): SalePayload {
  return {
    id: "PED-1",
    total: 100,
    customerName: "Cliente",
    customerCpf: CPF,
    lines: [{ inventoryId: "__avulso__1", name: "Item", quantity: 1, unitPrice: 100, isAvulso: true }],
    ...over,
  }
}

describe("upsertVendaInTransaction — creditoVale na entrada à vista", () => {
  it("dinheiro puro: caixa recebe o total, sem uso de crédito", async () => {
    const { tx, financeiro, usosCredito } = makeFakeTx()
    await upsertVendaInTransaction(tx, STORE, avulsoSale({ paymentBreakdown: { dinheiro: 100 } }))
    expect(financeiro).toHaveLength(1)
    expect(financeiro[0]!.valor).toBeCloseTo(100, 2)
    expect(usosCredito).toHaveLength(0)
  })

  it("vale puro: NADA entra no caixa (vale ≠ dinheiro novo) e o crédito é debitado", async () => {
    const { tx, financeiro, usosCredito, creditos } = makeFakeTx({ creditos: [{ id: "c1", saldo: 100 }] })
    await upsertVendaInTransaction(tx, STORE, avulsoSale({ paymentBreakdown: { creditoVale: 100 } }))
    expect(financeiro).toHaveLength(0) // valorAVista = 100 − 0 − 100 = 0
    expect(usosCredito).toHaveLength(1)
    expect(usosCredito[0]!.valor).toBeCloseTo(100, 2)
    expect(creditos[0]!.saldoAtual).toBeCloseTo(0, 2)
  })

  it("dinheiro + vale: caixa recebe SÓ o dinheiro; o vale debita crédito", async () => {
    const { tx, financeiro, usosCredito } = makeFakeTx({ creditos: [{ id: "c1", saldo: 100 }] })
    await upsertVendaInTransaction(tx, STORE, avulsoSale({ paymentBreakdown: { dinheiro: 60, creditoVale: 40 } }))
    expect(financeiro).toHaveLength(1)
    expect(financeiro[0]!.valor).toBeCloseTo(60, 2) // 100 − 0 − 40
    expect(usosCredito).toHaveLength(1)
    expect(usosCredito[0]!.valor).toBeCloseTo(40, 2)
  })

  it("múltiplo (dinheiro+pix+débito): caixa recebe o total à vista, sem vale", async () => {
    const { tx, financeiro } = makeFakeTx()
    await upsertVendaInTransaction(
      tx,
      STORE,
      avulsoSale({ paymentBreakdown: { dinheiro: 30, pix: 30, cartaoDebito: 40 } }),
    )
    expect(financeiro).toHaveLength(1)
    expect(financeiro[0]!.valor).toBeCloseTo(100, 2)
  })

  it("à prazo + vale + entrada: caixa = só a entrada; título = aPrazo; crédito debitado", async () => {
    const { tx, financeiro, usosCredito, titulos } = makeFakeTx({ creditos: [{ id: "c1", saldo: 100 }] })
    await upsertVendaInTransaction(
      tx,
      STORE,
      avulsoSale({ paymentBreakdown: { dinheiro: 20, aPrazo: 50, creditoVale: 30 } }),
    )
    expect(financeiro).toHaveLength(1)
    expect(financeiro[0]!.valor).toBeCloseTo(20, 2) // 100 − 50 − 30
    expect(titulos).toHaveLength(1)
    expect(titulos[0]!.valor).toBeCloseTo(50, 2)
    expect(usosCredito).toHaveLength(1)
    expect(usosCredito[0]!.valor).toBeCloseTo(30, 2)
  })

  it("idempotência: MovimentacaoFinanceira já existente não duplica a entrada", async () => {
    const { tx, financeiro } = makeFakeTx({ movFinJaExiste: true })
    await upsertVendaInTransaction(tx, STORE, avulsoSale({ paymentBreakdown: { dinheiro: 100 } }))
    expect(financeiro).toHaveLength(0) // guard de duplicidade pula a criação
  })
})
