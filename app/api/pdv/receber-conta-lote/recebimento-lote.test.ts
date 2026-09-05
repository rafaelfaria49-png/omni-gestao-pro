import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, it, expect, beforeEach, vi } from "vitest"

// ============================================================================
// GOAL PDV-RECEBIMENTO-MULTITITULO-BACKEND-003 (G2) — recebimento em lote.
// ----------------------------------------------------------------------------
// O banco fake herda o harness do G1 (`../receber-conta/recebimento-atomico.test.ts`) e
// acrescenta o que o lote exige:
//
//   (a) `$queryRaw` com um advisory lock DE VERDADE — uma fila por chave, presa até o
//       fim da transação. É o que permite provar concorrência: duas requisições com a
//       MESMA `idempotencyKey` são serializadas, e a segunda só enxerga o estado depois
//       do commit da primeira. Chaves diferentes não se bloqueiam.
//   (b) `SELECT ... FOR UPDATE` da sessão de caixa, respondido pelo mesmo fake.
//   (c) falhas injetáveis no N-ésimo título / N-ésima movimentação / na operação de caixa,
//       para provar rollback DEPOIS de escritas já feitas — não só antes.
//
// Como no G1, o cliente GLOBAL recusa qualquer acesso enquanto há transação aberta: um
// service que ignorasse a porta `db` estouraria em vez de passar despercebido.
// ============================================================================

type Row = Record<string, unknown>

