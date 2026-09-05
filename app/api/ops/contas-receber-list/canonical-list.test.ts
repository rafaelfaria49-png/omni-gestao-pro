import { describe, it, expect, beforeEach, vi } from "vitest"

// ============================================================================
// GOAL PDV-RECEBIMENTO-CANONICALIDADE-HARDENING-002 (G1) — §2 listagem canônica.
// ----------------------------------------------------------------------------
// `GET /api/ops/contas-receber-list` devolvia `rows` = o SNAPSHOT cru do `payload`
// (linha do localStorage do painel legado). Quando o servidor quitava o título, o
// snapshot continuava dizendo "pendente / valor bruto" e a tela do PDV desenhava a
// dívida como aberta. Aqui o handler de PRODUÇÃO roda sobre um Prisma EM MEMÓRIA e
// prova que status e saldo apresentados são a verdade do servidor.
// ============================================================================

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>
  const titulos = new Map<string, Row>()
  const byId = new Map<string, Row>()
  let seq = 0
  let relogio = Date.parse("2026-09-04T12:00:00.000Z")

  const tick = () => new Date(++relogio)

  const ck = (storeId: string, localKey: string) => `${storeId}::${localKey}`

  function put(row: Row): Row {
    titulos.set(ck(String(row.storeId), String(row.localKey)), row)
    byId.set(String(row.id), row)
    return row
  }
  function makeRow(data: Row): Row {
    return {
      id: `cr-${++seq}`,
      storeId: data.storeId,
      localKey: data.localKey,
      descricao: data.descricao ?? "",
      cliente: data.cliente ?? "",
      valor: data.valor ?? 0,
      vencimento: data.vencimento ?? "",
      status: data.status ?? "pendente",
      payload: data.payload ?? {},
      createdAt: tick(),
      updatedAt: tick(),
    }
  }
  function applyScalars(row: Row, data: Row): Row {
    for (const k of ["descricao", "cliente", "valor", "vencimento", "status", "payload"]) {
      if (data[k] !== undefined) row[k] = data[k]
    }
    row.updatedAt = tick()
    return row
  }
  function snapshot<T extends Row | null | undefined>(row: T): T {
    return (row ? { ...row } : row) as T
  }

  const prisma = {
    contaReceberTitulo: {
      findUnique: async ({ where }: { where: { storeId_localKey: { storeId: string; localKey: string } } }) => {
        const { storeId, localKey } = where.storeId_localKey
        return snapshot(titulos.get(ck(storeId, localKey)) ?? null)
      },
      findFirst: async ({ where }: { where: { id?: string; storeId?: string } }) => {
        if (where?.id) {
          const r = byId.get(where.id)
          if (r && (!where.storeId || r.storeId === where.storeId)) return snapshot(r)
          return null
        }
        return null
      },
      findMany: async ({ where }: { where?: { storeId?: string } }) =>
        [...titulos.values()].filter((r) => !where?.storeId || r.storeId === where.storeId).map(snapshot),
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { storeId_localKey: { storeId: string; localKey: string } }
        create: Row
        update: Row
      }) => {
        const { storeId, localKey } = where.storeId_localKey
        const existing = titulos.get(ck(storeId, localKey))
        if (existing) return snapshot(applyScalars(existing, update))
        return snapshot(put(makeRow(create)))
      },
      update: async ({ where, data }: { where: { id?: string }; data: Row }) => {
        const row = where.id ? byId.get(where.id) : undefined
        if (!row) throw new Error("Record to update not found.")
        return snapshot(applyScalars(row, data))
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id?: string; storeId?: string; updatedAt?: unknown }
        data: Row
      }) => {
        const row = where.id ? byId.get(where.id) : undefined
        if (!row || (where.storeId && row.storeId !== where.storeId)) return { count: 0 }
        const atual = row.updatedAt as Date | undefined
        const token = where.updatedAt as Date | undefined
        if (!atual || !token || atual.getTime() !== token.getTime()) return { count: 0 }
        applyScalars(row, data)
        return { count: 1 }
      },
      create: async ({ data }: { data: Row }) => snapshot(put(makeRow(data))),
    },
  }

  return {
    prisma,
    reset: () => {
      titulos.clear()
      byId.clear()
      seq = 0
      relogio = Date.parse("2026-09-04T12:00:00.000Z")
    },
  }
})

const STORE = "loja-1"

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma, prismaEnsureConnected: vi.fn(async () => undefined) }))
vi.mock("@/lib/ops-api-gate", () => ({
  opsLojaIdFromRequest: vi.fn(() => STORE),
  opsLojaIdFromRequestForWrite: vi.fn(() => STORE),
}))
vi.mock("@/lib/auth/api-enterprise-guard", () => ({
  apiGuardFinanceiroViewOrOps: vi.fn(async () => null),
}))

import { GET } from "./route"
import {
  upsertContaReceber,
  registrarPagamentoParcial,
  liquidarContaReceber,
} from "@/lib/financeiro/services/contas-receber-service"
import type { ContaReceberRow } from "@/lib/contas-receber-types"
import { isTituloEmAberto, saldoAbertoDaRow, somaSaldoEmAberto } from "@/lib/contas-receber-aberto"

const LK = "cr-legado-77"

