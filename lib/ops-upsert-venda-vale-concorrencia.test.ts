/**
 * GOAL PDV-TROCAS-VALE-HARDENING-PRE-PUBLISH-002 — débito de crédito/vale FAIL-CLOSED.
 *
 * Contrato novo do passo 5 de `upsertVendaInTransaction`: venda que contabiliza
 * `creditoVale` sem saldo efetivamente debitado NUNCA conclui — lança
 * `CreditoValeInsuficienteError` (code CREDITO_VALE_INSUFICIENTE) e reverte a
 * transação inteira. Cobre:
 *  - double-spend END-TO-END: duas vendas tentam o mesmo saldo; somente uma
 *    conclui; a outra recebe conflito; nenhuma fica paga com crédito inexistente;
 *  - corrida real (escrita concorrente entre a leitura e o débito atômico);
 *  - vale inexistente/esgotado; exceder saldo; venda sem titular;
 *  - vendas SEM crédito/vale permanecem inalteradas;
 *  - exemplos 40/109,99 · 40/30 · 40/40 e FIFO seguem válidos.
 *
 * Fake TransactionClient em memória (mesmo padrão de ops-upsert-venda*.test.ts),
 * com `rollback()` simulando o revert do `prisma.$transaction` quando o motor lança.
 */
import { describe, expect, it, vi, afterEach } from "vitest"
import {
  upsertVendaInTransaction,
  CreditoValeInsuficienteError,
  type SalePayload,
} from "./ops-upsert-venda"

const STORE = "loja-1"
const CPF = "12345678900"

type Credito = { id: string; saldoAtual: number; status: string; createdAt: number }

