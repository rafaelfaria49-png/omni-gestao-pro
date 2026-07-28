/**
 * GOAL CONTADOR-HUB-STATUS-COMENTARIOS-011 — projeção da timeline.
 *
 * Cobre ordem determinística, projeção de eventos e comentários, corte de
 * comentário interno no contexto compartilhado e — o ponto mais sensível — a
 * garantia de que o DTO não vaza storageRef, URL assinada, token nem metadata bruta.
 */
import { describe, expect, it } from "vitest"
import {
  METADATA_PERMITIDA,
  montarTimeline,
  sanitizarMetadata,
  type ComentarioTimeline,
  type EventoTimeline,
} from "@/lib/contador/timeline/projecao"
import { carregarTimeline, type TimelineRepo } from "@/lib/contador/timeline/service"
import { ComentarioValidacaoError } from "@/lib/contador/comentarios/service"

const T = (iso: string) => new Date(iso)

function evento(over: Partial<EventoTimeline> & { id: string }): EventoTimeline {
  return {
    tipo: "documento_enviado",
    atorTipo: "interno",
    atorId: "user-1",
    entidade: "documento",
    entidadeId: "doc-1",
    origem: "contador.documentos",
    metadata: { categoria: "fiscal" },
    createdAt: T("2026-07-20T10:00:00.000Z"),
    ...over,
  }
}

function comentario(over: Partial<ComentarioTimeline> & { id: string }): ComentarioTimeline {
  return {
    documentoId: null,
    autorTipo: "interno",
    autorId: "user-1",
    visibilidade: "interna",
    texto: "observação",
    createdAt: T("2026-07-21T10:00:00.000Z"),
    ...over,
  }
}

/* ─────────────────────────── ordenação ─────────────────────────── */

describe("timeline · ordem determinística", () => {
  it("mais recente primeiro, misturando eventos e comentários", () => {
    const t = montarTimeline({
      eventos: [
        evento({ id: "e1", createdAt: T("2026-07-20T10:00:00.000Z") }),
        evento({ id: "e2", createdAt: T("2026-07-22T10:00:00.000Z") }),
      ],
      comentarios: [comentario({ id: "c1", createdAt: T("2026-07-21T10:00:00.000Z") })],
      contexto: "interno",
    })
    expect(t.itens.map((i) => i.id)).toEqual(["evento:e2", "comentario:c1", "evento:e1"])
  })

  it("empate no mesmo instante é desempatado de forma ESTÁVEL pelo id composto", () => {
    const mesmo = T("2026-07-20T10:00:00.000Z")
    const base = {
      eventos: [evento({ id: "b", createdAt: mesmo }), evento({ id: "a", createdAt: mesmo })],
      comentarios: [comentario({ id: "a", createdAt: mesmo })],
      contexto: "interno" as const,
    }
    const primeira = montarTimeline(base).itens.map((i) => i.id)
    // Mesma entrada em ordem invertida deve produzir a MESMA saída.
    const segunda = montarTimeline({
      ...base,
      eventos: [...base.eventos].reverse(),
    }).itens.map((i) => i.id)

    expect(primeira).toEqual(segunda)
    expect(primeira).toEqual(["comentario:a", "evento:a", "evento:b"])
  })

  it("respeita o limite aplicado DEPOIS da ordenação e informa o total real", () => {
    const eventos = Array.from({ length: 5 }, (_, i) =>
      evento({ id: `e${i}`, createdAt: T(`2026-07-2${i}T10:00:00.000Z`) }),
    )
    const t = montarTimeline({ eventos, comentarios: [], contexto: "interno", limite: 2 })
    expect(t.total).toBe(5)
    expect(t.itens.map((i) => i.id)).toEqual(["evento:e4", "evento:e3"])
  })

  it("sem atividade → lista vazia honesta", () => {
    const t = montarTimeline({ eventos: [], comentarios: [], contexto: "interno" })
    expect(t.total).toBe(0)
    expect(t.itens).toEqual([])
  })
})

/* ─────────────────────────── projeção ─────────────────────────── */