const h = vi.hoisted(() => {
  type Db = {
    titulos: Record<string, unknown>[]
    movs: Record<string, unknown>[]
    caixaOps: Record<string, unknown>[]
    carteiras: Record<string, unknown>[]
    sessoes: Record<string, unknown>[]
  }
  const empty = (): Db => ({ titulos: [], movs: [], caixaOps: [], carteiras: [], sessoes: [] })
  let db: Db = empty()
  let seq = 0
  let txAbertas = 0

  /** Trilha das operações relevantes, na ordem — prova que o lock vem primeiro. */
  let ordem: string[] = []

  /** Falhas injetadas. 0 = desligado; N = falha na N-ésima chamada. */
  const falhas = {
    tituloUpdate: 0,
    mov: 0,
    caixa: false,
    pagarNaLeitura: 0,
    tocarAposLeitura: 0,
    concorrenteAposCarga: null as { localKey: string; valor: number; origem: "singular" | "batch" } | null,
  }
  const contadores = { tituloUpdate: 0, mov: 0, tituloRead: 0 }

  /**
   * Relógio monotônico do `updatedAt`. `new Date()` repetiria o mesmo milissegundo em
   * escritas seguidas e o token de concorrência otimista pareceria funcionar sem funcionar.
   */
  let relogio = Date.parse("2026-09-04T12:00:00.000Z")
  const tick = () => new Date(++relogio)

  /** Fila por chave: emula `pg_advisory_xact_lock` (transacional, exclusivo). */
  const filas = new Map<string, Promise<void>>()
  async function adquirirLock(key: string): Promise<() => void> {
    const anterior = filas.get(key) ?? Promise.resolve()
    let liberar!: () => void
    const meu = new Promise<void>((r) => {
      liberar = r
    })
    filas.set(
      key,
      anterior.then(() => meu),
    )
    await anterior
    return liberar
  }

  function next(prefix: string) {
    return `${prefix}-${++seq}`
  }

  function money(v: unknown): number {
    const n = typeof v === "number" ? v : Number(v)
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
  }

  function matchTitulo(r: Row, where: Record<string, unknown>): boolean {
    if (where.id && r.id !== where.id) return false
    if (where.storeId && r.storeId !== where.storeId) return false
    return true
  }

  function applyScalars(row: Row, data: Row): Row {
    for (const k of ["descricao", "cliente", "valor", "vencimento", "status", "payload"]) {
      if (data[k] !== undefined) row[k] = data[k]
    }
    row.updatedAt = tick()
    return row
  }

  /**
   * Leituras devolvem CÓPIA, como um banco de verdade. Devolver a referência viva faria o
   * `updatedAt` que o service capturou mudar junto com a linha — e o teste de concorrência
   * nunca conseguiria simular "outra transação tocou a linha depois da minha leitura".
   */
  function snapshot<T extends Row | null | undefined>(row: T): T {
    return (row ? { ...row } : row) as T
  }

  type Ctx = {
    releases: Array<() => void>
    /**
     * Re-tira o snapshot de rollback. Uma transação que ESPERA no advisory lock começou
     * antes da concorrente commitar; sem refazer o snapshot aqui, um rollback dela
     * apagaria o que a outra já gravou.
     */
    resnapshot: () => void
  }

  /** Delegates sobre o store. `guard` recusa uso do cliente global em transação. */
  function makeClient(guard: () => void, ctx: Ctx | null) {
    return {
      $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        guard()
        const sql = strings.join("?")
        if (sql.includes("pg_advisory_xact_lock")) {
          const key = String(values[0])
          ordem.push(`lock:${key}`)
          const liberar = await adquirirLock(key)
          ctx?.releases.push(liberar)
          // O lock do lote é sempre a primeira operação e pode ter esperado outra
          // transação commitar. Locks posteriores (carteira) não podem redefinir o
          // snapshot de rollback depois que o lote já escreveu títulos/movimentos.
          if (key.startsWith("pdv-rc-lote:")) ctx?.resnapshot()
          return [{ lock: "" }]
        }
        if (sql.includes("sessoes_caixa")) {
          ordem.push("sessao_for_update")
          const sessaoId = String(values[0])
          const storeId = String(values[1])
          const s = db.sessoes.find((x) => x.id === sessaoId && x.storeId === storeId)
          return s ? [{ id: s.id, storeId: s.storeId, status: s.status }] : []
        }
        throw new Error(`query raw não suportada no harness: ${sql}`)
      },
      contaReceberTitulo: {
        findUnique: async ({
          where,
        }: {
          where: { id?: string; storeId_localKey?: { storeId: string; localKey: string } }
        }) => {
          guard()
          if (where.id) return snapshot(db.titulos.find((r) => r.id === where.id) ?? null)
          const { storeId, localKey } = where.storeId_localKey!
          return snapshot(db.titulos.find((r) => r.storeId === storeId && r.localKey === localKey) ?? null)
        },
        findFirst: async ({ where }: { where: Record<string, unknown> }) => {
          guard()
          const row = db.titulos.find((r) => matchTitulo(r, where ?? {})) ?? null
          contadores.tituloRead += 1
          // Corrida real: o título é quitado por OUTRA sessão entre a revalidação do lote
          // e a gravação deste item. O service recusa (`ja_pago`) e o lote inteiro cai.
          if (row && falhas.pagarNaLeitura > 0 && contadores.tituloRead === falhas.pagarNaLeitura) {
            row.status = "pago"
          }
          const lido = snapshot(row)
          // Outra transação toca a linha DEPOIS desta leitura: o token `updatedAt` que o
          // service acabou de capturar fica velho e a escrita dele tem de casar 0 linhas.
          if (row && falhas.tocarAposLeitura > 0 && contadores.tituloRead === falhas.tocarAposLeitura) {
            row.updatedAt = tick()
          }
          return lido
        },
        findMany: async ({ where }: { where?: Record<string, unknown> }) => {
          guard()
          const lk = where?.localKey as { in?: string[] } | string | undefined
          const alvos = lk && typeof lk === "object" && Array.isArray(lk.in) ? new Set(lk.in) : null
          const lidos = db.titulos
            .filter((r) => {
              if (where?.storeId && r.storeId !== where.storeId) return false
              if (alvos && !alvos.has(String(r.localKey))) return false
              if (typeof lk === "string" && r.localKey !== lk) return false
              return true
            })
            .map(snapshot)

          // Commit externo ENTRE a carga T0 e o primeiro CAS do lote. O snapshot entregue
          // ao lote permanece T0; o store real avança e a mutação concorrente é incorporada
          // ao snapshot de rollback, portanto sobrevive quando o lote aborta.
          const concorrente = falhas.concorrenteAposCarga
          if (concorrente) {
            const row = db.titulos.find((r) => r.localKey === concorrente.localKey)
            if (row) {
              const payload = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
                ? (row.payload as Row)
                : {}
              const historico = Array.isArray(payload.historico) ? [...(payload.historico as Row[])] : []
              const at = tick()
              historico.push({ tipo: "pagamento", valor: concorrente.valor, at: at.toISOString(), origem: "concorrente" })
              row.payload = { ...payload, historico }
              const pago = historico.reduce((s, item) => {
                const tipo = String(item.tipo ?? "")
                return tipo === "pagamento" || tipo === "liquidacao" ? s + money(item.valor) : s
              }, 0)
              row.status = pago >= money(row.valor) ? "pago" : "parcial"
              row.updatedAt = at
              db.movs.push({
                id: next("mov-externo"),
                storeId: row.storeId,
                tipo: "entrada",
                origem: pago >= money(row.valor) ? "receber" : "receber_parcial",
                referenciaId: row.id,
                valor: concorrente.valor,
                createdAt: at,
              })
              db.caixaOps.push({
                id: next("cxop-externo"),
                sessaoId: "sess-concorrente",
                storeId: row.storeId,
                tipo: "recebimento_cr",
                valor: concorrente.valor,
                payload: { origem: concorrente.origem, localId: `${concorrente.origem}-externo` },
                createdAt: at,
              })
              falhas.concorrenteAposCarga = null
              ctx?.resnapshot()
            }
          }

          return lidos
        },
        upsert: async ({
          where,
          create,
          update,
        }: {
          where: { storeId_localKey: { storeId: string; localKey: string } }
          create: Row
          update: Row
        }) => {
          guard()
          const { storeId, localKey } = where.storeId_localKey
          const existing = db.titulos.find((r) => r.storeId === storeId && r.localKey === localKey)
          if (existing) return applyScalars(existing, update)
          const row: Row = {
            id: next("cr"),
            storeId,
            localKey,
            descricao: create.descricao ?? "",
            cliente: create.cliente ?? "",
            valor: create.valor ?? 0,
            vencimento: create.vencimento ?? "",
            status: create.status ?? "pendente",
            payload: create.payload ?? {},
            createdAt: new Date(),
            updatedAt: tick(),
          }
          db.titulos.push(row)
          return row
        },
        update: async ({ where, data }: { where: { id?: string }; data: Row }) => {
          guard()
          contadores.tituloUpdate += 1
          if (falhas.tituloUpdate > 0 && contadores.tituloUpdate === falhas.tituloUpdate) {
            throw new Error(`falha injetada: título #${falhas.tituloUpdate}`)
          }
          const row = db.titulos.find((r) => r.id === where.id)
          if (!row) throw new Error("Record to update not found.")
          ordem.push(`titulo_update:${String(row.localKey)}`)
          return applyScalars(row, data)
        },
        /**
         * Token de concorrência otimista: o `where` traz `updatedAt` da leitura. Se outra
         * escrita tocou a linha nesse meio-tempo, o `count` volta 0 — como no Postgres.
         */
        updateMany: async ({ where, data }: { where: { id?: string; storeId?: string; updatedAt?: unknown }; data: Row }) => {
          guard()
          contadores.tituloUpdate += 1
          if (falhas.tituloUpdate > 0 && contadores.tituloUpdate === falhas.tituloUpdate) {
            throw new Error(`falha injetada: título #${falhas.tituloUpdate}`)
          }
          const row = db.titulos.find((r) => r.id === where.id)
          if (!row) return { count: 0 }
          if (where.storeId && row.storeId !== where.storeId) return { count: 0 }
          if (where.updatedAt !== undefined) {
            const atual = row.updatedAt as Date | undefined
            const token = where.updatedAt as Date
            if (!atual || !(token instanceof Date) || atual.getTime() !== token.getTime()) {
              return { count: 0 }
            }
          }
          ordem.push(`titulo_update:${String(row.localKey)}`)
          applyScalars(row, data)
          return { count: 1 }
        },
      },
      movimentacaoFinanceira: {
        findFirst: async ({ where }: { where: Record<string, unknown> }) => {
          guard()
          ordem.push("mov_idempotencia_findFirst")
          const r = db.movs.find(
            (m) =>
              m.storeId === where.storeId &&
              m.referenciaId === where.referenciaId &&
              m.tipo === where.tipo &&
              m.origem === where.origem,
          )
          return r ? { id: r.id as string } : null
        },
        aggregate: async ({ where }: { where: Record<string, unknown> }) => {
          guard()
          const startsWith = (where.origem as { startsWith?: string } | undefined)?.startsWith
          if (startsWith) ordem.push("mov_idempotencia_aggregate")
          if (where.carteiraId) ordem.push(`carteira_aggregate:${String(where.carteiraId)}:${String(where.tipo)}`)
          const rows = db.movs.filter((m) => {
            if (where.storeId && m.storeId !== where.storeId) return false
            if (where.referenciaId && m.referenciaId !== where.referenciaId) return false
            if (where.tipo && m.tipo !== where.tipo) return false
            if (where.carteiraId && m.carteiraId !== where.carteiraId) return false
            if (startsWith && !String(m.origem).startsWith(startsWith)) return false
            return true
          })
          return { _sum: { valor: rows.reduce((s, m) => s + money(m.valor), 0) } }
        },
        create: async ({ data }: { data: Row }) => {
          guard()
          contadores.mov += 1
          if (falhas.mov > 0 && contadores.mov === falhas.mov) {
            throw new Error("falha injetada: MovimentacaoFinanceira")
          }
          const row = { id: next("mov"), createdAt: new Date(), ...data }
          db.movs.push(row)
          ordem.push("mov_create")
          return row
        },
      },
      caixaOperacao: {
        findFirst: async ({ where }: { where: Record<string, unknown> }) => {
          guard()
          ordem.push("caixa_replay_findFirst")
          const pl = where.payload as { path?: string[]; equals?: unknown } | undefined
          const r = db.caixaOps.find((o) => {
            if (where.storeId && o.storeId !== where.storeId) return false
            if (where.sessaoId && o.sessaoId !== where.sessaoId) return false
            if (where.tipo && o.tipo !== where.tipo) return false
            if (pl?.path?.length) {
              const key = pl.path[0]!
              if ((o.payload as Row | undefined)?.[key] !== pl.equals) return false
            }
            return true
          })
          return r
            ? {
                id: r.id as string,
                sessaoId: r.sessaoId as string,
                valor: r.valor as number,
                payload: r.payload as Row,
              }
            : null
        },
        create: async ({ data }: { data: Row }) => {
          guard()
          if (falhas.caixa) throw new Error("falha injetada: CaixaOperacao")
          const row = { id: next("cxop"), createdAt: new Date(), ...data }
          db.caixaOps.push(row)
          ordem.push("caixa_create")
          return row
        },
      },
      carteiraFinanceira: {
        findFirst: async ({ where }: { where: Record<string, unknown> }) => {
          guard()
          return (
            db.carteiras.find(
              (c) =>
                c.id === where.id &&
                (!where.storeId || c.storeId === where.storeId) &&
                (where.ativo === undefined || c.ativo === where.ativo),
            ) ?? null
          )
        },
        update: async ({ where, data }: { where: { id?: string }; data: Row }) => {
          guard()
          const c = db.carteiras.find((x) => x.id === where.id)
          if (!c) throw new Error("Carteira não encontrada")
          ordem.push("carteira_recalculo")
          Object.assign(c, data)
          return c
        },
      },
      sessaoCaixa: {
        findFirst: async ({ where }: { where: Record<string, unknown> }) => {
          guard()
          const r = db.sessoes.find(
            (s) =>
              (!where.id || s.id === where.id) &&
              (!where.storeId || s.storeId === where.storeId) &&
              (!where.status || s.status === where.status),
          )
          return r ? { id: r.id as string } : null
        },
      },
    }
  }

  const globalClient = makeClient(() => {
    if (txAbertas > 0) {
      throw new Error("cliente GLOBAL usado dentro de $transaction — porta `db` não foi injetada")
    }
  }, null)

  const prisma = {
    ...globalClient,
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      let snap = structuredClone(db)
      const ctx: Ctx = {
        releases: [],
        resnapshot: () => {
          snap = structuredClone(db)
        },
      }
      // Cliente PRÓPRIO por transação: cada uma segura seus próprios locks.
      const txClient = makeClient(() => {}, ctx)
      txAbertas += 1
      try {
        return await fn(txClient)
      } catch (e) {
        db = snap // rollback real do estado
        throw e
      } finally {
        txAbertas -= 1
        // Advisory lock é TRANSACIONAL: solta no commit e no rollback.
        for (const liberar of ctx.releases) liberar()
      }
    },
  }

  return {
    prisma,
    get db() {
      return db
    },
    get ordem() {
      return ordem
    },
    falharTituloNo: (n: number) => {
      falhas.tituloUpdate = n
    },
    falharMovNo: (n: number) => {
      falhas.mov = n
    },
    falharCaixa: () => {
      falhas.caixa = true
    },
    pagarNaLeituraDoTitulo: (n: number) => {
      falhas.pagarNaLeitura = n
    },
    /** Outra transação grava no título logo depois da N-ésima leitura do service. */
    tocarTituloAposLeitura: (n: number) => {
      falhas.tocarAposLeitura = n
    },
    receberExternamenteAposCarga: (localKey: string, valor: number, origem: "singular" | "batch" = "singular") => {
      falhas.concorrenteAposCarga = { localKey, valor, origem }
    },
    seedSessao: (id: string, storeId: string, status = "ABERTA") => db.sessoes.push({ id, storeId, status }),
    fecharSessao: (id: string) => {
      const s = db.sessoes.find((x) => x.id === id)
      if (s) s.status = "FECHADA"
    },
    reset: () => {
      db = empty()
      seq = 0
      txAbertas = 0
      ordem = []
      filas.clear()
      falhas.tituloUpdate = 0
      falhas.mov = 0
      falhas.caixa = false
      falhas.pagarNaLeitura = 0
      falhas.tocarAposLeitura = 0
      falhas.concorrenteAposCarga = null
      contadores.tituloUpdate = 0
      contadores.mov = 0
      contadores.tituloRead = 0
    },
  }
})

