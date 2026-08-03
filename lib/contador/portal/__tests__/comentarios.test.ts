/**
 * GOAL CONTADOR-HUB-PORTAL-EXTERNO-READONLY-015 — comentários do portal.
 *
 * Fake in-memory do `ComentariosRepo`. Prova: visibilidade SEMPRE compartilhada,
 * bloqueio em FECHADA sem escrita, metadata do evento sem texto (só textoLen),
 * listagem cortada em `compartilhado` com autor interno pseudonimizado.
 */
import { describe, expect, it } from "vitest"
import {
  ComentarioValidacaoError,
  type ComentarioRow,
  type ComentariosRepo,
  type CompetenciaRefComentario,
} from "@/lib/contador/comentarios/service"
import {
  CompetenciaFechadaError,
  DocumentoNaoEncontradoError,
} from "@/lib/contador/documentos/service"
import { CompetenciaNaoEncontradaError } from "@/lib/contador/fechamento/service"
import { comentarPortal, listarComentariosPortal } from "../comentarios"
import { escopoExternoFake } from "./helpers"

const AGORA = new Date("2026-08-01T12:00:00.000Z")

type Estado = {
  competencias: CompetenciaRefComentario[]
  comentarios: ComentarioRow[]
  eventos: Record<string, unknown>[]
  docsDaCompetencia: string[]
}

function repoFalso(estado: Estado): ComentariosRepo {
  return {
    getOrCreateCompetencia: async () => {
      throw new Error("portal NUNCA cria competência ao comentar")
    },
    acharCompetencia: async (storeId, comp) =>
      storeId === "loja-1"
        ? estado.competencias.find((c) => c.ano === comp.ano && c.mes === comp.mes) ?? null
        : null,
    documentoPertence: async ({ documentoId, competenciaId, storeId }) =>
      storeId === "loja-1" && competenciaId === "comp-1" && estado.docsDaCompetencia.includes(documentoId),
    criarComentarioComEvento: async ({ comentario, evento }) => {
      const row: ComentarioRow = { ...comentario, createdAt: AGORA }
      estado.comentarios.push(row)
      estado.eventos.push({ ...evento })
      return row
    },
    listarComentarios: async ({ competenciaId, storeId, visibilidade, limite }) =>
      estado.comentarios
        .filter((c) => c.competenciaId === competenciaId)
        .filter(() => storeId === "loja-1")
        .filter((c) => !visibilidade || c.visibilidade === visibilidade)
        .slice(0, limite),
  }
}

function estadoBase(over: Partial<Estado> = {}): Estado {
  return {
    competencias: [{ id: "comp-1", ano: 2026, mes: 7, status: "ABERTA" }],
    comentarios: [],
    eventos: [],
    docsDaCompetencia: ["doc-1"],
    ...over,
  }
}