describe("timeline · projeção de eventos e comentários", () => {
  it("evento de status vira item com statusAnterior/statusNovo legíveis", () => {
    const t = montarTimeline({
      eventos: [
        evento({
          id: "e1",
          tipo: "status_alterado",
          metadata: {
            statusAnterior: "ENVIADO",
            statusNovo: "PENDENTE",
            acao: "rejeitar",
            motivoComentarioId: "cmt-9",
            motivoLen: 18,
            competencia: "2026-07",
          },
        }),
      ],
      comentarios: [],
      contexto: "interno",
    })
    expect(t.itens[0]).toMatchObject({
      origem: "evento",
      tipo: "status_alterado",
      entidade: "documento",
      entidadeId: "doc-1",
      visibilidade: null,
      texto: null,
      detalhes: {
        statusAnterior: "ENVIADO",
        statusNovo: "PENDENTE",
        acao: "rejeitar",
        motivoComentarioId: "cmt-9",
        motivoLen: 18,
      },
    })
  })

  it("comentário vira item com texto, visibilidade e alvo do documento", () => {
    const t = montarTimeline({
      eventos: [],
      comentarios: [
        comentario({ id: "c1", documentoId: "doc-7", visibilidade: "compartilhada", texto: "ok" }),
      ],
      contexto: "interno",
    })
    expect(t.itens[0]).toMatchObject({
      id: "comentario:c1",
      origem: "comentario",
      tipo: "comentario",
      visibilidade: "compartilhada",
      texto: "ok",
      entidade: "documento",
      entidadeId: "doc-7",
    })
  })

  it("os eventos de documento do GOAL 010 já auditados são projetados", () => {
    const tipos = [
      "documento_enviado",
      "documento_substituido",
      "documento_download_autorizado",
      "documento_excluido",
    ]
    const t = montarTimeline({
      eventos: tipos.map((tipo, i) =>
        evento({ id: `e${i}`, tipo, createdAt: T(`2026-07-1${i}T10:00:00.000Z`) }),
      ),
      comentarios: [],
      contexto: "interno",
    })
    expect(t.itens.map((i) => i.tipo).sort()).toEqual([...tipos].sort())
  })
})

/* ─────────────────────────── visibilidade ─────────────────────────── */

describe("timeline · comentário interno não vaza no contexto compartilhado", () => {
  const entrada = {
    eventos: [evento({ id: "e1" })],
    comentarios: [
      comentario({ id: "c-int", visibilidade: "interna", texto: "nota sigilosa da equipe" }),
      comentario({ id: "c-pub", visibilidade: "compartilhada", texto: "mensagem ao contador" }),
    ],
  }

  it("interno enxerga os dois comentários", () => {
    const t = montarTimeline({ ...entrada, contexto: "interno" })
    expect(t.itens.filter((i) => i.origem === "comentario")).toHaveLength(2)
  })

  it("compartilhado só enxerga o compartilhado", () => {
    const t = montarTimeline({ ...entrada, contexto: "compartilhado" })
    const cmts = t.itens.filter((i) => i.origem === "comentario")
    expect(cmts).toHaveLength(1)
    expect(cmts[0].id).toBe("comentario:c-pub")
    expect(JSON.stringify(t)).not.toContain("sigilosa")
  })

  it("visibilidade desconhecida é tratada como INTERNA (fail-closed)", () => {
    const t = montarTimeline({
      eventos: [],
      comentarios: [comentario({ id: "c1", visibilidade: "publica", texto: "vazaria?" })],
      contexto: "compartilhado",
    })
    expect(t.itens).toHaveLength(0)
  })

  it("contexto inválido cai para interno (a rota já recusa antes)", () => {
    const t = montarTimeline({ eventos: [], comentarios: [], contexto: "qualquer" as never })
    expect(t.contexto).toBe("interno")
  })
})

/* ─────────────────────────── sanitização do DTO ─────────────────────────── */

describe("timeline · DTO não vaza informação privada", () => {
  it("metadata fora da allowlist é descartada", () => {
    const bruto = {
      categoria: "fiscal",
      storageRef: "contador/loja-1/2026-07/doc-1/arq.pdf",
      signedUrl: "https://supabase.co/storage/v1/object/sign/xyz?token=abc",
      token: "eyJhbGciOi",
      stack: "Error: boom\n at x",
      cookie: "sessao=123",
      ip: "189.1.2.3",
      userAgent: "Mozilla/5.0",
      senha: "hunter2",
    }
    const limpo = sanitizarMetadata(bruto)
    expect(limpo).toEqual({ categoria: "fiscal" })
    expect(JSON.stringify(limpo)).not.toContain("contador/loja-1")
    expect(JSON.stringify(limpo)).not.toContain("token")
  })

  it("valores não primitivos são descartados mesmo em chave permitida", () => {
    expect(sanitizarMetadata({ categoria: { nested: true }, bytes: [1, 2] })).toEqual({})
  })

  it("metadata nula/estranha não quebra a projeção", () => {
    for (const bruto of [null, undefined, "texto", 42, [1, 2, 3]]) {
      expect(sanitizarMetadata(bruto)).toEqual({})
    }
  })

  it("o item completo nunca carrega storageRef, URL assinada nem cabeçalho de rede", () => {
    const t = montarTimeline({
      eventos: [
        evento({
          id: "e1",
          metadata: {
            categoria: "fiscal",
            storageRef: "contador/loja-1/2026-07/doc-1",
            signedUrl: "https://exemplo/sign?token=zzz",
          },
        }),
      ],
      comentarios: [],
      contexto: "interno",
    })
    const serializado = JSON.stringify(t)
    for (const proibido of ["storageRef", "signedUrl", "token", "contador/loja-1", "exemplo/sign"]) {
      expect(serializado, proibido).not.toContain(proibido)
    }
    // `ip`/`userAgent` do evento nunca são projetados (checados como CHAVE, já que
    // "ip" é substring de "tipo" e um `toContain` cru daria falso positivo).
    for (const chave of ["ip", "userAgent"]) {
      expect(serializado, chave).not.toContain(`"${chave}":`)
      expect(Object.keys(t.itens[0])).not.toContain(chave)
      expect(Object.keys(t.itens[0].detalhes)).not.toContain(chave)
    }
  })

  it("a allowlist não contém nenhuma chave suspeita", () => {
    for (const k of METADATA_PERMITIDA) {
      expect(k, k).not.toMatch(/url|token|secret|senha|password|signed|storage|cookie|stack/i)
    }
  })
})