const STORE = "loja-1"
const OUTRA = "loja-2"
const SESSAO = "sess-1"
const SESSAO_OUTRA = "sess-2"
const KEY = "lote-0001-abcdefgh"

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma, prismaEnsureConnected: vi.fn(async () => undefined) }))
vi.mock("@/lib/store-id-from-request", () => ({
  storeIdFromAssistecRequestForWrite: vi.fn((req: Request) => req.headers.get("x-assistec-loja-id") ?? ""),
}))
vi.mock("@/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1", name: "Tester" } })) }))
vi.mock("@/lib/auth/session-operator", () => ({ getOperatorLabelFromSession: vi.fn(() => "Tester") }))
vi.mock("@/lib/auth/api-enterprise-guard", () => ({
  apiGuardFinanceiroEditEnterpriseOrLegacy: vi.fn(async () => null),
}))
vi.mock("@/lib/financeiro/services/fechamento-service", () => ({
  verificarPeriodoFechado: vi.fn(async () => ({ fechado: false })),
}))
vi.mock("@/lib/financeiro/services/auditoria-actor", () => ({
  extractAuditoriaActor: vi.fn(() => ({})),
  logAuditoriaFinanceira: vi.fn(async () => undefined),
}))

import { POST } from "./route"
import {
  upsertContaReceber,
  getContaReceberByLocalKey,
  buildContaReceberAuditTrail,
} from "@/lib/financeiro/services/contas-receber-service"
import {
  RECEBIMENTO_LOTE_MAX_ITENS,
  buildRecebimentoLoteLocalId,
  buildRecebimentoLoteRequestFingerprint,
} from "@/lib/financeiro/services/recebimento-lote-service"

type ItemBody = { localKey: string; saldoEsperado: number; valorReceber: number; tituloId?: string }

async function seedTitulos(qtd: number, valor = 100, storeId = STORE, prefixo = "cr") {
  const keys: string[] = []
  for (let i = 1; i <= qtd; i++) {
    const localKey = `${prefixo}-${i}`
    await upsertContaReceber({
      storeId,
      localKey,
      descricao: `Crediário ${i}`,
      cliente: "Ana Souza",
      valor,
      vencimento: "2026-08-10",
      status: "pendente",
      payloadPatch: { id: localKey, origem: "manual" },
      replacePayload: true,
    })
    keys.push(localKey)
  }
  return keys
}

function post(body: Record<string, unknown>, storeId = STORE) {
  return new Request("http://local/api/pdv/receber-conta-lote", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-assistec-loja-id": storeId },
    body: JSON.stringify({
      sessaoId: storeId === STORE ? SESSAO : SESSAO_OUTRA,
      formaPagamento: "dinheiro",
      idempotencyKey: KEY,
      ...body,
    }),
  })
}

function itensDe(keys: string[], saldo = 100, valor = saldo): ItemBody[] {
  return keys.map((localKey) => ({ localKey, saldoEsperado: saldo, valorReceber: valor }))
}

async function json(res: Response) {
  return (await res.json()) as Record<string, unknown>
}

const saldoDe = async (localKey: string, storeId = STORE) => {
  const t = await getContaReceberByLocalKey(storeId, localKey)
  return t ? buildContaReceberAuditTrail([t])[0]!.saldoAberto : null
}

const statusDe = async (localKey: string, storeId = STORE) =>
  (await getContaReceberByLocalKey(storeId, localKey))?.status ?? null

beforeEach(() => {
  h.reset()
  h.seedSessao(SESSAO, STORE)
  h.seedSessao(SESSAO_OUTRA, OUTRA)
})

