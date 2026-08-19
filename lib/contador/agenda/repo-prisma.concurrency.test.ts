/**
 * GOAL 016 — concorrência no adapter Prisma da agenda.
 *
 * Exercita `criarRepoAgenda` contra um cliente in-memory com `$transaction`
 * (commit/rollback) e semântica de `updateMany` (count). Nenhum banco real.
 *
 * Freeze = `contadorCompetencia.updateMany` com `status: { not: "FECHADA" }`
 * na mesma tx da linha-filha + evento (primitive do GOAL 012).
 */
import { describe, expect, it } from "vitest"
import { CompetenciaFechadaError } from "@/lib/contador/documentos/service"
import {
  criarRepoAgenda,
  travarCompetenciaNaoFechada,
  type AgendaDbClient,
  type AgendaTxClient,
} from "./repo-prisma"
import { GuiaNaoEncontradaError, GuiaPagaError } from "./erros"
import type { GuiaCreateInput, ObrigacaoCreateInput } from "./service"
import type { NovoEventoAgenda } from "./tipos"

type CompRow = { id: string; storeId: string; ano: number; mes: number; status: string }

type ObgRow = {
  id: string
  storeId: string
  competenciaId: string
  templateId: string | null
  titulo: string
  descricao: string | null
  tipo: string
  vencimento: Date | null
  status: string
  criadoPorTipo: string
  criadoPorId: string
  createdAt: Date
  updatedAt: Date
}

type GuiaRowDb = {
  id: string
  storeId: string
  competenciaId: string
  obrigacaoId: string | null
  titulo: string
  valorCentavos: number
  vencimento: Date
  origem: string
  pdfDocumentoId: string | null
  comprovanteDocumentoId: string | null
  pagaEm: Date | null
  criadoPorTipo: string
  criadoPorId: string
  createdAt: Date
  updatedAt: Date
}

type Estado = {
  competencias: CompRow[]
  obrigacoes: ObgRow[]
  guias: GuiaRowDb[]
  eventos: Record<string, unknown>[]
}

type FakeDb = AgendaDbClient & {
  estado: Estado
  transacoes: number
  /** Fecha a competência DEPOIS da leitura da tx e ANTES do updateMany-trava. */
  antesDeTravar: (() => void) | null
  /** Marca a guia paga DEPOIS da trava e ANTES do updateMany da guia. */
  antesDeUpdateGuia: (() => void) | null
}

function clone(e: Estado): Estado {
  return {
    competencias: e.competencias.map((c) => ({ ...c })),
    obrigacoes: e.obrigacoes.map((o) => ({ ...o })),
    guias: e.guias.map((g) => ({ ...g })),
    eventos: e.eventos.map((v) => ({ ...v })),
  }
}

function hidratarObg(estado: Estado, o: ObgRow) {
  const c = estado.competencias.find((x) => x.id === o.competenciaId) ?? {
    ano: 2026,
    mes: 7,
    status: "ABERTA",
  }
  return { ...o, competencia: { ano: c.ano, mes: c.mes, status: c.status } }
}

function hidratarGuia(estado: Estado, g: GuiaRowDb) {
  const c = estado.competencias.find((x) => x.id === g.competenciaId) ?? {
    ano: 2026,
    mes: 7,
    status: "ABERTA",
  }
  return { ...g, competencia: { ano: c.ano, mes: c.mes, status: c.status } }
}

function casaStatusNot(where: Record<string, unknown>, status: string): boolean {
  const s = where.status as { not?: string } | string | undefined
  if (s && typeof s === "object" && "not" in s) return status !== s.not
  if (typeof s === "string") return status === s
  return true
}

