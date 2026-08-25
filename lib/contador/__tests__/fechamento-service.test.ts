/**
 * GOAL CONTADOR-HUB-FECHAMENTO-SNAPSHOT-012 — fechamento, reabertura, congelamento,
 * refechamento, divergência e segurança.
 *
 * Os testes exercitam o REPOSITÓRIO PRISMA REAL (`criarRepoFechamento`) contra um
 * cliente in-memory que implementa `$transaction` com rollback de verdade, e um storage
 * fake. A atomicidade verificada é a do código que vai para produção — não a de um mock
 * do serviço.
 */
import { describe, expect, it } from "vitest"
import { criarRepoFechamento, type FechamentoDbClient, type FechamentoTxClient } from "@/lib/contador/fechamento/repo-prisma"
import {
  CompetenciaJaFechadaError,
  CompetenciaNaoFechadaError,
  ConfirmacaoInvalidaError,
  FechamentoConcorrenteError,
  MotivoReaberturaObrigatorioError,
  PacoteNaoEncontradoError,
  PendenciaDesconhecidaError,
  PendenciasNaoAssumidasError,
  PermissaoFechamentoError,
  avaliarDivergencia,
  carregarEstadoFechamento,
  extrairTotais,
  fecharCompetencia,
  montarStorageRefPacote,
  reabrirCompetencia,
  registrarDivergencia,
  type FechamentoRepo,
  type PacotePort,
  type StoragePacotePort,
} from "@/lib/contador/fechamento/service"
import { autorizarDownloadPacote, compararVersoes } from "@/lib/contador/pacote/versoes"
import { sha256Texto } from "@/lib/contador/fechamento/canonico"
import {
  SNAPSHOT_CAMINHO_PACOTE,
  verificarSnapshotDoPacote,
} from "@/lib/contador/fechamento/snapshot"
import type { ContadorScopeInterno } from "@/lib/contador/scope-core"
import type { ContadorDadosReais } from "@/lib/contador/readers/tipos"
import type { ChecklistFechamento } from "@/lib/contador/fechamento/tipos"
import type { ArquivoPacote, PacoteContador } from "@/lib/contador/pacote/tipos"

/* ─────────────────────────── fixtures de domínio ─────────────────────────── */

const AGORA = new Date("2026-08-05T12:00:00.000Z")
const COMP = { ano: 2026, mes: 7 }
const CODIGO = "2026-07"
const ELEVADO = { acessaHub: true, podeConferir: true, podeGerenciarAcessoExterno: true } as const
const BASICO = { acessaHub: true, podeConferir: false, podeGerenciarAcessoExterno: false } as const

const SCOPE_A = { ok: true, storeId: "loja-1", userId: "user-1", permissaoContador: true } as unknown as ContadorScopeInterno
const SCOPE_B = { ok: true, storeId: "loja-2", userId: "user-2", permissaoContador: true } as unknown as ContadorScopeInterno
const ESCOPO_A = { storeId: "loja-1", userId: "user-1" }
const ESCOPO_B = { storeId: "loja-2", userId: "user-2" }

function metrica(valor: number | null) {
  return { valor, disponibilidade: "real" as const, fonte: "teste" }
}

function dados(vendasTotal = 1200): ContadorDadosReais {
  return {
    competencia: COMP,
    liquidoCompetencia: metrica(vendasTotal - 200),
    vendas: {
      quantidade: metrica(10),
      total: metrica(vendasTotal),
      canceladasQuantidade: metrica(0),
      canceladasTotal: metrica(0),
      descontoTotal: metrica(0),
      descontoCoberturaQuantidade: metrica(0),
      formasPagamento: [],
      formaPagamentoDisponibilidade: "real",
      naoIdentificadoQuantidade: metrica(0),
      naoIdentificadoValor: metrica(0),
      divergenciaPagamentoQuantidade: metrica(0),
      reconciliacaoPagamento: null,
    },
    devolucoes: { quantidade: metrica(1), total: metrica(200) },
    financeiro: {
      entradasRealizadas: metrica(900),
      saidasRealizadas: metrica(300),
      estornos: metrica(0),
      transferencias: metrica(0),
      transferenciasQuantidade: metrica(0),
      naoClassificados: metrica(0),
      naoClassificadosQuantidade: metrica(0),
      titulosReceberAberto: metrica(50),
      titulosReceberQuantidade: metrica(2),
      titulosPagarAberto: metrica(30),
      titulosPagarQuantidade: metrica(1),
    },
    caixa: {
      sessoes: metrica(3),
      sessoesAbertas: metrica(0),
      sangriasTotal: metrica(0),
      sangriasQuantidade: metrica(0),
      suprimentosTotal: metrica(0),
      suprimentosQuantidade: metrica(0),
      diferencas: metrica(0),
    },
    alertas: [],
    fiscal: { valor: null, disponibilidade: "indisponivel", fonte: "teste" },
  } as unknown as ContadorDadosReais
}

function checklist(itens: { id: string; estado: string }[]): ChecklistFechamento {
  return {
    competencia: COMP,
    itens: itens.map((i) => ({ id: i.id, titulo: i.id, estado: i.estado, origem: "t", explicacao: "t" })),
    contagem: { ok: 0, atencao: 0, pendente: 0, nao_disponivel: 0, total: itens.length },
    disclaimer: "t",
    geradoEm: AGORA.toISOString(),
  } as unknown as ChecklistFechamento
}

/* ─────────────────────────── fake do pacote ─────────────────────────── */

type OpcoesPacote = {
  arquivos?: { caminho: string; bytes: number; sha256: string; fonte: string }[]
  vendasTotal?: number
  checklistItens?: { id: string; estado: string }[]
  falhar?: boolean
}

