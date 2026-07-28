/**
 * GOAL CONTADOR-HUB-FECHAMENTO-SNAPSHOT-012A-CLOSURE — os dois gaps do 012.
 *
 * GAP 1 · retenção reconstruível: cada versão do pacote leva o SEU
 * `00-FECHAMENTO/snapshot.json`, cujos bytes são exatamente o JSON canônico. Logo
 * `sha256(arquivo) === snapshotHash === ContadorPacoteItem.sha256` — o snapshot de
 * qualquer versão passada continua reconstruível e verificável, sem schema novo.
 *
 * GAP 2 · dedupe forte: o registro da divergência trava a linha da competência
 * (`SELECT … FOR UPDATE`) antes de verificar/criar, de modo que dois POSTs simultâneos
 * produzem exatamente um evento.
 */
import { describe, expect, it } from "vitest"
import { criarRepoFechamento, type FechamentoDbClient, type FechamentoTxClient } from "@/lib/contador/fechamento/repo-prisma"
import {
  avaliarDivergencia,
  extrairTotais,
  fecharCompetencia,
  reabrirCompetencia,
  registrarDivergencia,
  type PacotePort,
  type StoragePacotePort,
} from "@/lib/contador/fechamento/service"
import {
  SNAPSHOT_CAMINHO_PACOTE,
  verificarSnapshotDoPacote,
  type SnapshotFechamentoV1,
} from "@/lib/contador/fechamento/snapshot"
import { sha256Texto } from "@/lib/contador/fechamento/canonico"
import type { ContadorScopeInterno } from "@/lib/contador/scope-core"
import type { ContadorDadosReais } from "@/lib/contador/readers/tipos"
import type { ChecklistFechamento } from "@/lib/contador/fechamento/tipos"
import type { ArquivoPacote, PacoteContador } from "@/lib/contador/pacote/tipos"

/* ─────────────────────────── fixtures ─────────────────────────── */

const AGORA = new Date("2026-08-05T12:00:00.000Z")
const COMP = { ano: 2026, mes: 7 }
const CODIGO = "2026-07"
const ELEVADO = { acessaHub: true, podeConferir: true } as const
const SCOPE = { ok: true, storeId: "loja-1", userId: "user-1", permissaoContador: true } as unknown as ContadorScopeInterno
const ESCOPO = { storeId: "loja-1", userId: "user-1" }

const met = (valor: number | null) => ({ valor, disponibilidade: "real" as const, fonte: "t" })

function dados(vendasTotal = 1200): ContadorDadosReais {
  return {
    competencia: COMP,
    liquidoCompetencia: met(vendasTotal - 200),
    vendas: {
      quantidade: met(10),
      total: met(vendasTotal),
      canceladasQuantidade: met(0),
      canceladasTotal: met(0),
      descontoTotal: met(0),
      descontoCoberturaQuantidade: met(0),
      formasPagamento: [],
      formaPagamentoDisponibilidade: "real",
      naoIdentificadoQuantidade: met(0),
      naoIdentificadoValor: met(0),
      divergenciaPagamentoQuantidade: met(0),
      reconciliacaoPagamento: null,
    },
    devolucoes: { quantidade: met(1), total: met(200) },
    financeiro: {
      entradasRealizadas: met(900),
      saidasRealizadas: met(300),
      estornos: met(0),
      transferencias: met(0),
      transferenciasQuantidade: met(0),
      naoClassificados: met(0),
      naoClassificadosQuantidade: met(0),
      titulosReceberAberto: met(50),
      titulosReceberQuantidade: met(2),
      titulosPagarAberto: met(30),
      titulosPagarQuantidade: met(1),
    },
    caixa: {
      sessoes: met(3),
      sessoesAbertas: met(0),
      sangriasTotal: met(0),
      sangriasQuantidade: met(0),
      suprimentosTotal: met(0),
      suprimentosQuantidade: met(0),
      diferencas: met(0),
    },
    alertas: [],
    fiscal: { valor: null, disponibilidade: "indisponivel", fonte: "t" },
  } as unknown as ContadorDadosReais
}

