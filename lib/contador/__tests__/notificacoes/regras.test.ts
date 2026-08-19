import { describe, expect, it } from "vitest"
import { avaliarRegras, diasAteFimCompetencia } from "@/lib/contador/notificacoes/regras"
import { CHECKLIST_IDS_STALE, EVENTO_ALTERACAO_POS_FECHAMENTO } from "@/lib/contador/notificacoes/tipos"
import { JANELA_OPERACIONAL_DIAS } from "@/lib/contador/notificacoes/limiares"
import { GUIAS_VENCENDO_DIAS } from "@/lib/contador/agenda/tipos"
import type { FontesAvaliacao } from "@/lib/contador/notificacoes/tipos"
import { competenciaRow } from "./helpers"

const HOJE = new Date("2026-08-19T15:00:00.000Z")

function fontes(over: Partial<FontesAvaliacao> = {}): FontesAvaliacao {
  return {
    competencia: competenciaRow(),
    documentos: [],
    guias: [],
    pacotes: [],
    eventosPosFechamento: [],
    eventosAlerta: [],
    ...over,
  }
}

describe("notificacoes · regras puras", () => {
  it("documento PENDENTE dispara e CONFERIDO/RESOLVIDO/ENVIADO silenciam", () => {
    const pend = avaliarRegras(
      fontes({
        documentos: [
          { id: "d1", status: "PENDENTE", titulo: "Extrato", vencimento: null },
          { id: "d2", status: "CONFERIDO", titulo: "NF", vencimento: null },
          { id: "d3", status: "RESOLVIDO", titulo: "Folha", vencimento: null },
          { id: "d4", status: "ENVIADO", titulo: "Contrato", vencimento: null },
        ],
      }),
      HOJE,
    )
    expect(pend.filter((a) => a.regra === "documento_pendente").map((a) => a.alvo)).toEqual(["d1"])
  })

  it("fechamento próximo silencia se a competência está FECHADA", () => {
    const aberta = avaliarRegras(fontes({ competencia: competenciaRow({ status: "ABERTA" }) }), HOJE)
    const fechada = avaliarRegras(fontes({ competencia: competenciaRow({ status: "FECHADA" }) }), HOJE)
    const dias = diasAteFimCompetencia({ ano: 2026, mes: 8 }, HOJE)
    if (dias <= JANELA_OPERACIONAL_DIAS) {
      expect(aberta.some((a) => a.regra === "fechamento_proximo")).toBe(true)
    }
    expect(fechada.some((a) => a.regra === "fechamento_proximo")).toBe(false)
  })

  it("fechamento próximo dispara no último dia da competência e silencia com folga > 7 dias", () => {
    const ultimo = new Date("2026-08-31T15:00:00.000Z")
    const folga = new Date("2026-08-10T15:00:00.000Z")
    expect(avaliarRegras(fontes(), ultimo).some((a) => a.regra === "fechamento_proximo")).toBe(true)
    expect(avaliarRegras(fontes(), folga).some((a) => a.regra === "fechamento_proximo")).toBe(false)
  })

  it("guia hoje e +7 disparam vencendo; +8 silencia; vencida dispara; paga silencia", () => {
    const hoje = new Date("2026-08-19T15:00:00.000Z")
    const venceHoje = new Date("2026-08-19T00:00:00.000Z")
    const vence7 = new Date("2026-08-26T00:00:00.000Z")
    const vence8 = new Date("2026-08-27T00:00:00.000Z")
    const vencida = new Date("2026-08-10T00:00:00.000Z")

    const rHoje = avaliarRegras(
      fontes({ guias: [{ id: "g1", titulo: "DAS", vencimento: venceHoje, pagaEm: null }] }),
      hoje,
    )
    const r7 = avaliarRegras(
      fontes({ guias: [{ id: "g2", titulo: "DAS", vencimento: vence7, pagaEm: null }] }),
      hoje,
    )
    const r8 = avaliarRegras(
      fontes({ guias: [{ id: "g3", titulo: "DAS", vencimento: vence8, pagaEm: null }] }),
      hoje,
    )
    const rVenc = avaliarRegras(
      fontes({ guias: [{ id: "g4", titulo: "DAS", vencimento: vencida, pagaEm: null }] }),
      hoje,
    )
    const rPaga = avaliarRegras(
      fontes({
        guias: [{ id: "g5", titulo: "DAS", vencimento: vencida, pagaEm: new Date("2026-08-11T00:00:00.000Z") }],
      }),
      hoje,
    )

    expect(GUIAS_VENCENDO_DIAS).toBe(7)
    expect(rHoje.some((a) => a.regra === "guia_vencendo" && a.alvo === "g1")).toBe(true)
    expect(r7.some((a) => a.regra === "guia_vencendo" && a.alvo === "g2")).toBe(true)
    expect(r8.some((a) => a.regra.startsWith("guia_"))).toBe(false)
    expect(rVenc.some((a) => a.regra === "guia_vencida" && a.alvo === "g4")).toBe(true)
    expect(rPaga.some((a) => a.regra.startsWith("guia_"))).toBe(false)
  })

  it("pacote com pendências canônicas dispara; só stale ou sem pacote silencia", () => {
    const soStale = avaliarRegras(
      fontes({
        competencia: competenciaRow({
          snapshot: {
            checklist: { itens: [{ id: "caixa", estado: "atencao" }] },
          },
        }),
        pacotes: [
          {
            versao: 1,
            fonte: "ok",
            pendencias: CHECKLIST_IDS_STALE.map((id) => `[pendente] ${id} — sinal stale`),
          },
        ],
      }),
      HOJE,
    )
    const comPend = avaliarRegras(
      fontes({
        competencia: competenciaRow({ snapshot: { checklist: { itens: [] } } }),
        pacotes: [{ versao: 1, fonte: "ok", pendencias: ["[atencao] caixa — conferência"] }],
      }),
      HOJE,
    )
    const semPacote = avaliarRegras(
      fontes({
        competencia: competenciaRow({ snapshot: { checklist: { itens: [{ id: "caixa", estado: "atencao" }] } } }),
        pacotes: [],
      }),
      HOJE,
    )
    const semPend = avaliarRegras(
      fontes({
        pacotes: [{ versao: 2, fonte: "ok", pendencias: [] }],
      }),
      HOJE,
    )

    expect(soStale.some((a) => a.regra === "pacote_com_pendencias")).toBe(false)
    expect(comPend.some((a) => a.regra === "pacote_com_pendencias" && a.alvo === "v1")).toBe(true)
    expect(semPacote.some((a) => a.regra === "pacote_com_pendencias")).toBe(false)
    expect(semPend.some((a) => a.regra === "pacote_com_pendencias")).toBe(false)
  })

  it("quando snapshot e manifesto.pendencias divergem, o alerta segue o pacote", () => {
    const snapshotPendente = {
      checklist: {
        itens: [
          { id: "documentos", estado: "pendente" },
          { id: "caixa", estado: "atencao" },
        ],
      },
    }
    const snapshotLimpo = {
      checklist: { itens: [{ id: "caixa", estado: "ok" }] },
    }

    const seguePacoteVazio = avaliarRegras(
      fontes({
        competencia: competenciaRow({ snapshot: snapshotPendente }),
        pacotes: [{ versao: 3, fonte: "ok", pendencias: [] }],
      }),
      HOJE,
    )
    const seguePacoteComPend = avaliarRegras(
      fontes({
        competencia: competenciaRow({ snapshot: snapshotLimpo }),
        pacotes: [{ versao: 3, fonte: "ok", pendencias: ["[atencao] sessoes_caixa — diferença"] }],
      }),
      HOJE,
    )
    const staleNoPacoteNaoReaparece = avaliarRegras(
      fontes({
        competencia: competenciaRow({ snapshot: snapshotPendente }),
        pacotes: [
          {
            versao: 3,
            fonte: "ok",
            pendencias: ["[pendente] documentos — domínio", "[pendente] fechamento_oficial — GOAL"],
          },
        ],
      }),
      HOJE,
    )

    expect(seguePacoteVazio.some((a) => a.regra === "pacote_com_pendencias")).toBe(false)
    expect(seguePacoteComPend.some((a) => a.regra === "pacote_com_pendencias" && a.alvo === "v3")).toBe(true)
    expect(staleNoPacoteNaoReaparece.some((a) => a.regra === "pacote_com_pendencias")).toBe(false)
  })

  it("pendência só por fonte parcial dispara; manifesto indisponível não vira alerta", () => {
    const soParcial = avaliarRegras(
      fontes({
        pacotes: [
          {
            versao: 1,
            fonte: "ok",
            pendencias: ["Fonte parcial: vendas — cobertura incompleta"],
          },
        ],
      }),
      HOJE,
    )
    const parcialComStaleNoTexto = avaliarRegras(
      fontes({
        pacotes: [
          {
            versao: 1,
            fonte: "ok",
            pendencias: ["Fonte parcial: documentos — cobertura incompleta"],
          },
        ],
      }),
      HOJE,
    )
    const indisponivel = avaliarRegras(
      fontes({
        pacotes: [
          {
            versao: 4,
            fonte: "indisponivel",
            pendencias: ["[atencao] caixa — não usar esta lista"],
          },
        ],
      }),
      HOJE,
    )
    const duasVersoes = avaliarRegras(
      fontes({
        pacotes: [
          { versao: 1, fonte: "ok", pendencias: ["[atencao] caixa — v1"] },
          { versao: 2, fonte: "ok", pendencias: [] },
        ],
      }),
      HOJE,
    )

    expect(soParcial.some((a) => a.regra === "pacote_com_pendencias" && a.alvo === "v1")).toBe(true)
    expect(parcialComStaleNoTexto.some((a) => a.regra === "pacote_com_pendencias")).toBe(true)
    expect(indisponivel.some((a) => a.regra === "pacote_com_pendencias")).toBe(false)
    expect(duasVersoes.some((a) => a.regra === "pacote_com_pendencias")).toBe(false)
  })

  it("alteracao_pos_fechamento só nasce de evento persistido", () => {
    const semEvento = avaliarRegras(fontes(), HOJE)
    const comEvento = avaliarRegras(
      fontes({
        eventosPosFechamento: [
          {
            id: "ev-1",
            tipo: EVENTO_ALTERACAO_POS_FECHAMENTO,
            entidadeId: "comp-1",
            metadata: { diffHash: "abc123", versao: 1 },
            createdAt: HOJE,
          },
        ],
      }),
      HOJE,
    )
    expect(semEvento.some((a) => a.regra === "alteracao_pos_fechamento")).toBe(false)
    expect(comEvento.some((a) => a.regra === "alteracao_pos_fechamento" && a.alvo === "abc123")).toBe(true)
  })

  it("sem competência não dispara nenhuma regra", () => {
    expect(avaliarRegras(fontes({ competencia: null }), HOJE)).toEqual([])
  })
})