function fakePacotePort(
  opts: OpcoesPacote = {},
): PacotePort & { chamadas: number; ultimoConteudo: Map<string, string> } {
  const port = {
    chamadas: 0,
    ultimoConteudo: new Map<string, string>(),
    async gerar(input: Parameters<PacotePort["gerar"]>[0]): Promise<PacoteContador> {
      port.chamadas += 1
      if (opts.falhar) throw new Error("falha simulada ao gerar o pacote")
      const dadosGerados = dados(opts.vendasTotal)
      const checklistGerado = checklist(opts.checklistItens ?? [{ id: "vendas", estado: "ok" }])

      // Espelha o builder real: os extras entram ANTES do manifesto e são descritos
      // nele (caminho + sha256 dos bytes), fechando a cadeia acíclica.
      const extras = input.montarExtras?.({ dados: dadosGerados, checklist: checklistGerado })
      const arquivosExtra: readonly ArquivoPacote[] = extras?.arquivos ?? []
      const extrasDescritos = arquivosExtra.map((a) => ({
        caminho: a.caminho,
        bytes: Buffer.byteLength(a.conteudo, "utf8"),
        sha256: sha256Texto(a.conteudo),
        fonte: a.fonte,
      }))
      // Guardado para o teste inspecionar os bytes preservados no "ZIP".
      port.ultimoConteudo = new Map(arquivosExtra.map((a) => [a.caminho, a.conteudo]))

      const arquivos = [
        ...(opts.arquivos ?? [
          { caminho: "01-VENDAS/vendas.csv", bytes: 100, sha256: "a".repeat(64), fonte: "vendas" },
          { caminho: "00-LEIA-ME/indice.md", bytes: 50, sha256: "b".repeat(64), fonte: "indice" },
        ]),
        ...extrasDescritos,
      ]
      return {
        nomeArquivo: "pacote.zip",
        bytes: new Uint8Array([1, 2, 3, 4]),
        manifesto: {
          schema: "omni.contador.pacote.manifest/v1",
          pacoteVersao: 1,
          competencia: {
            storeId: "loja-1",
            ano: COMP.ano,
            mes: COMP.mes,
            timezone: "America/Sao_Paulo",
            periodoUtc: { inicio: "2026-07-01T03:00:00.000Z", fimExclusivo: "2026-08-01T03:00:00.000Z" },
          },
          geradoEm: AGORA.toISOString(),
          geradoPor: { tipo: "interno", id: "u_abcdef0123456789" },
          fontes: [],
          arquivos,
          pendencias: [],
          itensNaoDisponiveis: [],
          avisos: [],
          ...(extras?.snapshotHash ? { snapshotHash: extras.snapshotHash } : {}),
        },
        dados: dadosGerados,
        checklist: checklistGerado,
        metricas: {
          bytesZip: 4,
          bytesDescompactados: 150,
          arquivos: arquivos.length,
          contagens: {},
          fontesParciais: [],
          fontesIndisponiveis: [],
        },
      } as unknown as PacoteContador
    },
  }
  return port
}

function fakeStorage(opts: { falharUpload?: boolean } = {}) {
  const objetos = new Map<string, Uint8Array>()
  const port: StoragePacotePort & { objetos: Map<string, Uint8Array>; uploads: number } = {
    objetos,
    uploads: 0,
    async enviarPacote(ref, bytes) {
      if (opts.falharUpload) throw new Error("falha simulada de storage")
      port.uploads += 1
      objetos.set(ref, bytes)
    },
    async verificarExistencia(ref) {
      return objetos.has(ref)
    },
    async criarDownloadAssinado(ref, nome) {
      if (!objetos.has(ref)) throw new Error("objeto inexistente")
      return { signedUrl: `https://storage.local/sign/${nome}?token=xyz`, expiresInSec: 300 }
    },
  }
  return port
}

/* ─────────────────────────── fake do banco ─────────────────────────── */

type CompRow = {
  id: string
  storeId: string
  ano: number
  mes: number
  status: string
  versao: number
  snapshot: unknown
  snapshotHash: string | null
  fechadaEm: Date | null
  fechadaPorId: string | null
  reabertaEm: Date | null
  reabertaPorId?: string | null
  reabertaMotivo?: string | null
  updatedAt: Date
}

type Estado = {
  competencias: CompRow[]
  documentos: { competenciaId: string; storeId: string; categoria: string; status: string; excluidoEm: Date | null }[]
  pacotes: Record<string, unknown>[]
  itens: Record<string, unknown>[]
  comentarios: Record<string, unknown>[]
  eventos: Record<string, unknown>[]
}

type FakeDb = FechamentoDbClient & {
  estado: Estado
  transacoes: number
  falharEvento: boolean
  falharPacote: boolean
  /** Parâmetros de cada `SELECT … FOR UPDATE` pedido (prova do lock). */
  locks: string[]
}

function clonar(e: Estado): Estado {
  return {
    competencias: e.competencias.map((c) => ({ ...c })),
    documentos: e.documentos.map((d) => ({ ...d })),
    pacotes: e.pacotes.map((p) => ({ ...p })),
    itens: e.itens.map((i) => ({ ...i })),
    comentarios: e.comentarios.map((c) => ({ ...c })),
    eventos: e.eventos.map((v) => ({ ...v })),
  }
}

