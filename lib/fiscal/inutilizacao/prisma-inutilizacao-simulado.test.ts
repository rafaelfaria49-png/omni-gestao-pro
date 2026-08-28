/**
 * Caminho Prisma/worker: STUB/simulado não autoriza inutilização definitiva.
 */
import { describe, expect, it, vi } from "vitest"
import { stubHomologacaoProvider } from "../provider/stub-homologacao"
import { createPrismaFiscalQueueWorkerPorts } from "../queue/prisma-queue-worker"
import type { FiscalQueueJob } from "../queue/queue.types"
import { executeInutilizacaoJob } from "./execute"
import { INUTILIZACAO_MARK, asInutilizacaoPayload } from "./mark"
import { createPrismaInutilizacaoPorts } from "./prisma-ports"

type Row = Record<string, unknown>

type SimuladoTx = {
  fiscalEmissaoJob: {
    findUnique: (args: { where: { storeId_dedupeKey?: { storeId: string; dedupeKey: string } } }) => Promise<Row | null>
    findFirst: () => Promise<Row | null>
    upsert: () => Promise<Row>
    updateMany: (args: { where: Row; data: Row }) => Promise<{ count: number }>
  }
  notaFiscal: {
    findFirst: () => Promise<null>
    updateMany: () => Promise<{ count: number }>
    create: () => Promise<Row>
  }
  notaFiscalItem: { findMany: () => Promise<unknown[]>; createMany: () => Promise<Row> }
  eventoFiscal: {
    findFirst: () => Promise<Row | null>
    create: (args: { data: Row }) => Promise<Row>
    updateMany: (args: { where: Row; data: Row }) => Promise<{ count: number }>
  }
  fiscalLog: { create: (args: { data: Row }) => Promise<Row> }
  venda: { updateMany: () => Promise<{ count: number }> }
  configuracaoFiscalLoja: { findUnique: () => Promise<Row> }
}

type SimuladoClient = SimuladoTx & {
  $transaction: <T>(fn: (tx: SimuladoTx) => Promise<T>) => Promise<T>
  snapshot: () => { jobs: Row[]; eventos: Row[]; logs: Row[] }
}

function payloadAInutilizar(): Row {
  return {
    version: 1,
    operation: "INUTILIZACAO",
    mark: INUTILIZACAO_MARK.A_INUTILIZAR,
    storeId: "loja-1",
    modelo: "NFCE",
    ambiente: "HOMOLOGACAO",
    serie: 1,
    numeroInicial: 19,
    numeroFinal: 19,
    justificativa: "Numero NFC-e rejeitado pela SEFAZ; faixa inutilizada para nao reutilizar.",
    motivo: "rejeicao_definitiva",
    notaFiscalId: "nf-1",
    vendaId: "venda-1",
    protocolo: null,
    cStat: null,
    xMotivo: null,
    inutilizadoEm: null,
    requestedAt: "2026-08-25T00:00:00.000Z",
    requestedBy: "op",
  }
}