function fakeDb(seed: Partial<Estado> = {}): FakeDb {
  const db = {
    estado: {
      competencias: seed.competencias ?? [],
      obrigacoes: seed.obrigacoes ?? [],
      guias: seed.guias ?? [],
      eventos: seed.eventos ?? [],
    } as Estado,
    transacoes: 0,
    antesDeTravar: null,
    antesDeUpdateGuia: null,
  } as FakeDb

  const agora = () => new Date("2026-07-16T12:00:00.000Z")

  const ops: AgendaTxClient = {
    contadorCompetencia: {
      async findFirst({ where }) {
        const w = where as { id?: string; storeId?: string; ano?: number; mes?: number }
        return (
          db.estado.competencias.find((c) => {
            if (w.id && c.id !== w.id) return false
            if (w.storeId && c.storeId !== w.storeId) return false
            if (w.ano != null && c.ano !== w.ano) return false
            if (w.mes != null && c.mes !== w.mes) return false
            return true
          }) ?? null
        )
      },
      async updateMany({ where, data }) {
        await db.antesDeTravar?.()
        const w = where as { id: string; storeId: string; status?: { not?: string } }
        const alvo = db.estado.competencias.filter(
          (c) => c.id === w.id && c.storeId === w.storeId && casaStatusNot(where, c.status),
        )
        for (const c of alvo) {
          if (typeof data.storeId === "string") c.storeId = data.storeId
          if (typeof data.status === "string") c.status = data.status
        }
        return { count: alvo.length }
      },
    },
    contadorObrigacaoTemplate: {
      async findMany() {
        return []
      },
      async findFirst() {
        return null
      },
      async create() {
        throw new Error("não usado neste teste")
      },
      async update() {
        throw new Error("não usado neste teste")
      },
      async deleteMany() {
        return { count: 0 }
      },
      async count() {
        return 0
      },
    },
    contadorObrigacao: {
      async findMany({ where }) {
        const w = where as { competenciaId?: string; storeId?: string }
        return db.estado.obrigacoes
          .filter((o) => (!w.competenciaId || o.competenciaId === w.competenciaId) && (!w.storeId || o.storeId === w.storeId))
          .map((o) => hidratarObg(db.estado, o)) as never
      },
      async findFirst({ where }) {
        const w = where as {
          id?: string
          storeId?: string
          templateId?: string
          competenciaId?: string
        }
        const o = db.estado.obrigacoes.find((x) => {
          if (w.id && x.id !== w.id) return false
          if (w.storeId && x.storeId !== w.storeId) return false
          if (w.templateId && x.templateId !== w.templateId) return false
          if (w.competenciaId && x.competenciaId !== w.competenciaId) return false
          return true
        })
        return o ? (hidratarObg(db.estado, o) as never) : null
      },
      async create({ data }) {
        const d = data as ObgRow
        if (d.templateId) {
          const dup = db.estado.obrigacoes.find(
            (x) => x.templateId === d.templateId && x.competenciaId === d.competenciaId && x.storeId === d.storeId,
          )
          if (dup) {
            const err = new Error("unique") as Error & { code: string }
            err.code = "P2002"
            throw err
          }
        }
        const row: ObgRow = {
          ...d,
          createdAt: agora(),
          updatedAt: agora(),
        }
        db.estado.obrigacoes.push(row)
        return hidratarObg(db.estado, row) as never
      },
      async updateMany({ where, data }) {
        const w = where as { id: string; storeId: string; status?: string }
        const alvo = db.estado.obrigacoes.filter((o) => {
          if (o.id !== w.id || o.storeId !== w.storeId) return false
          if (w.status && o.status !== w.status) return false
          return true
        })
        for (const o of alvo) Object.assign(o, data, { updatedAt: agora() })
        return { count: alvo.length }
      },
      async count({ where }) {
        const w = where as { templateId?: string; storeId?: string }
        return db.estado.obrigacoes.filter(
          (o) => (!w.templateId || o.templateId === w.templateId) && (!w.storeId || o.storeId === w.storeId),
        ).length
      },
    },
    contadorGuia: {
      async findMany({ where }) {
        const w = where as { competenciaId?: string; storeId?: string }
        return db.estado.guias
          .filter((g) => (!w.competenciaId || g.competenciaId === w.competenciaId) && (!w.storeId || g.storeId === w.storeId))
          .map((g) => hidratarGuia(db.estado, g)) as never
      },
      async findFirst({ where }) {
        const w = where as { id?: string; storeId?: string; pagaEm?: null }
        const g = db.estado.guias.find((x) => {
          if (w.id && x.id !== w.id) return false
          if (w.storeId && x.storeId !== w.storeId) return false
          if ("pagaEm" in w && w.pagaEm === null && x.pagaEm !== null) return false
          return true
        })
        return g ? (hidratarGuia(db.estado, g) as never) : null
      },
      async create({ data }) {
        const d = data as GuiaRowDb
        const row: GuiaRowDb = { ...d, createdAt: agora(), updatedAt: agora() }
        db.estado.guias.push(row)
        return hidratarGuia(db.estado, row) as never
      },
      async updateMany({ where, data }) {
        await db.antesDeUpdateGuia?.()
        const w = where as { id: string; storeId: string; pagaEm?: null }
        const alvo = db.estado.guias.filter((g) => {
          if (g.id !== w.id || g.storeId !== w.storeId) return false
          if ("pagaEm" in w && w.pagaEm === null && g.pagaEm !== null) return false
          return true
        })
        for (const g of alvo) Object.assign(g, data, { updatedAt: agora() })
        return { count: alvo.length }
      },
    },
    contadorDocumento: {
      async findFirst() {
        return null
      },
    },
    contadorEvento: {
      async create({ data }) {
        db.estado.eventos.push({ ...data })
        return { id: `ev-${db.estado.eventos.length}` }
      },
    },
  }

  Object.assign(db, ops)

  let fila: Promise<unknown> = Promise.resolve()
  db.$transaction = <T,>(fn: (tx: AgendaTxClient) => Promise<T>): Promise<T> => {
    const executar = async (): Promise<T> => {
      db.transacoes += 1
      const snapshot = clone(db.estado)
      try {
        return await fn(ops)
      } catch (e) {
        db.estado = snapshot
        throw e
      }
    }
    const resultado = fila.then(executar, executar)
    fila = resultado.then(
      () => undefined,
      () => undefined,
    )
    return resultado
  }
  return db
}

