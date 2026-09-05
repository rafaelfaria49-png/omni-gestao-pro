import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

// ============================================================================
// GOAL PDV-RECEBIMENTO-CANONICALIDADE-HARDENING-002 (G1) — §3 honestidade do modal.
// ----------------------------------------------------------------------------
// "Em aberto" é SALDO > PAY_EPS, nunca status textual. O modal contava
// `filtered.length` cruzando apenas cliente × status: título quitado com status legado
// "pendente" aparecia como dívida, e o saldo caía no `valor` BRUTO da coluna.
//
// A regra vive num módulo puro (o harness roda em `node`, sem jsdom, e não monta .tsx);
// o contrato com o componente é travado por leitura do fonte.
// ============================================================================

import { isTituloEmAberto, saldoAbertoDaRow, somaSaldoEmAberto, PAY_EPS } from "./contas-receber-aberto"

const row = (over: Record<string, unknown> = {}) =>
  ({ id: "t-1", valor: 100, ...over }) as { id: string; valor: number; saldoAberto?: number }

describe("saldoAbertoDaRow — ordem de autoridade", () => {
  it("usa o saldo canônico do servidor quando presente", () => {
    expect(saldoAbertoDaRow(row({ valor: 100, saldoAberto: 60 }))).toBe(60)
  })

  it("saldo canônico ZERO vence o valor bruto (o bug original)", () => {
    expect(saldoAbertoDaRow(row({ valor: 100, saldoAberto: 0 }))).toBe(0)
  })

  it("cai no mapa do `audit` quando a linha não traz saldo", () => {
    expect(saldoAbertoDaRow(row({ valor: 100 }), { "t-1": 42 })).toBe(42)
  })

  it("o valor bruto é o ÚLTIMO recurso", () => {
    expect(saldoAbertoDaRow(row({ valor: 100 }))).toBe(100)
    expect(saldoAbertoDaRow(row({ valor: 100 }), {})).toBe(100)
  })

  it("normaliza centavos e nunca devolve negativo", () => {
    expect(saldoAbertoDaRow(row({ saldoAberto: 60.005 }))).toBe(60.01)
    expect(saldoAbertoDaRow(row({ saldoAberto: -5 }))).toBe(0)
    expect(saldoAbertoDaRow(row({ valor: Number.NaN }))).toBe(0)
  })
})

describe("isTituloEmAberto — saldo, não status", () => {
  it("saldo zero não é título aberto", () => {
    expect(isTituloEmAberto(row({ saldoAberto: 0 }))).toBe(false)
  })

  it("resíduo de centavo dentro do epsilon não é título aberto", () => {
    expect(isTituloEmAberto(row({ saldoAberto: PAY_EPS }))).toBe(false)
    expect(isTituloEmAberto(row({ saldoAberto: 0.005 }))).toBe(false)
  })

  it("um centavo acima do epsilon ainda é cobrável", () => {
    expect(isTituloEmAberto(row({ saldoAberto: 0.01 }))).toBe(true)
  })

  it("saldo cheio é título aberto", () => {
    expect(isTituloEmAberto(row({ saldoAberto: 100 }))).toBe(true)
  })
})

describe("somaSaldoEmAberto — total honesto do cabeçalho", () => {
  it("soma só o que foi passado, com saldo canônico", () => {
    const rows = [row({ id: "a", saldoAberto: 60 }), row({ id: "b", saldoAberto: 0 }), row({ id: "c", saldoAberto: 20 })]
    expect(somaSaldoEmAberto(rows)).toBe(80)
  })

  it("filtrando por saldo aberto, o título quitado não entra no total", () => {
    const rows = [row({ id: "a", valor: 100, saldoAberto: 60 }), row({ id: "b", valor: 500, saldoAberto: 0 })]
    expect(somaSaldoEmAberto(rows.filter((r) => isTituloEmAberto(r)))).toBe(60)
  })

  it("lista vazia soma zero", () => {
    expect(somaSaldoEmAberto([])).toBe(0)
  })
})

describe("contrato com o modal do PDV (fonte)", () => {
  const modal = readFileSync(
    resolve(__dirname, "../components/dashboard/vendas/pdv-recebimento-modal.tsx"),
    "utf8",
  )

  it("a lista operacional separa aberto de recebido por SALDO, não por cliente/status", () => {
    // O corte por saldo > ε mora em `partitionTitulos` desde o G3 (multitítulo);
    // antes era `isTituloEmAberto` inline. A propriedade guardada é a mesma.
    expect(modal).toContain("partitionTitulos")
  })

  it("o saldo total do cabeçalho usa o saldo canônico", () => {
    expect(modal).toContain("abertos.reduce((s, t) => s + t.saldoAberto, 0)")
    expect(modal).not.toContain("s + t.valorBruto")
  })

  it("o saldo por título não deriva do valor bruto dentro do componente", () => {
    expect(modal).toContain("saldoAbertoDaRow")
    expect(modal).not.toContain("Math.round((Number(row.valor) || 0) * 100) / 100")
  })

  it("a contagem de títulos em aberto vem da lista derivada do saldo", () => {
    expect(modal).toContain("{abertos.length}")
    expect(modal).not.toContain("{doCliente.length}")
  })

  it("o epsilon é o do contrato financeiro, não um 0.009 solto", () => {
    expect(modal).toContain("PAY_EPS")
    expect(modal).not.toContain("+ 0.009")
  })

  it("o modal envia idempotencyKey ao receber", () => {
    expect(modal).toContain("idempotencyKey")
  })
})