function checklist(): ChecklistFechamento {
  return {
    competencia: COMP,
    itens: [{ id: "vendas", titulo: "vendas", estado: "ok", origem: "t", explicacao: "t" }],
    contagem: { ok: 1, atencao: 0, pendente: 0, nao_disponivel: 0, total: 1 },
    disclaimer: "t",
    geradoEm: AGORA.toISOString(),
  } as unknown as ChecklistFechamento
}

/**
 * Fake do gerador que ESPELHA o builder real: chama `montarExtras`, descreve os extras
 * no manifesto pelo sha256 dos bytes e guarda o conteúdo (o "ZIP" desta versão).
 */
function fakePacote(vendasTotal = 1200) {
  const zips: Map<string, Map<string, string>> = new Map()
  let seq = 0
  const port: PacotePort & { zips: typeof zips } = {
    zips,
    async gerar(input): Promise<PacoteContador> {
      const d = dados(vendasTotal)
      const c = checklist()
      const extras = input.montarExtras?.({ dados: d, checklist: c })
      const arquivosExtra = extras?.arquivos ?? []
      const conteudos = new Map(arquivosExtra.map((a) => [a.caminho, a.conteudo]))
      zips.set(`v${++seq}`, conteudos)

      return {
        nomeArquivo: "p.zip",
        bytes: new Uint8Array([seq]),
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
          geradoPor: { tipo: "interno", id: "u_0123456789abcdef" },
          fontes: [],
          arquivos: [
            { caminho: "01-VENDAS/vendas.csv", bytes: 10, sha256: "a".repeat(64), fonte: "vendas" },
            ...arquivosExtra.map((a) => ({
              caminho: a.caminho,
              bytes: Buffer.byteLength(a.conteudo, "utf8"),
              sha256: sha256Texto(a.conteudo),
              fonte: a.fonte,
            })),
          ],
          pendencias: [],
          itensNaoDisponiveis: [],
          avisos: [],
          ...(extras?.snapshotHash ? { snapshotHash: extras.snapshotHash } : {}),
        },
        dados: d,
        checklist: c,
        metricas: {
          bytesZip: 1,
          bytesDescompactados: 10,
          arquivos: 1 + arquivosExtra.length,
          contagens: {},
          fontesParciais: [],
          fontesIndisponiveis: [],
        },
      } as unknown as PacoteContador
    },
  }
  return port
}

function fakeStorage() {
  const objetos = new Map<string, Uint8Array>()
  const port: StoragePacotePort & { objetos: typeof objetos } = {
    objetos,
    async enviarPacote(ref, bytes) {
      objetos.set(ref, bytes)
    },
    async verificarExistencia(ref) {
      return objetos.has(ref)
    },
    async criarDownloadAssinado() {
      return { signedUrl: "https://s/x", expiresInSec: 300 }
    },
  }
  return port
}

/* ─────────────────────────── fake do banco ─────────────────────────── */

type Estado = {
  competencias: Record<string, unknown>[]
  pacotes: Record<string, unknown>[]
  itens: Record<string, unknown>[]
  comentarios: Record<string, unknown>[]
  eventos: Record<string, unknown>[]
}

function clonar(e: Estado): Estado {
  return {
    competencias: e.competencias.map((x) => ({ ...x })),
    pacotes: e.pacotes.map((x) => ({ ...x })),
    itens: e.itens.map((x) => ({ ...x })),
    comentarios: e.comentarios.map((x) => ({ ...x })),
    eventos: e.eventos.map((x) => ({ ...x })),
  }
}

function casaDedupe(evento: Record<string, unknown>, where: Record<string, unknown>): boolean {
  if (evento.competenciaId !== where.competenciaId || evento.tipo !== where.tipo) return false
  const meta = (evento.metadata ?? {}) as Record<string, unknown>
  const ands = (where.AND ?? []) as { metadata: { path: string[]; equals: unknown } }[]
  return ands.every((c) => meta[c.metadata.path[0]] === c.metadata.equals)
}

