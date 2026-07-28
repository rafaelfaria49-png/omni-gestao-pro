/**
 * GOAL CONTADOR-HUB-STATUS-COMENTARIOS-011 — serviço de transição de status.
 *
 * Os testes exercitam o REPOSITÓRIO REAL (`criarRepoStatus`) contra um cliente
 * in-memory que implementa `$transaction` com semântica de commit/rollback. Assim
 * a atomicidade testada é a do código que vai para produção, não a de um mock do
 * próprio serviço. Nenhum banco é tocado.
 */
import { describe, expect, it } from "vitest"
import {
  MotivoObrigatorioError,
  PermissaoTransicaoError,
  StatusInvalidoError,
  TransicaoConcorrenteError,
  TransicaoInvalidaError,
} from "@/lib/contador/status/matriz"
import { criarRepoStatus, type StatusDbClient, type StatusTxClient } from "@/lib/contador/status/repo-prisma"
import { alterarStatusDocumento, EVENTO_STATUS_ALTERADO } from "@/lib/contador/status/service"
import {
  CompetenciaFechadaError,
  DocumentoNaoEncontradoError,
} from "@/lib/contador/documentos/service"

/* ─────────────────────── cliente in-memory transacional ─────────────────────── */

type DocRow = {
  id: string
  competenciaId: string
  storeId: string
  titulo: string
  categoria: string
  status: string
  vencimento: Date | null
  excluidoEm: Date | null
  updatedAt: Date
  competencia: { status: string; ano: number; mes: number }
}

type Estado = {
  docs: DocRow[]
  comentarios: Record<string, unknown>[]
  eventos: Record<string, unknown>[]
}

type FakeDb = StatusDbClient & {
  estado: Estado
  /** Liga a falha do `contadorEvento.create` (teste de rollback). */
  falharEvento: boolean
  /** Liga a falha do `contadorComentario.create`. */
  falharComentario: boolean
  transacoes: number
}

function clone(e: Estado): Estado {
  return {
    docs: e.docs.map((d) => ({ ...d, competencia: { ...d.competencia } })),
    comentarios: e.comentarios.map((c) => ({ ...c })),
    eventos: e.eventos.map((v) => ({ ...v })),
  }
}

function fakeDb(docs: DocRow[]): FakeDb {
  const db = {
    estado: { docs, comentarios: [], eventos: [] } as Estado,
    falharEvento: false,
    falharComentario: false,
    transacoes: 0,
  } as FakeDb

  const ops: StatusTxClient = {
    contadorDocumento: {
      async findFirst({ where }) {
        // Escopo por loja no WHERE — igual ao Prisma real.
        return db.estado.docs.find((d) => d.id === where.id && d.storeId === where.storeId) ?? null
      },
      async updateMany({ where, data }) {
        const alvo = db.estado.docs.filter(
          (d) =>
            d.id === where.id &&
            d.storeId === where.storeId &&
            d.status === where.status &&
            d.excluidoEm === where.excluidoEm,
        )
        for (const d of alvo) {
          d.status = data.status
          d.updatedAt = new Date(d.updatedAt.getTime() + 1000)
        }
        return { count: alvo.length }
      },
    },
    contadorComentario: {
      async create({ data }) {
        if (db.falharComentario) throw new Error("falha simulada ao criar comentário")
        db.estado.comentarios.push({ ...data })
        return { id: data.id }
      },
    },
    contadorEvento: {
      async create({ data }) {
        if (db.falharEvento) throw new Error("falha simulada ao criar evento")
        db.estado.eventos.push({ ...data })
        return { id: `ev-${db.estado.eventos.length}` }
      },
    },
  }

  Object.assign(db, ops)
  db.$transaction = async <T,>(fn: (tx: StatusTxClient) => Promise<T>): Promise<T> => {
    db.transacoes += 1
    const snapshot = clone(db.estado)
    try {
      return await fn(ops)
    } catch (e) {
      // ROLLBACK real: descarta tudo que a transação escreveu.
      db.estado.docs = snapshot.docs
      db.estado.comentarios = snapshot.comentarios
      db.estado.eventos = snapshot.eventos
      throw e
    }
  }
  return db
}

/* ─────────────────────────── fixtures ─────────────────────────── */

const AGORA = new Date("2026-07-28T12:00:00.000Z")
const ESCOPO_A = { storeId: "loja-1", userId: "user-1" }
const ESCOPO_B = { storeId: "loja-2", userId: "user-2" }
const ELEVADO = { acessaHub: true, podeConferir: true } as const
const BASICO = { acessaHub: true, podeConferir: false } as const

