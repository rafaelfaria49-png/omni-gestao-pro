import { describe, it, expect, beforeEach, vi } from "vitest"

// ============================================================================
// GOAL_FIX_CONTAS_RECEBER_PARCIAL_FINANCEIRO_V01 — bug irmão do fix do PDV.
// ----------------------------------------------------------------------------
// PATCH /api/financeiro/receber op="liquidar" usava `res.data.valor` (coluna
// BRUTA, que NÃO diminui em baixas parciais via backend) como valor da
// movimentação financeira e da auditoria. Em um título já parcialmente pago,
// isso lançaria mais que o devido. O fix passa a usar o saldo aberto REAL
// (buildContaReceberAuditTrail(...).saldoAberto) calculado ANTES de quitar.
//
// Este teste exercita o handler PATCH de PRODUÇÃO sobre um Prisma EM MEMÓRIA.
// Apenas auth/guards/store-id/movimentação/fechamento são mockados; o cálculo
// de saldo (services reais) roda sobre o banco fake.
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
        for (const r of titulos.values()) if (!where?.storeId || r.storeId === where.storeId) return snapshot(r)
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
    carteiraFinanceira: {
      findFirst: async () => null,
    },
  }

  return {
    prisma,
    titulos,
    movSpy: vi.fn(
      async (_titulo: unknown, _valor: number, _opts?: Record<string, unknown>) =>
        ({ ok: true, action: "created" as const }),
    ),
    auditSpy: vi.fn(async (_arg: { depois?: { valor?: number } }) => undefined),
    reset: () => {
      titulos.clear()
      byId.clear()
      seq = 0
      relogio = Date.parse("2026-09-04T12:00:00.000Z")
    },
  }
})

const STORE = "loja-2"

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma, prismaEnsureConnected: vi.fn(async () => undefined) }))
vi.mock("@/lib/store-id-from-request", () => ({
  storeIdFromAssistecRequestForWrite: vi.fn(() => STORE),
}))
vi.mock("@/lib/ops-api-gate", () => ({ opsLojaIdFromRequest: vi.fn(() => STORE) }))
vi.mock("@/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1", name: "Tester" } })) }))
vi.mock("@/lib/auth/session-operator", () => ({ getOperatorLabelFromSession: vi.fn(() => "Tester") }))
vi.mock("@/lib/auth/api-enterprise-guard", () => ({
  apiGuardFinanceiroEditEnterpriseOrLegacy: vi.fn(async () => null),
  apiGuardFinanceiroViewOrOps: vi.fn(async () => null),
}))
vi.mock("@/lib/financeiro/services/auditoria-actor", () => ({
  extractAuditoriaActor: vi.fn(() => ({})),
  logAuditoriaFinanceira: h.auditSpy,
}))
vi.mock("@/lib/financeiro/services/movimentacoes-service", () => ({
  createMovimentacaoEntradaFromReceber: h.movSpy,
  estornarMovimentacaoPorReferencia: vi.fn(async () => ({ ok: true, action: "created" as const })),
}))
vi.mock("@/lib/financeiro/services/fechamento-service", () => ({
  verificarPeriodoFechado: vi.fn(async () => ({ fechado: false })),
}))

import { PATCH } from "./route"
import {
  upsertContaReceber,
  registrarPagamentoParcial,
  getContaReceberByLocalKey,
  buildContaReceberAuditTrail,
} from "@/lib/financeiro/services/contas-receber-service"

const LOCAL_KEY = `receber:manual:${STORE}:t-001`

async function seedTitulo(valor = 365.01) {
  await upsertContaReceber({
    storeId: STORE,
    localKey: LOCAL_KEY,
    descricao: "SALDO MIGRADO SMARTGENIUS - EM ATRASO",
    cliente: "CAROLAINE RAMOS FERNANDES",
    valor,
    vencimento: "2026-01-10",
    status: "vencido",
    payloadPatch: { origem: "importacao", origemSistema: "smart-genius" },
  })
}

function patchReq(body: Record<string, unknown>) {
  return new Request("http://local/api/financeiro/receber", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-assistec-loja-id": STORE },
    body: JSON.stringify(body),
  })
}

/** Valor que o handler passou à movimentação financeira na última chamada. */
function lastMovValor(): number {
  const calls = h.movSpy.mock.calls
  return calls.length ? Number(calls[calls.length - 1]![1]) : NaN
}

beforeEach(() => {
  h.reset()
  h.movSpy.mockClear()
  h.auditSpy.mockClear()
})

describe("PATCH /api/financeiro/receber — liquidação usa saldo aberto real", () => {
  it("liquidar APÓS baixa parcial lança SOMENTE o saldo restante (165,01), não o bruto (365,01)", async () => {
    await seedTitulo(365.01)
    const p = await registrarPagamentoParcial({ storeId: STORE, localKey: LOCAL_KEY, valorPago: 200 })
    expect(p.ok).toBe(true)

    const res = await PATCH(patchReq({ op: "liquidar", localKey: LOCAL_KEY }))
    const json = (await res.json()) as { ok?: boolean; op?: string }
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)

    // movimentação financeira recebeu o saldo restante, não o valor bruto
    expect(h.movSpy).toHaveBeenCalledTimes(1)
    expect(lastMovValor()).toBe(165.01)

    // auditoria registra o mesmo valor real
    const auditArg = h.auditSpy.mock.calls.at(-1)?.[0]
    expect(auditArg?.depois?.valor).toBe(165.01)

    // título quitado e sem saldo
    const t = await getContaReceberByLocalKey(STORE, LOCAL_KEY)
    expect(t!.status).toBe("pago")
    expect(buildContaReceberAuditTrail([t!])[0]!.saldoAberto).toBe(0)
  })

  it("liquidação pura (sem parcial) continua lançando o valor cheio (365,01) — sem regressão", async () => {
    await seedTitulo(365.01)
    const res = await PATCH(patchReq({ op: "liquidar", localKey: LOCAL_KEY }))
    expect(res.status).toBe(200)
    expect(h.movSpy).toHaveBeenCalledTimes(1)
    expect(lastMovValor()).toBe(365.01)
  })

  it("baixa parcial continua lançando exatamente o valor pago (200) com flag parcial", async () => {
    await seedTitulo(365.01)
    const res = await PATCH(patchReq({ op: "parcial", localKey: LOCAL_KEY, valor: 200 }))
    const json = (await res.json()) as { ok?: boolean; op?: string }
    expect(res.status).toBe(200)
    expect(json.op).toBe("parcial")

    expect(h.movSpy).toHaveBeenCalledTimes(1)
    expect(lastMovValor()).toBe(200)
    const opts = h.movSpy.mock.calls.at(-1)?.[2]
    expect(opts?.parcial).toBe(true)

    const t = await getContaReceberByLocalKey(STORE, LOCAL_KEY)
    expect(t!.status).toBe("parcial")
    expect(buildContaReceberAuditTrail([t!])[0]!.saldoAberto).toBe(165.01)
  })

  it("liquidar com várias parciais lança a soma correta no total (parciais + restante = bruto)", async () => {
    await seedTitulo(365.01)
    await registrarPagamentoParcial({ storeId: STORE, localKey: LOCAL_KEY, valorPago: 100 })
    await registrarPagamentoParcial({ storeId: STORE, localKey: LOCAL_KEY, valorPago: 65 })

    const res = await PATCH(patchReq({ op: "liquidar", localKey: LOCAL_KEY }))
    expect(res.status).toBe(200)
    // saldo restante = 365,01 − 100 − 65 = 200,01
    expect(lastMovValor()).toBe(200.01)
  })
})