function competencia(over: Partial<CompRow> = {}): CompRow {
  return {
    id: "comp-1",
    storeId: "loja-1",
    ano: COMP.ano,
    mes: COMP.mes,
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

/** Casa o `where` do dedupe: competenciaId + tipo + metadata.path/equals. */
function casaDedupe(evento: Record<string, unknown>, where: Record<string, unknown>): boolean {
  if (evento.competenciaId !== where.competenciaId) return false
  if (evento.tipo !== where.tipo) return false
  const meta = (evento.metadata ?? {}) as Record<string, unknown>
  const ands = (where.AND ?? []) as { metadata: { path: string[]; equals: unknown } }[]
  return ands.every((cond) => meta[cond.metadata.path[0]] === cond.metadata.equals)
}

function fakeDb(estadoInicial: Partial<Estado> = {}): FakeDb {
  const db = {
    estado: {
      competencias: estadoInicial.competencias ?? [competencia()],
      documentos: estadoInicial.documentos ?? [],
      pacotes: [],
      itens: [],
      comentarios: [],
      eventos: [],
    } as Estado,
    transacoes: 0,
    falharEvento: false,
    falharPacote: false,
    locks: [],
    // Os métodos do cliente são acoplados logo abaixo (Object.assign(db, ops)).
  } as unknown as FakeDb

  let seq = 0
  const ops: FechamentoTxClient = {
    contadorCompetencia: {
      async findUnique({ where }) {
        const k = where.storeId_ano_mes
        return db.estado.competencias.find((c) => c.storeId === k.storeId && c.ano === k.ano && c.mes === k.mes) ?? null
      },
      async findFirst({ where }) {
        const w = where as { id?: string; storeId?: string }
        return db.estado.competencias.find((c) => c.id === w.id && c.storeId === w.storeId) ?? null
      },
      async updateMany({ where, data }) {
        const w = where as {
          id: string
          storeId: string
          status: string | { in: readonly string[] }
          versao: number
        }
        const alvo = db.estado.competencias.filter((c) => {
          if (c.id !== w.id || c.storeId !== w.storeId || c.versao !== w.versao) return false
          return typeof w.status === "string" ? c.status === w.status : w.status.in.includes(c.status)
        })
        for (const c of alvo) Object.assign(c, data, { updatedAt: new Date(c.updatedAt.getTime() + 1000) })
        return { count: alvo.length }
      },
      // `create` existe para o getOrCreate do GOAL 009 (competência ausente).
      ...({
        async create({ data }: { data: { storeId: string; ano: number; mes: number } }) {
          const nova = competencia({ id: `comp-${++seq}`, ...data })
          db.estado.competencias.push(nova)
          return nova
        },
      } as object),
    },
    contadorDocumento: {
      async findMany({ where }) {
        const w = where as { competenciaId: string; storeId: string }
        return db.estado.documentos
          .filter((d) => d.competenciaId === w.competenciaId && d.storeId === w.storeId && !d.excluidoEm)
          .map((d) => ({ categoria: d.categoria, status: d.status }))
      },
    },
    contadorPacote: {
      async create({ data }) {
        if (db.falharPacote) throw new Error("falha simulada ao gravar o pacote")
        const d = data as Record<string, unknown>
        // Espelha a unique (competenciaId, versao) do schema.
        const dup = db.estado.pacotes.find(
          (p) => p.competenciaId === d.competenciaId && p.versao === d.versao,
        )
        if (dup) throw new Error("unique constraint: (competenciaId, versao)")
        const row = { id: `pac-${++seq}`, ...d }
        db.estado.pacotes.push(row)
        return { id: row.id as string }
      },
      async findMany({ where }) {
        const w = where as { competenciaId: string }
        return db.estado.pacotes.filter((p) => p.competenciaId === w.competenciaId) as never
      },
      async findFirst({ where }) {
        const w = where as { competenciaId: string; versao: number }
        return (db.estado.pacotes.find(
          (p) => p.competenciaId === w.competenciaId && p.versao === w.versao,
        ) ?? null) as never
      },
    },
    contadorPacoteItem: {
      async createMany({ data }) {
        db.estado.itens.push(...data)
        return { count: data.length }
      },
      async findMany({ where }) {
        const w = where as { pacoteId: string }
        return db.estado.itens.filter((i) => i.pacoteId === w.pacoteId) as never
      },
    },
    contadorComentario: {
      async create({ data }) {
        db.estado.comentarios.push({ ...data })
        return { id: data.id as string }
      },
    },
    contadorEvento: {
      async create({ data }) {
        if (db.falharEvento) throw new Error("falha simulada ao criar evento")
        db.estado.eventos.push({ ...data })
        return { id: `ev-${db.estado.eventos.length}` }
      },
      async findFirst({ where }) {
        const achado = db.estado.eventos.find((e) => casaDedupe(e, where))
        return achado ? { id: "ev-existente" } : null
      },
    },
    // Lock de linha do dedupe. No fake, a serialização das transações (fila abaixo) já
    // é o equivalente ao `FOR UPDATE`; aqui só registramos que o lock foi pedido, para
    // o teste provar que o caminho passa por ele.
    async $queryRaw(query: TemplateStringsArray, ...values: unknown[]) {
      db.locks.push(values.map(String).join("|"))
      const sql = query.join("?")
      if (!/FOR UPDATE/i.test(sql)) throw new Error("lock esperado com FOR UPDATE")
      return [] as unknown as never
    },
  }

  Object.assign(db, ops)

  // Transações são SERIALIZADAS: no Postgres real, dois fechamentos da mesma
  // competência disputam o row lock do `updateMany` e nunca escrevem entrelaçados.
  // Sem isto, o rollback da transação perdedora restauraria um snapshot anterior ao
  // commit da vencedora — apagando escrita já confirmada, que o banco jamais faria.
  let fila: Promise<unknown> = Promise.resolve()
  db.$transaction = <T,>(fn: (tx: FechamentoTxClient) => Promise<T>): Promise<T> => {
    const executar = async (): Promise<T> => {
      db.transacoes += 1
      const snapshot = clonar(db.estado)
      try {
        return await fn(ops)
      } catch (e) {
        // ROLLBACK real: descarta tudo que ESTA transação escreveu.
        db.estado = snapshot
        throw e
      }
    }
    const resultado = fila.then(executar, executar)
    // A fila não pode quebrar quando uma transação falha (o próximo ainda roda).
    fila = resultado.then(
      () => undefined,
      () => undefined,
    )
    return resultado
  }
  return db
}

function montar(estado: Partial<Estado> = {}, opts: OpcoesPacote = {}) {
  const db = fakeDb(estado)
  const repo: FechamentoRepo = criarRepoFechamento(db)
  const pacote = fakePacotePort(opts)
  const storage = fakeStorage()
  return { db, repo, pacote, storage, deps: { repo, pacote, storage } }
}

/* ═══════════════════════ 1 · FECHAMENTO ═══════════════════════ */

describe("fechamento · caminho oficial", () => {
  it("fecha, grava snapshot canônico, pacote v1 e evento numa transação", async () => {
    const { db, deps, storage } = montar()
    const r = await fecharCompetencia(SCOPE_A, ELEVADO, COMP, { confirmacao: CODIGO }, deps, AGORA)

    expect(r.versao).toBe(1)
    expect(r.status).toBe("FECHADA")
    expect(r.snapshotHash).toMatch(/^[0-9a-f]{64}$/)

    const comp = db.estado.competencias[0]
    expect(comp.status).toBe("FECHADA")
    expect(comp.snapshotHash).toBe(r.snapshotHash)
    expect(comp.fechadaPorId).toBe("user-1")
    expect(comp.fechadaEm).toEqual(AGORA)

    expect(db.estado.pacotes).toHaveLength(1)
    expect(db.estado.pacotes[0].versao).toBe(1)
    expect(db.transacoes).toBe(1)
    // O ZIP subiu ANTES da transação, no path endereçado por conteúdo.
    expect(storage.uploads).toBe(1)
    expect([...storage.objetos.keys()][0]).toBe(db.estado.pacotes[0].storageRef)
  })

  it("os itens do pacote espelham exatamente o manifesto", async () => {
    const arquivos = [
      { caminho: "01-VENDAS/vendas.csv", bytes: 10, sha256: "1".repeat(64), fonte: "vendas" },
      { caminho: "02-FINANCEIRO/mov.csv", bytes: 20, sha256: "2".repeat(64), fonte: "financeiro" },
      { caminho: "00-LEIA-ME/indice.md", bytes: 30, sha256: "3".repeat(64), fonte: "indice" },
    ]
    const { db, deps } = montar({}, { arquivos })
    await fecharCompetencia(SCOPE_A, ELEVADO, COMP, { confirmacao: CODIGO }, deps, AGORA)

    // 3 arquivos do pacote + o snapshot do fechamento (GOAL 012A).
    expect(db.estado.itens).toHaveLength(4)
    expect(db.estado.itens.map((i) => i.caminho).sort()).toEqual(
      [...arquivos.map((a) => a.caminho), SNAPSHOT_CAMINHO_PACOTE].sort(),
    )
    expect(db.estado.itens.every((i) => i.pacoteId === db.estado.pacotes[0].id)).toBe(true)
  })

  it("o evento competencia_fechada guarda só metadados seguros", async () => {
    const { db, deps } = montar()
    const r = await fecharCompetencia(SCOPE_A, ELEVADO, COMP, { confirmacao: CODIGO }, deps, AGORA)

    const ev = db.estado.eventos.find((e) => e.tipo === "competencia_fechada")!
    expect(ev.entidade).toBe("competencia")
    expect(ev.atorId).toBe("user-1")
    const meta = ev.metadata as Record<string, unknown>
    expect(meta).toMatchObject({
      competencia: CODIGO,
      versao: 1,
      snapshotHash: r.snapshotHash,
      pendenciasAssumidas: 0,
    })
    const serializado = JSON.stringify(meta)
    for (const proibido of ["storageRef", "signedUrl", "token", "http"]) {
      expect(serializado, proibido).not.toContain(proibido)
    }
  })

  it("o storageRef é endereçado por conteúdo e versionado", () => {
    const ref = montarStorageRefPacote("loja-1", CODIGO, 2, "f".repeat(64))
    expect(ref).toBe(`contador/loja-1/2026-07/pacotes/v2/${"f".repeat(64)}.zip`)
  })

  it("papel sem permissão recebe 403 SEM qualquer escrita", async () => {
    const { db, deps, storage, pacote } = montar()
    await expect(
      fecharCompetencia(SCOPE_A, BASICO, COMP, { confirmacao: CODIGO }, deps, AGORA),
    ).rejects.toBeInstanceOf(PermissaoFechamentoError)

    expect(db.estado.competencias[0].status).toBe("ABERTA")
    expect(db.estado.pacotes).toHaveLength(0)
    expect(db.estado.eventos).toHaveLength(0)
    expect(db.transacoes).toBe(0)
    expect(storage.uploads).toBe(0)
    // Nem o pacote chegou a ser gerado: a permissão é a PRIMEIRA barreira.
    expect(pacote.chamadas).toBe(0)
  })

  it("confirmação textual errada recusa antes de gerar o pacote", async () => {
    const { db, deps, pacote } = montar()
    await expect(
      fecharCompetencia(SCOPE_A, ELEVADO, COMP, { confirmacao: "sim" }, deps, AGORA),
    ).rejects.toBeInstanceOf(ConfirmacaoInvalidaError)
    expect(pacote.chamadas).toBe(0)
    expect(db.transacoes).toBe(0)
  })

  it("competência já fechada recusa com 409", async () => {
    const { deps } = montar({ competencias: [competencia({ status: "FECHADA" })] })
    await expect(
      fecharCompetencia(SCOPE_A, ELEVADO, COMP, { confirmacao: CODIGO }, deps, AGORA),
    ).rejects.toBeInstanceOf(CompetenciaJaFechadaError)
  })
})

/* ═══════════════════════ pendências assumidas ═══════════════════════ */

describe("fechamento · pendências revalidadas no servidor", () => {
  const comPendencia = { checklistItens: [{ id: "vendas", estado: "ok" }, { id: "caixa", estado: "pendente" }] }

  it("fechar sem assumir a pendência é recusado", async () => {
    const { db, deps } = montar({}, comPendencia)
    await expect(
      fecharCompetencia(SCOPE_A, ELEVADO, COMP, { confirmacao: CODIGO }, deps, AGORA),
    ).rejects.toBeInstanceOf(PendenciasNaoAssumidasError)
    expect(db.estado.competencias[0].status).toBe("ABERTA")
    expect(db.transacoes).toBe(0)
  })

  it("pendência inexistente no checklist é recusada", async () => {
    const { deps } = montar({}, comPendencia)
    await expect(
      fecharCompetencia(
        SCOPE_A,
        ELEVADO,
        COMP,
        { confirmacao: CODIGO, pendenciasAssumidas: ["caixa", "inventada"] },
        deps,
        AGORA,
      ),
    ).rejects.toBeInstanceOf(PendenciaDesconhecidaError)
  })

  it("assumindo a pendência, fecha e registra no snapshot e no evento", async () => {
    const { db, deps } = montar({}, comPendencia)
    await fecharCompetencia(
      SCOPE_A,
      ELEVADO,
      COMP,
      { confirmacao: CODIGO, pendenciasAssumidas: ["caixa"] },
      deps,
      AGORA,
    )
    const snap = db.estado.competencias[0].snapshot as { pendenciasAssumidas: string[] }
    expect(snap.pendenciasAssumidas).toEqual(["caixa"])
    const ev = db.estado.eventos.find((e) => e.tipo === "competencia_fechada")!
    expect((ev.metadata as Record<string, unknown>).pendenciasAssumidas).toBe(1)
  })
})

/* ═══════════════════════ 2 · ATOMICIDADE ═══════════════════════ */

describe("fechamento · atomicidade", () => {
  it("falha ao GERAR o pacote impede o fechamento (nada escrito, nada subido)", async () => {
    const { db, deps, storage } = montar({}, { falhar: true })
    await expect(
      fecharCompetencia(SCOPE_A, ELEVADO, COMP, { confirmacao: CODIGO }, deps, AGORA),
    ).rejects.toThrow(/falha simulada ao gerar o pacote/)
    expect(db.estado.competencias[0].status).toBe("ABERTA")
    expect(storage.uploads).toBe(0)
    expect(db.transacoes).toBe(0)
  })

  it("falha no UPLOAD impede o fechamento", async () => {
    const db = fakeDb()
    const deps = { repo: criarRepoFechamento(db), pacote: fakePacotePort(), storage: fakeStorage({ falharUpload: true }) }
    await expect(
      fecharCompetencia(SCOPE_A, ELEVADO, COMP, { confirmacao: CODIGO }, deps, AGORA),
    ).rejects.toThrow(/falha simulada de storage/)
    expect(db.estado.competencias[0].status).toBe("ABERTA")
    expect(db.transacoes).toBe(0)
  })

  it("falha ao criar o EVENTO desfaz o status e o pacote (rollback real)", async () => {
    const { db, deps } = montar()
    db.falharEvento = true
    await expect(
      fecharCompetencia(SCOPE_A, ELEVADO, COMP, { confirmacao: CODIGO }, deps, AGORA),
    ).rejects.toThrow(/falha simulada ao criar evento/)

    expect(db.estado.competencias[0].status).toBe("ABERTA")
    expect(db.estado.competencias[0].snapshotHash).toBeNull()
    expect(db.estado.pacotes).toHaveLength(0)
    expect(db.estado.itens).toHaveLength(0)
  })

  it("falha ao gravar o PACOTE desfaz a mudança de status", async () => {
    const { db, deps } = montar()
    db.falharPacote = true
    await expect(
      fecharCompetencia(SCOPE_A, ELEVADO, COMP, { confirmacao: CODIGO }, deps, AGORA),
    ).rejects.toThrow(/falha simulada ao gravar o pacote/)
    expect(db.estado.competencias[0].status).toBe("ABERTA")
    expect(db.estado.eventos).toHaveLength(0)
  })

  it("corrida: se a competência fechou entre a leitura e a escrita, aborta sem duplicar versão", async () => {
    const { db, repo, deps } = montar()
    const original = repo.listarDocumentosParaSnapshot.bind(repo)
    // Outra sessão fecha logo antes da transação desta.
    repo.listarDocumentosParaSnapshot = async (id, storeId) => {
      const r = await original(id, storeId)
      db.estado.competencias[0].status = "FECHADA"
      return r
    }

    await expect(
      fecharCompetencia(SCOPE_A, ELEVADO, COMP, { confirmacao: CODIGO }, deps, AGORA),
    ).rejects.toBeInstanceOf(FechamentoConcorrenteError)
    expect(db.estado.pacotes).toHaveLength(0)
    expect(db.estado.eventos).toHaveLength(0)
  })

  it("dois fechamentos concorrentes produzem UMA única versão", async () => {
    const { db, deps } = montar()
    const r = await Promise.allSettled([
      fecharCompetencia(SCOPE_A, ELEVADO, COMP, { confirmacao: CODIGO }, deps, AGORA),
      fecharCompetencia(SCOPE_A, ELEVADO, COMP, { confirmacao: CODIGO }, deps, AGORA),
    ])
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1)
    expect(db.estado.pacotes).toHaveLength(1)
    expect(db.estado.eventos.filter((e) => e.tipo === "competencia_fechada")).toHaveLength(1)
  })
})

/* ═══════════════════════ 4 · REABERTURA ═══════════════════════ */

describe("reabertura", () => {
  async function fechada() {
    const ctx = montar()
    await fecharCompetencia(SCOPE_A, ELEVADO, COMP, { confirmacao: CODIGO }, ctx.deps, AGORA)
    return ctx
  }

  it("sem motivo é recusada, sem alterar nada", async () => {
    const { db, deps } = await fechada()
    await expect(
      reabrirCompetencia(ESCOPO_A, ELEVADO, COMP, { confirmacao: CODIGO, motivo: "   " }, deps, AGORA),
    ).rejects.toBeInstanceOf(MotivoReaberturaObrigatorioError)
    expect(db.estado.competencias[0].status).toBe("FECHADA")
    expect(db.estado.competencias[0].versao).toBe(1)
  })

  it("sem permissão elevada é recusada", async () => {
    const { deps } = await fechada()
    await expect(
      reabrirCompetencia(ESCOPO_A, BASICO, COMP, { confirmacao: CODIGO, motivo: "erro" }, deps, AGORA),
    ).rejects.toBeInstanceOf(PermissaoFechamentoError)
  })

  it("competência aberta não pode ser reaberta", async () => {
    const { deps } = montar()
    await expect(
      reabrirCompetencia(ESCOPO_A, ELEVADO, COMP, { confirmacao: CODIGO, motivo: "erro" }, deps, AGORA),
    ).rejects.toBeInstanceOf(CompetenciaNaoFechadaError)
  })

  it("com motivo: incrementa versão, grava comentário interno e preserva pacote/snapshot", async () => {
    const { db, deps } = await fechada()
    const snapshotAntes = db.estado.competencias[0].snapshot
    const hashAntes = db.estado.competencias[0].snapshotHash

    const r = await reabrirCompetencia(
      ESCOPO_A,
      ELEVADO,
      COMP,
      { confirmacao: CODIGO, motivo: "  faltou o extrato de junho  " },
      deps,
      AGORA,
      () => "cmt-fixo",
    )

    expect(r.versaoAnterior).toBe(1)
    expect(r.versao).toBe(2)
    const comp = db.estado.competencias[0]
    expect(comp.status).toBe("ABERTA")
    expect(comp.versao).toBe(2)
    expect(comp.reabertaEm).toEqual(AGORA)
    // Preservação: pacote v1 e snapshot anterior continuam lá.
    expect(db.estado.pacotes).toHaveLength(1)
    expect(comp.snapshot).toBe(snapshotAntes)
    expect(comp.snapshotHash).toBe(hashAntes)

    const cmt = db.estado.comentarios[0]
    expect(cmt.visibilidade).toBe("interna")
    expect(cmt.texto).toBe("faltou o extrato de junho")

    const ev = db.estado.eventos.find((e) => e.tipo === "competencia_reaberta")!
    const meta = ev.metadata as Record<string, unknown>
    expect(meta).toMatchObject({ versaoAnterior: 1, versao: 2, motivoComentarioId: "cmt-fixo", motivoLen: 25 })
    // G2-05: o texto do motivo NUNCA entra na metadata do evento.
    expect(JSON.stringify(meta)).not.toContain("extrato de junho")
  })

  it("reabertura concorrente não duplica evento nem versão", async () => {
    const { db, deps } = await fechada()
    const r = await Promise.allSettled([
      reabrirCompetencia(ESCOPO_A, ELEVADO, COMP, { confirmacao: CODIGO, motivo: "a" }, deps, AGORA),
      reabrirCompetencia(ESCOPO_A, ELEVADO, COMP, { confirmacao: CODIGO, motivo: "b" }, deps, AGORA),
    ])
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1)
    expect(db.estado.competencias[0].versao).toBe(2)
    expect(db.estado.eventos.filter((e) => e.tipo === "competencia_reaberta")).toHaveLength(1)
  })
})