function doc(over: Partial<DocRow> = {}): DocRow {
  return {
    id: "doc-1",
    competenciaId: "comp-1",
    storeId: "loja-1",
    titulo: "DAS Julho",
    categoria: "FISCAL",
    status: "PENDENTE",
    vencimento: null,
    excluidoEm: null,
    updatedAt: new Date("2026-07-20T10:00:00.000Z"),
    competencia: { status: "ABERTA", ano: 2026, mes: 7 },
    ...over,
  }
}

function montar(docs: DocRow[]) {
  const db = fakeDb(docs)
  return { db, repo: criarRepoStatus(db) }
}

/* ─────────────────────────── caminho feliz ─────────────────────────── */

describe("status · ciclo completo persistido", () => {
  it("pendente → enviado grava status + evento na MESMA transação", async () => {
    const { db, repo } = montar([doc()])
    const dto = await alterarStatusDocumento(ESCOPO_A, BASICO, { documentoId: "doc-1", para: "ENVIADO" }, { repo }, AGORA)

    expect(dto.status).toBe("ENVIADO")
    expect(db.estado.docs[0].status).toBe("ENVIADO")
    expect(db.estado.eventos).toHaveLength(1)
    expect(db.transacoes).toBe(1)

    const ev = db.estado.eventos[0]
    expect(ev.tipo).toBe(EVENTO_STATUS_ALTERADO)
    expect(ev.entidade).toBe("documento")
    expect(ev.entidadeId).toBe("doc-1")
    expect(ev.storeId).toBe("loja-1")
    expect(ev.competenciaId).toBe("comp-1")
    expect(ev.atorId).toBe("user-1")
    expect(ev.metadata).toMatchObject({
      statusAnterior: "PENDENTE",
      statusNovo: "ENVIADO",
      acao: "enviar",
      competencia: "2026-07",
    })
  })

  it("enviado → conferido → resolvido com papel elevado", async () => {
    const { db, repo } = montar([doc({ status: "ENVIADO" })])
    await alterarStatusDocumento(ESCOPO_A, ELEVADO, { documentoId: "doc-1", para: "conferido" }, { repo }, AGORA)
    const dto = await alterarStatusDocumento(ESCOPO_A, ELEVADO, { documentoId: "doc-1", para: "RESOLVIDO" }, { repo }, AGORA)

    expect(dto.status).toBe("RESOLVIDO")
    expect(dto.transicoes).toEqual([])
    expect(db.estado.eventos).toHaveLength(2)
  })

  it("o DTO devolve `vencido` derivado e nunca um status VENCIDO", async () => {
    const { repo } = montar([doc({ status: "PENDENTE", vencimento: new Date("2026-07-01T00:00:00.000Z") })])
    const dto = await alterarStatusDocumento(ESCOPO_A, BASICO, { documentoId: "doc-1", para: "ENVIADO" }, { repo }, AGORA)
    expect(dto.status).toBe("ENVIADO")
    expect(dto.vencido).toBe(true)
  })

  it("documento resolvido e vencido não aparece como vencido", async () => {
    const { repo } = montar([doc({ status: "CONFERIDO", vencimento: new Date("2020-01-01T00:00:00.000Z") })])
    const dto = await alterarStatusDocumento(ESCOPO_A, ELEVADO, { documentoId: "doc-1", para: "RESOLVIDO" }, { repo }, AGORA)
    expect(dto.vencido).toBe(false)
  })
})

/* ─────────────────────────── transições recusadas ─────────────────────────── */

describe("status · transições fora da matriz não escrevem nada", () => {
  it("pendente → conferido é recusado com erro tipado", async () => {
    const { db, repo } = montar([doc()])
    await expect(
      alterarStatusDocumento(ESCOPO_A, ELEVADO, { documentoId: "doc-1", para: "CONFERIDO" }, { repo }, AGORA),
    ).rejects.toBeInstanceOf(TransicaoInvalidaError)
    expect(db.estado.docs[0].status).toBe("PENDENTE")
    expect(db.estado.eventos).toHaveLength(0)
    expect(db.transacoes).toBe(0)
  })

  it("resolvido → qualquer coisa é recusado (estado terminal)", async () => {
    const { db, repo } = montar([doc({ status: "RESOLVIDO" })])
    for (const para of ["PENDENTE", "ENVIADO", "CONFERIDO", "RESOLVIDO"]) {
      await expect(
        alterarStatusDocumento(ESCOPO_A, ELEVADO, { documentoId: "doc-1", para }, { repo }, AGORA),
      ).rejects.toBeInstanceOf(TransicaoInvalidaError)
    }
    expect(db.estado.eventos).toHaveLength(0)
  })

  it("status alvo inexistente (`vencido`) é recusado antes de qualquer leitura", async () => {
    const { db, repo } = montar([doc()])
    await expect(
      alterarStatusDocumento(ESCOPO_A, ELEVADO, { documentoId: "doc-1", para: "VENCIDO" }, { repo }, AGORA),
    ).rejects.toBeInstanceOf(StatusInvalidoError)
    expect(db.estado.eventos).toHaveLength(0)
  })

  it("competência FECHADA bloqueia transição (409), sem escrita", async () => {
    const { db, repo } = montar([doc({ competencia: { status: "FECHADA", ano: 2026, mes: 7 } })])
    await expect(
      alterarStatusDocumento(ESCOPO_A, ELEVADO, { documentoId: "doc-1", para: "ENVIADO" }, { repo }, AGORA),
    ).rejects.toBeInstanceOf(CompetenciaFechadaError)
    expect(db.estado.docs[0].status).toBe("PENDENTE")
    expect(db.estado.eventos).toHaveLength(0)
  })

  it("documento excluído logicamente não transiciona", async () => {
    const { db, repo } = montar([doc({ status: "ENVIADO", excluidoEm: new Date() })])
    await expect(
      alterarStatusDocumento(ESCOPO_A, ELEVADO, { documentoId: "doc-1", para: "CONFERIDO" }, { repo }, AGORA),
    ).rejects.toBeInstanceOf(DocumentoNaoEncontradoError)
    expect(db.estado.eventos).toHaveLength(0)
  })
})

