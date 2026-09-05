import { describe, it, expect, beforeEach, vi } from "vitest"

// ============================================================================
// GOAL PDV-RECEBIMENTO-CANONICALIDADE-HARDENING-002 (G1) — §4/§5/§6/§7/§8.
// ----------------------------------------------------------------------------
// A baixa singular do PDV gravava título, MovimentacaoFinanceira e CaixaOperacao em
// três escritas independentes — a movimentação ainda por cima com `.catch(console.error)`.
// Título quitado sem lançamento financeiro era possível. E o `localId` da CaixaOperacao
// carregava `Date.now()`: todo retry criava uma segunda entrada de caixa.
//
// O banco fake abaixo NÃO é um mock passivo: implementa `$transaction` com
// snapshot/restore real, e o cliente GLOBAL recusa qualquer acesso enquanto uma
// transação está aberta. Assim o teste prova duas coisas de fato:
//   (a) rollback — falha em qualquer etapa desfaz TODAS as anteriores;
//   (b) porta `db` injetada — se um service usasse o singleton global dentro da
//       transação, a chamada estouraria em vez de passar despercebida.
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
  let txDepth = 0
  let relogio = Date.parse("2026-09-04T12:00:00.000Z")
  let concorrenteAntesDoCas: { localKey: string; valor: number; origem: "batch" | "singular" } | null = null
  let ordem: string[] = []
  /** Falhas injetadas: "mov" | "caixa" — disparam UMA vez. */
  const falhas = new Set<string>()

  const tick = () => new Date(++relogio)

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

  /** Prisma devolve snapshots, não referências vivas para a linha armazenada. */
  function snapshot<T extends Row | null | undefined>(row: T): T {
    return (row ? { ...row } : row) as T
  }

  /** Delegates que operam sobre o store. `guard` recusa uso do cliente global em transação. */
  function makeClient(guard: () => void) {
    return {
      $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        guard()
        if (strings.join("?").includes("pg_advisory_xact_lock")) {
          ordem.push(`lock:${String(values[0])}`)
          return [{ lock: "" }]
        }
        throw new Error("query raw não suportada no harness singular")
      },
      contaReceberTitulo: {
        findUnique: async ({ where }: { where: { storeId_localKey: { storeId: string; localKey: string } } }) => {
          guard()
          const { storeId, localKey } = where.storeId_localKey
          return snapshot(db.titulos.find((r) => r.storeId === storeId && r.localKey === localKey) ?? null)
        },
        findFirst: async ({ where }: { where: Record<string, unknown> }) => {
          guard()
          return snapshot(db.titulos.find((r) => matchTitulo(r, where ?? {})) ?? null)
        },
        findMany: async ({ where }: { where?: { storeId?: string } }) => {
          guard()
          return db.titulos.filter((r) => !where?.storeId || r.storeId === where.storeId).map(snapshot)
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
            createdAt: tick(),
            updatedAt: tick(),
          }
          db.titulos.push(row)
          return row
        },
        update: async ({ where, data }: { where: { id?: string }; data: Row }) => {
          guard()
          const row = db.titulos.find((r) => r.id === where.id)
          if (!row) throw new Error("Record to update not found.")
          return applyScalars(row, data)
        },
        updateMany: async ({
          where,
          data,
        }: {
          where: { id?: string; storeId?: string; updatedAt?: unknown }
          data: Row
        }) => {
          guard()
          const row = db.titulos.find((r) => r.id === where.id)
          if (!row || (where.storeId && row.storeId !== where.storeId)) return { count: 0 }

          // Interleaving B: o singular já leu T0; um batch commita antes do CAS.
          // A mutação externa troca payload + token e deixa seus artefatos financeiros.
          const concorrente = concorrenteAntesDoCas
          if (concorrente && concorrente.localKey === row.localKey) {
            concorrenteAntesDoCas = null
            const payload = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
              ? (row.payload as Row)
              : {}
            const historico = Array.isArray(payload.historico) ? [...(payload.historico as Row[])] : []
            const at = tick()
            historico.push({ tipo: "pagamento", valor: concorrente.valor, at: at.toISOString(), origem: concorrente.origem })
            row.payload = { ...payload, historico }
            row.status = money(concorrente.valor) >= money(row.valor) ? "pago" : "parcial"
            row.updatedAt = at
            db.movs.push({
              id: next("mov-externo"),
              storeId: row.storeId,
              tipo: "entrada",
              origem: concorrente.valor >= money(row.valor) ? "receber" : "receber_parcial",
              referenciaId: row.id,
              valor: concorrente.valor,
              createdAt: at,
            })
            db.caixaOps.push({
              id: next("cxop-externo"),
              sessaoId: "sessao-batch-concorrente",
              storeId: row.storeId,
              tipo: "recebimento_cr",
              valor: concorrente.valor,
              payload: { origem: concorrente.origem, localId: `${concorrente.origem}-externo` },
              createdAt: at,
            })
          }

          const atual = row.updatedAt as Date | undefined
          const token = where.updatedAt as Date | undefined
          if (!atual || !token || atual.getTime() !== token.getTime()) return { count: 0 }
          applyScalars(row, data)
          return { count: 1 }
        },
      },
      movimentacaoFinanceira: {
        findFirst: async ({ where }: { where: Record<string, unknown> }) => {
          guard()
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
          if (where.carteiraId) ordem.push(`carteira_aggregate:${String(where.carteiraId)}:${String(where.tipo)}`)
          const startsWith = (where.origem as { startsWith?: string } | undefined)?.startsWith
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
          if (falhas.delete("mov")) throw new Error("falha injetada: MovimentacaoFinanceira")
          const row = { id: next("mov"), createdAt: new Date(), ...data }
          db.movs.push(row)
          return row
        },
      },
      caixaOperacao: {
        findFirst: async ({ where }: { where: Record<string, unknown> }) => {
          guard()
          const pl = where.payload as { path?: string[]; equals?: unknown } | undefined
          const r = db.caixaOps.find((o) => {
            if (where.storeId && o.storeId !== where.storeId) return false
            if (where.tipo && o.tipo !== where.tipo) return false
            if (pl?.path?.length) {
              const key = pl.path[0]!
              if ((o.payload as Row | undefined)?.[key] !== pl.equals) return false
            }
            return true
          })
          return r ? { id: r.id as string, sessaoId: r.sessaoId as string, valor: r.valor as number } : null
        },
        create: async ({ data }: { data: Row }) => {
          guard()
          if (falhas.delete("caixa")) throw new Error("falha injetada: CaixaOperacao")
          const row = { id: next("cxop"), createdAt: new Date(), ...data }
          db.caixaOps.push(row)
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

  const txClient = makeClient(() => {})
  const globalClient = makeClient(() => {
    if (txDepth > 0) {
      throw new Error("cliente GLOBAL usado dentro de $transaction — porta `db` não foi injetada")
    }
  })

  const prisma = {
    ...globalClient,
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const snap = structuredClone(db)
      txDepth += 1
      try {
        const out = await fn(txClient)
        return out
      } catch (e) {
        db = snap // rollback real do estado
        throw e
      } finally {
        txDepth -= 1
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
    injetarFalha: (k: "mov" | "caixa") => falhas.add(k),
    receberExternamenteAntesDoCas: (localKey: string, valor: number, origem: "batch" | "singular" = "batch") => {
      concorrenteAntesDoCas = { localKey, valor, origem }
    },
    seedSessao: (id: string, storeId: string) => db.sessoes.push({ id, storeId, status: "ABERTA" }),
    reset: () => {
      db = empty()
      seq = 0
      txDepth = 0
      relogio = Date.parse("2026-09-04T12:00:00.000Z")
      concorrenteAntesDoCas = null
      ordem = []
      falhas.clear()
    },
  }
})

const STORE = "loja-1"
const OUTRA = "loja-2"
const SESSAO = "sess-1"
const SESSAO_OUTRA = "sess-2"
const LK = "cr-crediario-77"

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

async function seedTitulo(storeId = STORE, valor = 100, localKey = LK) {
  await upsertContaReceber({
    storeId,
    localKey,
    descricao: "Crediário — Ana",
    cliente: "Ana Souza",
    valor,
    vencimento: "2026-08-10",
    status: "pendente",
    payloadPatch: { id: localKey, origem: "manual" },
    replacePayload: true,
  })
}

function post(body: Record<string, unknown>, storeId = STORE) {
  return new Request("http://local/api/pdv/receber-conta", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-assistec-loja-id": storeId },
    body: JSON.stringify({ sessaoId: storeId === STORE ? SESSAO : SESSAO_OUTRA, ...body }),
  })
}

