/**
 * GOAL 075 — o motor central persiste `fiscalPaymentHandoff` na Venda.
 *
 * Cobre upsertVendaInTransaction (produtor único de todos os PDVs ativos) e
 * regressão: caixa/financeiro/estoque inalterados; cliente não injeta o contrato.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { upsertVendaInTransaction, type SalePayload } from "./ops-upsert-venda"
import { FISCAL_PAYMENT_HANDOFF_VERSION } from "./vendas/fiscal-payment-handoff"

const STORE = "loja-1"

type TituloCriado = { storeId: string; localKey: string; valor: number; descricao: string; payload: unknown }

function makeFakeTx() {
  const financeiro: Array<Record<string, any>> = []
  const titulos: TituloCriado[] = []
  const vendas: Array<{ payload: Record<string, unknown> }> = []
  let vendaCounter = 0

  const tx: any = {
    cliente: { findFirst: async () => null },
    venda: {
      findUnique: async () => null,
      create: async ({ data }: any) => {
        vendas.push({ payload: data.payload })
        return {
          id: `venda-${++vendaCounter}`,
          ...data,
          terminalId: data.terminalId ?? null,
          status: "concluida",
        }
      },
      update: async () => ({}),
    },
    itemVenda: { deleteMany: async () => ({ count: 0 }), create: async () => ({}) },
    produto: {
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

  return { tx, financeiro, titulos, vendas }
}

function avulsoSale(over: Partial<SalePayload> = {}): SalePayload {
  return {
    id: "PED-HANDOFF-1",
    total: 50,
    customerName: "Cliente Teste",
    lines: [{ inventoryId: "__avulso__1", name: "Item", quantity: 1, unitPrice: 50, isAvulso: true }],
    ...over,
  }
}

describe("upsertVendaInTransaction · fiscalPaymentHandoff persistido", () => {
  it("dinheiro: handoff versionado com tPag 01 no payload da Venda", async () => {
    const { tx, financeiro, vendas } = makeFakeTx()
    await upsertVendaInTransaction(tx, STORE, avulsoSale({ paymentBreakdown: { dinheiro: 50 } }))
    const handoff = vendas[0]!.payload.fiscalPaymentHandoff as { version: number; linhas: Array<{ tPag?: string }> }
    expect(handoff.version).toBe(FISCAL_PAYMENT_HANDOFF_VERSION)
    expect(handoff.linhas).toEqual([
      { formaOrigem: "dinheiro", valor: 50, tPag: "01", capability: "supported", status: "ok" },
    ])
    expect(financeiro).toHaveLength(1)
    expect(financeiro[0]!.valor).toBe(50)
  })

  it("PIX: persiste a forma e não inventa tPag 17/20/23", async () => {
    const { tx, vendas } = makeFakeTx()
    await upsertVendaInTransaction(tx, STORE, avulsoSale({ paymentBreakdown: { pix: 50 } }))
    const linhas = (vendas[0]!.payload.fiscalPaymentHandoff as { linhas: Array<{ tPag?: string; capability: string }> }).linhas
    expect(linhas).toHaveLength(1)
    expect(linhas[0]!.tPag).toBeUndefined()
    expect(linhas[0]!.capability).toBe("blocked")
  })

  it("split débito + crédito", async () => {
    const { tx, vendas, financeiro } = makeFakeTx()
    await upsertVendaInTransaction(
      tx,
      STORE,
      avulsoSale({ total: 100, paymentBreakdown: { cartaoDebito: 40, cartaoCredito: 60 } }),
    )
    const linhas = (vendas[0]!.payload.fiscalPaymentHandoff as { linhas: Array<{ formaOrigem: string; tPag?: string }> }).linhas
    expect(linhas.map((l) => l.tPag).sort()).toEqual(["03", "04"])
    expect(financeiro[0]!.valor).toBe(100)
  })

  it("carne / aPrazo / creditoVale ficam bloqueados no handoff e o financeiro permanece o de sempre", async () => {
    const { tx, financeiro, titulos, vendas } = makeFakeTx()
    await upsertVendaInTransaction(
      tx,
      STORE,
      avulsoSale({
        total: 90,
        paymentBreakdown: { carne: 10, aPrazo: 50, creditoVale: 30 },
      }),
    )
    const linhas = (vendas[0]!.payload.fiscalPaymentHandoff as { linhas: Array<{ formaOrigem: string; tPag?: string }> }).linhas
    expect(linhas.every((l) => l.tPag === undefined)).toBe(true)
    expect(linhas.map((l) => l.formaOrigem).sort()).toEqual(["aPrazo", "carne", "creditoVale"])
    // aPrazo continua gerando título; creditoVale não entra no caixa; carne entra no imediato.
    expect(titulos).toHaveLength(1)
    expect(titulos[0]!.valor).toBe(50)
    expect(financeiro).toHaveLength(1)
    expect(financeiro[0]!.valor).toBe(10)
  })

  it("cliente não consegue injetar tPag fabricado", async () => {
    const { tx, vendas } = makeFakeTx()
    await upsertVendaInTransaction(
      tx,
      STORE,
      avulsoSale({
        paymentBreakdown: { pix: 50 },
        fiscalPaymentHandoff: {
          version: 1,
          catalogoTPag: "IT-2024.002-v1.11",
          linhas: [{ formaOrigem: "pix", valor: 50, tPag: "17", capability: "supported", status: "ok" }],
        },
      }),
    )
    const linhas = (vendas[0]!.payload.fiscalPaymentHandoff as { linhas: Array<{ tPag?: string }> }).linhas
    expect(linhas[0]!.tPag).toBeUndefined()
  })

  it("não persiste vTroco", async () => {
    const { tx, vendas } = makeFakeTx()
    await upsertVendaInTransaction(tx, STORE, avulsoSale({ paymentBreakdown: { dinheiro: 50 } }))
    expect(JSON.stringify(vendas[0]!.payload.fiscalPaymentHandoff)).not.toMatch(/vTroco|valorEntregue/)
  })
})

describe("PDVs ativos não produzem o handoff — só o motor central", () => {
  const pdvs = [
    "components/dashboard/vendas/pdv-classic.tsx",
    "components/dashboard/vendas/pdv-supermercado.tsx",
    "components/dashboard/vendas/pdv-assistencia-enterprise.tsx",
    "components/dashboard/vendas/pdv-venda-completa-enterprise.tsx",
    "components/dashboard/vendas/venda-completa-enterprise.tsx",
    "components/pdv-next/PdvBlackEdition.tsx",
    "lib/operations-store.tsx",
    "components/dashboard/vendas/payment-modal.tsx",
  ]

  it("nenhum PDV ativo / PaymentModal / finalizeSaleTransaction monta fiscalPaymentHandoff", () => {
    for (const rel of pdvs) {
      const src = readFileSync(resolve(process.cwd(), rel), "utf8")
      expect(src, rel).not.toContain("fiscalPaymentHandoff")
      expect(src, rel).not.toContain("buildFiscalPaymentHandoff")
    }
  })
})