/* ─────────────────────────── rejeição exige motivo ─────────────────────────── */

describe("status · rejeição exige comentário/motivo", () => {
  it.each([undefined, "", "   ", null, 42])("motivo %s → recusa sem alterar nada", async (motivo) => {
    const { db, repo } = montar([doc({ status: "ENVIADO" })])
    await expect(
      alterarStatusDocumento(
        ESCOPO_A,
        ELEVADO,
        { documentoId: "doc-1", para: "PENDENTE", motivo },
        { repo },
        AGORA,
      ),
    ).rejects.toBeInstanceOf(MotivoObrigatorioError)
    expect(db.estado.docs[0].status).toBe("ENVIADO")
    expect(db.estado.eventos).toHaveLength(0)
    expect(db.estado.comentarios).toHaveLength(0)
    expect(db.transacoes).toBe(0)
  })

  it("com motivo: volta a pendente, grava comentário INTERNO e referencia no evento", async () => {
    const { db, repo } = montar([doc({ status: "CONFERIDO" })])
    await alterarStatusDocumento(
      ESCOPO_A,
      ELEVADO,
      { documentoId: "doc-1", para: "PENDENTE", motivo: "  extrato incompleto  " },
      { repo },
      AGORA,
    )

    expect(db.estado.docs[0].status).toBe("PENDENTE")
    expect(db.estado.comentarios).toHaveLength(1)
    const cmt = db.estado.comentarios[0]
    expect(cmt.visibilidade).toBe("interna")
    expect(cmt.texto).toBe("extrato incompleto")
    expect(cmt.documentoId).toBe("doc-1")
    expect(cmt.competenciaId).toBe("comp-1")

    const meta = db.estado.eventos[0].metadata as Record<string, unknown>
    expect(meta.acao).toBe("rejeitar")
    expect(meta.motivoComentarioId).toBe(cmt.id)
    expect(meta.motivoLen).toBe("extrato incompleto".length)
    // Ajuste G2-05: o TEXTO livre nunca entra na metadata do evento.
    expect(JSON.stringify(meta)).not.toContain("extrato incompleto")
  })
})

/* ─────────────────────────── permissões ─────────────────────────── */

describe("status · permissões (403 sem escrita parcial)", () => {
  it("papel sem capacidade não confere", async () => {
    const { db, repo } = montar([doc({ status: "ENVIADO" })])
    await expect(
      alterarStatusDocumento(ESCOPO_A, BASICO, { documentoId: "doc-1", para: "CONFERIDO" }, { repo }, AGORA),
    ).rejects.toBeInstanceOf(PermissaoTransicaoError)
    expect(db.estado.docs[0].status).toBe("ENVIADO")
    expect(db.estado.eventos).toHaveLength(0)
    expect(db.transacoes).toBe(0)
  })

  it("papel sem capacidade não resolve", async () => {
    const { db, repo } = montar([doc({ status: "CONFERIDO" })])
    await expect(
      alterarStatusDocumento(ESCOPO_A, BASICO, { documentoId: "doc-1", para: "RESOLVIDO" }, { repo }, AGORA),
    ).rejects.toBeInstanceOf(PermissaoTransicaoError)
    expect(db.estado.docs[0].status).toBe("CONFERIDO")
    expect(db.estado.eventos).toHaveLength(0)
  })

  it("papel sem capacidade ainda pode enviar e rejeitar", async () => {
    const { db, repo } = montar([doc({ status: "PENDENTE" })])
    await alterarStatusDocumento(ESCOPO_A, BASICO, { documentoId: "doc-1", para: "ENVIADO" }, { repo }, AGORA)
    await alterarStatusDocumento(
      ESCOPO_A,
      BASICO,
      { documentoId: "doc-1", para: "PENDENTE", motivo: "faltou anexo" },
      { repo },
      AGORA,
    )
    expect(db.estado.docs[0].status).toBe("PENDENTE")
    expect(db.estado.eventos).toHaveLength(2)
  })
})

