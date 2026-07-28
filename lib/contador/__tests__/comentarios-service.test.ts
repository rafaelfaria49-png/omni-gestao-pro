/**
 * GOAL CONTADOR-HUB-STATUS-COMENTARIOS-011 — comentários internos e compartilhados.
 *
 * Duas camadas:
 *  1. o SERVIÇO contra um fake da porta `ComentariosRepo` (regras: texto, visibilidade,
 *     escopo, contexto, evento);
 *  2. o REPOSITÓRIO REAL (`criarRepoComentarios`) contra um cliente in-memory com
 *     `$transaction` de verdade — prova a atomicidade comentário ⇄ evento e o filtro
 *     de loja embutido no `where`.
 *
 * Nenhum banco é tocado.
 */
import { describe, expect, it } from "vitest"
import {
  ComentarioValidacaoError,
  criarComentario,
  listarComentarios,
  EVENTO_COMENTARIO_CRIADO,
  type ComentarioRow,
  type ComentariosRepo,
  type CompetenciaRefComentario,
  type NovoEventoComentario,
} from "@/lib/contador/comentarios/service"
import {
  criarRepoComentarios,
  type ComentariosDbClient,
  type ComentariosTxClient,
} from "@/lib/contador/comentarios/repo-prisma"
import { DocumentoNaoEncontradoError } from "@/lib/contador/documentos/service"

const ESCOPO_A = { storeId: "loja-1", userId: "user-1" }
const ESCOPO_B = { storeId: "loja-2", userId: "user-2" }

/* ─────────────────────── fake da porta (regras do serviço) ─────────────────────── */

type FakeRepo = ComentariosRepo & {
  _comentarios: ComentarioRow[]
  _eventos: NovoEventoComentario[]
  _documentos: { id: string; competenciaId: string; storeId: string }[]
}

function fakeRepo(): FakeRepo {
  const comentarios: ComentarioRow[] = []
  const eventos: NovoEventoComentario[] = []
  const documentos = [{ id: "doc-1", competenciaId: "comp-loja-1-2026-7", storeId: "loja-1" }]
  const chave = (storeId: string, ano: number, mes: number) => `comp-${storeId}-${ano}-${mes}`
  const competencias = new Map<string, CompetenciaRefComentario>()

  const criar = (storeId: string, ano: number, mes: number): CompetenciaRefComentario => {
    const id = chave(storeId, ano, mes)
    const existente = competencias.get(id)
    if (existente) return existente
    const nova = { id, ano, mes, status: "ABERTA" }
    competencias.set(id, nova)
    return nova
  }

  return {
    _comentarios: comentarios,
    _eventos: eventos,
    _documentos: documentos,
    async getOrCreateCompetencia(storeId, comp) {
      return criar(storeId, comp.ano, comp.mes)
    },
    async acharCompetencia(storeId, comp) {
      return competencias.get(chave(storeId, comp.ano, comp.mes)) ?? null
    },
    async documentoPertence({ documentoId, competenciaId, storeId }) {
      return documentos.some(
        (d) => d.id === documentoId && d.competenciaId === competenciaId && d.storeId === storeId,
      )
    },
    async criarComentarioComEvento({ comentario, evento }) {
      const row: ComentarioRow = {
        id: comentario.id,
        competenciaId: comentario.competenciaId,
        documentoId: comentario.documentoId,
        autorTipo: comentario.autorTipo,
        autorId: comentario.autorId,
        visibilidade: comentario.visibilidade,
        texto: comentario.texto,
        createdAt: new Date(2026, 6, 28, 10, comentarios.length),
      }
      comentarios.push(row)
      eventos.push(evento)
      return row
    },
    async listarComentarios({ competenciaId, documentoId, visibilidade, limite }) {
      return comentarios
        .filter((c) => c.competenciaId === competenciaId)
        .filter((c) => (documentoId ? c.documentoId === documentoId : true))
        .filter((c) => (visibilidade ? c.visibilidade === visibilidade : true))
        .slice(0, limite)
    },
  }
}

