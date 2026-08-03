/**
 * GOAL CONTADOR-HUB-PORTAL-EXTERNO-READONLY-015 — janela de competências do portal.
 */
import { describe, expect, it } from "vitest"
import type { CompetenciaFechamentoRow, FechamentoRepo } from "@/lib/contador/fechamento/service"
import { JANELA_COMPETENCIAS_PORTAL, listarCompetenciasDaJanela, listarCompetenciasPortal } from "../competencias"
import { escopoExternoFake } from "./helpers"

const AGORA = new Date("2026-08-01T12:00:00.000Z")

function repoFalso(rows: CompetenciaFechamentoRow[]): Pick<FechamentoRepo, "acharCompetencia"> {
  return {
    acharCompetencia: async (storeId, comp) =>
      rows.find((c) => c.storeId === storeId && c.ano === comp.ano && c.mes === comp.mes) ?? null,
  }
}

function linha(over: Partial<CompetenciaFechamentoRow>): CompetenciaFechamentoRow {
  return {
    id: "comp-x",
    storeId: "loja-1",
    ano: 2026,
    mes: 7,
    status: "ABERTA",
    versao: 1,
    snapshot: null,
    snapshotHash: null,
    fechadaEm: null,
    fechadaPorId: null,
    reabertaEm: null,
    updatedAt: AGORA,
    ...over,
  }
}

describe("listarCompetenciasDaJanela", () => {
  it("atual + 12 anteriores, cruzando o ano", () => {
    const janela = listarCompetenciasDaJanela(AGORA) // 2026-08 em America/Sao_Paulo
    expect(janela).toHaveLength(JANELA_COMPETENCIAS_PORTAL)
    expect(janela[0]).toEqual({ ano: 2026, mes: 8 })
    expect(janela[12]).toEqual({ ano: 2025, mes: 8 })
  })
})

describe("listarCompetenciasPortal", () => {
  it("13 competências, selo `oficial vN` só nas fechadas, ABERTA honesta sem linha", async () => {
    const rows = [
      linha({ id: "comp-fechada", ano: 2026, mes: 6, status: "FECHADA", versao: 2, fechadaEm: AGORA }),
      linha({ id: "comp-enviada", ano: 2026, mes: 7, status: "ENVIADA", versao: 1 }),
    ]
    const lista = await listarCompetenciasPortal(escopoExternoFake(), { repo: repoFalso(rows) }, AGORA)
    expect(lista).toHaveLength(13)
    expect(lista[0]).toMatchObject({ codigo: "2026-08", status: "ABERTA", fechada: false, selo: null, versao: null })
    expect(lista[1]).toMatchObject({ codigo: "2026-07", status: "ENVIADA", fechada: false, selo: null, versao: 1 })
    expect(lista[2]).toMatchObject({ codigo: "2026-06", status: "FECHADA", fechada: true, selo: "oficial v2", versao: 2 })
    // Demais sem linha: ABERTA sem selo — nunca inventa status nem cria competência.
    for (const dto of lista.slice(3)) {
      expect(dto).toMatchObject({ status: "ABERTA", fechada: false, selo: null })
    }
  })

  it("só enxerga a loja do escopo (linhas de outra loja não contaminam)", async () => {
    const rows = [linha({ id: "comp-alheia", storeId: "loja-2", ano: 2026, mes: 6, status: "FECHADA", versao: 1 })]
    const lista = await listarCompetenciasPortal(escopoExternoFake(), { repo: repoFalso(rows) }, AGORA)
    expect(lista.find((c) => c.codigo === "2026-06")).toMatchObject({ status: "ABERTA", fechada: false })
  })
})