/* ─────────────────────────── isolamento multi-loja ─────────────────────────── */

describe("status · isolamento por loja", () => {
  it("usuário da loja B não altera documento da loja A (404, não 403)", async () => {
    const { db, repo } = montar([doc()])
    await expect(
      alterarStatusDocumento(ESCOPO_B, ELEVADO, { documentoId: "doc-1", para: "ENVIADO" }, { repo }, AGORA),
    ).rejects.toBeInstanceOf(DocumentoNaoEncontradoError)
    expect(db.estado.docs[0].status).toBe("PENDENTE")
    expect(db.estado.eventos).toHaveLength(0)
  })

  it("mesmo id em lojas diferentes: cada escopo só mexe no seu", async () => {
    const { db, repo } = montar([
      doc({ id: "doc-x", storeId: "loja-1", competenciaId: "comp-1" }),
      doc({ id: "doc-x2", storeId: "loja-2", competenciaId: "comp-2" }),
    ])
    await alterarStatusDocumento(ESCOPO_A, BASICO, { documentoId: "doc-x", para: "ENVIADO" }, { repo }, AGORA)
    expect(db.estado.docs.find((d) => d.id === "doc-x")?.status).toBe("ENVIADO")
    expect(db.estado.docs.find((d) => d.id === "doc-x2")?.status).toBe("PENDENTE")
    expect(db.estado.eventos.every((e) => e.storeId === "loja-1")).toBe(true)
  })

  it("o evento herda a loja do ESCOPO, não do corpo da requisição", async () => {
    const { db, repo } = montar([doc()])
    await alterarStatusDocumento(
      ESCOPO_A,
      BASICO,
      // `storeId` no corpo é ignorado: o serviço não o lê.
      { documentoId: "doc-1", para: "ENVIADO", ...({ storeId: "loja-9" } as object) },
      { repo },
      AGORA,
    )
    expect(db.estado.eventos[0].storeId).toBe("loja-1")
  })
})

/* ─────────────────────────── atomicidade ─────────────────────────── */

describe("status · atomicidade status ⇄ evento", () => {
  it("falha ao criar o evento DESFAZ a mudança de status", async () => {
    const { db, repo } = montar([doc({ status: "PENDENTE" })])
    db.falharEvento = true
    await expect(
      alterarStatusDocumento(ESCOPO_A, BASICO, { documentoId: "doc-1", para: "ENVIADO" }, { repo }, AGORA),
    ).rejects.toThrow(/falha simulada ao criar evento/)
    expect(db.estado.docs[0].status).toBe("PENDENTE")
    expect(db.estado.eventos).toHaveLength(0)
  })

  it("falha ao gravar o comentário do motivo desfaz status E não deixa evento", async () => {
    const { db, repo } = montar([doc({ status: "ENVIADO" })])
    db.falharComentario = true
    await expect(
      alterarStatusDocumento(
        ESCOPO_A,
        ELEVADO,
        { documentoId: "doc-1", para: "PENDENTE", motivo: "documento ilegível" },
        { repo },
        AGORA,
      ),
    ).rejects.toThrow(/falha simulada ao criar comentário/)
    expect(db.estado.docs[0].status).toBe("ENVIADO")
    expect(db.estado.eventos).toHaveLength(0)
    expect(db.estado.comentarios).toHaveLength(0)
  })

  it("corrida: se o status mudou entre leitura e escrita, nada é gravado (sem evento órfão)", async () => {
    const { db, repo } = montar([doc({ status: "PENDENTE" })])
    // Simula outra sessão vencendo a corrida logo após a leitura do serviço.
    const original = repo.acharDocumentoParaTransicao.bind(repo)
    repo.acharDocumentoParaTransicao = async (id, storeId) => {
      const lido = await original(id, storeId)
      db.estado.docs[0].status = "ENVIADO"
      return lido
    }

    await expect(
      alterarStatusDocumento(ESCOPO_A, BASICO, { documentoId: "doc-1", para: "ENVIADO" }, { repo }, AGORA),
    ).rejects.toBeInstanceOf(TransicaoConcorrenteError)
    expect(db.estado.eventos).toHaveLength(0)
    expect(db.estado.comentarios).toHaveLength(0)
  })
})