function makeFakeTx(opts?: {
  creditos?: Array<{ id: string; saldo: number; status?: string }>
  /**
   * Simula transação concorrente que consome parte do crédito depois que o motor
   * leu o snapshot, mas antes do débito — exatamente a janela do double-spend.
   */
  drenaConcorrente?: { creditoId: string; valor: number }
}) {
  const financeiro: Array<Record<string, any>> = []
  const usosCredito: Array<Record<string, any>> = []
  const titulos: Array<Record<string, any>> = []
  const vendas: Array<Record<string, any>> = []
  const creditos: Credito[] = (opts?.creditos ?? []).map((c, i) => ({
    id: c.id,
    saldoAtual: c.saldo,
    status: c.status ?? "ativo",
    createdAt: i,
  }))
  const creditosInicial = creditos.map((c) => ({ ...c }))
  let drena = opts?.drenaConcorrente
  let vendaCounter = 0
  /** Último ponto consistente (antes de cada transação bem-sucedida do motor). */
  let marcado = {
    creditos: creditos.map((c) => ({ ...c })),
    financeiro: [] as Array<Record<string, any>>,
    usos: [] as Array<Record<string, any>>,
    titulos: [] as Array<Record<string, any>>,
    vendas: [] as Array<Record<string, any>>,
    vendaCounter: 0,
  }

  const tx: any = {
    cliente: { findFirst: async () => null },
    venda: {
      findUnique: async () => null,
      create: async ({ data }: any) => {
        const venda = {
          id: `venda-${++vendaCounter}`,
          ...data,
          terminalId: data.terminalId ?? null,
          status: "concluida",
        }
        vendas.push(venda)
        return venda
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
            // Transação externa COMMITADA: o efeito sobrevive ao rollback do motor.
            const base = creditosInicial.find((c) => c.id === vivo.id)
            if (base) base.saldoAtual = vivo.saldoAtual
            const marcadoC = marcado.creditos.find((c) => c.id === vivo.id)
            if (marcadoC) marcadoC.saldoAtual = vivo.saldoAtual
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
        const inc = data.saldoAtual?.increment
        if (typeof dec === "number") {
          c.saldoAtual = Math.round((c.saldoAtual - dec) * 100) / 100
        } else if (typeof inc === "number") {
          c.saldoAtual = Math.round((c.saldoAtual + inc) * 100) / 100
        } else {
          return { count: 0 }
        }
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

  return {
    tx,
    financeiro,
    usosCredito,
    titulos,
    vendas,
    creditos,
    /** Fixa o estado atual como ponto de revert (após transações bem-sucedidas). */
    marcar() {
      marcado = {
        creditos: creditos.map((c) => ({ ...c })),
        financeiro: financeiro.map((f) => ({ ...f })),
        usos: usosCredito.map((u) => ({ ...u })),
        titulos: titulos.map((t) => ({ ...t })),
        vendas: vendas.map((v) => ({ ...v })),
        vendaCounter,
      }
    },
    /** Simula o revert do `prisma.$transaction` após um throw do motor. */
    rollback() {
      creditos.splice(0, creditos.length, ...marcado.creditos.map((c) => ({ ...c })))
      financeiro.splice(0, financeiro.length, ...marcado.financeiro.map((f) => ({ ...f })))
      usosCredito.splice(0, usosCredito.length, ...marcado.usos.map((u) => ({ ...u })))
      titulos.splice(0, titulos.length, ...marcado.titulos.map((t) => ({ ...t })))
      vendas.splice(0, vendas.length, ...marcado.vendas.map((v) => ({ ...v })))
      vendaCounter = marcado.vendaCounter
    },
  }
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

  it("venda SEM crédito/vale não toca o gate e conclui normalmente (fail-closed não generaliza)", async () => {
    const { tx, financeiro, usosCredito, creditos } = makeFakeTx({
      creditos: [{ id: "c1", saldo: 0, status: "zerado" }],
    })
    await upsertVendaInTransaction(
      tx,
      STORE,
      avulsoSale({ total: 100, paymentBreakdown: { dinheiro: 100 } }),
    )
    expect(financeiro).toHaveLength(1)
    expect(usosCredito).toHaveLength(0)
    expect(creditos[0]!.saldoAtual).toBeCloseTo(0, 2)
  })
})

describe("upsertVendaInTransaction — crédito/vale FAIL-CLOSED (GOAL PDV-TROCAS-002)", () => {
  it("DOUBLE-SPEND END-TO-END: duas vendas tentam o mesmo saldo → 1ª conclui, 2ª recebe conflito, nenhuma paga com crédito inexistente", async () => {
    const db = makeFakeTx({ creditos: [{ id: "c1", saldo: 30 }] })

    // Venda A consome o saldo integralmente.
    await upsertVendaInTransaction(
      db.tx,
      STORE,
      avulsoSale({ id: "PED-A", total: 30, paymentBreakdown: { creditoVale: 30 } }),
    )
    expect(db.creditos[0]!.saldoAtual).toBeCloseTo(0, 2)
    expect(db.vendas).toHaveLength(1)
    db.marcar() // estado consistente pós-venda A vira o ponto de revert da venda B
    const financeiroAposA = db.financeiro.length
    const usosAposA = db.usosCredito.length

    // Venda B (outra transação/outro caixa) tenta consumir o saldo já zerado.
    const erro = await upsertVendaInTransaction(
      db.tx,
      STORE,
      avulsoSale({ id: "PED-B", total: 30, paymentBreakdown: { creditoVale: 30 } }),
    ).catch((e: unknown) => e)

    expect(erro).toBeInstanceOf(CreditoValeInsuficienteError)
    expect((erro as CreditoValeInsuficienteError).code).toBe("CREDITO_VALE_INSUFICIENTE")
    expect((erro as CreditoValeInsuficienteError).detail).toMatchObject({
      pedidoId: "PED-B",
      clienteDoc: CPF,
      solicitado: 30,
      faltante: 30,
    })
    // Nada da venda B foi gravado — ela NÃO fica paga com crédito inexistente.
    db.rollback() // prisma.$transaction reverteria tudo; o fake espelha o revert
    expect(db.vendas).toHaveLength(1) // só a venda A existe
    expect(db.creditos[0]!.saldoAtual).toBeCloseTo(0, 2) // sem saldo negativo
    expect(db.usosCredito).toHaveLength(usosAposA)
    expect(db.financeiro).toHaveLength(financeiroAposA)
  })

  it("corrida real: débito concorrente drena o saldo entre leitura e updateMany → venda rejeita e transação reverte", async () => {
    const spyWarn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const db = makeFakeTx({
      creditos: [{ id: "c1", saldo: 30 }],
      drenaConcorrente: { creditoId: "c1", valor: 30 },
    })
    const erro = await upsertVendaInTransaction(
      db.tx,
      STORE,
      avulsoSale({ total: 30, paymentBreakdown: { creditoVale: 30 } }),
    ).catch((e: unknown) => e)
    expect(erro).toBeInstanceOf(CreditoValeInsuficienteError)
    // Revert da transação: nenhum efeito da venda malsucedida permanece e o
    // saldo vivo (0, consumido pela concorrente) não fica negativo.
    db.rollback()
    expect(db.vendas).toHaveLength(0)
    expect(db.usosCredito).toHaveLength(0)
    expect(db.creditos[0]!.saldoAtual).toBeCloseTo(0, 2)
    expect(spyWarn).toHaveBeenCalledWith(
      "[upsert-venda] credito-saldo-concorrente",
      expect.objectContaining({ pedidoId: "PED-1" }),
    )
  })

  it("corrida parcial: concorrência drena 25 de 30 → conflito e rollback preservam os 5 vivos", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const db = makeFakeTx({
      creditos: [{ id: "c1", saldo: 30 }],
      drenaConcorrente: { creditoId: "c1", valor: 25 },
    })
    const erro = await upsertVendaInTransaction(
      db.tx,
      STORE,
      avulsoSale({ total: 30, paymentBreakdown: { creditoVale: 30 } }),
    ).catch((e: unknown) => e)
    expect(erro).toBeInstanceOf(CreditoValeInsuficienteError)
    db.rollback()
    // Os 5 restantes pertencem à outra transação — preservados, nunca negativados.
    expect(db.creditos[0]!.saldoAtual).toBeCloseTo(5, 2)
    expect(db.vendas).toHaveLength(0)
  })

  it("vale inexistente (nenhum crédito do titular) → conflito, venda não conclui", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const db = makeFakeTx({ creditos: [] })
    const erro = await upsertVendaInTransaction(
      db.tx,
      STORE,
      avulsoSale({ total: 20, paymentBreakdown: { creditoVale: 20 } }),
    ).catch((e: unknown) => e)
    expect(erro).toBeInstanceOf(CreditoValeInsuficienteError)
    db.rollback()
    expect(db.vendas).toHaveLength(0)
    expect(db.financeiro).toHaveLength(0)
  })

  it("vale esgotado (saldo 0/status zerado) → conflito, venda não conclui", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const db = makeFakeTx({ creditos: [{ id: "c1", saldo: 0, status: "zerado" }] })
    const erro = await upsertVendaInTransaction(
      db.tx,
      STORE,
      avulsoSale({ total: 20, paymentBreakdown: { creditoVale: 20 } }),
    ).catch((e: unknown) => e)
    expect(erro).toBeInstanceOf(CreditoValeInsuficienteError)
    db.rollback()
    expect(db.vendas).toHaveLength(0)
  })

  it("exceder o saldo (vale 40, uso 50) → conflito e rollback devolve o estado exato", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const db = makeFakeTx({ creditos: [{ id: "c1", saldo: 40 }] })
    const erro = await upsertVendaInTransaction(
      db.tx,
      STORE,
      avulsoSale({ total: 50, paymentBreakdown: { dinheiro: 10, creditoVale: 50 } }),
    ).catch((e: unknown) => e)
    expect(erro).toBeInstanceOf(CreditoValeInsuficienteError)
    expect((erro as CreditoValeInsuficienteError).detail).toMatchObject({
      solicitado: 50,
      faltante: 10,
    })
    db.rollback()
    expect(db.creditos[0]!.saldoAtual).toBeCloseTo(40, 2) // débito parcial desfeito
    expect(db.creditos[0]!.status).toBe("ativo")
    expect(db.vendas).toHaveLength(0)
    expect(db.usosCredito).toHaveLength(0)
  })

  it("creditoVale sem titular (customerCpf ausente) → conflito, venda não conclui", async () => {
    const db = makeFakeTx({ creditos: [{ id: "c1", saldo: 100 }] })
    const erro = await upsertVendaInTransaction(
      db.tx,
      STORE,
      avulsoSale({ total: 40, customerCpf: undefined, paymentBreakdown: { creditoVale: 40 } }),
    ).catch((e: unknown) => e)
    expect(erro).toBeInstanceOf(CreditoValeInsuficienteError)
    expect((erro as CreditoValeInsuficienteError).detail).toMatchObject({
      clienteDoc: "",
      solicitado: 40,
      faltante: 40,
    })
    db.rollback()
    expect(db.vendas).toHaveLength(0)
    expect(db.creditos[0]!.saldoAtual).toBeCloseTo(100, 2) // intocado
  })
})
