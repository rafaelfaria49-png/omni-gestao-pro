/**
 * markRejected enviado: rejeição commita sozinha; enqueue de inutilização é posterior.
 * Falha no enqueue não desfaz REJEITADA.
 */
import { describe, expect, it } from "vitest"
import { createPrismaUncertainStatePersistence } from "./prisma-uncertain-state-persistence"
import { INUTILIZACAO_MARK, asInutilizacaoPayload } from "../inutilizacao/mark"

type Row = Record<string, unknown>

function createRejectClient(options: { failEnqueue?: boolean } = {}) {
  const notas: Row[] = [
    {
      id: "nf-1",
      storeId: "loja-1",
      vendaId: "venda-1",
      status: "TRANSMITINDO",
      modelo: "NFCE",
      ambiente: "HOMOLOGACAO",
      serie: 7,
      numero: 19,
    },
  ]
  const vendas: Row[] = [{ id: "venda-1", storeId: "loja-1", fiscalStatus: "EMITINDO" }]
  const jobs: Row[] = [
    {
      id: "job-emissao",
      storeId: "loja-1",
      vendaId: "venda-1",
      notaFiscalId: "nf-1",
      tipo: "EMISSAO",
      status: "PROCESSANDO",
      payload: { version: 2 },
    },
  ]
  const logs: Row[] = []
  let committed = false

  const api = {
    $transaction: async <T>(fn: (tx: typeof api) => Promise<T>): Promise<T> => {
      const snapshot = {
        notas: notas.map((n) => ({ ...n })),
        vendas: vendas.map((v) => ({ ...v })),
        jobs: jobs.map((j) => ({ ...j })),
        logs: logs.slice(),
      }
      try {
        const result = await fn(api)
        committed = true
        return result
      } catch (error) {
        notas.splice(0, notas.length, ...snapshot.notas)
        vendas.splice(0, vendas.length, ...snapshot.vendas)
        jobs.splice(0, jobs.length, ...snapshot.jobs)
        logs.splice(0, logs.length, ...snapshot.logs)
        committed = false
        throw error
      }
    },
    notaFiscal: {
      findFirst: async (args: { where: Row }) =>
        notas.find((n) => n.id === args.where.id && n.storeId === args.where.storeId) ?? null,
      updateMany: async (args: { where: Row; data: Row }) => {
        const hits = notas.filter(
          (n) => n.id === args.where.id && n.storeId === args.where.storeId && n.vendaId === args.where.vendaId,
        )
        for (const n of hits) Object.assign(n, args.data)
        return { count: hits.length }
      },
    },
    venda: {
      updateMany: async (args: { where: Row; data: Row }) => {
        const hits = vendas.filter((v) => v.id === args.where.id && v.storeId === args.where.storeId)
        for (const v of hits) Object.assign(v, args.data)
        return { count: hits.length }
      },
    },
    fiscalEmissaoJob: {
      findFirst: async (args: { where: Row }) =>
        jobs.find(
          (j) =>
            j.storeId === args.where.storeId &&
            j.vendaId === args.where.vendaId &&
            j.notaFiscalId === args.where.notaFiscalId,
        ) ?? null,
      findUnique: async (args: { where: { storeId_dedupeKey?: { storeId: string; dedupeKey: string } } }) => {
        const key = args.where.storeId_dedupeKey
        if (!key) return null
        return jobs.find((j) => j.storeId === key.storeId && j.dedupeKey === key.dedupeKey) ?? null
      },
      update: async (args: { where: Row; data: Row }) => {
        const job = jobs.find((j) => j.id === args.where.id)
        if (job) Object.assign(job, args.data)
        return job ?? null
      },
      updateMany: async () => ({ count: 0 }),
      upsert: async (args: { where: { storeId_dedupeKey: { storeId: string; dedupeKey: string } }; create: Row }) => {
        if (options.failEnqueue) throw new Error("enqueue boom")
        const existing = jobs.find(
          (j) =>
            j.storeId === args.where.storeId_dedupeKey.storeId &&
            j.dedupeKey === args.where.storeId_dedupeKey.dedupeKey,
        )
        if (existing) return existing
        const created = { id: `job-inut-${jobs.length}`, ...args.create }
        jobs.push(created)
        return created
      },
    },
    fiscalLog: {
      create: async (args: { data: Row }) => {
        logs.push(args.data)
        return args.data
      },
    },
    snapshot: () => ({ notas, vendas, jobs, logs, committed }),
  }
  return api
}

const document = {
  storeId: "loja-1",
  vendaId: "venda-1",
  notaFiscalId: "nf-1",
  modelo: "NFCE" as const,
  ambiente: "HOMOLOGACAO" as const,
  serie: 7,
  numero: 19,
  chaveAcesso: "3".repeat(44),
  status: "TRANSMITINDO" as const,
  xmlAssinado: "<NFe/>",
  xmlBytesSha256: "abc",
}

describe("createPrismaUncertainStatePersistence.markRejected", () => {
  it("persiste REJEITADA e depois cria job INUTILIZACAO", async () => {
    const client = createRejectClient()
    const persistence = createPrismaUncertainStatePersistence(client as never)
    await persistence.markRejected({
      document,
      result: { outcome: "REJECTED", cStat: "215", xMotivo: "Falha de schema" },
      now: new Date("2026-08-25T12:00:00.000Z"),
      source: "CONSULTATION",
      requiresInutilizacao: true,
    })
    const snap = client.snapshot()
    expect(snap.committed).toBe(true)
    expect(snap.notas[0]?.status).toBe("REJEITADA")
    expect(snap.vendas[0]?.fiscalStatus).toBe("REJEITADA")
    const inut = snap.jobs.find((j) => j.tipo === "INUTILIZACAO")
    expect(inut).toBeTruthy()
    const payload = asInutilizacaoPayload(inut?.payload)
    expect(payload?.mark).toBe(INUTILIZACAO_MARK.A_INUTILIZAR)
    expect(payload?.numeroInicial).toBe(19)
    expect(payload?.numeroFinal).toBe(19)
  })

  it("falha no enqueue não desfaz a rejeição já commitada", async () => {
    const client = createRejectClient({ failEnqueue: true })
    const persistence = createPrismaUncertainStatePersistence(client as never)
    await persistence.markRejected({
      document,
      result: { outcome: "REJECTED", cStat: "215", xMotivo: "Falha de schema" },
      now: new Date("2026-08-25T12:00:00.000Z"),
      source: "CONSULTATION",
      requiresInutilizacao: true,
    })
    const snap = client.snapshot()
    expect(snap.notas[0]?.status).toBe("REJEITADA")
    expect(snap.vendas[0]?.fiscalStatus).toBe("REJEITADA")
    expect(snap.jobs.some((j) => j.tipo === "INUTILIZACAO")).toBe(false)
    expect(snap.logs.some((l) => l.acao === "fiscal.inutilizacao.enqueue_failed_after_rejection")).toBe(true)
  })
})