async function json(res: Response) {
  return (await res.json()) as Record<string, unknown>
}

const saldoDe = async (storeId: string, localKey = LK) => {
  const t = await getContaReceberByLocalKey(storeId, localKey)
  return t ? buildContaReceberAuditTrail([t])[0]!.saldoAberto : null
}

beforeEach(() => {
  h.reset()
  h.seedSessao(SESSAO, STORE)
  h.seedSessao(SESSAO_OUTRA, OUTRA)
})

describe("G1 §5 — atomicidade da baixa singular", () => {
  it("[CRIT-6] falha da MovimentacaoFinanceira faz rollback: título NÃO fica quitado e o caixa não recebe nada", async () => {
    await seedTitulo()
    h.injetarFalha("mov")

    const res = await POST(post({ op: "liquidar", localKey: LK }))
    expect(res.status).toBe(503)

    const t = await getContaReceberByLocalKey(STORE, LK)
    expect(t!.status).toBe("pendente")
    expect(await saldoDe(STORE)).toBe(100)
    expect(h.db.movs).toHaveLength(0)
    expect(h.db.caixaOps).toHaveLength(0)
  })

  it("[CRIT-7] falha da CaixaOperacao faz rollback: título e movimentação não permanecem gravados", async () => {
    await seedTitulo()
    h.injetarFalha("caixa")

    const res = await POST(post({ op: "liquidar", localKey: LK }))
    expect(res.status).toBe(503)

    const t = await getContaReceberByLocalKey(STORE, LK)
    expect(t!.status).toBe("pendente")
    expect(await saldoDe(STORE)).toBe(100)
    expect(h.db.movs).toHaveLength(0)
    expect(h.db.caixaOps).toHaveLength(0)
  })

  it("rollback também vale para baixa parcial", async () => {
    await seedTitulo()
    h.injetarFalha("caixa")

    const res = await POST(post({ op: "parcial", localKey: LK, valor: 40 }))
    expect(res.status).toBe(503)

    expect(await saldoDe(STORE)).toBe(100)
    expect(h.db.movs).toHaveLength(0)
    expect(h.db.caixaOps).toHaveLength(0)
  })

  it("[CRIT-6] a movimentação não é mais best-effort: o erro chega ao chamador", async () => {
    await seedTitulo()
    h.injetarFalha("mov")
    const res = await POST(post({ op: "liquidar", localKey: LK }))
    const body = await json(res)
    expect(body.ok).toBe(false)
    expect(String(body.error)).toContain("MovimentacaoFinanceira")
  })
})