describe("G2 — caminho feliz do lote", () => {
  it("[T1] 5 títulos selecionados, todos quitados: 1 CaixaOperacao, 5 movimentações, 5 títulos pagos", async () => {
    const keys = await seedTitulos(5)
    const res = await POST(post({ itens: itensDe(keys) }))
    const body = await json(res)

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.jaRegistrado).toBe(false)
    expect(body.totalRecebido).toBe(500)
    expect(body.sessaoId).toBe(SESSAO)
    expect((body.itens as Row[]).map((i) => i.statusFinal)).toEqual(["pago", "pago", "pago", "pago", "pago"])

    for (const k of keys) {
      expect(await saldoDe(k)).toBe(0)
      expect(await statusDe(k)).toBe("pago")
    }
    expect(h.db.caixaOps).toHaveLength(1)
    expect(h.db.movs).toHaveLength(5)
  })

  it("[T2] 3 de 5 selecionados: apenas os 3 mudam; os outros 2 ficam intactos", async () => {
    const keys = await seedTitulos(5)
    const escolhidos = [keys[0]!, keys[2]!, keys[4]!]
    const res = await POST(post({ itens: itensDe(escolhidos) }))

    expect(res.status).toBe(200)
    for (const k of escolhidos) expect(await saldoDe(k)).toBe(0)
    expect(await saldoDe(keys[1]!)).toBe(100)
    expect(await saldoDe(keys[3]!)).toBe(100)
    expect(await statusDe(keys[1]!)).toBe("pendente")
    expect(h.db.movs).toHaveLength(3)
    expect(h.db.caixaOps).toHaveLength(1)
    expect(h.db.caixaOps[0]!.valor).toBe(300)
  })

  it("[T3] lote misto: A quita (100 de 100) e B fica parcial (50 de 200)", async () => {
    await upsertContaReceber({
      storeId: STORE,
      localKey: "A",
      descricao: "A",
      cliente: "Ana",
      valor: 100,
      vencimento: "2026-08-10",
      status: "pendente",
      payloadPatch: { id: "A" },
      replacePayload: true,
    })
    await upsertContaReceber({
      storeId: STORE,
      localKey: "B",
      descricao: "B",
      cliente: "Ana",
      valor: 200,
      vencimento: "2026-08-10",
      status: "pendente",
      payloadPatch: { id: "B" },
      replacePayload: true,
    })

    const res = await POST(
      post({
        itens: [
          { localKey: "A", saldoEsperado: 100, valorReceber: 100 },
          { localKey: "B", saldoEsperado: 200, valorReceber: 50 },
        ],
      }),
    )
    const body = await json(res)
    const itens = body.itens as Row[]

    expect(res.status).toBe(200)
    expect(body.totalRecebido).toBe(150)
    expect(itens[0]).toMatchObject({ localKey: "A", saldoAntes: 100, valorRecebido: 100, saldoDepois: 0, statusFinal: "pago" })
    expect(itens[1]).toMatchObject({ localKey: "B", saldoAntes: 200, valorRecebido: 50, saldoDepois: 150, statusFinal: "parcial" })
    expect(await statusDe("A")).toBe("pago")
    expect(await statusDe("B")).toBe("parcial")
    expect(h.db.caixaOps).toHaveLength(1)
    expect(h.db.caixaOps[0]!.valor).toBe(150)
  })

  it("[T13] o total da CaixaOperacao é a soma dos itens — recalculada no servidor", async () => {
    const keys = await seedTitulos(3, 70)
    const res = await POST(
      post({
        // O cliente sequer envia total; se enviasse, seria ignorado.
        total: 999999,
        itens: [
          { localKey: keys[0]!, saldoEsperado: 70, valorReceber: 70 },
          { localKey: keys[1]!, saldoEsperado: 70, valorReceber: 20 },
          { localKey: keys[2]!, saldoEsperado: 70, valorReceber: 5.5 },
        ],
      }),
    )
    const body = await json(res)

    expect(res.status).toBe(200)
    expect(body.totalRecebido).toBe(95.5)
    expect(h.db.caixaOps[0]!.valor).toBe(95.5)
    const itensPayload = (h.db.caixaOps[0]!.payload as Row).itens as Row[]
    expect(itensPayload.reduce((s, i) => s + Number(i.valor), 0)).toBe(95.5)
  })

  it("[T14] uma MovimentacaoFinanceira por título, com referenciaId do próprio título", async () => {
    const keys = await seedTitulos(4)
    await POST(post({ itens: itensDe(keys) }))

    expect(h.db.movs).toHaveLength(4)
    const refs = h.db.movs.map((m) => String(m.referenciaId))
    expect(new Set(refs).size).toBe(4)
    for (const k of keys) {
      const t = await getContaReceberByLocalKey(STORE, k)
      expect(refs).toContain(t!.id)
    }
    expect(h.db.movs.every((m) => m.tipo === "entrada")).toBe(true)
    expect(h.db.movs.every((m) => String(m.origem).startsWith("receber"))).toBe(true)
  })

  it("[T15] uma única CaixaOperacao por lote, com rastreabilidade de todos os títulos", async () => {
    const keys = await seedTitulos(3)
    await POST(post({ itens: itensDe(keys) }))

    expect(h.db.caixaOps).toHaveLength(1)
    const op = h.db.caixaOps[0]!
    const payload = op.payload as Row
    expect(op.tipo).toBe("recebimento_cr")
    expect(op.sessaoId).toBe(SESSAO)
    expect(payload.origem).toBe("pdv_lote")
    expect(payload.formaPagamento).toBe("dinheiro")
    expect(payload.localId).toBe(`pdv-rc-lote:${STORE}:${SESSAO}:${KEY}`)
    expect(payload.requestFingerprint).toMatch(/^[a-f0-9]{64}$/)
    const itens = payload.itens as Row[]
    expect(itens).toHaveLength(3)
    expect(itens.map((i) => i.localKey)).toEqual(keys)
    for (const i of itens) expect(typeof i.tituloId).toBe("string")
  })

  it("o `localId` é determinístico — sem `Date.now()` — e carrega loja e sessão", async () => {
    const keys = await seedTitulos(1)
    await POST(post({ itens: itensDe(keys) }))
    const localId = String((h.db.caixaOps[0]!.payload as Row).localId)

    expect(localId).toBe(buildRecebimentoLoteLocalId({ storeId: STORE, sessaoId: SESSAO, idempotencyKey: KEY }))
    expect(localId).not.toMatch(/\d{13}/)
  })

  it("o histórico do título carimba forma de pagamento e o id do lote", async () => {
    const keys = await seedTitulos(1)
    await POST(post({ itens: itensDe(keys), observacao: "acerto do mês" }))

    const t = await getContaReceberByLocalKey(STORE, keys[0]!)
    const hist = ((t!.payload as Row).historico as Row[]).at(-1)!
    expect(hist.tipo).toBe("liquidacao")
    expect(hist.valor).toBe(100)
    expect(hist.formaPagamento).toBe("dinheiro")
    expect(hist.loteId).toBe(KEY)
    expect(String(hist.observacao)).toContain("acerto do mês")
    expect(hist.userLabel).toBe("Tester")
  })
})