/* ═══════════════════════ 5 · REFECHAMENTO ═══════════════════════ */

describe("refechamento", () => {
  it("gera pacote v2, novo snapshot e preserva a v1 intacta", async () => {
    const arquivosV1 = [
      { caminho: "01-VENDAS/vendas.csv", bytes: 10, sha256: "1".repeat(64), fonte: "vendas" },
      { caminho: "so-na-v1.csv", bytes: 5, sha256: "9".repeat(64), fonte: "vendas" },
    ]
    const db = fakeDb()
    const storage = fakeStorage()
    const deps1 = { repo: criarRepoFechamento(db), pacote: fakePacotePort({ arquivos: arquivosV1 }), storage }
    await fecharCompetencia(SCOPE_A, ELEVADO, COMP, { confirmacao: CODIGO }, deps1, AGORA)
    const hashV1 = db.estado.competencias[0].snapshotHash
    const pacoteV1 = { ...db.estado.pacotes[0] }

    await reabrirCompetencia(ESCOPO_A, ELEVADO, COMP, { confirmacao: CODIGO, motivo: "ajuste" }, deps1, AGORA)

    const arquivosV2 = [
      { caminho: "01-VENDAS/vendas.csv", bytes: 12, sha256: "2".repeat(64), fonte: "vendas" },
      { caminho: "so-na-v2.csv", bytes: 7, sha256: "8".repeat(64), fonte: "caixa" },
    ]
    const deps2 = {
      repo: criarRepoFechamento(db),
      pacote: fakePacotePort({ arquivos: arquivosV2, vendasTotal: 1500 }),
      storage,
    }
    const r2 = await fecharCompetencia(SCOPE_A, ELEVADO, COMP, { confirmacao: CODIGO }, deps2, AGORA)

    expect(r2.versao).toBe(2)
    expect(db.estado.pacotes).toHaveLength(2)
    expect(db.estado.pacotes.map((p) => p.versao).sort()).toEqual([1, 2])
    // v1 permanece byte-a-byte intacta.
    expect(db.estado.pacotes.find((p) => p.versao === 1)).toEqual(pacoteV1)
    expect(storage.objetos.has(pacoteV1.storageRef as string)).toBe(true)
    // Novo snapshot (dados mudaram) ⇒ hash diferente.
    expect(db.estado.competencias[0].snapshotHash).not.toBe(hashV1)

    // Diff de manifestos entre as duas versões.
    const diff = await compararVersoes(ESCOPO_A, COMP, 1, 2, { repo: criarRepoFechamento(db) })
    expect(diff.resumo.identicos).toBe(false)
    expect(diff.adicionados.map((a) => a.caminho)).toEqual(["so-na-v2.csv"])
    expect(diff.removidos.map((a) => a.caminho)).toEqual(["so-na-v1.csv"])
    // O snapshot também muda entre versões — é justamente o que prova que cada versão
    // carrega o SEU próprio snapshot, e não uma cópia da anterior.
    expect(diff.alterados.map((a) => a.caminho).sort()).toEqual([
      SNAPSHOT_CAMINHO_PACOTE,
      "01-VENDAS/vendas.csv",
    ])
    expect(diff.alterados.find((a) => a.caminho === "01-VENDAS/vendas.csv")!.deltaBytes).toBe(2)
  })
})