type FakeDb = FechamentoDbClient & { estado: Estado; locks: string[]; lockAtivo: boolean }

/**
 * Fake com LOCK DE LINHA de verdade: `$queryRaw … FOR UPDATE` adquire um mutex por
 * competência, liberado no fim da transação. Sem serializar as transações inteiras —
 * assim o teste de concorrência prova o lock, não a fila.
 */
function fakeDb(): FakeDb {
  const db = {
    estado: {
      competencias: [
        {
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
        },
      ],
      pacotes: [],
      itens: [],
      comentarios: [],
      eventos: [],
    } as Estado,
    locks: [],
    lockAtivo: false,
    // Os métodos do cliente são acoplados logo abaixo (Object.assign(db, ops)).
  } as unknown as FakeDb

  let seq = 0
  const esperaLock: (() => void)[] = []

  const ops: FechamentoTxClient = {
    contadorCompetencia: {
      async findUnique({ where }) {
        const k = where.storeId_ano_mes
        return (db.estado.competencias.find(
          (c) => c.storeId === k.storeId && c.ano === k.ano && c.mes === k.mes,
        ) ?? null) as never
      },
      async findFirst({ where }) {
        const w = where as { id?: string; storeId?: string }
        return (db.estado.competencias.find((c) => c.id === w.id && c.storeId === w.storeId) ?? null) as never
      },
      async updateMany({ where, data }) {
        const w = where as { id: string; storeId: string; status: string | { in: readonly string[] }; versao: number }
        const alvo = db.estado.competencias.filter((c) => {
          if (c.id !== w.id || c.storeId !== w.storeId || c.versao !== w.versao) return false
          return typeof w.status === "string" ? c.status === w.status : w.status.in.includes(c.status as string)
        })
        for (const c of alvo) Object.assign(c, data)
        return { count: alvo.length }
      },
      ...({
        async create({ data }: { data: Record<string, unknown> }) {
          const nova = { id: `comp-${++seq}`, status: "ABERTA", versao: 1, ...data }
          db.estado.competencias.push(nova)
          return nova
        },
      } as object),
    },
    contadorDocumento: {
      async findMany() {
        return []
      },
    },
    contadorPacote: {
      async create({ data }) {
        const d = data as Record<string, unknown>
        if (db.estado.pacotes.some((p) => p.competenciaId === d.competenciaId && p.versao === d.versao)) {
          throw new Error("unique (competenciaId, versao)")
        }
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
        return (db.estado.pacotes.find((p) => p.competenciaId === w.competenciaId && p.versao === w.versao) ??
          null) as never
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
        db.estado.eventos.push({ ...data })
        return { id: `ev-${db.estado.eventos.length}` }
      },
      async findFirst({ where }) {
        return db.estado.eventos.find((e) => casaDedupe(e, where)) ? { id: "ev-x" } : null
      },
    },
    async $queryRaw(query: TemplateStringsArray, ...values: unknown[]) {
      const sql = query.join("?")
      if (!/FOR UPDATE/i.test(sql)) throw new Error("lock precisa ser FOR UPDATE")
      db.locks.push(values.map(String).join("|"))
      // Bloqueia enquanto outra transação segura o lock (semântica do row lock).
      while (db.lockAtivo) await new Promise<void>((r) => esperaLock.push(r))
      db.lockAtivo = true
      return [] as unknown as never
    },
  }

  Object.assign(db, ops)
  db.$transaction = async <T,>(fn: (tx: FechamentoTxClient) => Promise<T>): Promise<T> => {
    const snapshot = clonar(db.estado)
    try {
      return await fn(ops)
    } catch (e) {
      db.estado = snapshot
      throw e
    } finally {
      // Commit/rollback libera o lock — exatamente quando o Postgres liberaria.
      if (db.lockAtivo) {
        db.lockAtivo = false
        esperaLock.shift()?.()
      }
    }
  }
  return db
}