describe("G2 — revalidação server-side do saldo", () => {
  it("[T4] saldoEsperado divergente derruba o lote inteiro com 409 e ZERO escritas", async () => {
    const keys = await seedTitulos(3)
    const itens = itensDe(keys)
    itens[1]!.saldoEsperado = 999 // o cliente estava com a lista velha

    const res = await POST(post({ itens }))
    const body = await json(res)

    expect(res.status).toBe(409)
    expect(body.code).toBe("saldo_divergente")
    expect((body.detalhes as Row[])[0]).toMatchObject({ localKey: keys[1], saldoReal: 100 })
    for (const k of keys) expect(await saldoDe(k)).toBe(100)
    expect(h.db.movs).toHaveLength(0)
    expect(h.db.caixaOps).toHaveLength(0)
  })

  it("[T4b] valorReceber acima do saldo real derruba o lote (409), mesmo com saldoEsperado coerente", async () => {
    const keys = await seedTitulos(2)
    // Saldo real 100 depois de uma parcial anterior de 40 — o cliente pede 100.
    await POST(
      post({
        idempotencyKey: "parcial-anterior-01",
        itens: [{ localKey: keys[0]!, saldoEsperado: 100, valorReceber: 40 }],
      }),
    )
    expect(await saldoDe(keys[0]!)).toBe(60)

    const res = await POST(post({ itens: [{ localKey: keys[0]!, saldoEsperado: 100, valorReceber: 100 }] }))
    const body = await json(res)

    expect(res.status).toBe(409)
    expect(body.code).toBe("saldo_divergente")
    expect(await saldoDe(keys[0]!)).toBe(60)
    expect(h.db.caixaOps).toHaveLength(1) // só a parcial anterior
  })

  it("[T5] título já quitado no meio do lote: 409 titulo_alterado e nada gravado", async () => {
    const keys = await seedTitulos(5)
    // Terceiro título quitado por outra sessão antes do lote chegar.
    await POST(
      post({ idempotencyKey: "quitacao-avulsa-01", itens: [{ localKey: keys[2]!, saldoEsperado: 100, valorReceber: 100 }] }),
    )
    const caixaAntes = h.db.caixaOps.length
    const movsAntes = h.db.movs.length

    const res = await POST(post({ itens: itensDe(keys) }))
    const body = await json(res)

    expect(res.status).toBe(409)
    expect(body.code).toBe("titulo_alterado")
    expect((body.detalhes as Row[])[0]).toMatchObject({ localKey: keys[2], motivo: "titulo_pago" })
    for (const k of [keys[0]!, keys[1]!, keys[3]!, keys[4]!]) expect(await saldoDe(k)).toBe(100)
    expect(h.db.caixaOps).toHaveLength(caixaAntes)
    expect(h.db.movs).toHaveLength(movsAntes)
  })

  it("[T5b] título quitado DEPOIS da revalidação, já com 2 títulos gravados: rollback total", async () => {
    const keys = await seedTitulos(5)
    // Outra transação quita o 3º título depois da carga T0. Os dois primeiros updates do
    // lote chegam a acontecer, mas o CAS do terceiro usa T0 e derruba tudo que é do lote.
    h.receberExternamenteAposCarga(keys[2]!, 100)

    const res = await POST(post({ itens: itensDe(keys) }))
    const body = await json(res)

    expect(res.status).toBe(409)
    expect(body.code).toBe("titulo_alterado")
    // Os dois primeiros JÁ tinham sido gravados quando o erro subiu — e voltaram atrás.
    // O commit externo, por outro lado, não pertence ao lote e permanece.
    expect(await saldoDe(keys[0]!)).toBe(100)
    expect(await saldoDe(keys[1]!)).toBe(100)
    expect(await saldoDe(keys[2]!)).toBe(0)
    expect(await saldoDe(keys[3]!)).toBe(100)
    expect(await saldoDe(keys[4]!)).toBe(100)
    expect(h.db.movs).toHaveLength(1)
    expect(h.db.movs[0]!.valor).toBe(100)
    expect(h.db.caixaOps).toHaveLength(1)
    expect(h.db.caixaOps[0]!.valor).toBe(100)
  })

  it("título inexistente na loja: 409 titulo_alterado, zero escritas", async () => {
    const keys = await seedTitulos(2)
    const res = await POST(
      post({ itens: [...itensDe(keys), { localKey: "nao-existe", saldoEsperado: 10, valorReceber: 10 }] }),
    )
    const body = await json(res)

    expect(res.status).toBe(409)
    expect((body.detalhes as Row[])[0]).toMatchObject({ localKey: "nao-existe", motivo: "titulo_nao_encontrado" })
    expect(h.db.caixaOps).toHaveLength(0)
    expect(await saldoDe(keys[0]!)).toBe(100)
  })

  it("tituloId de conferência que não bate com o localKey derruba o lote", async () => {
    const keys = await seedTitulos(2)
    const res = await POST(
      post({ itens: [{ localKey: keys[0]!, tituloId: "outro-id", saldoEsperado: 100, valorReceber: 100 }] }),
    )
    const body = await json(res)

    expect(res.status).toBe(409)
    expect((body.detalhes as Row[])[0]).toMatchObject({ motivo: "titulo_id_divergente" })
    expect(h.db.caixaOps).toHaveLength(0)
  })
})

describe("G2 — atomicidade sob falha injetada", () => {
  it("[T6] falha ao gravar o 3º título de 5: os 5 seguem em aberto, zero movimentações, zero caixa", async () => {
    const keys = await seedTitulos(5)
    h.falharTituloNo(3)

    const res = await POST(post({ itens: itensDe(keys) }))
    expect(res.status).toBe(503)

    for (const k of keys) {
      expect(await saldoDe(k)).toBe(100)
      expect(await statusDe(k)).toBe("pendente")
    }
    expect(h.db.movs).toHaveLength(0)
    expect(h.db.caixaOps).toHaveLength(0)
  })

  it("[T5d/C] dois batches de sessões/keys diferentes: um commit vence e o outro recusa sem excedente", async () => {
    const keys = await seedTitulos(1)
    h.receberExternamenteAposCarga(keys[0]!, 30, "batch")

    const perdedor = await POST(post({
      idempotencyKey: "lote-concorrente-perdedor",
      itens: [{ localKey: keys[0]!, saldoEsperado: 100, valorReceber: 100 }],
    }))
    const body = await json(perdedor)

    expect(perdedor.status).toBe(409)
    expect(body.code).toBe("titulo_alterado")
    expect(await saldoDe(keys[0]!)).toBe(70)
    expect(h.db.movs).toHaveLength(1)
    expect(h.db.movs[0]!.valor).toBe(30)
    expect(h.db.caixaOps).toHaveLength(1)
    expect(h.db.caixaOps[0]!.valor).toBe(30)
    const titulo = await getContaReceberByLocalKey(STORE, keys[0]!)
    expect(((titulo!.payload as Row).historico as Row[])).toHaveLength(1)
  })

  it("[T7] falha na MovimentacaoFinanceira do 2º título faz rollback do lote inteiro", async () => {
    const keys = await seedTitulos(4)
    h.falharMovNo(2)

    const res = await POST(post({ itens: itensDe(keys) }))
    const body = await json(res)
    expect(res.status).toBe(503)
    expect(String(body.error)).toContain("MovimentacaoFinanceira")

    for (const k of keys) expect(await saldoDe(k)).toBe(100)
    expect(h.db.movs).toHaveLength(0)
    expect(h.db.caixaOps).toHaveLength(0)
  })

  it("[T8] falha na CaixaOperacao (última escrita) desfaz títulos e movimentações", async () => {
    const keys = await seedTitulos(5)
    h.falharCaixa()

    const res = await POST(post({ itens: itensDe(keys) }))
    expect(res.status).toBe(503)

    for (const k of keys) {
      expect(await saldoDe(k)).toBe(100)
      expect(await statusDe(k)).toBe("pendente")
    }
    expect(h.db.movs).toHaveLength(0)
    expect(h.db.caixaOps).toHaveLength(0)
  })

  it("[T5c] o CAS usa o snapshot T0: parcial concorrente após a carga derruba o lote inteiro", async () => {
    const keys = await seedTitulos(4)
    // O lote planeja quitar R$100. Uma baixa singular commita R$20 depois da carga T0.
    // O bug de 924bc23 relia T1, quitava os R$80 restantes e lançava R$100 em Movimento/
    // Caixa. Com o snapshot T0 vinculado ao CAS, o segundo título casa zero linhas.
    h.receberExternamenteAposCarga(keys[1]!, 20)

    const res = await POST(post({ itens: itensDe(keys) }))
    const body = await json(res)

    expect(res.status).toBe(409)
    expect(body.code).toBe("titulo_alterado")
    expect((body.detalhes as Row[])[0]).toMatchObject({ localKey: keys[1], motivo: "titulo_alterado" })
    // O 1º título já tinha sido gravado quando o conflito apareceu — e voltou atrás; a
    // parcial externa permanece como único dinheiro aplicado.
    expect(await saldoDe(keys[0]!)).toBe(100)
    expect(await saldoDe(keys[1]!)).toBe(80)
    expect(await saldoDe(keys[2]!)).toBe(100)
    expect(await saldoDe(keys[3]!)).toBe(100)
    const concorrente = await getContaReceberByLocalKey(STORE, keys[1]!)
    expect(((concorrente!.payload as Row).historico as Row[])).toHaveLength(1)
    expect(h.db.movs).toHaveLength(1)
    expect(h.db.movs[0]!.valor).toBe(20)
    expect(h.db.caixaOps).toHaveLength(1)
    expect(h.db.caixaOps[0]!.valor).toBe(20)
  })

  it("o cenário proibido do design é impossível: nunca 'títulos 1 e 2 quitados, 3 falha, 4 e 5 intactos'", async () => {
    const keys = await seedTitulos(5)
    h.falharTituloNo(3)
    await POST(post({ itens: itensDe(keys) }))

    const saldos = await Promise.all(keys.map((k) => saldoDe(k)))
    expect(new Set(saldos)).toEqual(new Set([100]))
  })
})