const COMP: CompRow = { id: "comp-1", storeId: "loja-1", ano: 2026, mes: 7, status: "ABERTA" }

function ev(over: Partial<NovoEventoAgenda> = {}): NovoEventoAgenda {
  return {
    storeId: "loja-1",
    competenciaId: "comp-1",
    tipo: "obrigacao_criada",
    atorTipo: "interno",
    atorId: "u1",
    entidade: "obrigacao",
    entidadeId: "obg-1",
    origem: "contador.agenda",
    metadata: { titulo: "x" },
    ...over,
  }
}

function obgInput(over: Partial<ObrigacaoCreateInput> = {}): ObrigacaoCreateInput {
  return {
    id: "obg-1",
    storeId: "loja-1",
    competenciaId: "comp-1",
    templateId: null,
    titulo: "Manual",
    descricao: null,
    tipo: "TAREFA",
    vencimento: null,
    status: "PENDENTE",
    criadoPorTipo: "interno",
    criadoPorId: "u1",
    ...over,
  }
}

function guiaInput(over: Partial<GuiaCreateInput> = {}): GuiaCreateInput {
  return {
    id: "guia-1",
    storeId: "loja-1",
    competenciaId: "comp-1",
    obrigacaoId: null,
    titulo: "DAS",
    valorCentavos: 100,
    vencimento: new Date("2026-07-20T00:00:00.000Z"),
    origem: "MANUAL",
    pdfDocumentoId: null,
    comprovanteDocumentoId: null,
    pagaEm: null,
    criadoPorTipo: "interno",
    criadoPorId: "u1",
    ...over,
  }
}

