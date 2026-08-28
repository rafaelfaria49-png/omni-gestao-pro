/**
 * GOAL PDV-TROCAS-DEVOLUCOES-001 — débito de crédito/vale atômico e examples.
 *
 * Cobre o passo 5 (ClienteCredito/UsoCreditoCliente) do `upsertVendaInTransaction`
 * após o GOAL: o débito passou a ser ATÔMICO (`updateMany` condicional
 * `saldoAtual >= débito` + releitura), então duas vendas concorrentes nunca gastam
 * o mesmo saldo duas vezes.
 *
 * Fake TransactionClient em memória (mesmo padrão de ops-upsert-venda*.test.ts).
 * A simulação de corrida injeta a escrita concorrente ENTRE o `findMany`
 * (snapshot obsoleto) e o `updateMany` (que reavalia o predicado no vivo —
 * semântica READ COMMITTED do Postgres).
 */
import { describe, expect, it, vi, afterEach } from "vitest"
import { upsertVendaInTransaction, type SalePayload } from "./ops-upsert-venda"

const STORE = "loja-1"
const CPF = "12345678900"

type Credito = { id: string; saldoAtual: number; status: string; createdAt: number }

function makeFakeTx(opts?: {
  creditos?: Array<{ id: string; saldo: number }>
  /**
   * Simula transação concorrente que consome parte do crédito depois que o motor
   * leu o snapshot, mas antes do débito — exatamente a janela do double-spend.
   */
  drenaConcorrente?: { creditoId: string; valor: number }
}) {
  const financeiro: Array<Record<string, any>> = []
  const usosCredito: Array<Record<string, any>> = []
  const titulos: Array<Record<string, any>> = []
  const creditos: Credito[] = (opts?.creditos ?? []).map((c, i) => ({
    id: c.id,
    saldoAtual: c.saldo,
    status: "ativo",
    createdAt: i,
  }))
  let drena = opts?.drenaConcorrente
  let vendaCounter = 0

  const tx: any = {
    cliente: { findFirst: async () => null },
    venda: {
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
    clienteCredito: {
      findMany: async () => {
        const snapshot = creditos
          .filter((c) => c.status === "ativo" && c.saldoAtual > 0)
          .sort((a, b) => a.createdAt - b.createdAt)
          .map((c) => ({ ...c }))
        // A transação concorrente commita APÓS a leitura do motor — o snapshot
        // devolvido ficou obsoleto; o vivo só é visto pelo updateMany.
        if (drena) {
          const vivo = creditos.find((c) => c.id === drena!.creditoId)
          if (vivo) {
            vivo.saldoAtual = Math.round((vivo.saldoAtual - drena.valor) * 100) / 100
          }
          drena = undefined
        }
        return snapshot
      },
      updateMany: async ({ where, data }: any) => {
        const c = creditos.find((x) => x.id === where.id)
        if (!c) return { count: 0 }
        const gte = where.saldoAtual?.gte
        // Predicado reavaliado no valor VIVO — é isso que impede o double-spend.
        if (gte !== undefined && c.saldoAtual < gte) return { count: 0 }
        const dec = data.saldoAtual?.decrement
        if (typeof dec !== "number") return { count: 0 }
        c.saldoAtual = Math.round((c.saldoAtual - dec) * 100) / 100
        return { count: 1 }
      },
      findUnique: async ({ where }: any) => {
        const c = creditos.find((x) => x.id === where.id)
        return c ? { ...c } : null
      },
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

afterEach(() => {
  vi.restoreAllMocks()
})

describe("upsertVendaInTransaction — exemplos obrigatórios do vale (GOAL PDV-TROCAS-001)", () => {
  it("Vale R$40 + venda R$109,99 → crédito usado 40, restante 69,99 em dinheiro (misto)", async () => {
    const { tx, financeiro, usosCredito, creditos } = makeFakeTx({
      creditos: [{ id: "c1", saldo: 40 }],
    })
    await upsertVendaInTransaction(
      tx,
      STORE,
      avulsoSale({ total: 109.99, paymentBreakdown: { dinheiro: 69.99, creditoVale: 40 } }),
    )
    expect(usosCredito).toHaveLength(1)
    expect(usosCredito[0]!.valor).toBeCloseTo(40, 2)
    expect(usosCredito[0]!.saldoAntes).toBeCloseTo(40, 2)
    expect(usosCredito[0]!.saldoDepois).toBeCloseTo(0, 2)
    expect(creditos[0]!.saldoAtual).toBeCloseTo(0, 2)
    // Vale não é dinheiro novo: caixa recebe SÓ o restante (109,99 − 40).
    expect(financeiro).toHaveLength(1)
    expect(financeiro[0]!.valor).toBeCloseTo(69.99, 2)
  })

  it("Vale R$40 + venda R$30 → crédito usado 30, saldo residual 10 do próprio vale", async () => {
    const { tx, financeiro, usosCredito, creditos } = makeFakeTx({
      creditos: [{ id: "c1", saldo: 40 }],
    })
    await upsertVendaInTransaction(
      tx,
      STORE,
      avulsoSale({ total: 30, paymentBreakdown: { creditoVale: 30 } }),
    )
    expect(usosCredito).toHaveLength(1)
    expect(usosCredito[0]!.valor).toBeCloseTo(30, 2)
    expect(usosCredito[0]!.saldoDepois).toBeCloseTo(10, 2)
    expect(creditos[0]!.saldoAtual).toBeCloseTo(10, 2)
    expect(creditos[0]!.status).toBe("ativo") // saldo residual mantém o vale vivo
    expect(financeiro).toHaveLength(0) // venda 100% vale não movimenta a gaveta
  })

  it("Vale R$40 + venda R$40 → venda concluída só com vale, saldo R$0, status zerado", async () => {
    const { tx, financeiro, usosCredito, creditos } = makeFakeTx({
      creditos: [{ id: "c1", saldo: 40 }],
    })
    await upsertVendaInTransaction(
      tx,
      STORE,
      avulsoSale({ total: 40, paymentBreakdown: { creditoVale: 40 } }),
    )
    expect(usosCredito).toHaveLength(1)
    expect(usosCredito[0]!.valor).toBeCloseTo(40, 2)
    expect(creditos[0]!.saldoAtual).toBeCloseTo(0, 2)
    expect(creditos[0]!.status).toBe("zerado")
    expect(financeiro).toHaveLength(0)
  })
})

describe("upsertVendaInTransaction — concorrência e esgotamento do vale", () => {
  it("double-spend: débito concorrente entre leitura e escrita NÃO gasta saldo inexistente", async () => {
    const spyWarn = vi.spyOn(console, "warn").mockImplementation(() => {})
    // Snapshot lido pelo motor: 30. A transação concorrente consome os 30
    // ANTES do updateMany do motor → o predicado `saldoAtual >= 30` falha no vivo.
    const { tx, usosCredito, creditos } = makeFakeTx({
      creditos: [{ id: "c1", saldo: 30 }],
      drenaConcorrente: { creditoId: "c1", valor: 30 },
    })
    await upsertVendaInTransaction(
      tx,
      STORE,
      avulsoSale({ total: 30, paymentBreakdown: { creditoVale: 30 } }),
    )
    // Nenhum UsoCredito foi criado — o mesmo saldo não foi gasto duas vezes.
    expect(usosCredito).toHaveLength(0)
    // O saldo vivo (0) não ficou negativo nem foi sobrescrito pelo snapshot.
    expect(creditos[0]!.saldoAtual).toBeCloseTo(0, 2)
    expect(spyWarn).toHaveBeenCalledWith(
      "[upsert-venda] credito-sub-debitado",
      expect.objectContaining({ pedidoId: "PED-1", restante: 30 }),
    )
  })

  it("double-spend parcial: concorrência drena 25 de 30 → motor debita só os 5 vivos restantes", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const { tx, usosCredito, creditos } = makeFakeTx({
      creditos: [{ id: "c1", saldo: 30 }],
      drenaConcorrente: { creditoId: "c1", valor: 25 },
    })
    // Débito tentado por iteração = min(snapshot 30, restante 30) = 30 → falha
    // no vivo (sobra 5). O próximo crédito não existe → sub-debitado 30, mas
    // o crédito vivo preservou os 5 para a segunda tentativa de venda.
    await upsertVendaInTransaction(
      tx,
      STORE,
      avulsoSale({ total: 30, paymentBreakdown: { creditoVale: 30 } }),
    )
    expect(usosCredito).toHaveLength(0)
    expect(creditos[0]!.saldoAtual).toBeCloseTo(5, 2)
  })

  it("vale esgotado (saldo 0) não é debitado e a venda não cria UsoCredito", async () => {
    const spyWarn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { tx, usosCredito, creditos } = makeFakeTx({
      creditos: [{ id: "c1", saldo: 0 }],
    })
    await upsertVendaInTransaction(
      tx,
      STORE,
      avulsoSale({ total: 20, paymentBreakdown: { creditoVale: 20 } }),
    )
    expect(usosCredito).toHaveLength(0)
    expect(creditos[0]!.saldoAtual).toBeCloseTo(0, 2)
    expect(spyWarn).toHaveBeenCalledWith(
      "[upsert-venda] credito-sub-debitado",
      expect.objectContaining({ creditoValeUsado: 20, restante: 20 }),
    )
  })

  it("FIFO: consumo atravessa créditos na ordem de criação (10 + 40 para venda de 30)", async () => {
    const { tx, usosCredito, creditos } = makeFakeTx({
      creditos: [
        { id: "antigo", saldo: 10 },
        { id: "novo", saldo: 40 },
      ],
    })
    await upsertVendaInTransaction(
      tx,
      STORE,
      avulsoSale({ total: 30, paymentBreakdown: { creditoVale: 30 } }),
    )
    expect(usosCredito).toHaveLength(2)
    expect(usosCredito[0]).toMatchObject({ creditoId: "antigo", valor: 10, saldoDepois: 0 })
    expect(usosCredito[1]).toMatchObject({ creditoId: "novo", valor: 20, saldoDepois: 20 })
    expect(creditos[0]!.status).toBe("zerado")
    expect(creditos[1]!.status).toBe("ativo")
    expect(creditos[1]!.saldoAtual).toBeCloseTo(20, 2)
  })

  it("attempt de exceder o saldo (vale 40, uso 50) debita só o que existe e alerta", async () => {
    const spyWarn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { tx, usosCredito, creditos } = makeFakeTx({
      creditos: [{ id: "c1", saldo: 40 }],
    })
    await upsertVendaInTransaction(
      tx,
      STORE,
      avulsoSale({ total: 50, paymentBreakdown: { dinheiro: 10, creditoVale: 50 } }),
    )
    expect(usosCredito).toHaveLength(1)
    expect(usosCredito[0]!.valor).toBeCloseTo(40, 2)
    expect(creditos[0]!.saldoAtual).toBeCloseTo(0, 2)
    expect(spyWarn).toHaveBeenCalledWith(
      "[upsert-venda] credito-sub-debitado",
      expect.objectContaining({ restante: 10 }),
    )
  })
})