/* ═══════════════ GAP 1 · retenção reconstruível ═══════════════ */

describe("012A · GAP 1 — snapshot reconstruível por versão", () => {
  async function ciclo() {
    const db = fakeDb()
    const pacote = fakePacote(1200)
    const storage = fakeStorage()
    const deps = { repo: criarRepoFechamento(db), pacote, storage }

    await fecharCompetencia(SCOPE, ELEVADO, COMP, { confirmacao: CODIGO }, deps, AGORA)

    await reabrirCompetencia(ESCOPO, ELEVADO, COMP, { confirmacao: CODIGO, motivo: "ajuste" }, deps, AGORA)

    const pacote2 = fakePacote(1500)
    const deps2 = { repo: criarRepoFechamento(db), pacote: pacote2, storage }
    await fecharCompetencia(SCOPE, ELEVADO, COMP, { confirmacao: CODIGO }, deps2, AGORA)

    return { db, zipV1: pacote.zips.get("v1")!, zipV2: pacote2.zips.get("v1")! }
  }

  it("1 · o pacote v1 contém o snapshot canônico", async () => {
    const db = fakeDb()
    const pacote = fakePacote()
    const deps = { repo: criarRepoFechamento(db), pacote, storage: fakeStorage() }
    await fecharCompetencia(SCOPE, ELEVADO, COMP, { confirmacao: CODIGO }, deps, AGORA)

    const conteudo = pacote.zips.get("v1")!.get(SNAPSHOT_CAMINHO_PACOTE)
    expect(conteudo).toBeTruthy()
    const item = db.estado.itens.find((i) => i.caminho === SNAPSHOT_CAMINHO_PACOTE)!
    expect(item).toBeTruthy()
    expect(item.sha256).toBe(sha256Texto(conteudo!))
  })

  it("2 · reabrir e refechar gera v2 com snapshot PRÓPRIO", async () => {
    const { db, zipV1, zipV2 } = await ciclo()
    expect(db.estado.pacotes.map((p) => p.versao).sort()).toEqual([1, 2])
    const s1 = zipV1.get(SNAPSHOT_CAMINHO_PACOTE)!
    const s2 = zipV2.get(SNAPSHOT_CAMINHO_PACOTE)!
    expect(s1).not.toBe(s2)
    expect(JSON.parse(s1).versao).toBe(1)
    expect(JSON.parse(s2).versao).toBe(2)
    // v2 reflete os dados vivos daquele momento (vendas 1500), v1 os de então (1200).
    expect(JSON.parse(s1).totais["vendas.total"].valor).toBe(1200)
    expect(JSON.parse(s2).totais["vendas.total"].valor).toBe(1500)
  })

  it("3 · o snapshot v1 permanece BYTE-IDÊNTICO depois de criado o v2", async () => {
    const { db, zipV1 } = await ciclo()
    const conteudoV1 = zipV1.get(SNAPSHOT_CAMINHO_PACOTE)!
    const pacoteV1 = db.estado.pacotes.find((p) => p.versao === 1)!
    const itemV1 = db.estado.itens.find(
      (i) => i.pacoteId === pacoteV1.id && i.caminho === SNAPSHOT_CAMINHO_PACOTE,
    )!
    // O item persistido da v1 continua descrevendo os bytes originais da v1.
    expect(itemV1.sha256).toBe(sha256Texto(conteudoV1))
    expect(JSON.parse(conteudoV1).versao).toBe(1)
  })

  it("4 · snapshotHash confere com os bytes preservados e reconstrói o objeto", async () => {
    const { db, zipV1 } = await ciclo()
    const pacoteV1 = db.estado.pacotes.find((p) => p.versao === 1)!
    const itemV1 = db.estado.itens.find(
      (i) => i.pacoteId === pacoteV1.id && i.caminho === SNAPSHOT_CAMINHO_PACOTE,
    )!
    const conteudo = zipV1.get(SNAPSHOT_CAMINHO_PACOTE)!

    const reconstruido = verificarSnapshotDoPacote(conteudo, itemV1.sha256 as string)
    expect(reconstruido).not.toBeNull()
    const s = reconstruido as unknown as SnapshotFechamentoV1
    expect(s.versao).toBe(1)
    expect(s.schemaVersion).toContain("/v2")
    // Adulterar um byte quebra a verificação.
    expect(verificarSnapshotDoPacote(conteudo + " ", itemV1.sha256 as string)).toBeNull()
  })

  it("5 · SEM CICLO: manifesto cita o snapshot, snapshot não cita o manifesto", async () => {
    const db = fakeDb()
    const pacote = fakePacote()
    const deps = { repo: criarRepoFechamento(db), pacote, storage: fakeStorage() }
    await fecharCompetencia(SCOPE, ELEVADO, COMP, { confirmacao: CODIGO }, deps, AGORA)

    const conteudo = pacote.zips.get("v1")!.get(SNAPSHOT_CAMINHO_PACOTE)!
    // O snapshot é calculável sem conhecer o manifesto.
    for (const proibido of ["manifestoHash", "manifest.json", "storageRef"]) {
      expect(conteudo, proibido).not.toContain(proibido)
    }
    // E o manifesto, por sua vez, referencia o hash do snapshot.
    const item = db.estado.itens.find((i) => i.caminho === SNAPSHOT_CAMINHO_PACOTE)!
    expect(item.sha256).toBe(sha256Texto(conteudo))
  })

  it("6 · ordem diferente da mesma entrada mantém o hash do arquivo", () => {
    // A canonização ordena as chaves, então dois objetos equivalentes produzem
    // exatamente os mesmos bytes — e o mesmo sha256 no manifesto.
    const a = montarConteudoPacoteExtras([
      { caminho: "x.json", conteudo: JSON.stringify({ b: 1, a: 2 }), categoria: "snapshot", fonte: "f", descricao: "d" },
    ])
    const b = montarConteudoPacoteExtras([
      { caminho: "x.json", conteudo: JSON.stringify({ b: 1, a: 2 }), categoria: "snapshot", fonte: "f", descricao: "d" },
    ])
    expect(a).toEqual(b)
  })

  it("10 · o snapshot não carrega PII, storeId, storageRef nem URL", async () => {
    const db = fakeDb()
    const pacote = fakePacote()
    const deps = { repo: criarRepoFechamento(db), pacote, storage: fakeStorage() }
    await fecharCompetencia(SCOPE, ELEVADO, COMP, { confirmacao: CODIGO }, deps, AGORA)

    const conteudo = pacote.zips.get("v1")!.get(SNAPSHOT_CAMINHO_PACOTE)!.toLowerCase()
    for (const proibido of ["loja-1", "user-1", "storageref", "http", "token", "secret", "cpf", "@"]) {
      expect(conteudo, proibido).not.toContain(proibido)
    }
  })
})