function seedGuia(over: Partial<GuiaRowDb> = {}): GuiaRowDb {
  return {
    ...guiaInput(),
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    ...over,
  }
}

function seedObg(over: Partial<ObgRow> = {}): ObgRow {
  return {
    ...obgInput(),
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    ...over,
  }
}

describe("travarCompetenciaNaoFechada", () => {
  it("count 0 (FECHADA) → CompetenciaFechadaError", async () => {
    const db = fakeDb({ competencias: [{ ...COMP, status: "FECHADA" }] })
    await expect(travarCompetenciaNaoFechada(db, "loja-1", "comp-1")).rejects.toBeInstanceOf(CompetenciaFechadaError)
  })

  it("ABERTA → count 1", async () => {
    const db = fakeDb({ competencias: [{ ...COMP }] })
    await travarCompetenciaNaoFechada(db, "loja-1", "comp-1")
    expect(db.estado.competencias[0]?.status).toBe("ABERTA")
  })
})

describe("adapter Prisma · corrida de freeze", () => {
  it("A: fecha entre início da tx e a trava → create obrigação aborta sem evento", async () => {
    const db = fakeDb({ competencias: [{ ...COMP }] })
    db.antesDeTravar = () => {
      const c = db.estado.competencias[0]
      if (c) c.status = "FECHADA"
    }
    const repo = criarRepoAgenda(db)
    await expect(repo.criarObrigacao(obgInput(), ev())).rejects.toBeInstanceOf(CompetenciaFechadaError)
    expect(db.estado.obrigacoes).toHaveLength(0)
    expect(db.estado.eventos).toHaveLength(0)
  })

  it("B: fecha entre início da tx e a trava → create guia aborta sem evento", async () => {
    const db = fakeDb({ competencias: [{ ...COMP }] })
    db.antesDeTravar = () => {
      const c = db.estado.competencias[0]
      if (c) c.status = "FECHADA"
    }
    const repo = criarRepoAgenda(db)
    await expect(
      repo.criarGuia(guiaInput(), ev({ tipo: "guia_informada", entidade: "guia", entidadeId: "guia-1" })),
    ).rejects.toBeInstanceOf(CompetenciaFechadaError)
    expect(db.estado.guias).toHaveLength(0)
    expect(db.estado.eventos).toHaveLength(0)
  })

  it("C: fecha antes do updateMany de status → status intacto, zero evento", async () => {
    const db = fakeDb({
      competencias: [{ ...COMP }],
      obrigacoes: [seedObg()],
    })
    db.antesDeTravar = () => {
      const c = db.estado.competencias[0]
      if (c) c.status = "FECHADA"
    }
    const repo = criarRepoAgenda(db)
    await expect(
      repo.aplicarStatusObrigacao({
        id: "obg-1",
        storeId: "loja-1",
        de: "PENDENTE",
        para: "ENVIADO",
        evento: ev({ tipo: "obrigacao_status_alterado" }),
      }),
    ).rejects.toBeInstanceOf(CompetenciaFechadaError)
    expect(db.estado.obrigacoes[0]?.status).toBe("PENDENTE")
    expect(db.estado.eventos).toHaveLength(0)
  })

  it("D: fecha durante lote de 2 → zero linhas, zero eventos (não parcial)", async () => {
    const db = fakeDb({ competencias: [{ ...COMP }] })
    db.antesDeTravar = () => {
      const c = db.estado.competencias[0]
      if (c) c.status = "FECHADA"
    }
    const repo = criarRepoAgenda(db)
    await expect(
      repo.criarObrigacoesEmLote([
        {
          row: obgInput({ id: "obg-a", templateId: "tpl-a", titulo: "DAS" }),
          evento: ev({ entidadeId: "obg-a" }),
        },
        {
          row: obgInput({ id: "obg-b", templateId: "tpl-b", titulo: "FGTS" }),
          evento: ev({ entidadeId: "obg-b" }),
        },
      ]),
    ).rejects.toBeInstanceOf(CompetenciaFechadaError)
    expect(db.estado.obrigacoes).toHaveLength(0)
    expect(db.estado.eventos).toHaveLength(0)
  })

  it("E: guia vira paga entre trava e PATCH → GUIA_PAGA, título intacto, zero evento", async () => {
    const db = fakeDb({
      competencias: [{ ...COMP }],
      guias: [seedGuia({ titulo: "original" })],
    })
    db.antesDeUpdateGuia = () => {
      const g = db.estado.guias[0]
      if (g) g.pagaEm = new Date("2026-07-16T12:00:00.000Z")
    }
    const repo = criarRepoAgenda(db)
    await expect(
      repo.atualizarGuia(
        "guia-1",
        "loja-1",
        { titulo: "hackeado" },
        ev({ tipo: "guia_atualizada", entidade: "guia", entidadeId: "guia-1" }),
      ),
    ).rejects.toBeInstanceOf(GuiaPagaError)
    expect(db.estado.guias[0]?.titulo).toBe("original")
    expect(db.estado.eventos).toHaveLength(0)
  })

  it("E2: guia de outra loja no PATCH → 404, zero evento", async () => {
    const db = fakeDb({
      competencias: [{ ...COMP }],
      guias: [seedGuia()],
    })
    const repo = criarRepoAgenda(db)
    await expect(
      repo.atualizarGuia("guia-1", "loja-2", { titulo: "x" }, ev({ storeId: "loja-2" })),
    ).rejects.toBeInstanceOf(GuiaNaoEncontradaError)
    expect(db.estado.guias[0]?.titulo).toBe("DAS")
    expect(db.estado.eventos).toHaveLength(0)
  })

  it("F: duas marcarGuiaPaga simultâneas → uma vence, a outra GUIA_PAGA, um evento", async () => {
    const db = fakeDb({
      competencias: [{ ...COMP }],
      guias: [seedGuia()],
    })
    const repo = criarRepoAgenda(db)
    const evento = () =>
      ev({ tipo: "guia_paga", entidade: "guia", entidadeId: "guia-1", metadata: { comprovanteAusente: true } })
    const settled = await Promise.allSettled([
      repo.marcarGuiaPaga("guia-1", "loja-1", new Date("2026-07-16T12:00:00.000Z"), null, evento()),
      repo.marcarGuiaPaga("guia-1", "loja-1", new Date("2026-07-16T12:01:00.000Z"), null, evento()),
    ])
    const ok = settled.filter((s) => s.status === "fulfilled")
    const fail = settled.filter((s) => s.status === "rejected")
    expect(ok).toHaveLength(1)
    expect(fail).toHaveLength(1)
    expect(fail[0]!.status === "rejected" && fail[0].reason).toBeInstanceOf(GuiaPagaError)
    expect(db.estado.guias[0]?.pagaEm).toBeTruthy()
    expect(db.estado.eventos).toHaveLength(1)
    expect(db.estado.eventos[0]?.tipo).toBe("guia_paga")
  })

  it("G: unique template+competência — segunda create no lote devolve a existente, sem duplicar", async () => {
    const db = fakeDb({
      competencias: [{ ...COMP }],
      obrigacoes: [seedObg({ id: "obg-existente", templateId: "tpl-1", titulo: "já" })],
    })
    const repo = criarRepoAgenda(db)
    const rows = await repo.criarObrigacoesEmLote([
      {
        row: obgInput({ id: "obg-novo", templateId: "tpl-1", titulo: "novo" }),
        evento: ev({ entidadeId: "obg-novo" }),
      },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe("obg-existente")
    expect(db.estado.obrigacoes.filter((o) => o.templateId === "tpl-1")).toHaveLength(1)
    expect(db.estado.eventos).toHaveLength(0)
  })
})