describe("comentarPortal", () => {
  it("grava SEMPRE como externo + compartilhada; evento com metadata saneada (só textoLen)", async () => {
    const estado = estadoBase()
    const escopo = escopoExternoFake({ usuarioId: "usr-ext-1" })
    const dto = await comentarPortal(
      escopo,
      { competencia: "2026-07", texto: "Recebi os documentos, obrigado." },
      { repo: repoFalso(estado) },
    )
    expect(dto).toMatchObject({
      competenciaId: "comp-1",
      autorTipo: "externo",
      autorId: "usr-ext-1",
      visibilidade: "compartilhada",
      texto: "Recebi os documentos, obrigado.",
    })
    const evento = estado.eventos[0]!
    expect(evento).toMatchObject({
      tipo: "comentario_criado",
      atorTipo: "externo",
      atorId: "usr-ext-1",
      origem: "contador.portal",
      metadata: { visibilidade: "compartilhada", textoLen: 31, competencia: "2026-07" },
    })
    // O TEXTO nunca vai para a metadata do evento.
    expect(JSON.stringify(evento.metadata)).not.toContain("Recebi os documentos")
  })

  it("a entrada nem TEM campo de visibilidade — interna é estruturalmente impossível", async () => {
    const estado = estadoBase()
    const escopo = escopoExternoFake()
    // Mesmo que um cliente envie `visibilidade: "interna"` no JSON, o tipo da
    // entrada não o carrega e o serviço grava "compartilhada".
    const entrada = { competencia: "2026-07", texto: "ok", visibilidade: "interna" }
    await comentarPortal(escopo, entrada, { repo: repoFalso(estado) })
    expect(estado.comentarios[0]!.visibilidade).toBe("compartilhada")
  })

  it("competência FECHADA → 409 de domínio, ZERO escrita", async () => {
    const estado = estadoBase({
      competencias: [{ id: "comp-1", ano: 2026, mes: 7, status: "FECHADA" }],
    })
    const escopo = escopoExternoFake()
    await expect(
      comentarPortal(escopo, { competencia: "2026-07", texto: "tarde demais" }, { repo: repoFalso(estado) }),
    ).rejects.toBeInstanceOf(CompetenciaFechadaError)
    expect(estado.comentarios).toEqual([])
    expect(estado.eventos).toEqual([])
  })

  it("competência inexistente → 404 (o portal não cria competência)", async () => {
    const estado = estadoBase({ competencias: [] })
    const escopo = escopoExternoFake()
    await expect(
      comentarPortal(escopo, { competencia: "2026-07", texto: "oi" }, { repo: repoFalso(estado) }),
    ).rejects.toBeInstanceOf(CompetenciaNaoEncontradaError)
    expect(estado.comentarios).toEqual([])
  })

  it("texto > 4000 → 422 de domínio; documento de fora → 404", async () => {
    const estado = estadoBase()
    const escopo = escopoExternoFake()
    await expect(
      comentarPortal(escopo, { competencia: "2026-07", texto: "x".repeat(4001) }, { repo: repoFalso(estado) }),
    ).rejects.toBeInstanceOf(ComentarioValidacaoError)
    await expect(
      comentarPortal(escopo, { competencia: "2026-07", documentoId: "doc-alheio", texto: "oi" }, { repo: repoFalso(estado) }),
    ).rejects.toBeInstanceOf(DocumentoNaoEncontradoError)
    expect(estado.comentarios).toEqual([])
  })
})

describe("listarComentariosPortal", () => {
  it("só enxerga compartilhado e pseudonimiza autorId INTERNO (externo permanece)", async () => {
    const estado = estadoBase({
      comentarios: [
        {
          id: "cmt-int",
          competenciaId: "comp-1",
          documentoId: null,
          autorTipo: "interno",
          autorId: "admin-user-42",
          visibilidade: "compartilhada",
          texto: "visível e interno",
          createdAt: AGORA,
        },
        {
          id: "cmt-sigilo",
          competenciaId: "comp-1",
          documentoId: null,
          autorTipo: "interno",
          autorId: "admin-user-42",
          visibilidade: "interna",
          texto: "NUNCA pode sair no portal",
          createdAt: AGORA,
        },
        {
          id: "cmt-ext",
          competenciaId: "comp-1",
          documentoId: null,
          autorTipo: "externo",
          autorId: "usr-ext-1",
          visibilidade: "compartilhada",
          texto: "do próprio contador",
          createdAt: AGORA,
        },
      ],
    })
    const lista = await listarComentariosPortal(escopoExternoFake(), { competencia: "2026-07" }, { repo: repoFalso(estado) })
    expect(lista.map((c) => c.id).sort()).toEqual(["cmt-ext", "cmt-int"])
    const interno = lista.find((c) => c.id === "cmt-int")!
    expect(interno.autorId).toMatch(/^u_[0-9a-f]{16}$/)
    expect(interno.autorId).not.toBe("admin-user-42")
    expect(lista.find((c) => c.id === "cmt-ext")!.autorId).toBe("usr-ext-1")
    expect(JSON.stringify(lista)).not.toContain("NUNCA pode sair")
  })
})