/* ─────────────────────────── criação ─────────────────────────── */

describe("comentários · criação", () => {
  it("cria comentário interno com autor e loja do ESCOPO e emite evento saneado", async () => {
    const repo = fakeRepo()
    const c = await criarComentario(
      ESCOPO_A,
      { competencia: "2026-07", texto: "  falta o extrato  ", visibilidade: "interna" },
      { repo },
    )

    expect(c.visibilidade).toBe("interna")
    expect(c.texto).toBe("falta o extrato")
    expect(c.autorId).toBe("user-1")
    expect(c.autorTipo).toBe("interno")
    expect(c.documentoId).toBeNull()

    expect(repo._eventos).toHaveLength(1)
    const ev = repo._eventos[0]
    expect(ev.tipo).toBe(EVENTO_COMENTARIO_CRIADO)
    expect(ev.storeId).toBe("loja-1")
    expect(ev.entidade).toBe("comentario")
    expect(ev.entidadeId).toBe(c.id)
    expect(ev.metadata).toMatchObject({
      visibilidade: "interna",
      textoLen: "falta o extrato".length,
      competencia: "2026-07",
    })
    // Ajuste G2-05: o texto NUNCA vai para a metadata do evento.
    expect(JSON.stringify(ev.metadata)).not.toContain("falta o extrato")
  })

  it("cria comentário compartilhado vinculado a um documento da mesma competência", async () => {
    const repo = fakeRepo()
    await repo.getOrCreateCompetencia("loja-1", { ano: 2026, mes: 7 })
    const c = await criarComentario(
      ESCOPO_A,
      {
        competencia: "2026-07",
        documentoId: "doc-1",
        texto: "segue o extrato consolidado",
        visibilidade: "compartilhada",
      },
      { repo },
    )
    expect(c.visibilidade).toBe("compartilhada")
    expect(c.documentoId).toBe("doc-1")
    expect(repo._eventos[0].metadata).toMatchObject({ documentoId: "doc-1" })
  })

  it.each([
    { texto: "", caso: "vazio" },
    { texto: "   ", caso: "só espaço" },
    { texto: null, caso: "nulo" },
    { texto: 42, caso: "não string" },
  ])(
    "texto $caso é recusado sem gravar nada",
    async ({ texto }) => {
      const repo = fakeRepo()
      await expect(
        criarComentario(ESCOPO_A, { competencia: "2026-07", texto, visibilidade: "interna" }, { repo }),
      ).rejects.toBeInstanceOf(ComentarioValidacaoError)
      expect(repo._comentarios).toHaveLength(0)
      expect(repo._eventos).toHaveLength(0)
    },
  )

  it("texto acima do limite é recusado", async () => {
    const repo = fakeRepo()
    await expect(
      criarComentario(
        ESCOPO_A,
        { competencia: "2026-07", texto: "x".repeat(4001), visibilidade: "interna" },
        { repo },
      ),
    ).rejects.toBeInstanceOf(ComentarioValidacaoError)
  })

  it.each(["publica", "", "INTERNO", null])("visibilidade %s é recusada", async (visibilidade) => {
    const repo = fakeRepo()
    await expect(
      criarComentario(ESCOPO_A, { competencia: "2026-07", texto: "ok", visibilidade }, { repo }),
    ).rejects.toBeInstanceOf(ComentarioValidacaoError)
    expect(repo._comentarios).toHaveLength(0)
  })

  it.each(["2026-13", "26-07", "2026/07", "", null])("competência %s é recusada", async (competencia) => {
    const repo = fakeRepo()
    await expect(
      criarComentario(ESCOPO_A, { competencia, texto: "ok", visibilidade: "interna" }, { repo }),
    ).rejects.toBeInstanceOf(ComentarioValidacaoError)
  })

  it("documento de OUTRA loja → 404, sem gravar comentário", async () => {
    const repo = fakeRepo()
    await expect(
      criarComentario(
        ESCOPO_B,
        { competencia: "2026-07", documentoId: "doc-1", texto: "ok", visibilidade: "interna" },
        { repo },
      ),
    ).rejects.toBeInstanceOf(DocumentoNaoEncontradoError)
    expect(repo._comentarios).toHaveLength(0)
    expect(repo._eventos).toHaveLength(0)
  })

  it("documento de outra COMPETÊNCIA da mesma loja → 404", async () => {
    const repo = fakeRepo()
    await expect(
      criarComentario(
        ESCOPO_A,
        { competencia: "2026-06", documentoId: "doc-1", texto: "ok", visibilidade: "interna" },
        { repo },
      ),
    ).rejects.toBeInstanceOf(DocumentoNaoEncontradoError)
    expect(repo._comentarios).toHaveLength(0)
  })
})

