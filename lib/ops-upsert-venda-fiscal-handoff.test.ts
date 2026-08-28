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
    // Crédito/Vale é fail-closed (PDV-TROCAS-VALE-HARDENING-002): o fake fornece
    // um crédito ativo com saldo amplo para os testes que usam creditoVale.
    clienteCredito: {
      findMany: async () => [
        { id: "cred-1", saldoAtual: 10_000, status: "ativo", createdAt: 0 },
      ],
      updateMany: async ({ where }: any) => {
        if (where.id !== "cred-1") return { count: 0 }
        if (where.saldoAtual?.gte !== undefined && 10_000 < where.saldoAtual.gte) return { count: 0 }
        return { count: 1 }
      },
      findUnique: async () => ({ id: "cred-1", saldoAtual: 9_999, status: "ativo" }),
      update: async () => ({}),
    },
    usoCreditoCliente: {
      create: async ({ data }: any) => data,
    },
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
    // Titular obrigatório: crédito/vale é fail-closed (PDV-TROCAS-VALE-HARDENING-002).
    customerCpf: "12345678900",
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
    expect(linhas.every((l) => (l as { tpIntegra?: string }).tpIntegra === "2")).toBe(true)
    expect(financeiro[0]!.valor).toBe(100)
  })

  it("carne / aPrazo ficam bloqueados; creditoVale novo deriva tPag 21; financeiro permanece o de sempre", async () => {
    const { tx, financeiro, titulos, vendas } = makeFakeTx()
    await upsertVendaInTransaction(
      tx,
      STORE,
      avulsoSale({
        total: 90,
        paymentBreakdown: { carne: 10, aPrazo: 50, creditoVale: 30 },
      }),
    )
    const linhas = (vendas[0]!.payload.fiscalPaymentHandoff as { linhas: Array<{ formaOrigem: string; tPag?: string; capability: string }> }).linhas
    expect(linhas.find((l) => l.formaOrigem === "carne")).toMatchObject({ capability: "blocked" })
    expect(linhas.find((l) => l.formaOrigem === "aPrazo")).toMatchObject({ capability: "blocked" })
    expect(linhas.find((l) => l.formaOrigem === "creditoVale")).toMatchObject({
      tPag: "21",
      capability: "supported",
    })
    expect(linhas.find((l) => l.formaOrigem === "carne")?.tPag).toBeUndefined()
    expect(linhas.find((l) => l.formaOrigem === "aPrazo")?.tPag).toBeUndefined()
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

  it("cliente não persiste tpIntegra=1, CNPJ, tBand, cAut nem card arbitrário — servidor reconstrói 2", async () => {
    const { tx, vendas, financeiro } = makeFakeTx()
    await upsertVendaInTransaction(
      tx,
      STORE,
      avulsoSale({
        paymentBreakdown: { cartaoCredito: 50 },
        tpIntegra: "1",
        tBand: "01",
        cAut: "FAKE",
        CNPJ: "11222333000181",
        CNPJReceb: "11222333000181",
        idTermPag: "TERM-1",
        NSU: "999",
        card: { tpIntegra: "1", CNPJ: "11222333000181", tBand: "02", cAut: "XYZ" },
        fiscalPaymentHandoff: {
          version: 1,
          catalogoTPag: "IT-2024.002-v1.11",
          linhas: [
            {
              formaOrigem: "cartaoCredito",
              valor: 50,
              tPag: "03",
              tpIntegra: "1",
              CNPJ: "11222333000181",
              tBand: "01",
              cAut: "FAKE",
              capability: "supported",
              status: "ok",
            },
          ],
        },
      } as unknown as SalePayload),
    )
    const payload = vendas[0]!.payload as Record<string, unknown>
    expect(payload.tpIntegra).toBeUndefined()
    expect(payload.tBand).toBeUndefined()
    expect(payload.cAut).toBeUndefined()
    expect(payload.CNPJ).toBeUndefined()
    expect(payload.CNPJReceb).toBeUndefined()
    expect(payload.idTermPag).toBeUndefined()
    expect(payload.card).toBeUndefined()
    expect(payload.NSU).toBeUndefined()
    const linhas = (payload.fiscalPaymentHandoff as { linhas: Array<Record<string, unknown>> }).linhas
    expect(linhas[0]).toEqual({
      formaOrigem: "cartaoCredito",
      valor: 50,
      tPag: "03",
      tpIntegra: "2",
      capability: "supported",
      status: "ok",
    })
    expect(JSON.stringify(payload.fiscalPaymentHandoff)).not.toMatch(/tBand|cAut|CNPJ|"tpIntegra":"1"|NSU/)
    expect(financeiro).toHaveLength(1)
    expect(financeiro[0]!.valor).toBe(50)
  })

  it("PIX com pixQrKind estático persiste tPag 20 e ignora tPag do cliente", async () => {
    const { tx, vendas, financeiro } = makeFakeTx()
    await upsertVendaInTransaction(
      tx,
      STORE,
      avulsoSale({
        paymentBreakdown: { pix: 50 },
        pixQrKind: "estatico",
        tPag: "17",
        fiscalPaymentHandoff: {
          version: 1,
          catalogoTPag: "IT-2024.002-v1.11",
          linhas: [{ formaOrigem: "pix", valor: 50, tPag: "17", capability: "supported", status: "ok" }],
        },
      } as SalePayload & { tPag?: string }),
    )
    const payload = vendas[0]!.payload
    expect(payload.tPag).toBeUndefined()
    const linhas = (payload.fiscalPaymentHandoff as { linhas: Array<Record<string, unknown>> }).linhas
    expect(linhas[0]).toMatchObject({
      formaOrigem: "pix",
      valor: 50,
      pixQrKind: "estatico",
      tPag: "20",
      capability: "supported",
      status: "ok",
    })
    expect(payload.pixQrKind).toBe("estatico")
    expect(linhas[0]!.tpIntegra).toBeUndefined()
    expect(financeiro).toHaveLength(1)
    expect(financeiro[0]!.valor).toBe(50)
  })

  it("PIX dinâmico persiste tPag 17 + tpIntegra 2 e ignora YA04 do cliente", async () => {
    const { tx, vendas, financeiro } = makeFakeTx()
    await upsertVendaInTransaction(
      tx,
      STORE,
      avulsoSale({
        paymentBreakdown: { pix: 50 },
        pixQrKind: "dinamico",
        tpIntegra: "1",
        card: { tpIntegra: "1", cAut: "E2EIDFAKE" },
      } as SalePayload & { tpIntegra?: string; card?: unknown }),
    )
    const payload = vendas[0]!.payload
    expect(payload.tpIntegra).toBeUndefined()
    expect(payload.card).toBeUndefined()
    const linhasPix = (payload.fiscalPaymentHandoff as { linhas: Array<Record<string, unknown>> }).linhas
    expect(linhasPix[0]).toEqual({
      formaOrigem: "pix",
      valor: 50,
      pixQrKind: "dinamico",
      tPag: "17",
      tpIntegra: "2",
      capability: "supported",
      status: "ok",
    })
    expect(JSON.stringify(payload.fiscalPaymentHandoff)).not.toMatch(/E2EIDFAKE|"tpIntegra":"1"/)
    expect(financeiro).toHaveLength(1)
  })

  it("PIX com pixQrKind inválido bloqueia fiscal e a venda comercial ainda persiste", async () => {
    const { tx, vendas, financeiro } = makeFakeTx()
    await upsertVendaInTransaction(
      tx,
      STORE,
      avulsoSale({ paymentBreakdown: { pix: 50 }, pixQrKind: "qr-inventado" }),
    )
    const linhas = (vendas[0]!.payload.fiscalPaymentHandoff as { linhas: Array<{ tPag?: string; motivo?: string }> }).linhas
    expect(linhas[0]!.tPag).toBeUndefined()
    expect(linhas[0]!.motivo).toBe("pix_qr_kind_desconhecido")
    expect(financeiro).toHaveLength(1)
  })

  it("PIX dinâmico persiste tPag 17 + tpIntegra 2 e ignora YA04 do cliente", async () => {
    const { tx, vendas, financeiro } = makeFakeTx()
    await upsertVendaInTransaction(
      tx,
      STORE,
      avulsoSale({
        paymentBreakdown: { pix: 50 },
        pixQrKind: "dinamico",
        tpIntegra: "1",
        card: { tpIntegra: "1", cAut: "E2EIDFAKE" },
      } as SalePayload & { tpIntegra?: string; card?: unknown }),
    )
    const payload = vendas[0]!.payload
    expect(payload.tpIntegra).toBeUndefined()
    expect(payload.card).toBeUndefined()
    const linhas = (payload.fiscalPaymentHandoff as { linhas: Array<Record<string, unknown>> }).linhas
    expect(linhas[0]).toEqual({
      formaOrigem: "pix",
      valor: 50,
      pixQrKind: "dinamico",
      tPag: "17",
      tpIntegra: "2",
      capability: "supported",
      status: "ok",
    })
    expect(JSON.stringify(payload.fiscalPaymentHandoff)).not.toMatch(/E2EIDFAKE|"tpIntegra":"1"/)
    expect(financeiro).toHaveLength(1)
  })

  it("split PIX + dinheiro com pixQrKind dinâmico", async () => {
    const { tx, vendas } = makeFakeTx()
    await upsertVendaInTransaction(
      tx,
      STORE,
      avulsoSale({ total: 100, paymentBreakdown: { pix: 40, dinheiro: 60 }, pixQrKind: "dinamico" }),
    )
    const linhas = (vendas[0]!.payload.fiscalPaymentHandoff as { linhas: Array<{ formaOrigem: string; tPag?: string; tpIntegra?: string }> }).linhas
    expect(linhas.find((l) => l.formaOrigem === "pix")).toMatchObject({ tPag: "17", tpIntegra: "2" })
    expect(linhas.find((l) => l.formaOrigem === "dinheiro")).toMatchObject({ tPag: "01" })
    expect(linhas.find((l) => l.formaOrigem === "dinheiro")?.tpIntegra).toBeUndefined()
  })

  it("split PIX + cartão com pixQrKind automático", async () => {
    const { tx, vendas } = makeFakeTx()
    await upsertVendaInTransaction(
      tx,
      STORE,
      avulsoSale({ total: 90, paymentBreakdown: { pix: 30, cartaoDebito: 60 }, pixQrKind: "automatico" }),
    )
    const linhas = (vendas[0]!.payload.fiscalPaymentHandoff as {
      linhas: Array<{ formaOrigem: string; tPag?: string; tpIntegra?: string }>
    }).linhas
    expect(linhas.find((l) => l.formaOrigem === "pix")?.tPag).toBe("23")
    expect(linhas.find((l) => l.formaOrigem === "pix")?.tpIntegra).toBeUndefined()
    expect(linhas.find((l) => l.formaOrigem === "cartaoDebito")?.tPag).toBe("04")
  })

  it("creditoVale 100% persiste tPag 21 e não movimenta caixa", async () => {
    const { tx, vendas, financeiro } = makeFakeTx()
    await upsertVendaInTransaction(tx, STORE, avulsoSale({ paymentBreakdown: { creditoVale: 50 } }))
    const linhas = (vendas[0]!.payload.fiscalPaymentHandoff as { linhas: Array<{ tPag?: string; formaOrigem: string }> }).linhas
    expect(linhas).toEqual([
      { formaOrigem: "creditoVale", valor: 50, tPag: "21", capability: "supported", status: "ok" },
    ])
    expect(financeiro).toHaveLength(0)
  })

  it("cliente não injeta tPag 19 em creditoVale — servidor deriva 21", async () => {
    const { tx, vendas, financeiro } = makeFakeTx()
    await upsertVendaInTransaction(
      tx,
      STORE,
      avulsoSale({
        paymentBreakdown: { creditoVale: 50 },
        tPag: "19",
        fiscalPaymentHandoff: {
          version: 1,
          catalogoTPag: "IT-2024.002-v1.11",
          linhas: [{ formaOrigem: "creditoVale", valor: 50, tPag: "19", capability: "supported", status: "ok" }],
        },
      } as SalePayload & { tPag?: string }),
    )
    const payload = vendas[0]!.payload
    expect(payload.tPag).toBeUndefined()
    const linhas = (payload.fiscalPaymentHandoff as { linhas: Array<Record<string, unknown>> }).linhas
    expect(linhas[0]).toMatchObject({ formaOrigem: "creditoVale", tPag: "21", capability: "supported" })
    expect(financeiro).toHaveLength(0)
  })

  it("split creditoVale + dinheiro: 21+01; caixa só o dinheiro", async () => {
    const { tx, vendas, financeiro } = makeFakeTx()
    await upsertVendaInTransaction(
      tx,
      STORE,
      avulsoSale({ total: 100, paymentBreakdown: { dinheiro: 60, creditoVale: 40 } }),
    )
    const linhas = (vendas[0]!.payload.fiscalPaymentHandoff as { linhas: Array<{ formaOrigem: string; tPag?: string }> }).linhas
    expect(linhas.find((l) => l.formaOrigem === "dinheiro")?.tPag).toBe("01")
    expect(linhas.find((l) => l.formaOrigem === "creditoVale")?.tPag).toBe("21")
    expect(financeiro).toHaveLength(1)
    expect(financeiro[0]!.valor).toBe(60)
  })

  it("split creditoVale + PIX com pixQrKind: 21+20", async () => {
    const { tx, vendas } = makeFakeTx()
    await upsertVendaInTransaction(
      tx,
      STORE,
      avulsoSale({ total: 100, paymentBreakdown: { pix: 30, creditoVale: 70 }, pixQrKind: "estatico" }),
    )
    const linhas = (vendas[0]!.payload.fiscalPaymentHandoff as { linhas: Array<{ formaOrigem: string; tPag?: string }> }).linhas
    expect(linhas.find((l) => l.formaOrigem === "pix")?.tPag).toBe("20")
    expect(linhas.find((l) => l.formaOrigem === "creditoVale")?.tPag).toBe("21")
  })

  it("split creditoVale + cartão: 21+03", async () => {
    const { tx, vendas } = makeFakeTx()
    await upsertVendaInTransaction(
      tx,
      STORE,
      avulsoSale({ total: 80, paymentBreakdown: { cartaoCredito: 50, creditoVale: 30 } }),
    )
    const linhas = (vendas[0]!.payload.fiscalPaymentHandoff as { linhas: Array<{ formaOrigem: string; tPag?: string }> }).linhas
    expect(linhas.find((l) => l.formaOrigem === "cartaoCredito")?.tPag).toBe("03")
    expect(linhas.find((l) => l.formaOrigem === "creditoVale")?.tPag).toBe("21")
  })

  it("aPrazo sem discriminador permanece bloqueado e a venda comercial conclui", async () => {
    const { tx, vendas, titulos, financeiro } = makeFakeTx()
    await upsertVendaInTransaction(
      tx,
      STORE,
      avulsoSale({ total: 50, paymentBreakdown: { aPrazo: 50 } }),
    )
    const linhas = (vendas[0]!.payload.fiscalPaymentHandoff as { linhas: Array<{ tPag?: string; motivo?: string }> }).linhas
    expect(linhas[0]!.tPag).toBeUndefined()
    expect(linhas[0]!.motivo).toBe("aprazo_tpag_ambiguo")
    expect(titulos).toHaveLength(1)
    expect(financeiro).toHaveLength(0)
  })

  it("não persiste vTroco (cliente não é autoridade); cashTendered válido vira evidência", async () => {
    const { tx, vendas, financeiro } = makeFakeTx()
    await upsertVendaInTransaction(
      tx,
      STORE,
      avulsoSale({ total: 100, paymentBreakdown: { dinheiro: 60, pix: 40 }, cashTendered: 70, pixQrKind: "estatico" }),
    )
    const payload = vendas[0]!.payload as {
      cashTendered?: number
      fiscalPaymentHandoff: { cashTendered?: number; linhas: Array<{ formaOrigem: string; valor: number }> }
    }
    expect(payload.cashTendered).toBe(70)
    expect(payload.fiscalPaymentHandoff.cashTendered).toBe(70)
    expect(payload.fiscalPaymentHandoff.linhas.find((l) => l.formaOrigem === "dinheiro")?.valor).toBe(60)
    expect(JSON.stringify(payload.fiscalPaymentHandoff)).not.toMatch(/vTroco|valorEntregue/)
    expect(financeiro).toHaveLength(1)
    expect(financeiro[0]!.valor).toBe(100)
  })

  it("cashTendered ausente: venda fecha, handoff sem evidência, Caixa = total", async () => {
    const { tx, vendas, financeiro } = makeFakeTx()
    await upsertVendaInTransaction(tx, STORE, avulsoSale({ paymentBreakdown: { dinheiro: 50 } }))
    const handoff = vendas[0]!.payload.fiscalPaymentHandoff as { cashTendered?: number }
    expect(handoff.cashTendered).toBeUndefined()
    expect(vendas[0]!.payload.cashTendered).toBeUndefined()
    expect(JSON.stringify(vendas[0]!.payload.fiscalPaymentHandoff)).not.toMatch(/vTroco|valorEntregue/)
    expect(financeiro[0]!.valor).toBe(50)
  })

  it("cashTendered inválido ou menor que o aplicado não vira evidência; venda comercial persiste", async () => {
    const { tx: tx1, vendas: v1, financeiro: f1 } = makeFakeTx()
    await upsertVendaInTransaction(tx1, STORE, avulsoSale({ paymentBreakdown: { dinheiro: 50 }, cashTendered: -1 }))
    expect(v1[0]!.payload.cashTendered).toBeUndefined()
    expect((v1[0]!.payload.fiscalPaymentHandoff as { cashTendered?: number }).cashTendered).toBeUndefined()
    expect(f1[0]!.valor).toBe(50)

    const { tx: tx2, vendas: v2, financeiro: f2 } = makeFakeTx()
    await upsertVendaInTransaction(tx2, STORE, avulsoSale({ paymentBreakdown: { dinheiro: 50 }, cashTendered: 10 }))
    expect(v2[0]!.payload.cashTendered).toBeUndefined()
    expect((v2[0]!.payload.fiscalPaymentHandoff as { cashTendered?: number }).cashTendered).toBeUndefined()
    expect(f2[0]!.valor).toBe(50)
  })

  it("vTroco enviado pelo cliente é ignorado", async () => {
    const { tx, vendas } = makeFakeTx()
    await upsertVendaInTransaction(
      tx,
      STORE,
      avulsoSale({ paymentBreakdown: { dinheiro: 50 }, cashTendered: 70, vTroco: 99 } as SalePayload & { vTroco: number }),
    )
    expect(JSON.stringify(vendas[0]!.payload.fiscalPaymentHandoff)).not.toMatch(/vTroco/)
    expect((vendas[0]!.payload.fiscalPaymentHandoff as { cashTendered?: number }).cashTendered).toBe(70)
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

  it("PaymentModal captura pixQrKind em linguagem operacional, sem oferecer tPag nua nem picker de carnê/aPrazo/vale", () => {
    const src = readFileSync(resolve(process.cwd(), "components/dashboard/vendas/payment-modal.tsx"), "utf8")
    expect(src).toContain("PixQrKindPicker")
    expect(src).toContain("pixQrKind")
    expect(src).toContain("PIX_QR_KIND_OPCOES_OPERADOR")
    expect(src).not.toMatch(/tPag:\s*"17"|tPag:\s*"20"|tPag:\s*"23"|tPag:\s*"05"|tPag:\s*"15"|tPag:\s*"19"|tPag:\s*"21"|tPag:\s*"91"/)
    expect(src).not.toContain("buildFiscalPaymentHandoff")
    expect(src).not.toContain("deferredPaymentKind")
    expect(src).not.toContain("creditKind")
    expect(src).not.toContain("tpIntegra")
    expect(src).not.toContain("tBand")
    expect(src).not.toContain("cAut")
  })

  it("finalizeSaleTransaction propaga pixQrKind e cashTendered e não deriva tPag/vTroco no cliente", () => {
    const src = readFileSync(resolve(process.cwd(), "lib/operations-store.tsx"), "utf8")
    expect(src).toContain("pixQrKind")
    expect(src).toContain("cashTendered")
    expect(src).not.toContain("buildFiscalPaymentHandoff")
    expect(src).not.toContain("fiscalPaymentHandoff")
    expect(src).not.toMatch(/tPagFromPixQrKind|tPag:\s*"17"/)
    expect(src).not.toMatch(/vTroco\s*:/)
  })

  it("PDVs que usam PaymentModal encaminham cashTendered ao finalizer", () => {
    const pdvs = [
      "components/dashboard/vendas/pdv-classic.tsx",
      "components/dashboard/vendas/pdv-supermercado.tsx",
      "components/dashboard/vendas/pdv-assistencia-enterprise.tsx",
      "components/dashboard/vendas/pdv-venda-completa-enterprise.tsx",
      "components/dashboard/vendas/venda-completa-enterprise.tsx",
      "components/pdv-next/PdvBlackEdition.tsx",
    ]
    for (const rel of pdvs) {
      const src = readFileSync(resolve(process.cwd(), rel), "utf8")
      expect(src, rel).toContain("cashTendered: meta?.cashTendered")
      expect(src, rel).not.toContain("buildFiscalPaymentHandoff")
      expect(src, rel).not.toMatch(/vTroco\s*:/)
    }
    const modal = readFileSync(resolve(process.cwd(), "components/dashboard/vendas/payment-modal.tsx"), "utf8")
    expect(modal).toContain("sumCashTendered(payments)")
    expect(modal).toContain("normalizePaymentsToMatchTotal(payments, total)")
    expect(modal.indexOf("sumCashTendered(payments)")).toBeLessThan(modal.indexOf("normalizePaymentsToMatchTotal(payments, total)"))
  })
})
