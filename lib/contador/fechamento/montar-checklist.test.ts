import { describe, expect, it } from "vitest"
import { montarDados, type FontesContador } from "@/lib/contador/readers"
import { montarChecklistFechamento } from "./montar-checklist"
import { LIMIAR_DIVERGENCIA_CAIXA } from "./index"
import type { ChecklistItemFechamento, EstadoChecklistItem } from "./tipos"

/** Competências relativas a AGORA (July/2026): June = passada, July = atual, Aug = futura. */
const PASSADA = { ano: 2026, mes: 6 }
const ATUAL = { ano: 2026, mes: 7 }
const FUTURA = { ano: 2026, mes: 8 }
const AGORA = new Date("2026-07-16T12:00:00.000Z") // 09:00 America/Sao_Paulo → Julho/2026

const TOTAL_ITENS = 14

const vazio: FontesContador = {
  vendas: [],
  devolucoes: [],
  movimentacoes: [],
  receber: [],
  pagar: [],
  sessoes: [],
  operacoes: [],
  falhas: [],
}

type Checklist = ReturnType<typeof montarChecklistFechamento>

function itemDe(checklist: Checklist, id: string): ChecklistItemFechamento {
  const it = checklist.itens.find((i) => i.id === id)
  if (!it) throw new Error(`item ${id} ausente`)
  return it
}

function estadoDe(checklist: Checklist, id: string): EstadoChecklistItem {
  return itemDe(checklist, id).estado
}

function montar(fontes: Partial<FontesContador>, competencia = PASSADA, agora = AGORA) {
  const dados = montarDados({ ...vazio, ...fontes }, competencia)
  return montarChecklistFechamento({ dados, competencia, agora })
}

/* ───────────────────────────── Vendas ───────────────────────────── */

describe("montarChecklistFechamento — vendas (CORREÇÃO 1)", () => {
  it("vendas > 0 → ok", () => {
    const c = montar({
      vendas: [{ total: 100, status: "concluida", payload: { paymentBreakdown: { pix: 100 } } }],
    })
    expect(estadoDe(c, "vendas")).toBe("ok")
  })

  it("vendas == 0 (leitura real) → pendente, exige confirmação humana", () => {
    const c = montar({})
    expect(estadoDe(c, "vendas")).toBe("pendente")
    expect(itemDe(c, "vendas").explicacao).toContain(
      "Nenhuma venda foi registrada nesta competência.",
    )
    expect(itemDe(c, "vendas").explicacao).toContain("Confirme se o período realmente não teve movimento.")
  })

  it("fonte de vendas indisponível → nao_disponivel", () => {
    const c = montar({ falhas: ["vendas"] })
    expect(estadoDe(c, "vendas")).toBe("nao_disponivel")
  })
})

/* ───────────────────────────── Sessões ───────────────────────────── */