/* ─────────────────────────── leitura por contexto ─────────────────────────── */

describe("comentários · contexto interno × compartilhado", () => {
  async function semear() {
    const repo = fakeRepo()
    await criarComentario(
      ESCOPO_A,
      { competencia: "2026-07", texto: "nota interna sigilosa", visibilidade: "interna" },
      { repo },
    )
    await criarComentario(
      ESCOPO_A,
      { competencia: "2026-07", texto: "mensagem ao contador", visibilidade: "compartilhada" },
      { repo },
    )
    return repo
  }

  it("contexto interno enxerga os dois", async () => {
    const repo = await semear()
    const lista = await listarComentarios(ESCOPO_A, { competencia: "2026-07" }, { repo })
    expect(lista).toHaveLength(2)
  })

  it("contexto compartilhado NUNCA devolve comentário interno", async () => {
    const repo = await semear()
    const lista = await listarComentarios(
      ESCOPO_A,
      { competencia: "2026-07", contexto: "compartilhado" },
      { repo },
    )
    expect(lista).toHaveLength(1)
    expect(lista[0].visibilidade).toBe("compartilhada")
    expect(JSON.stringify(lista)).not.toContain("sigilosa")
  })

  it("mesmo se o repositório devolvesse um interno, a projeção o descarta (defesa em profundidade)", async () => {
    const repo = await semear()
    // Repositório "quebrado": ignora o filtro de visibilidade.
    repo.listarComentarios = async ({ competenciaId }) =>
      repo._comentarios.filter((c) => c.competenciaId === competenciaId)
    const lista = await listarComentarios(
      ESCOPO_A,
      { competencia: "2026-07", contexto: "compartilhado" },
      { repo },
    )
    expect(lista).toHaveLength(1)
    expect(lista[0].visibilidade).toBe("compartilhada")
  })

  it("contexto inválido é recusado (não cai em silêncio no caminho interno)", async () => {
    const repo = await semear()
    await expect(
      listarComentarios(ESCOPO_A, { competencia: "2026-07", contexto: "publico" }, { repo }),
    ).rejects.toBeInstanceOf(ComentarioValidacaoError)
  })

  it("competência sem registro devolve lista vazia, não erro", async () => {
    const repo = fakeRepo()
    expect(await listarComentarios(ESCOPO_A, { competencia: "2026-01" }, { repo })).toEqual([])
  })

  it("loja B não lê comentários da loja A (competência distinta por loja)", async () => {
    const repo = await semear()
    expect(await listarComentarios(ESCOPO_B, { competencia: "2026-07" }, { repo })).toEqual([])
  })
})

/* ─────────────────── repositório real: atomicidade + escopo no where ─────────────────── */

type EstadoDb = { comentarios: Record<string, unknown>[]; eventos: Record<string, unknown>[] }