/* ═══════════════════════ 6 · DIVERGÊNCIA ═══════════════════════ */

describe("divergência pós-fechamento", () => {
  async function fechadaCom(vendasTotal: number) {
    const db = fakeDb()
    const deps = { repo: criarRepoFechamento(db), pacote: fakePacotePort({ vendasTotal }), storage: fakeStorage() }
    await fecharCompetencia(SCOPE_A, ELEVADO, COMP, { confirmacao: CODIGO }, deps, AGORA)
    return { db, deps, repo: deps.repo }
  }

  it("dados vivos iguais ⇒ sem divergência e sem evento", async () => {
    const { db, repo } = await fechadaCom(1200)
    const comp = db.estado.competencias[0]
    const d = avaliarDivergencia(comp, extrairTotais(dados(1200)))!
    expect(d.divergente).toBe(false)

    const r = await registrarDivergencia(ESCOPO_A, COMP, comp, d, { repo })
    expect(r.criado).toBe(false)
    expect(db.estado.eventos.filter((e) => e.tipo === "alteracao_pos_fechamento")).toHaveLength(0)
  })

  it("mudança exclusivamente textual do pacote não produz falso drift pós-deploy", async () => {
    const caminhoReadme = "04-DOCUMENTOS/LEIA-ME.md"
    const pacoteV1 = {
      caminho: caminhoReadme,
      bytes: 180,
      sha256: "1".repeat(64),
      fonte: "documentos",
    }
    const pacoteV2 = {
      caminho: caminhoReadme,
      bytes: 240,
      sha256: "2".repeat(64),
      fonte: "documentos",
    }
    const db = fakeDb()
    const storage = fakeStorage()
    const depsV1 = { repo: criarRepoFechamento(db), pacote: fakePacotePort({ arquivos: [pacoteV1] }), storage }

    // T0: fecha com a geração anterior e congela o estado empresarial.
    await fecharCompetencia(SCOPE_A, ELEVADO, COMP, { confirmacao: CODIGO }, depsV1, AGORA)
    const totaisSnapshotV1 = (db.estado.competencias[0].snapshot as { totais: unknown }).totais

    // T1: a única diferença da nova geração é textual, no arquivo de documentos.
    await reabrirCompetencia(ESCOPO_A, ELEVADO, COMP, { confirmacao: CODIGO, motivo: "ajuste de copy" }, depsV1, AGORA)
    const depsV2 = {
      repo: criarRepoFechamento(db),
      pacote: fakePacotePort({ arquivos: [pacoteV2], vendasTotal: 1200 }),
      storage,
    }
    await fecharCompetencia(SCOPE_A, ELEVADO, COMP, { confirmacao: CODIGO }, depsV2, AGORA)

    // T2: nenhum dado empresarial mudou; a baseline de totais continua a mesma.
    expect((db.estado.competencias[0].snapshot as { totais: unknown }).totais).toEqual(totaisSnapshotV1)
    const comp = db.estado.competencias[0]
    const divergencia = avaliarDivergencia(comp, extrairTotais(dados(1200)))!

    // T3: comparação oficial usa somente snapshot.totais; copy textual não vira drift.
    expect(divergencia.divergente).toBe(false)
    const resultado = await registrarDivergencia(ESCOPO_A, COMP, comp, divergencia, { repo: depsV2.repo })
    expect(resultado.criado).toBe(false)
    expect(db.estado.eventos.filter((e) => e.tipo === "alteracao_pos_fechamento")).toHaveLength(0)
  })

  it("competência ABERTA não é comparável (sem linha de base)", async () => {
    const db = fakeDb()
    expect(avaliarDivergencia(db.estado.competencias[0], extrairTotais(dados()))).toBeNull()
  })

  it("alteração detectada gera diffHash e UM único evento, mesmo repetindo o POST", async () => {
    const { db, repo } = await fechadaCom(1200)
    const comp = db.estado.competencias[0]
    const d = avaliarDivergencia(comp, extrairTotais(dados(1500)))!
    expect(d.divergente).toBe(true)

    const r1 = await registrarDivergencia(ESCOPO_A, COMP, comp, d, { repo })
    const r2 = await registrarDivergencia(ESCOPO_A, COMP, comp, d, { repo })
    const r3 = await registrarDivergencia(ESCOPO_A, COMP, comp, d, { repo })

    expect(r1.criado).toBe(true)
    expect(r2.criado).toBe(false)
    expect(r3.criado).toBe(false)
    expect(db.estado.eventos.filter((e) => e.tipo === "alteracao_pos_fechamento")).toHaveLength(1)

    const ev = db.estado.eventos.find((e) => e.tipo === "alteracao_pos_fechamento")!
    expect((ev.metadata as Record<string, unknown>).diffHash).toBe(d.diffHash)
  })

  it("uma divergência DIFERENTE gera um segundo evento", async () => {
    const { db, repo } = await fechadaCom(1200)
    const comp = db.estado.competencias[0]
    await registrarDivergencia(ESCOPO_A, COMP, comp, avaliarDivergencia(comp, extrairTotais(dados(1500)))!, { repo })
    await registrarDivergencia(ESCOPO_A, COMP, comp, avaliarDivergencia(comp, extrairTotais(dados(1700)))!, { repo })
    expect(db.estado.eventos.filter((e) => e.tipo === "alteracao_pos_fechamento")).toHaveLength(2)
  })
})