describe("G2 P1 — concorrência entre lote e baixa singular", () => {
  it("[B] singular lê T0, batch commita e singular recusa 409 sem sobrescrever o batch", async () => {
    await seedTitulo()
    h.receberExternamenteAntesDoCas(LK, 40, "batch")

    const res = await POST(post({ op: "liquidar", localKey: LK, idempotencyKey: "singular-perdedor" }))
    const body = await json(res)

    expect(res.status).toBe(409)
    expect(body.code).toBe("titulo_alterado")
    expect(await saldoDe(STORE)).toBe(60)
    expect(h.db.movs).toHaveLength(1)
    expect(h.db.movs[0]!.valor).toBe(40)
    expect(h.db.caixaOps).toHaveLength(1)
    expect(h.db.caixaOps[0]!.valor).toBe(40)

    const titulo = await getContaReceberByLocalKey(STORE, LK)
    const historico = ((titulo!.payload as Row).historico as Row[]) ?? []
    expect(historico).toHaveLength(1)
    expect(historico[0]).toMatchObject({ tipo: "pagamento", valor: 40, origem: "batch" })
  })
})

describe("G1 §6 — porta `db` injetável (controle negativo do harness)", () => {
  it("o harness DETECTA um service que ignore a porta `db` dentro da transação", async () => {
    await seedTitulo()
    // Controle negativo: sem `db`, o service cai no singleton global — que o banco fake
    // recusa enquanto há transação aberta. Se este teste passasse a NÃO estourar, os
    // testes de rollback acima estariam provando nada.
    await expect(
      h.prisma.$transaction(async () => {
        await getContaReceberByLocalKey(STORE, LK)
      }),
    ).rejects.toThrow(/porta `db` não foi injetada/)
  })

  it("com a porta `db` injetada, a mesma leitura roda dentro da transação", async () => {
    await seedTitulo()
    const t = await h.prisma.$transaction(async (tx: unknown) =>
      getContaReceberByLocalKey(STORE, LK, tx as Parameters<typeof getContaReceberByLocalKey>[2]),
    )
    expect(t).not.toBeNull()
  })
})