function fakeDbComentarios(): ComentariosDbClient & { estado: EstadoDb; falharEvento: boolean; wheres: unknown[] } {
  const db = {
    estado: { comentarios: [], eventos: [] } as EstadoDb,
    falharEvento: false,
    wheres: [] as unknown[],
  } as ComentariosDbClient & { estado: EstadoDb; falharEvento: boolean; wheres: unknown[] }

  const ops: ComentariosTxClient = {
    contadorComentario: {
      async create({ data }) {
        db.estado.comentarios.push({ ...data })
        return {
          id: data.id,
          competenciaId: data.competenciaId,
          documentoId: data.documentoId,
          autorTipo: data.autorTipo,
          autorId: data.autorId,
          visibilidade: data.visibilidade,
          texto: data.texto,
          createdAt: new Date("2026-07-28T10:00:00.000Z"),
        }
      },
      async findMany({ where }) {
        db.wheres.push(where)
        return []
      },
    },
    contadorDocumento: {
      async findFirst() {
        return null
      },
    },
    contadorCompetencia: {
      async findUnique() {
        return null
      },
    },
    contadorEvento: {
      async create({ data }) {
        if (db.falharEvento) throw new Error("falha simulada ao criar evento")
        db.estado.eventos.push({ ...data })
        return { id: "ev-1" }
      },
    },
  }

  Object.assign(db, ops)
  db.$transaction = async <T,>(fn: (tx: ComentariosTxClient) => Promise<T>): Promise<T> => {
    const snapshot: EstadoDb = {
      comentarios: db.estado.comentarios.map((c) => ({ ...c })),
      eventos: db.estado.eventos.map((e) => ({ ...e })),
    }
    try {
      return await fn(ops)
    } catch (e) {
      db.estado = snapshot
      throw e
    }
  }
  return db
}

const NOVO = {
  id: "cmt-1",
  competenciaId: "comp-1",
  documentoId: null,
  autorTipo: "interno",
  autorId: "user-1",
  visibilidade: "interna" as const,
  texto: "teste",
}
const EVENTO: NovoEventoComentario = {
  storeId: "loja-1",
  competenciaId: "comp-1",
  tipo: EVENTO_COMENTARIO_CRIADO,
  atorTipo: "interno",
  atorId: "user-1",
  entidade: "comentario",
  entidadeId: "cmt-1",
  origem: "contador.comentarios",
  metadata: { visibilidade: "interna", textoLen: 5 },
}

describe("comentários · repositório real", () => {
  it("comentário e evento nascem na MESMA transação", async () => {
    const db = fakeDbComentarios()
    const repo = criarRepoComentarios(db)
    await repo.criarComentarioComEvento({ comentario: NOVO, evento: EVENTO })
    expect(db.estado.comentarios).toHaveLength(1)
    expect(db.estado.eventos).toHaveLength(1)
  })

  it("falha ao gravar o evento desfaz o comentário", async () => {
    const db = fakeDbComentarios()
    db.falharEvento = true
    const repo = criarRepoComentarios(db)
    await expect(
      repo.criarComentarioComEvento({ comentario: NOVO, evento: EVENTO }),
    ).rejects.toThrow(/falha simulada/)
    expect(db.estado.comentarios).toHaveLength(0)
    expect(db.estado.eventos).toHaveLength(0)
  })

  it("a listagem sempre exige a competência DESTA loja no where", async () => {
    const db = fakeDbComentarios()
    const repo = criarRepoComentarios(db)
    await repo.listarComentarios({ competenciaId: "comp-1", storeId: "loja-1", limite: 10 })
    expect(db.wheres[0]).toMatchObject({ competenciaId: "comp-1", competencia: { storeId: "loja-1" } })
  })

  it("contexto compartilhado corta a visibilidade já na consulta", async () => {
    const db = fakeDbComentarios()
    const repo = criarRepoComentarios(db)
    await repo.listarComentarios({
      competenciaId: "comp-1",
      storeId: "loja-1",
      visibilidade: "compartilhada",
      limite: 10,
    })
    expect(db.wheres[0]).toMatchObject({ visibilidade: "compartilhada" })
  })
})