describe("montarChecklistFechamento — sessões e semântica temporal (CORREÇÃO 2)", () => {
  const ABERTA = { status: "ABERTA", saldoFinal: null, saldoContado: null }
  const FECHADA = { status: "FECHADA", saldoFinal: 100, saldoContado: 100 }

  it("passada com sessão aberta → atencao", () => {
    const c = montar({ sessoes: [ABERTA] }, PASSADA)
    expect(estadoDe(c, "sessoes_caixa")).toBe("atencao")
    expect(itemDe(c, "sessoes_caixa").explicacao).toContain("competência passada ainda aberta")
  })

  it("atual com sessão aberta → pendente", () => {
    const c = montar({ sessoes: [ABERTA] }, ATUAL)
    expect(estadoDe(c, "sessoes_caixa")).toBe("pendente")
    expect(itemDe(c, "sessoes_caixa").explicacao).toContain("em andamento na competência atual")
  })

  it("passada sem sessão aberta → ok", () => {
    const c = montar({ sessoes: [FECHADA] }, PASSADA)
    expect(estadoDe(c, "sessoes_caixa")).toBe("ok")
  })

  it("atual sem sessão aberta → ok", () => {
    const c = montar({ sessoes: [FECHADA] }, ATUAL)
    expect(estadoDe(c, "sessoes_caixa")).toBe("ok")
  })

  it("futura sem sessões → pendente (nunca ok)", () => {
    const c = montar({ sessoes: [] }, FUTURA)
    expect(estadoDe(c, "sessoes_caixa")).toBe("pendente")
    expect(itemDe(c, "sessoes_caixa").explicacao).toContain("competência ainda é futura")
  })

  it("futura com sessão → pendente (nunca ok)", () => {
    const c = montar({ sessoes: [ABERTA] }, FUTURA)
    expect(estadoDe(c, "sessoes_caixa")).toBe("pendente")
  })

  it("fonte de sessões indisponível → nao_disponivel", () => {
    const c = montar({ falhas: ["sessoes"] }, PASSADA)
    expect(estadoDe(c, "sessoes_caixa")).toBe("nao_disponivel")
  })

  it("`agora` participa da decisão, não só de geradoEm (mesmos dados → estados diferentes)", () => {
    const dados = montarDados({ ...vazio, sessoes: [ABERTA] }, PASSADA)
    const comoPassada = montarChecklistFechamento({ dados, competencia: PASSADA, agora: AGORA })
    const comoAtual = montarChecklistFechamento({
      dados,
      competencia: PASSADA,
      agora: new Date("2026-06-16T12:00:00.000Z"), // Junho/2026 → PASSADA vira "atual"
    })
    expect(estadoDe(comoPassada, "sessoes_caixa")).toBe("atencao")
    expect(estadoDe(comoAtual, "sessoes_caixa")).toBe("pendente")
  })
})

/* ─────────────────────────── Títulos vencidos ─────────────────────────── */

describe("montarChecklistFechamento — títulos vencidos (CORREÇÃO 3)", () => {
  it("sem títulos em aberto → vencimento continua nao_disponivel", () => {
    const c = montar({})
    expect(estadoDe(c, "titulos_vencidos_receber")).toBe("nao_disponivel")
    expect(estadoDe(c, "titulos_vencidos_pagar")).toBe("nao_disponivel")
    expect(itemDe(c, "titulos_vencidos_receber").titulo).toBe("Títulos vencidos a receber")
  })

  it("com títulos em aberto → nao_disponivel, com evidência honesta do que existe", () => {
    const c = montar({
      receber: [{ valor: 150, status: "aberto", vencimento: "2026-06-15" }],
      pagar: [{ valor: 80, status: "aberto", vencimento: "2026-06-20" }],
    })
    expect(estadoDe(c, "titulos_vencidos_receber")).toBe("nao_disponivel")
    expect(estadoDe(c, "titulos_vencidos_pagar")).toBe("nao_disponivel")
    expect(itemDe(c, "titulos_vencidos_receber").evidencia).toContain("1 em aberto")
    expect(itemDe(c, "titulos_vencidos_receber").evidencia).toMatch(/150/)
    expect(itemDe(c, "titulos_vencidos_receber").explicacao).toContain(
      "não permite confirmar quais já estão vencidos",
    )
  })

  it("cobertura parcial → nao_disponivel com explicação (não vira vencido)", () => {
    const c = montar({
      receber: [
        { valor: 150, status: "aberto", vencimento: "2026-06-15" },
        { valor: 99, status: "aberto", vencimento: "" }, // sem vencimento reconhecível → parcial
      ],
    })
    expect(estadoDe(c, "titulos_vencidos_receber")).toBe("nao_disponivel")
    expect(itemDe(c, "titulos_vencidos_receber").evidencia).toContain("cobertura parcial")
  })

  it("fonte de títulos falha → nao_disponivel", () => {
    const c = montar({ falhas: ["receber", "pagar"] })
    expect(estadoDe(c, "titulos_vencidos_receber")).toBe("nao_disponivel")
    expect(estadoDe(c, "titulos_vencidos_pagar")).toBe("nao_disponivel")
    expect(itemDe(c, "titulos_vencidos_receber").evidencia).toContain("indisponível")
  })
})

