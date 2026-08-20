/**
 * Contador HUB · GOAL 018 — sinal fiscal do checklist (demais dimensões intocadas).
 */
import { describe, expect, it } from "vitest"
import { montarDados, type FontesContador } from "@/lib/contador/readers"
import { montarChecklistFechamento } from "@/lib/contador/fechamento"
import type { EvidenciaFiscalChecklist } from "@/lib/contador/readers/fiscal"

const COMPETENCIA = { ano: 2026, mes: 7 }
const AGORA = new Date("2026-07-16T12:00:00.000Z")

const vazio: FontesContador = {
  vendas: [{ total: 100, status: "concluida", payload: { paymentBreakdown: { pix: 100 } } }],
  devolucoes: [],
  movimentacoes: [],
  receber: [],
  pagar: [],
  sessoes: [],
  operacoes: [],
  falhas: [],
}

function montar(evidenciaFiscal: EvidenciaFiscalChecklist | null | undefined) {
  const dados = montarDados(vazio, COMPETENCIA)
  return montarChecklistFechamento({ dados, competencia: COMPETENCIA, agora: AGORA, evidenciaFiscal })
}

function fiscalDe(c: ReturnType<typeof montar>) {
  const it = c.itens.find((i) => i.id === "fiscal")
  if (!it) throw new Error("sinal fiscal ausente")
  return it
}

describe("checklist — somente o sinal fiscal (GOAL 018)", () => {
  it("sem evidência / flag off → nao_disponivel (não é zero notas)", () => {
    const off = montar(null)
    expect(fiscalDe(off).estado).toBe("nao_disponivel")
    expect(fiscalDe(off).explicacao).toMatch(/não significa zero notas|não consultada/i)

    const flag = montar({
      leituraOk: true,
      disponivel: false,
      motivo: "flag_off",
      entregaveis: 0,
      rejeitadas: 0,
      canceladas: 0,
    })
    expect(fiscalDe(flag).estado).toBe("nao_disponivel")
    expect(fiscalDe(flag).explicacao).toContain("não significa zero notas")
  })

  it("store fora da allowlist → nao_disponivel", () => {
    const c = montar({
      leituraOk: true,
      disponivel: false,
      motivo: "store_nao_allowlisted",
      entregaveis: 0,
      rejeitadas: 0,
      canceladas: 0,
    })
    expect(fiscalDe(c).estado).toBe("nao_disponivel")
  })

  it("falha de leitura → nao_disponivel (nunca 0 XML = ok)", () => {
    const c = montar({
      leituraOk: false,
      disponivel: false,
      motivo: "leitura_falhou",
      entregaveis: 0,
      rejeitadas: 0,
      canceladas: 0,
    })
    expect(fiscalDe(c).estado).toBe("nao_disponivel")
    expect(fiscalDe(c).explicacao).not.toMatch(/0 XML/)
    expect(fiscalDe(c).estado).not.toBe("ok")
  })

  it("entregáveis sem rejeitadas → ok", () => {
    const c = montar({
      leituraOk: true,
      disponivel: true,
      motivo: null,
      entregaveis: 1,
      rejeitadas: 0,
      canceladas: 0,
    })
    expect(fiscalDe(c).estado).toBe("ok")
    expect(fiscalDe(c).evidencia).toContain("1 entregável")
  })

  it("rejeitadas geram sinal honesto e não entram como ok", () => {
    const c = montar({
      leituraOk: true,
      disponivel: true,
      motivo: null,
      entregaveis: 1,
      rejeitadas: 1,
      canceladas: 0,
    })
    expect(fiscalDe(c).estado).toBe("atencao")
    expect(fiscalDe(c).explicacao).toContain("REJEITADA")
    expect(fiscalDe(c).explicacao).toContain("05-XML")
  })

  it("canceladas sem entregável → atencao (fora de 05-XML)", () => {
    const c = montar({
      leituraOk: true,
      disponivel: true,
      motivo: null,
      entregaveis: 0,
      rejeitadas: 0,
      canceladas: 2,
    })
    expect(fiscalDe(c).estado).toBe("atencao")
    expect(fiscalDe(c).explicacao).toContain("CANCELADA")
  })

  it("não altera outras dimensões", () => {
    const sem = montar(null)
    const com = montar({
      leituraOk: true,
      disponivel: true,
      motivo: null,
      entregaveis: 1,
      rejeitadas: 0,
      canceladas: 0,
    })
    const ids = sem.itens.map((i) => i.id)
    expect(ids).toEqual(com.itens.map((i) => i.id))
    for (const id of ids) {
      if (id === "fiscal") continue
      const a = sem.itens.find((i) => i.id === id)!
      const b = com.itens.find((i) => i.id === id)!
      expect(b.estado).toBe(a.estado)
      expect(b.explicacao).toBe(a.explicacao)
    }
  })
})
