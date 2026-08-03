/**
 * GOAL CONTADOR-HUB-PORTAL-EXTERNO-READONLY-015 — timeline do portal.
 *
 * Fake in-memory do `TimelineRepo`. Prova: contexto compartilhado chega NA
 * CONSULTA (visibilidade compartilhada + corte defensivo) e atorId INTERNO sai
 * pseudonimizado (externo permanece).
 */
import { describe, expect, it } from "vitest"
import type { ComentarioTimeline, EventoTimeline } from "@/lib/contador/timeline/projecao"
import type { TimelineRepo } from "@/lib/contador/timeline/service"
import { carregarTimelinePortal } from "../timeline"
import { escopoExternoFake } from "./helpers"

const AGORA = new Date("2026-08-01T12:00:00.000Z")

type Consultas = { visibilidadesComentarios: (string | undefined)[] }

function repoFalso(consultas: Consultas): TimelineRepo {
  const eventos: EventoTimeline[] = [
    {
      id: "ev-int",
      tipo: "documento_enviado",
      atorTipo: "interno",
      atorId: "admin-user-42",
      entidade: "documento",
      entidadeId: "doc-1",
      origem: "contador.documentos",
      metadata: { categoria: "FISCAL", bytes: 10, storageRef: "proibido" },
      createdAt: AGORA,
    },
    {
      id: "ev-ext",
      tipo: "documento_download_autorizado",
      atorTipo: "externo",
      atorId: "usr-ext-1",
      entidade: "documento",
      entidadeId: "doc-1",
      origem: "contador.portal",
      metadata: { expiresInSec: 300 },
      createdAt: AGORA,
    },
  ]
  const comentarios: ComentarioTimeline[] = [
    {
      id: "cmt-sigilo",
      documentoId: null,
      autorTipo: "interno",
      autorId: "admin-user-42",
      visibilidade: "interna",
      texto: "NUNCA pode sair no portal",
      createdAt: AGORA,
    },
    {
      id: "cmt-visivel",
      documentoId: null,
      autorTipo: "interno",
      autorId: "admin-user-42",
      visibilidade: "compartilhada",
      texto: "visível",
      createdAt: AGORA,
    },
  ]
  return {
    acharCompetencia: async (storeId, comp) =>
      storeId === "loja-1" ? { id: "comp-1", ano: comp.ano, mes: comp.mes, status: "ABERTA" } : null,
    listarEventos: async () => eventos,
    listarComentarios: async ({ visibilidade }) => {
      consultas.visibilidadesComentarios.push(visibilidade)
      // O fake honra o corte da consulta, como o Prisma real.
      return comentarios.filter((c) => !visibilidade || c.visibilidade === visibilidade)
    },
  }
}

describe("carregarTimelinePortal", () => {
  it("contexto compartilhado na consulta; atorId interno pseudonimizado na saída", async () => {
    const consultas: Consultas = { visibilidadesComentarios: [] }
    const resultado = await carregarTimelinePortal(
      escopoExternoFake(),
      { competencia: "2026-07" },
      { repo: repoFalso(consultas) },
    )
    // Corte NA CONSULTA: o repo recebeu a visibilidade compartilhada.
    expect(consultas.visibilidadesComentarios).toEqual(["compartilhada"])
    expect(resultado.timeline.contexto).toBe("compartilhado")

    const ids = resultado.timeline.itens.map((i) => i.id).sort()
    expect(ids).toEqual(["comentario:cmt-visivel", "evento:ev-ext", "evento:ev-int"])
    expect(JSON.stringify(resultado)).not.toContain("NUNCA pode sair")

    const eventoInterno = resultado.timeline.itens.find((i) => i.id === "evento:ev-int")!
    expect(eventoInterno.atorId).toMatch(/^u_[0-9a-f]{16}$/)
    expect(eventoInterno.atorId).not.toBe("admin-user-42")
    // Metadata da projeção já é allowlist — storageRef não sobrevive.
    expect(JSON.stringify(eventoInterno.detalhes)).not.toContain("proibido")

    const eventoExterno = resultado.timeline.itens.find((i) => i.id === "evento:ev-ext")!
    expect(eventoExterno.atorId).toBe("usr-ext-1")
  })

  it("competência inexistente → timeline vazia (estado honesto, sem erro)", async () => {
    const consultas: Consultas = { visibilidadesComentarios: [] }
    const resultado = await carregarTimelinePortal(
      escopoExternoFake({ storeId: "loja-sem-nada" }),
      { competencia: "2026-07" },
      { repo: repoFalso(consultas) },
    )
    expect(resultado.timeline.itens).toEqual([])
    expect(resultado.competenciaId).toBeNull()
  })
})