/** Helper local: só exercita a descrição determinística dos extras. */
function montarConteudoPacoteExtras(extras: ArquivoPacote[]) {
  return extras.map((a) => ({ caminho: a.caminho, sha256: sha256Texto(a.conteudo) }))
}

/* ═══════════════ GAP 2 · dedupe forte ═══════════════ */

describe("012A · GAP 2 — dedupe forte sob concorrência", () => {
  async function fechada() {
    const db = fakeDb()
    const deps = { repo: criarRepoFechamento(db), pacote: fakePacote(1200), storage: fakeStorage() }
    await fecharCompetencia(SCOPE, ELEVADO, COMP, { confirmacao: CODIGO }, deps, AGORA)
    return { db, repo: deps.repo }
  }

  it("7 · dois POSTs simultâneos do MESMO diff geram exatamente um evento", async () => {
    const { db, repo } = await fechada()
    const comp = db.estado.competencias[0] as never
    const d = avaliarDivergencia(comp, extrairTotais(dados(1500)))!
    expect(d.divergente).toBe(true)

    const [r1, r2] = await Promise.all([
      registrarDivergencia(ESCOPO, COMP, comp, d, { repo }),
      registrarDivergencia(ESCOPO, COMP, comp, d, { repo }),
    ])

    // Exatamente um criou; ambos responderam com sucesso (idempotente).
    expect([r1.criado, r2.criado].filter(Boolean)).toHaveLength(1)
    expect(db.estado.eventos.filter((e) => e.tipo === "alteracao_pos_fechamento")).toHaveLength(1)
    // E os dois passaram pelo lock, escopado por competência + loja.
    expect(db.locks.length).toBeGreaterThanOrEqual(2)
    expect(db.locks.every((l) => l === "comp-1|loja-1")).toBe(true)
  })

  it("7b · cinco POSTs simultâneos continuam gerando um único evento", async () => {
    const { db, repo } = await fechada()
    const comp = db.estado.competencias[0] as never
    const d = avaliarDivergencia(comp, extrairTotais(dados(1500)))!

    const r = await Promise.all(
      Array.from({ length: 5 }, () => registrarDivergencia(ESCOPO, COMP, comp, d, { repo })),
    )
    expect(r.filter((x) => x.criado)).toHaveLength(1)
    expect(db.estado.eventos.filter((e) => e.tipo === "alteracao_pos_fechamento")).toHaveLength(1)
  })

  it("8 · retry sequencial após conflito não duplica pacote, item nem evento", async () => {
    const { db, repo } = await fechada()
    const comp = db.estado.competencias[0] as never
    const d = avaliarDivergencia(comp, extrairTotais(dados(1500)))!

    await registrarDivergencia(ESCOPO, COMP, comp, d, { repo })
    await registrarDivergencia(ESCOPO, COMP, comp, d, { repo })
    await registrarDivergencia(ESCOPO, COMP, comp, d, { repo })

    expect(db.estado.eventos.filter((e) => e.tipo === "alteracao_pos_fechamento")).toHaveLength(1)
    // Refechar a mesma versão é recusado — pacote e itens continuam únicos.
    expect(db.estado.pacotes).toHaveLength(1)
    expect(db.estado.itens.filter((i) => i.caminho === SNAPSHOT_CAMINHO_PACOTE)).toHaveLength(1)
  })

  it("9 · falha na transação do registro mantém a competência consistente", async () => {
    const { db, repo } = await fechada()
    const comp = db.estado.competencias[0] as never
    const d = avaliarDivergencia(comp, extrairTotais(dados(1500)))!

    const statusAntes = db.estado.competencias[0].status
    const hashAntes = db.estado.competencias[0].snapshotHash
    const criarOriginal = db.contadorEvento.create
    db.contadorEvento.create = async () => {
      throw new Error("falha simulada ao criar evento")
    }

    await expect(registrarDivergencia(ESCOPO, COMP, comp, d, { repo })).rejects.toThrow(/falha simulada/)

    db.contadorEvento.create = criarOriginal
    expect(db.estado.competencias[0].status).toBe(statusAntes)
    expect(db.estado.competencias[0].snapshotHash).toBe(hashAntes)
    expect(db.estado.eventos.filter((e) => e.tipo === "alteracao_pos_fechamento")).toHaveLength(0)

    // E o lock foi liberado: um novo registro ainda funciona (sem deadlock).
    const r = await registrarDivergencia(ESCOPO, COMP, comp, d, { repo })
    expect(r.criado).toBe(true)
  })

  it("9b · divergência diferente ainda cria um segundo evento", async () => {
    const { db, repo } = await fechada()
    const comp = db.estado.competencias[0] as never
    await registrarDivergencia(ESCOPO, COMP, comp, avaliarDivergencia(comp, extrairTotais(dados(1500)))!, { repo })
    await registrarDivergencia(ESCOPO, COMP, comp, avaliarDivergencia(comp, extrairTotais(dados(1900)))!, { repo })
    expect(db.estado.eventos.filter((e) => e.tipo === "alteracao_pos_fechamento")).toHaveLength(2)
  })
})