describe("G1 §7 — idempotência do recebimento singular", () => {
  it("[CRIT-8] retry da MESMA baixa (mesma idempotencyKey) não duplica a entrada de caixa", async () => {
    await seedTitulo()
    const key = "op-abc-123"

    const r1 = await POST(post({ op: "parcial", localKey: LK, valor: 40, idempotencyKey: key }))
    expect(r1.status).toBe(200)
    const r2 = await POST(post({ op: "parcial", localKey: LK, valor: 40, idempotencyKey: key }))
    const b2 = await json(r2)

    expect(r2.status).toBe(200)
    expect(b2.jaRegistrado).toBe(true)
    expect(h.db.caixaOps).toHaveLength(1)
    expect(h.db.movs).toHaveLength(1)
    // o pagamento NÃO foi aplicado duas vezes
    expect(await saldoDe(STORE)).toBe(60)
  })

  it("[CRIT-8] retry sem idempotencyKey (mesmo título, op e valor) também não duplica o caixa", async () => {
    await seedTitulo()
    await POST(post({ op: "parcial", localKey: LK, valor: 40 }))
    await POST(post({ op: "parcial", localKey: LK, valor: 40 }))

    expect(h.db.caixaOps).toHaveLength(1)
    expect(await saldoDe(STORE)).toBe(60)
  })

  it("o `localId` gravado é determinístico — sem `Date.now()`", async () => {
    await seedTitulo()
    await POST(post({ op: "liquidar", localKey: LK, idempotencyKey: "op-xyz" }))

    const op = h.db.caixaOps[0]!
    const localId = String((op.payload as Row).localId)
    expect(localId).toBe(`pdv-rc:${STORE}:${SESSAO}:op-xyz`)
    expect(localId).not.toMatch(/\d{13}/)
  })

  it("pagamentos legítimos distintos geram entradas distintas (a idempotência não engole cobrança nova)", async () => {
    await seedTitulo()
    await POST(post({ op: "parcial", localKey: LK, valor: 40, idempotencyKey: "op-1" }))
    await POST(post({ op: "parcial", localKey: LK, valor: 40, idempotencyKey: "op-2" }))

    expect(h.db.caixaOps).toHaveLength(2)
    expect(await saldoDe(STORE)).toBe(20)
  })
})

describe("G1 §4 — título já pago não vira entrada de caixa", () => {
  it("[CRIT-5] re-liquidar título quitado devolve `ja_pago` e gera ZERO movimentos", async () => {
    await seedTitulo()
    const r1 = await POST(post({ op: "liquidar", localKey: LK }))
    expect(r1.status).toBe(200)
    expect(h.db.caixaOps).toHaveLength(1)
    expect(h.db.movs).toHaveLength(1)

    const r2 = await POST(post({ op: "liquidar", localKey: LK }))
    const b2 = await json(r2)
    expect(r2.status).toBe(422)
    expect(b2.code).toBe("ja_pago")

    // nenhuma escrita nova
    expect(h.db.caixaOps).toHaveLength(1)
    expect(h.db.movs).toHaveLength(1)
  })

  it("[CRIT-5] o valor lançado é o saldo REAL, nunca o valor bruto da coluna", async () => {
    await seedTitulo()
    await POST(post({ op: "parcial", localKey: LK, valor: 40, idempotencyKey: "p1" }))
    await POST(post({ op: "liquidar", localKey: LK, idempotencyKey: "q1" }))

    const valoresCaixa = h.db.caixaOps.map((o) => o.valor)
    expect(valoresCaixa).toEqual([40, 60])
    expect(h.db.movs.map((m) => m.valor)).toEqual([40, 60])
    expect(await saldoDe(STORE)).toBe(0)
  })
})