describe("G2 — idempotência do lote", () => {
  it("o fingerprint cobre loja, sessão, forma e todos os campos econômicos normalizados do item", () => {
    const input = { storeId: STORE, sessaoId: SESSAO, formaPagamento: "dinheiro" }
    const base = [{ localKey: "titulo-1", tituloId: "id-1", saldoEsperado: 100, valorReceber: 30 }]
    const fingerprint = buildRecebimentoLoteRequestFingerprint(input, base)
    const normalizado = buildRecebimentoLoteRequestFingerprint(
      { storeId: ` ${STORE} `, sessaoId: ` ${SESSAO} `, formaPagamento: " dinheiro " },
      [{ localKey: " titulo-1 ", tituloId: " id-1 ", saldoEsperado: 100.001, valorReceber: 30.001 }],
    )
    expect(normalizado).toBe(fingerprint)
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/)

    const variantes = [
      buildRecebimentoLoteRequestFingerprint({ ...input, storeId: OUTRA }, base),
      buildRecebimentoLoteRequestFingerprint({ ...input, sessaoId: SESSAO_OUTRA }, base),
      buildRecebimentoLoteRequestFingerprint({ ...input, formaPagamento: "pix" }, base),
      buildRecebimentoLoteRequestFingerprint(input, [{ ...base[0]!, localKey: "titulo-2" }]),
      buildRecebimentoLoteRequestFingerprint(input, [{ ...base[0]!, tituloId: "id-2" }]),
      buildRecebimentoLoteRequestFingerprint(input, [{ ...base[0]!, valorReceber: 31 }]),
      buildRecebimentoLoteRequestFingerprint(input, [{ ...base[0]!, saldoEsperado: 101 }]),
    ]
    expect(new Set([fingerprint, ...variantes]).size).toBe(8)
  })

  it("[T9] retry sequencial com a MESMA idempotencyKey devolve replay e não grava de novo", async () => {
    const keys = await seedTitulos(3)
    const r1 = await POST(post({ itens: itensDe(keys) }))
    const b1 = await json(r1)
    expect(r1.status).toBe(200)
    expect(b1.jaRegistrado).toBe(false)

    const r2 = await POST(post({ itens: itensDe(keys) }))
    const b2 = await json(r2)

    expect(r2.status).toBe(200)
    expect(b2.jaRegistrado).toBe(true)
    expect(b2.totalRecebido).toBe(300)
    expect(b2.sessaoId).toBe(SESSAO)
    expect((b2.itens as Row[])).toHaveLength(3)
    expect(h.db.caixaOps).toHaveLength(1)
    expect(h.db.movs).toHaveLength(3)
    for (const k of keys) expect(await saldoDe(k)).toBe(0)
  })

  it("[T9b] o replay NÃO vira erro só porque os títulos agora estão pagos", async () => {
    const keys = await seedTitulos(2)
    await POST(post({ itens: itensDe(keys) }))
    const r2 = await POST(post({ itens: itensDe(keys) }))
    const b2 = await json(r2)

    expect(r2.status).toBe(200)
    expect(b2.ok).toBe(true)
    expect(b2.jaRegistrado).toBe(true)
    // Resultado equivalente ao original, reconstruído do estado persistido.
    expect((b2.itens as Row[])[0]).toMatchObject({
      localKey: keys[0],
      saldoAntes: 100,
      valorRecebido: 100,
      saldoDepois: 0,
      statusFinal: "pago",
    })
  })

  it("[T9c] retry idêntico continua replay 200 depois que a sessão foi fechada", async () => {
    const keys = await seedTitulos(2)
    const primeiro = await POST(post({ itens: itensDe(keys) }))
    expect(primeiro.status).toBe(200)
    h.fecharSessao(SESSAO)

    const replay = await POST(post({ itens: itensDe(keys) }))
    const body = await json(replay)

    expect(replay.status).toBe(200)
    expect(body.jaRegistrado).toBe(true)
    expect(h.db.caixaOps).toHaveLength(1)
    expect(h.db.movs).toHaveLength(2)
  })

  it("[T9d] mesma key com conteúdo econômico diferente retorna 409 e zero novas escritas", async () => {
    const keys = await seedTitulos(1)
    const primeira = await POST(
      post({ itens: [{ localKey: keys[0]!, saldoEsperado: 100, valorReceber: 30 }] }),
    )
    expect(primeira.status).toBe(200)

    const conflito = await POST(
      post({ itens: [{ localKey: keys[0]!, saldoEsperado: 70, valorReceber: 40 }] }),
    )
    const body = await json(conflito)

    expect(conflito.status).toBe(409)
    expect(body.code).toBe("idempotency_conflict")
    expect(await saldoDe(keys[0]!)).toBe(70)
    expect(h.db.caixaOps).toHaveLength(1)
    expect(h.db.movs).toHaveLength(1)
  })

  it("fingerprint normaliza a ordem dos itens: mesma intenção reordenada continua replay", async () => {
    const keys = await seedTitulos(2)
    expect((await POST(post({ itens: itensDe(keys) }))).status).toBe(200)

    const replay = await POST(post({ itens: itensDe([...keys].reverse()) }))
    expect(replay.status).toBe(200)
    expect((await json(replay)).jaRegistrado).toBe(true)
    expect(h.db.caixaOps).toHaveLength(1)
    expect(h.db.movs).toHaveLength(2)
  })

  it("[T10] duas requisições SIMULTÂNEAS com a mesma chave: uma efetiva, uma replay", async () => {
    const keys = await seedTitulos(3)
    const [r1, r2] = await Promise.all([POST(post({ itens: itensDe(keys) })), POST(post({ itens: itensDe(keys) }))])
    const [b1, b2] = [await json(r1), await json(r2)]

    expect(r1.status).toBe(200)
    expect(r2.status).toBe(200)
    expect([b1.jaRegistrado, b2.jaRegistrado].sort()).toEqual([false, true])
    expect(h.db.caixaOps).toHaveLength(1)
    expect(h.db.movs).toHaveLength(3)
    for (const k of keys) expect(await saldoDe(k)).toBe(0)
    // Cada título recebeu exatamente UM lançamento no ledger.
    for (const k of keys) {
      const t = await getContaReceberByLocalKey(STORE, k)
      const hist = ((t!.payload as Row).historico as Row[]) ?? []
      expect(hist.filter((e) => e.tipo === "liquidacao" || e.tipo === "pagamento")).toHaveLength(1)
    }
  })

  it("o advisory lock é a PRIMEIRA instrução da transação, antes da sessão e do replay", async () => {
    const keys = await seedTitulos(1)
    await POST(post({ itens: itensDe(keys) }))

    expect(h.ordem[0]).toBe(`lock:pdv-rc-lote:${STORE}:${SESSAO}:${KEY}`)
    expect(h.ordem[1]).toBe("caixa_replay_findFirst")
    expect(h.ordem[2]).toBe("sessao_for_update")
  })

  it("chaves diferentes na mesma sessão são lotes diferentes — a idempotência não engole cobrança nova", async () => {
    const keys = await seedTitulos(2, 100)
    await POST(post({ idempotencyKey: "lote-aaaa-1111", itens: [{ localKey: keys[0]!, saldoEsperado: 100, valorReceber: 30 }] }))
    await POST(post({ idempotencyKey: "lote-bbbb-2222", itens: [{ localKey: keys[0]!, saldoEsperado: 70, valorReceber: 30 }] }))

    expect(h.db.caixaOps).toHaveLength(2)
    expect(h.db.movs).toHaveLength(2)
    expect(await saldoDe(keys[0]!)).toBe(40)
  })

  it("duas parciais legítimas de MESMO valor no mesmo título geram DOIS lançamentos financeiros", async () => {
    // Regressão do risco apontado no GOAL: a heurística de soma do helper de parcial
    // ("já gravei ≥ este valor ⇒ retry") suprimiria a segunda — dinheiro recebido
    // sumindo do financeiro. No lote, a idempotência do BATCH é a autoridade.
    const keys = await seedTitulos(1, 100)
    await POST(post({ idempotencyKey: "lote-parc-0001", itens: [{ localKey: keys[0]!, saldoEsperado: 100, valorReceber: 25 }] }))
    await POST(post({ idempotencyKey: "lote-parc-0002", itens: [{ localKey: keys[0]!, saldoEsperado: 75, valorReceber: 25 }] }))

    expect(h.db.movs).toHaveLength(2)
    expect(h.db.movs.map((m) => m.valor)).toEqual([25, 25])
    expect(await saldoDe(keys[0]!)).toBe(50)
    expect(h.db.caixaOps.map((o) => o.valor)).toEqual([25, 25])
  })
})