/* ─────────────────────────── Diferenças de caixa ─────────────────────────── */

describe("montarChecklistFechamento — diferenças de caixa e limiar R$ 0,01 (CORREÇÃO 4)", () => {
  const fechada = (saldoFinal: number, saldoContado: number) => ({
    status: "FECHADA",
    saldoFinal,
    saldoContado,
  })

  it("o limiar canônico é R$ 0,01", () => {
    expect(LIMIAR_DIVERGENCIA_CAIXA).toBe(0.01)
  })

  it("diferença 0 → ok", () => {
    const c = montar({ sessoes: [fechada(100, 100)] })
    expect(estadoDe(c, "diferencas_caixa")).toBe("ok")
  })

  it("diferença +R$ 0,01 → ok (dentro da tolerância)", () => {
    const c = montar({ sessoes: [fechada(100, 100.01)] })
    expect(estadoDe(c, "diferencas_caixa")).toBe("ok")
  })

  it("diferença -R$ 0,01 → ok (dentro da tolerância)", () => {
    const c = montar({ sessoes: [fechada(100.01, 100)] })
    expect(estadoDe(c, "diferencas_caixa")).toBe("ok")
  })

  it("diferença acima do limiar (+R$ 0,02) → atencao", () => {
    const c = montar({ sessoes: [fechada(100, 100.02)] })
    expect(estadoDe(c, "diferencas_caixa")).toBe("atencao")
    expect(itemDe(c, "diferencas_caixa").explicacao).toContain("acima da tolerância")
  })

  it("diferença negativa acima do limiar (-R$ 0,02) → atencao", () => {
    const c = montar({ sessoes: [fechada(100.02, 100)] })
    expect(estadoDe(c, "diferencas_caixa")).toBe("atencao")
  })

  it("conferência parcial → atencao", () => {
    const c = montar({
      sessoes: [fechada(100, 100), { status: "FECHADA", saldoFinal: 50, saldoContado: null }],
    })
    expect(estadoDe(c, "diferencas_caixa")).toBe("atencao")
  })

  it("sem sessões fechadas com conferência → nao_disponivel", () => {
    const c = montar({ sessoes: [] })
    expect(estadoDe(c, "diferencas_caixa")).toBe("nao_disponivel")
  })
})

/* ─────────────────────── Sinais sem fonte de dados ─────────────────────── */

describe("montarChecklistFechamento — Fiscal, Documentos, Conferência, Fechamento (CORREÇÕES 5/6/7)", () => {
  it("fiscal → nao_disponivel", () => {
    const c = montar({})
    expect(estadoDe(c, "fiscal")).toBe("nao_disponivel")
  })

  it("documentos existe e é nao_disponivel, sem mock/portal", () => {
    const c = montar({})
    const it = itemDe(c, "documentos")
    expect(it.estado).toBe("nao_disponivel")
    expect(it.titulo).toBe("Documentos do fechamento")
    expect(it.origem).toBe("Documentos não avaliados neste sinal do checklist")
    expect(it.explicacao).toContain("não consulta o acervo real do domínio Documentos")
    expect(it.evidencia).toBe("sem evidência neste builder")
  })

  it("conferencia_contador existe e é nao_disponivel, sem persistência", () => {
    const c = montar({})
    const it = itemDe(c, "conferencia_contador")
    expect(it.estado).toBe("nao_disponivel")
    expect(it.titulo).toBe("Conferência pelo contador")
    expect(it.origem).toBe("Confirmação do contador — ainda sem persistência")
    expect(it.explicacao).toContain("ainda não possuem persistência real")
    expect(it.evidencia).toBe("sem confirmação persistida")
  })

  it("fechamento_oficial permanece pendente e separado de documentos/conferência/guias", () => {
    const c = montar({})
    expect(estadoDe(c, "fechamento_oficial")).toBe("pendente")
    expect(itemDe(c, "fechamento_oficial").explicacao).toMatch(/GOAL 012/)
    const ids = c.itens.map((i) => i.id)
    expect(ids).toContain("documentos")
    expect(ids).toContain("conferencia_contador")
    expect(ids).toContain("guias_informadas_vencendo_vencidas")
    expect(ids).toContain("fechamento_oficial")
  })
})