/* ─────────────────────────── serviço de leitura ─────────────────────────── */

function fakeRepoTimeline(dados: {
  competencia?: { id: string; ano: number; mes: number; status: string } | null
  eventos?: EventoTimeline[]
  comentarios?: ComentarioTimeline[]
}): TimelineRepo & { chamadas: { eventos: unknown[]; comentarios: unknown[] } } {
  const chamadas = { eventos: [] as unknown[], comentarios: [] as unknown[] }
  return {
    chamadas,
    async acharCompetencia() {
      return dados.competencia ?? null
    },
    async listarEventos(args) {
      chamadas.eventos.push(args)
      return dados.eventos ?? []
    },
    async listarComentarios(args) {
      chamadas.comentarios.push(args)
      const todos = dados.comentarios ?? []
      return args.visibilidade ? todos.filter((c) => c.visibilidade === args.visibilidade) : todos
    },
  }
}

const ESCOPO = { storeId: "loja-1", userId: "user-1" }

describe("timeline · serviço de leitura", () => {
  it("competência inexistente → timeline vazia, não erro", async () => {
    const repo = fakeRepoTimeline({ competencia: null })
    const r = await carregarTimeline(ESCOPO, { competencia: "2026-07" }, { repo })
    expect(r.competenciaId).toBeNull()
    expect(r.timeline.itens).toEqual([])
    expect(r.competencia).toBe("2026-07")
  })

  it("consulta sempre escopada por loja e competência resolvidas no servidor", async () => {
    const repo = fakeRepoTimeline({ competencia: { id: "comp-1", ano: 2026, mes: 7, status: "ABERTA" } })
    await carregarTimeline(ESCOPO, { competencia: "2026-07" }, { repo })
    expect(repo.chamadas.eventos[0]).toMatchObject({ competenciaId: "comp-1", storeId: "loja-1" })
    expect(repo.chamadas.comentarios[0]).toMatchObject({ competenciaId: "comp-1", storeId: "loja-1" })
  })

  it("contexto compartilhado pede só comentários compartilhados ao repositório", async () => {
    const repo = fakeRepoTimeline({
      competencia: { id: "comp-1", ano: 2026, mes: 7, status: "ABERTA" },
      comentarios: [
        comentario({ id: "c-int", visibilidade: "interna" }),
        comentario({ id: "c-pub", visibilidade: "compartilhada" }),
      ],
    })
    const r = await carregarTimeline(ESCOPO, { competencia: "2026-07", contexto: "compartilhado" }, { repo })
    expect(repo.chamadas.comentarios[0]).toMatchObject({ visibilidade: "compartilhada" })
    expect(r.timeline.itens.map((i) => i.id)).toEqual(["comentario:c-pub"])
  })

  it("competência malformada é recusada com erro tipado", async () => {
    const repo = fakeRepoTimeline({})
    await expect(
      carregarTimeline(ESCOPO, { competencia: "2026-99" }, { repo }),
    ).rejects.toBeInstanceOf(ComentarioValidacaoError)
  })

  it("limite é normalizado dentro da faixa permitida", async () => {
    const repo = fakeRepoTimeline({ competencia: { id: "comp-1", ano: 2026, mes: 7, status: "ABERTA" } })
    await carregarTimeline(ESCOPO, { competencia: "2026-07", limite: 99999 }, { repo })
    expect(repo.chamadas.eventos[0]).toMatchObject({ limite: 500 })
  })
})