describe("G2 — sessão de caixa", () => {
  it("[T11] sessão fechada bloqueia o lote inteiro: 409 e zero escritas", async () => {
    const keys = await seedTitulos(3)
    h.fecharSessao(SESSAO)

    const res = await POST(post({ itens: itensDe(keys) }))
    const body = await json(res)

    expect(res.status).toBe(409)
    expect(body.code).toBe("caixa_fechado")
    for (const k of keys) expect(await saldoDe(k)).toBe(100)
    expect(h.db.movs).toHaveLength(0)
    expect(h.db.caixaOps).toHaveLength(0)
  })

  it("sessão de outra loja não serve: 409 caixa_fechado, zero escritas", async () => {
    const keys = await seedTitulos(2)
    const res = await POST(
      post({ sessaoId: SESSAO_OUTRA, itens: itensDe(keys) }), // sessão da loja-2 com header da loja-1
    )
    const body = await json(res)

    expect(res.status).toBe(409)
    expect(body.code).toBe("caixa_fechado")
    expect(h.db.caixaOps).toHaveLength(0)
  })

  it("a sessão é relida DENTRO da transação, com a linha travada (FOR UPDATE)", async () => {
    const keys = await seedTitulos(1)
    await POST(post({ itens: itensDe(keys) }))
    expect(h.ordem).toContain("sessao_for_update")
  })
})

describe("G2 — isolamento multi-loja", () => {
  it("[T12] mesmo localKey e mesma idempotencyKey em duas lojas: lotes independentes", async () => {
    const keysA = await seedTitulos(2, 100, STORE)
    const keysB = await seedTitulos(2, 100, OUTRA)
    expect(keysA).toEqual(keysB) // localKeys idênticos de propósito

    const rA = await POST(post({ itens: itensDe(keysA) }, STORE))
    const rB = await POST(post({ itens: itensDe(keysB) }, OUTRA))
    const bB = await json(rB)

    expect(rA.status).toBe(200)
    expect(rB.status).toBe(200)
    expect(bB.jaRegistrado).toBe(false) // a chave da loja A não vale para a loja B

    expect(h.db.caixaOps).toHaveLength(2)
    const localIds = h.db.caixaOps.map((o) => String((o.payload as Row).localId))
    expect(new Set(localIds).size).toBe(2)
    expect(h.db.caixaOps.map((o) => o.storeId).sort()).toEqual([STORE, OUTRA].sort())
    expect(h.db.movs).toHaveLength(4)
    expect(h.db.movs.filter((m) => m.storeId === STORE)).toHaveLength(2)
  })

  it("[T12b] lotes concorrentes de lojas diferentes não compartilham lock nem se veem", async () => {
    const keysA = await seedTitulos(2, 100, STORE)
    const keysB = await seedTitulos(2, 100, OUTRA)

    const [rA, rB] = await Promise.all([
      POST(post({ itens: itensDe(keysA) }, STORE)),
      POST(post({ itens: itensDe(keysB) }, OUTRA)),
    ])
    expect(rA.status).toBe(200)
    expect(rB.status).toBe(200)
    expect((await json(rA)).jaRegistrado).toBe(false)
    expect((await json(rB)).jaRegistrado).toBe(false)

    const chaves = h.ordem.filter((o) => o.startsWith("lock:"))
    expect(new Set(chaves).size).toBe(2)
  })

  it("[T12c] título da loja A não é alcançável com o header da loja B", async () => {
    const keys = await seedTitulos(2, 100, STORE)
    await seedTitulos(0, 100, OUTRA)

    const res = await POST(post({ itens: itensDe(keys) }, OUTRA))
    const body = await json(res)

    expect(res.status).toBe(409)
    expect(body.code).toBe("titulo_alterado")
    for (const k of keys) expect(await saldoDe(k, STORE)).toBe(100)
    expect(h.db.caixaOps).toHaveLength(0)
  })
})

describe("G2 — contrato da API", () => {
  it("lote sem itens é recusado com 400", async () => {
    const res = await POST(post({ itens: [] }))
    expect(res.status).toBe(400)
  })

  it(`lote acima do teto de ${RECEBIMENTO_LOTE_MAX_ITENS} itens é recusado com 400`, async () => {
    const itens = Array.from({ length: RECEBIMENTO_LOTE_MAX_ITENS + 1 }, (_, i) => ({
      localKey: `x-${i}`,
      saldoEsperado: 10,
      valorReceber: 10,
    }))
    const res = await POST(post({ itens }))
    expect(res.status).toBe(400)
    expect(h.db.caixaOps).toHaveLength(0)
  })

  it("item duplicado no mesmo lote é recusado com 400", async () => {
    const keys = await seedTitulos(1)
    const res = await POST(post({ itens: [...itensDe(keys), ...itensDe(keys)] }))
    const body = await json(res)

    expect(res.status).toBe(400)
    expect(body.code).toBe("item_duplicado")
    expect(h.db.caixaOps).toHaveLength(0)
  })

  it("valor zero, negativo ou abaixo do epsilon é recusado com 400", async () => {
    const keys = await seedTitulos(1)
    for (const valorReceber of [0, -10, 0.004]) {
      const res = await POST(post({ itens: [{ localKey: keys[0]!, saldoEsperado: 100, valorReceber }] }))
      expect(res.status).toBe(400)
    }
    expect(h.db.caixaOps).toHaveLength(0)
  })

  it("saldoEsperado menor que valorReceber é recusado com 400, sem tocar no banco", async () => {
    const keys = await seedTitulos(1)
    const res = await POST(post({ itens: [{ localKey: keys[0]!, saldoEsperado: 40, valorReceber: 100 }] }))
    const body = await json(res)

    expect(res.status).toBe(400)
    expect(body.code).toBe("saldo_esperado_insuficiente")
    expect(await saldoDe(keys[0]!)).toBe(100)
  })

  it("idempotencyKey ausente ou curta demais é recusada com 400", async () => {
    const keys = await seedTitulos(1)
    const semChave = new Request("http://local/api/pdv/receber-conta-lote", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-assistec-loja-id": STORE },
      body: JSON.stringify({ sessaoId: SESSAO, formaPagamento: "dinheiro", itens: itensDe(keys) }),
    })
    expect((await POST(semChave)).status).toBe(400)

    const curta = await POST(post({ idempotencyKey: "abc", itens: itensDe(keys) }))
    const body = await json(curta)
    expect(curta.status).toBe(400)
    expect(body.code).toBe("idempotency_key_invalida")
    expect(h.db.caixaOps).toHaveLength(0)
  })

  it("nome de cliente não é chave financeira: item sem localKey é recusado", async () => {
    await seedTitulos(1)
    const res = await POST(post({ itens: [{ cliente: "Ana Souza", saldoEsperado: 100, valorReceber: 100 }] }))
    expect(res.status).toBe(400)
    expect(h.db.caixaOps).toHaveLength(0)
  })

  it("unidade ausente ou inconsistente entre header e body é recusada", async () => {
    const keys = await seedTitulos(1)
    const semLoja = new Request("http://local/api/pdv/receber-conta-lote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessaoId: SESSAO, formaPagamento: "dinheiro", idempotencyKey: KEY, itens: itensDe(keys) }),
    })
    expect((await POST(semLoja)).status).toBe(400)

    const inconsistente = await POST(post({ lojaId: OUTRA, itens: itensDe(keys) }, STORE))
    expect(inconsistente.status).toBe(400)
    expect(h.db.caixaOps).toHaveLength(0)
  })

  it("a resposta não vaza payload bruto do título nem segredo", async () => {
    const keys = await seedTitulos(1)
    const body = await json(await POST(post({ itens: itensDe(keys) })))

    expect(Object.keys(body).sort()).toEqual(["itens", "jaRegistrado", "ok", "sessaoId", "totalRecebido"])
    expect(Object.keys((body.itens as Row[])[0]!).sort()).toEqual([
      "localKey",
      "saldoAntes",
      "saldoDepois",
      "statusFinal",
      "tituloId",
      "valorRecebido",
    ])
  })
})