/** Semeia como o painel legado: snapshot completo do localStorage no payload. */
async function seedLegado(localKey = LK, over: Record<string, unknown> = {}) {
  const snap = {
    id: localKey,
    descricao: "Crediário — Ana",
    cliente: "Ana Souza",
    valor: 100,
    vencimento: "2026-08-10",
    status: "pendente",
    tipo: "Manual",
    corDoCard: "violeta", // metadata puramente visual do snapshot
    ...over,
  }
  await upsertContaReceber({
    storeId: STORE,
    localKey,
    descricao: String(snap.descricao),
    cliente: String(snap.cliente),
    valor: Number(snap.valor),
    vencimento: String(snap.vencimento),
    status: String(snap.status),
    payloadPatch: snap as unknown as Record<string, unknown>,
    replacePayload: true,
  })
}

async function listar(): Promise<{ rows: ContaReceberRow[]; audit: Array<{ localKey?: string; saldoAberto?: number }> }> {
  const res = await GET(new Request("http://local/api/ops/contas-receber-list"))
  const json = (await res.json()) as { rows: ContaReceberRow[]; audit: Array<{ localKey?: string; saldoAberto?: number }> }
  expect(res.status).toBe(200)
  return json
}

const byKey = (rows: ContaReceberRow[], k: string) => rows.find((r) => String(r.id) === k)!

beforeEach(() => h.reset())

describe("G1 §2 — listagem canônica de contas a receber", () => {
  it("[CRIT-3] status apresentado é o do servidor, não o do snapshot antigo", async () => {
    await seedLegado()
    await liquidarContaReceber({ storeId: STORE, localKey: LK })

    const { rows } = await listar()
    const row = byKey(rows, LK)
    expect(row.status).toBe("pago")
  })

  it("[CRIT-3] saldo canônico vem explícito na linha (valor − ledger efetivo)", async () => {
    await seedLegado()
    await registrarPagamentoParcial({ storeId: STORE, localKey: LK, valorPago: 40 })

    const { rows } = await listar()
    const row = byKey(rows, LK)
    expect(row.saldoAberto).toBe(60)
    expect(row.valor).toBe(100) // a coluna bruta continua sendo o principal
    expect(row.status).toBe("parcial")
  })

  it("[CRIT-4] título com saldo zero não conta como aberto", async () => {
    await seedLegado()
    await liquidarContaReceber({ storeId: STORE, localKey: LK })

    const { rows } = await listar()
    const row = byKey(rows, LK)
    expect(row.saldoAberto).toBe(0)
    expect(isTituloEmAberto(row)).toBe(false)
    expect(rows.filter((r) => isTituloEmAberto(r))).toHaveLength(0)
  })

  it("o consumidor não precisa cruzar `rows` com `audit` por heurística", async () => {
    await seedLegado()
    await registrarPagamentoParcial({ storeId: STORE, localKey: LK, valorPago: 40 })

    const { rows, audit } = await listar()
    const row = byKey(rows, LK)
    const doAudit = audit.find((a) => a.localKey === LK)!.saldoAberto
    expect(row.saldoAberto).toBe(doAudit)
    expect(saldoAbertoDaRow(row)).toBe(60)
  })

  it("metadata visual legítima do snapshot é preservada", async () => {
    await seedLegado()
    const { rows } = await listar()
    expect((byKey(rows, LK) as unknown as { corDoCard?: string }).corDoCard).toBe("violeta")
  })

  it("contagem e total do cabeçalho derivam do saldo canônico", async () => {
    await seedLegado("cr-1", { id: "cr-1", valor: 100 })
    await seedLegado("cr-2", { id: "cr-2", valor: 50 })
    await seedLegado("cr-3", { id: "cr-3", valor: 30 })
    await liquidarContaReceber({ storeId: STORE, localKey: "cr-2" })
    await registrarPagamentoParcial({ storeId: STORE, localKey: "cr-3", valorPago: 10 })

    const { rows } = await listar()
    const abertos = rows.filter((r) => isTituloEmAberto(r))
    // cr-2 quitado sai da lista operacional; cr-1 (100) + cr-3 (20) permanecem.
    expect(abertos).toHaveLength(2)
    expect(somaSaldoEmAberto(abertos)).toBe(120)
  })

  it("título sem snapshot no payload continua listado, com saldo canônico", async () => {
    await upsertContaReceber({
      storeId: STORE,
      localKey: "cr-sem-snapshot",
      descricao: "Título de servidor",
      cliente: "Bruno",
      valor: 80,
      vencimento: "2026-09-01",
      status: "pendente",
      payloadPatch: { origem: "manual" },
    })

    const { rows } = await listar()
    const row = byKey(rows, "cr-sem-snapshot")
    expect(row.saldoAberto).toBe(80)
    expect(row.status).toBe("pendente")
  })

  it("a listagem só devolve títulos da loja do request", async () => {
    await seedLegado()
    await upsertContaReceber({
      storeId: "loja-b",
      localKey: LK,
      descricao: "Título da outra loja",
      cliente: "Outra",
      valor: 999,
      vencimento: "2026-08-10",
      status: "pendente",
    })

    const { rows } = await listar()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.valor).toBe(100)
  })
})