/* ═══════════════════════ 7 · SEGURANÇA ═══════════════════════ */

describe("segurança · isolamento e DTO", () => {
  it("loja B não fecha competência da loja A (competência da B é outra linha)", async () => {
    const { db, deps } = montar()
    await fecharCompetencia(SCOPE_B, ELEVADO, COMP, { confirmacao: CODIGO }, deps, AGORA)
    // A competência da loja A continua ABERTA; a da loja B foi criada à parte.
    expect(db.estado.competencias.find((c) => c.storeId === "loja-1")!.status).toBe("ABERTA")
    expect(db.estado.competencias.find((c) => c.storeId === "loja-2")!.status).toBe("FECHADA")
  })

  it("loja B não enxerga nem baixa o pacote da loja A", async () => {
    const { db, deps, repo, storage } = montar()
    await fecharCompetencia(SCOPE_A, ELEVADO, COMP, { confirmacao: CODIGO }, deps, AGORA)

    const estadoB = await carregarEstadoFechamento(ESCOPO_B, ELEVADO, COMP, { repo })
    expect(estadoB.pacotes).toEqual([])

    await expect(
      autorizarDownloadPacote(ESCOPO_B, COMP, 1, { repo, storage }),
    ).rejects.toBeInstanceOf(Error)
    expect(db.estado.eventos.filter((e) => e.tipo === "pacote_baixado")).toHaveLength(0)
  })

  it("o evento herda a loja do ESCOPO, não do corpo da requisição", async () => {
    const { db, deps } = montar()
    await fecharCompetencia(
      SCOPE_A,
      ELEVADO,
      COMP,
      { confirmacao: CODIGO, ...({ storeId: "loja-9" } as object) },
      deps,
      AGORA,
    )
    expect(db.estado.eventos.every((e) => e.storeId === "loja-1")).toBe(true)
    expect(db.estado.pacotes[0].storageRef).toContain("contador/loja-1/")
  })

  it("download registra pacote_baixado e o DTO não expõe storageRef", async () => {
    const { db, deps, repo, storage } = montar()
    await fecharCompetencia(SCOPE_A, ELEVADO, COMP, { confirmacao: CODIGO }, deps, AGORA)

    const dto = await autorizarDownloadPacote(ESCOPO_A, COMP, 1, { repo, storage })
    expect(dto.nomeArquivo).toBe("pacote-contador-2026-07-v1.zip")
    expect(Object.keys(dto)).not.toContain("storageRef")

    const ev = db.estado.eventos.find((e) => e.tipo === "pacote_baixado")!
    const meta = JSON.stringify(ev.metadata)
    expect(meta).not.toContain("storage.local")
    expect(meta).not.toContain("token")
    expect(meta).not.toContain("contador/loja-1")
  })

  it("versão inexistente devolve erro de pacote não encontrado", async () => {
    const { deps, repo, storage } = montar()
    await fecharCompetencia(SCOPE_A, ELEVADO, COMP, { confirmacao: CODIGO }, deps, AGORA)
    await expect(
      autorizarDownloadPacote(ESCOPO_A, COMP, 99, { repo, storage }),
    ).rejects.toBeInstanceOf(PacoteNaoEncontradoError)
  })

  it("estado de fechamento não expõe storageRef nem snapshot bruto", async () => {
    const { deps, repo } = montar()
    await fecharCompetencia(SCOPE_A, ELEVADO, COMP, { confirmacao: CODIGO }, deps, AGORA)
    const estado = await carregarEstadoFechamento(ESCOPO_A, ELEVADO, COMP, { repo })
    const serializado = JSON.stringify(estado)
    expect(serializado).not.toContain("storageRef")
    expect(serializado).not.toContain("contador/loja-1")
    expect(estado.fechada).toBe(true)
    expect(estado.podeReabrir).toBe(true)
    expect(estado.podeFechar).toBe(false)
    expect(estado.pacotes).toHaveLength(1)
  })

  it("papel básico não recebe capacidade de fechar nem reabrir no estado", async () => {
    const { repo } = montar()
    const estado = await carregarEstadoFechamento(ESCOPO_A, BASICO, COMP, { repo })
    expect(estado.podeFechar).toBe(false)
    expect(estado.podeReabrir).toBe(false)
  })
})