describe("G1 — o caminho normal continua funcionando", () => {
  it("[CRIT-11] liquidação normal grava título, movimentação e caixa", async () => {
    await seedTitulo()
    const res = await POST(post({ op: "liquidar", localKey: LK }))
    const body = await json(res)

    expect(res.status).toBe(200)
    expect(body.valorRecebido).toBe(100)
    expect(body.jaRegistrado).toBe(false)
    expect((body.titulo as Row).status).toBe("pago")
    expect(h.db.movs).toHaveLength(1)
    expect(h.db.caixaOps).toHaveLength(1)
    expect(h.db.caixaOps[0]!.sessaoId).toBe(SESSAO)
  })

  it("[CRIT-10] baixa parcial normal abate o valor e mantém o título aberto", async () => {
    await seedTitulo()
    const res = await POST(post({ op: "parcial", localKey: LK, valor: 30 }))
    const body = await json(res)

    expect(res.status).toBe(200)
    expect(body.valorRecebido).toBe(30)
    expect((body.titulo as Row).status).toBe("parcial")
    expect(await saldoDe(STORE)).toBe(70)
    expect(h.db.caixaOps[0]!.valor).toBe(30)
  })

  it("[W3] recebimento singular usa o mesmo lock da carteira antes da agregação", async () => {
    h.db.carteiras.push({
      id: "cart-1",
      storeId: STORE,
      nome: "Caixa PDV",
      tipo: "caixa",
      ativo: true,
      cor: null,
      icone: null,
      saldoInicial: 500,
      saldoAtual: 500,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await upsertContaReceber({
      storeId: STORE,
      localKey: LK,
      descricao: "Crediário — Ana",
      cliente: "Ana Souza",
      valor: 100,
      vencimento: "2026-08-10",
      status: "pendente",
      payloadPatch: { id: LK, carteiraId: "cart-1" },
      replacePayload: true,
    })

    const res = await POST(post({ op: "liquidar", localKey: LK }))
    expect(res.status).toBe(200)
    expect(h.db.carteiras[0]!.saldoAtual).toBe(600)
    const lock = `lock:financeiro:carteira-saldo:${STORE}:cart-1`
    expect(h.ordem).toContain(lock)
    expect(h.ordem.indexOf("carteira_aggregate:cart-1:entrada")).toBeGreaterThan(h.ordem.indexOf(lock))
  })

  it("caixa fechado bloqueia antes de qualquer escrita", async () => {
    await seedTitulo()
    const res = await POST(post({ op: "liquidar", localKey: LK, sessaoId: "sessao-inexistente" }))
    const body = await json(res)
    expect(res.status).toBe(409)
    expect(body.code).toBe("caixa_fechado")
    expect(h.db.caixaOps).toHaveLength(0)
  })
})

describe("G1 §8 — isolamento multi-loja no recebimento", () => {
  it("[CRIT-9] mesmo localKey em duas lojas: receber na A não quita nem deduplica a B", async () => {
    await seedTitulo(STORE)
    await seedTitulo(OUTRA)

    const rA = await POST(post({ op: "liquidar", localKey: LK, idempotencyKey: "mesma-chave" }, STORE), )
    expect(rA.status).toBe(200)

    // MESMA chave de idempotência, outra loja: não pode ser tratada como repetição.
    const rB = await POST(post({ op: "liquidar", localKey: LK, idempotencyKey: "mesma-chave" }, OUTRA))
    const bB = await json(rB)
    expect(rB.status).toBe(200)
    expect(bB.jaRegistrado).toBe(false)

    expect(await saldoDe(STORE)).toBe(0)
    expect(await saldoDe(OUTRA)).toBe(0)
    expect(h.db.caixaOps).toHaveLength(2)
    expect(h.db.caixaOps.map((o) => o.storeId).sort()).toEqual([STORE, OUTRA].sort())
    // o `localId` carrega a loja — chaves iguais em lojas distintas não colidem
    const ids = h.db.caixaOps.map((o) => String((o.payload as Row).localId))
    expect(new Set(ids).size).toBe(2)
  })

  it("[CRIT-9] receber com a loja errada no header não encontra o título da outra loja", async () => {
    await seedTitulo(STORE)
    const res = await POST(post({ op: "liquidar", localKey: LK }, OUTRA))
    const body = await json(res)

    expect(res.status).toBe(404)
    expect(body.code).toBe("not_found")
    expect(await saldoDe(STORE)).toBe(100)
    expect(h.db.caixaOps).toHaveLength(0)
  })
})