describe("G2 — carteira e transação", () => {
  it("a carteira do título é recalculada UMA vez por lote, dentro da mesma transação", async () => {
    h.db.carteiras.push({
      id: "cart-1",
      storeId: STORE,
      nome: "Caixa PDV",
      tipo: "caixa",
      ativo: true,
      cor: null,
      icone: null,
      saldoInicial: 0,
      saldoAtual: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    const keys: string[] = []
    for (let i = 1; i <= 3; i++) {
      const localKey = `cw-${i}`
      await upsertContaReceber({
        storeId: STORE,
        localKey,
        descricao: `Crediário ${i}`,
        cliente: "Ana",
        valor: 100,
        vencimento: "2026-08-10",
        status: "pendente",
        payloadPatch: { id: localKey, carteiraId: "cart-1" },
        replacePayload: true,
      })
      keys.push(localKey)
    }

    const res = await POST(post({ itens: itensDe(keys) }))
    expect(res.status).toBe(200)
    expect(h.db.carteiras[0]!.saldoAtual).toBe(300)
    expect(h.ordem.filter((o) => o === "carteira_recalculo")).toHaveLength(1)
  })

  it("[W1] dois lotes de sessões diferentes na mesma carteira preservam a soma integral do ledger", async () => {
    const sessaoB = "sess-carteira-b"
    h.seedSessao(sessaoB, STORE)
    h.db.carteiras.push({
      id: "cart-compartilhada",
      storeId: STORE,
      nome: "Carteira compartilhada",
      tipo: "caixa",
      ativo: true,
      cor: null,
      icone: null,
      saldoInicial: 0,
      saldoAtual: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    for (const localKey of ["wallet-a", "wallet-b"]) {
      await upsertContaReceber({
        storeId: STORE,
        localKey,
        descricao: localKey,
        cliente: "Cliente",
        valor: 100,
        vencimento: "2026-08-10",
        status: "pendente",
        payloadPatch: { id: localKey, carteiraId: "cart-compartilhada" },
        replacePayload: true,
      })
    }

    const [loteA, loteB] = await Promise.all([
      POST(post({
        sessaoId: SESSAO,
        idempotencyKey: "wallet-lote-a",
        itens: itensDe(["wallet-a"]),
      })),
      POST(post({
        sessaoId: sessaoB,
        idempotencyKey: "wallet-lote-b",
        itens: itensDe(["wallet-b"]),
      })),
    ])

    expect(loteA.status).toBe(200)
    expect(loteB.status).toBe(200)
    const ledger = h.db.movs.filter((m) => m.carteiraId === "cart-compartilhada")
    expect(ledger).toHaveLength(2)
    expect(ledger.reduce((s, m) => s + Number(m.valor), 0)).toBe(200)
    expect(h.db.carteiras[0]!.saldoAtual).toBe(200)
    expect(
      h.ordem.filter((o) => o === `lock:financeiro:carteira-saldo:${STORE}:cart-compartilhada`),
    ).toHaveLength(2)
  })

  it("[W2] lote com várias carteiras adquire os locks em ordem determinística antes das agregações", async () => {
    for (const id of ["cart-z", "cart-a"]) {
      h.db.carteiras.push({
        id,
        storeId: STORE,
        nome: id,
        tipo: "caixa",
        ativo: true,
        cor: null,
        icone: null,
        saldoInicial: 0,
        saldoAtual: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    }
    for (const [localKey, carteiraId] of [["ordem-z", "cart-z"], ["ordem-a", "cart-a"]] as const) {
      await upsertContaReceber({
        storeId: STORE,
        localKey,
        descricao: localKey,
        cliente: "Cliente",
        valor: 100,
        vencimento: "2026-08-10",
        status: "pendente",
        payloadPatch: { id: localKey, carteiraId },
        replacePayload: true,
      })
    }

    const res = await POST(post({ itens: itensDe(["ordem-z", "ordem-a"]) }))
    expect(res.status).toBe(200)

    const locks = h.ordem.filter((o) => o.startsWith("lock:financeiro:carteira-saldo:"))
    expect(locks).toEqual([
      `lock:financeiro:carteira-saldo:${STORE}:cart-a`,
      `lock:financeiro:carteira-saldo:${STORE}:cart-z`,
    ])
    for (const carteiraId of ["cart-a", "cart-z"]) {
      const lockIndex = h.ordem.indexOf(`lock:financeiro:carteira-saldo:${STORE}:${carteiraId}`)
      const aggregateIndex = h.ordem.indexOf(`carteira_aggregate:${carteiraId}:entrada`)
      expect(lockIndex).toBeGreaterThanOrEqual(0)
      expect(aggregateIndex).toBeGreaterThan(lockIndex)
    }
  })

  it("a heurística de idempotência do helper de movimentação NÃO roda no lote", async () => {
    const keys = await seedTitulos(2)
    await POST(post({ itens: itensDe(keys) }))
    expect(h.ordem).not.toContain("mov_idempotencia_findFirst")
    expect(h.ordem).not.toContain("mov_idempotencia_aggregate")
  })

  it("o harness DETECTA um service que ignore a porta `db` dentro da transação", async () => {
    await seedTitulos(1)
    await expect(
      h.prisma.$transaction(async () => {
        await getContaReceberByLocalKey(STORE, "cr-1")
      }),
    ).rejects.toThrow(/porta `db` não foi injetada/)
  })

  it("[T16] o lote não cria superfície de persistência nova — nenhum model além dos já existentes", async () => {
    // A prova formal de "sem schema change" é `git diff -- prisma/schema.prisma` vazio
    // (gate de entrega). Este teste guarda o outro lado: o lote não passa a gravar em
    // nenhuma tabela nova nem inventa campo — o conjunto de models tocados é fechado.
    const fonte = [
      readFileSync(resolve(process.cwd(), "lib/financeiro/services/recebimento-lote-service.ts"), "utf8"),
      readFileSync(resolve(process.cwd(), "app/api/pdv/receber-conta-lote/route.ts"), "utf8"),
    ].join("\n")

    const models = new Set(Array.from(fonte.matchAll(/\btx\.([a-zA-Z][a-zA-Z0-9]*)\./g), (m) => m[1]!))
    expect([...models].sort()).toEqual(["caixaOperacao", "carteiraFinanceira", "contaReceberTitulo"])
    // As movimentações passam pelo service compartilhado; nenhum `createMany`/`upsert` cru.
    expect(fonte).not.toMatch(/\$executeRaw(Unsafe)?|\$queryRawUnsafe/)
  })
})