function createPrismaClient(): SimuladoClient {
  const jobs: Row[] = [
    {
      id: "job-1",
      storeId: "loja-1",
      vendaId: "venda-1",
      notaFiscalId: "nf-1",
      tipo: "INUTILIZACAO",
      status: "PROCESSANDO",
      tentativas: 1,
      maxTentativas: 5,
      dedupeKey: "fiscal:inutilizacao:v1:loja-1:NFCE:HOMOLOGACAO:1:19:19",
      payload: payloadAInutilizar(),
    },
  ]
  const eventos: Row[] = []
  const logs: Row[] = []
  const api: SimuladoClient = {
    $transaction: async <T>(fn: (tx: SimuladoTx) => Promise<T>): Promise<T> => fn(api),
    fiscalEmissaoJob: {
      findUnique: async (args: { where: { storeId_dedupeKey?: { storeId: string; dedupeKey: string } } }) => {
        const key = args.where.storeId_dedupeKey
        if (!key) return null
        return jobs.find((j) => j.storeId === key.storeId && j.dedupeKey === key.dedupeKey) ?? null
      },
      findFirst: async () => jobs[0] ?? null,
      upsert: async () => jobs[0]!,
      updateMany: async (args: { where: Row; data: Row }) => {
        const equals = (args.where.payload as { equals?: string } | undefined)?.equals
        const hits = jobs.filter((j) => {
          if (j.id !== args.where.id || j.storeId !== args.where.storeId) return false
          if (equals && (j.payload as Row).mark !== equals) return false
          return true
        })
        for (const j of hits) Object.assign(j, args.data)
        return { count: hits.length }
      },
    },
    notaFiscal: {
      findFirst: async () => null,
      updateMany: async () => ({ count: 0 }),
      create: async () => ({}),
    },
    notaFiscalItem: { findMany: async () => [], createMany: async () => ({}) },
    eventoFiscal: {
      findFirst: async () => eventos[0] ?? null,
      create: async (args: { data: Row }) => {
        eventos.push({ id: `ev-${eventos.length + 1}`, ...args.data })
        return eventos[eventos.length - 1]
      },
      updateMany: async (args: { where: Row; data: Row }) => {
        for (const e of eventos) Object.assign(e, args.data)
        return { count: eventos.length }
      },
    },
    fiscalLog: {
      create: async (args: { data: Row }) => {
        logs.push(args.data)
        return args.data
      },
    },
    venda: { updateMany: async () => ({ count: 1 }) },
    configuracaoFiscalLoja: {
      findUnique: async () => ({
        cnpj: "11222333000181",
        uf: "SP",
        ambiente: "HOMOLOGACAO",
        modeloFiscal: "NFCE",
        provider: "STUB_HOMOLOGACAO",
        fiscalEnabled: true,
      }),
    },
    snapshot: () => ({ jobs, eventos, logs }),
  }
  return api
}

function jobFromClient(client: ReturnType<typeof createPrismaClient>): FiscalQueueJob {
  const row = client.snapshot().jobs[0]!
  const now = new Date("2026-08-25T12:00:00.000Z")
  return {
    id: String(row.id),
    storeId: String(row.storeId),
    vendaId: String(row.vendaId),
    notaFiscalId: String(row.notaFiscalId),
    tipo: "INUTILIZACAO",
    status: "PROCESSANDO",
    tentativas: 1,
    maxTentativas: 5,
    proximaTentativaEm: now,
    prioridade: 5,
    lockOwner: "worker-1",
    lockedAt: now,
    lockExpiresAt: new Date(now.getTime() + 60_000),
    dedupeKey: String(row.dedupeKey),
    payload: row.payload as FiscalQueueJob["payload"],
    ultimoErro: null,
    concluidoEm: null,
    createdAt: now,
    updatedAt: now,
  }
}

describe("Prisma/worker: simulado não autoriza inutilização", () => {
  it("execute via createPrismaInutilizacaoPorts não persiste INUTILIZADO nem Evento AUTORIZADO", async () => {
    const client = createPrismaClient()
    const result = await executeInutilizacaoJob(jobFromClient(client), {
      ports: createPrismaInutilizacaoPorts(client as never),
      provider: stubHomologacaoProvider,
    })
    expect(result.code).toBe("inutilizacao_simulada_nao_autoritativa")
    const snap = client.snapshot()
    expect(asInutilizacaoPayload(snap.jobs[0]?.payload)?.mark).toBe(INUTILIZACAO_MARK.A_INUTILIZAR)
    expect(snap.eventos.some((e: Row) => e.status === "AUTORIZADO")).toBe(false)
    expect(snap.logs.some((l: Row) => l.acao === "fiscal.inutilizacao.homologada")).toBe(false)
    expect(snap.logs.some((l: Row) => l.acao === "fiscal.inutilizacao.simulada_nao_autoritativa")).toBe(true)
  })

  it("worker STUB_HOMOLOGACAO não baixa a marca no adapter Prisma da fila", async () => {
    const client = createPrismaClient()
    const ports = createPrismaFiscalQueueWorkerPorts(client as never, vi.fn() as never)
    const result = await ports.execute(jobFromClient(client))
    expect(result.code).toBe("inutilizacao_simulada_nao_autoritativa")
    const snap = client.snapshot()
    expect(asInutilizacaoPayload(snap.jobs[0]?.payload)?.mark).toBe(INUTILIZACAO_MARK.A_INUTILIZAR)
    expect(snap.eventos.some((e: Row) => e.status === "AUTORIZADO")).toBe(false)
    expect(snap.logs.some((l: Row) => l.acao === "fiscal.inutilizacao.homologada")).toBe(false)
  })
})