/* ─────────────────────────── Resumo / contagem ─────────────────────────── */

describe("montarChecklistFechamento — resumo (CORREÇÃO 8)", () => {
  it("a soma dos estados bate com o total, incluindo os novos itens", () => {
    const c = montar({
      vendas: [{ total: 100, status: "concluida", payload: { paymentBreakdown: { pix: 100 } } }],
      sessoes: [{ status: "FECHADA", saldoFinal: 100, saldoContado: 100 }],
    })
    const { ok, atencao, pendente, nao_disponivel, total } = c.contagem
    expect(ok + atencao + pendente + nao_disponivel).toBe(total)
    expect(total).toBe(c.itens.length)
    expect(total).toBe(TOTAL_ITENS)
  })

  it("não expõe percentual/score/progresso/pronto para fechar", () => {
    const c = montar({})
    const blob = JSON.stringify(c).toLowerCase()
    expect(blob).not.toMatch(/percent|%|score|progresso|pronto para fechar|pronta para fechar/)
  })
})

/* ─────────────────────────── Sem DTO ─────────────────────────── */

describe("montarChecklistFechamento — sem DTO", () => {
  it("dados null: todos os 14 itens existem; derivados nao_disponivel; fechamento pendente", () => {
    const c = montarChecklistFechamento({
      dados: null,
      competencia: ATUAL,
      agora: AGORA,
      motivoIndisponivel: "Nenhuma loja ativa selecionada.",
    })
    expect(c.geradoEm).toBe(AGORA.toISOString())
    expect(c.competencia).toEqual(ATUAL)
    expect(c.contagem.total).toBe(TOTAL_ITENS)
    expect(c.itens).toHaveLength(TOTAL_ITENS)

    // Derivados viram nao_disponivel; documentos/conferência/guias também; fechamento pendente.
    for (const id of [
      "vendas",
      "devolucoes",
      "liquido",
      "formas_pagamento",
      "movimentacoes",
      "titulos_vencidos_receber",
      "titulos_vencidos_pagar",
      "sessoes_caixa",
      "diferencas_caixa",
      "fiscal",
      "documentos",
      "conferencia_contador",
      "guias_informadas_vencendo_vencidas",
    ]) {
      expect(estadoDe(c, id)).toBe("nao_disponivel")
    }
    expect(estadoDe(c, "fechamento_oficial")).toBe("pendente")
    expect(itemDe(c, "vendas").explicacao).toContain("Nenhuma loja ativa")
    expect(itemDe(c, "documentos").origem).toBe("Documentos não avaliados neste sinal do checklist")
    expect(itemDe(c, "conferencia_contador").evidencia).toBe("sem confirmação persistida")
    expect(itemDe(c, "guias_informadas_vencendo_vencidas").evidencia).toBe("agenda indisponível")

    expect(c.contagem.pendente).toBe(1)
    expect(c.contagem.nao_disponivel).toBe(13)
  })

  it("falha da agenda não derruba os demais sinais (vendas ok + guias nao_disponivel)", () => {
    const dados = montarDados(
      {
        ...vazio,
        vendas: [{ total: 100, status: "concluida", payload: { paymentBreakdown: { pix: 100 } } }],
      },
      PASSADA,
    )
    const c = montarChecklistFechamento({
      dados,
      competencia: PASSADA,
      agora: AGORA,
      evidenciaAgenda: { leituraOk: false, total: 0, vencidas: 0, vencendo: 0, pagas: 0 },
    })
    expect(estadoDe(c, "vendas")).toBe("ok")
    expect(estadoDe(c, "guias_informadas_vencendo_vencidas")).toBe("nao_disponivel")
    expect(itemDe(c, "guias_informadas_vencendo_vencidas").explicacao).toContain("demais sinais")
  })
})

/* ─────────────────────────── Serialização ─────────────────────────── */

describe("montarChecklistFechamento — serialização", () => {
  it("JSON.stringify passa; sem Date/Session/storeId/Prisma/erro bruto no DTO", () => {
    const c = montar({
      vendas: [{ total: 200, status: "concluida", payload: { paymentBreakdown: { dinheiro: 200 } } }],
      sessoes: [{ status: "FECHADA", saldoFinal: 100, saldoContado: 95 }],
    })
    expect(() => JSON.stringify(c)).not.toThrow()
    expect(typeof c.geradoEm).toBe("string") // ISO string, não objeto Date
    const blob = JSON.stringify(c)
    expect(blob).not.toMatch(/storeId|PrismaClient|@prisma|Session|findMany|query_engine/i)
    // Toda evidência/origem é string serializável.
    for (const it of c.itens) {
      expect(typeof it.origem).toBe("string")
      expect(typeof it.explicacao).toBe("string")
      expect(it.origem.trim().length).toBeGreaterThan(0)
      expect(it.explicacao.trim().length).toBeGreaterThan(0)
    }
  })
})

/* ─────────────────────────── Guias (GOAL 016) ─────────────────────────── */

describe("montarChecklistFechamento — guias informadas (GOAL 016)", () => {
  const baseDados = () =>
    montarDados(
      {
        ...vazio,
        vendas: [{ total: 100, status: "concluida", payload: { paymentBreakdown: { pix: 100 } } }],
      },
      PASSADA,
    )

  it("sem evidência → nao_disponivel (nunca ok)", () => {
    const c = montar({})
    const it = itemDe(c, "guias_informadas_vencendo_vencidas")
    expect(it.estado).toBe("nao_disponivel")
    expect(it.evidencia).toBe("agenda indisponível")
  })

  it("0 guias informadas → nao_disponivel, evidência explícita, não prova ausência de obrigação", () => {
    const c = montarChecklistFechamento({
      dados: baseDados(),
      competencia: PASSADA,
      agora: AGORA,
      evidenciaAgenda: { leituraOk: true, total: 0, vencidas: 0, vencendo: 0, pagas: 0 },
    })
    const it = itemDe(c, "guias_informadas_vencendo_vencidas")
    expect(it.estado).toBe("nao_disponivel")
    expect(it.evidencia).toBe("0 guias informadas")
    expect(it.explicacao).toContain("não prova ausência de obrigação")
    expect(estadoDe(c, "vendas")).toBe("ok")
  })

  it("alguma vencida → atencao", () => {
    const c = montarChecklistFechamento({
      dados: baseDados(),
      competencia: PASSADA,
      agora: AGORA,
      evidenciaAgenda: { leituraOk: true, total: 2, vencidas: 1, vencendo: 0, pagas: 1 },
    })
    expect(estadoDe(c, "guias_informadas_vencendo_vencidas")).toBe("atencao")
    expect(estadoDe(c, "vendas")).toBe("ok")
  })

  it("nenhuma vencida + alguma vencendo → pendente", () => {
    const c = montarChecklistFechamento({
      dados: baseDados(),
      competencia: PASSADA,
      agora: AGORA,
      evidenciaAgenda: { leituraOk: true, total: 1, vencidas: 0, vencendo: 1, pagas: 0 },
    })
    expect(estadoDe(c, "guias_informadas_vencendo_vencidas")).toBe("pendente")
  })

  it("guias reais sem vencida/vencendo (ex.: pagas) → ok", () => {
    const c = montarChecklistFechamento({
      dados: baseDados(),
      competencia: PASSADA,
      agora: AGORA,
      evidenciaAgenda: { leituraOk: true, total: 2, vencidas: 0, vencendo: 0, pagas: 2 },
    })
    expect(estadoDe(c, "guias_informadas_vencendo_vencidas")).toBe("ok")
    expect(itemDe(c, "guias_informadas_vencendo_vencidas").evidencia).toContain("2 guia")
  })
})
