import { describe, expect, it, vi } from "vitest"
import {
  readFiscalObservabilitySnapshot,
  type FiscalObservabilityClient,
} from "./fiscal-observability-service"
import {
  STORE_PAUSE_ACTION,
  GLOBAL_PAUSE_ACTION,
} from "../queue/prisma-queue-worker"

function createMockClient(options: {
  storeId?: string
  contingencyNotes?: number
  drainJobs?: Array<{ createdAt: Date; payload?: unknown }>
  isGlobalPaused?: boolean
  pausedStoreIds?: string[]
  pauseLog?: { cStat?: string; detalhe?: Record<string, unknown>; mensagem?: string } | null
} = {}): FiscalObservabilityClient {
  const storeId = options.storeId ?? "loja-teste-01"
  const now = new Date("2026-09-06T12:00:00.000Z")

  return {
    fiscalEmissaoJob: {
      groupBy: vi.fn().mockResolvedValue([
        { status: "PENDENTE", _count: { _all: 3 } },
        { status: "FALHA", _count: { _all: 1 } },
      ]),
      count: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        if (where.tipo === "CONTINGENCIA_TRANSMISSAO") {
          return options.drainJobs?.length ?? 0
        }
        if (where.status === "FALHA") return 1
        if (Array.isArray((where.status as Record<string, unknown>)?.in)) return 3
        if (where.status === "PROCESSANDO") return 0
        return 0
      }),
      findFirst: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        if (where.tipo === "CONTINGENCIA_TRANSMISSAO") {
          return options.drainJobs?.[0] ? { createdAt: options.drainJobs[0].createdAt } : null
        }
        return { createdAt: new Date(now.getTime() - 60_000) }
      }),
      findMany: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        if (where.tipo === "CONTINGENCIA_TRANSMISSAO") {
          return options.drainJobs ?? []
        }
        return []
      }),
    },
    fiscalLog: {
      count: vi.fn().mockResolvedValue(0),
      findFirst: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        if (where.acao === STORE_PAUSE_ACTION) {
          return options.pauseLog ?? null
        }
        if (where.acao === GLOBAL_PAUSE_ACTION) {
          return options.isGlobalPaused ? { detalhe: { paused: true } } : null
        }
        return null
      }),
      findMany: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        if (where.acao === STORE_PAUSE_ACTION) {
          return (options.pausedStoreIds ?? []).map((id) => ({
            storeId: id,
            detalhe: { paused: true },
          }))
        }
        return []
      }),
    },
    notaFiscal: {
      count: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        if (where.status === "CONTINGENCIA") {
          return options.contingencyNotes ?? 0
        }
        if (where.status === "TRANSMITINDO") return 0
        return 0
      }),
      findFirst: vi.fn().mockResolvedValue(null),
    },
  }
}

describe("fiscal-observability-service", () => {
  it("exige storeId explícito e não vazio", async () => {
    await expect(
      readFiscalObservabilitySnapshot({ storeId: "" }, createMockClient()),
    ).rejects.toThrow(/storeId obrigatório/)

    await expect(
      readFiscalObservabilitySnapshot({ storeId: "   " }, createMockClient()),
    ).rejects.toThrow(/storeId obrigatório/)
  })

  it("consolida métricas de fila, incerteza, contingência e throttling para loja ativa", async () => {
    const now = new Date("2026-09-06T12:00:00.000Z")
    const deadline1 = new Date("2026-09-06T13:00:00.000Z") // 1 hora no futuro (approaching se limite for 2h)
    const deadline2 = new Date("2026-09-07T12:00:00.000Z") // > 2h no futuro (safe)
    const client = createMockClient({
      storeId: "loja-1",
      contingencyNotes: 2,
      drainJobs: [
        {
          createdAt: new Date(now.getTime() - 120_000),
          payload: { deadlineAt: deadline1.toISOString() },
        },
        {
          createdAt: new Date(now.getTime() - 60_000),
          payload: { deadlineAt: deadline2.toISOString() },
        },
      ],
      isGlobalPaused: false,
      pausedStoreIds: [],
    })

    const snapshot = await readFiscalObservabilitySnapshot({ storeId: "loja-1", now }, client)

    expect(snapshot.storeId).toBe("loja-1")
    expect(snapshot.observedAt).toBe(now.toISOString())
    expect(snapshot.queue.depth).toBe(3)
    expect(snapshot.queue.failures).toBe(1)
    expect(snapshot.contingency.contingencyNotesCount).toBe(2)
    expect(snapshot.contingency.pendingDrainJobsCount).toBe(2)
    expect(snapshot.contingency.oldestPendingDrainAgeMs).toBe(120_000)
    expect(snapshot.contingency.nearestDeadlineAt).toBe(deadline1.toISOString())
    expect(snapshot.contingency.nearestAlarm).toBe("APPROACHING")
    expect(snapshot.contingency.alarms.approaching).toBe(1)
    expect(snapshot.contingency.alarms.safe).toBe(1)
    expect(snapshot.contingency.alarms.expired).toBe(0)

    expect(snapshot.throttling.isPaused).toBe(false)
    expect(snapshot.throttling.pausedScope).toBe("none")
    expect(snapshot.throttling.cStat656Evidence).toBe(false)
    expect(snapshot.throttling.reason).toBeNull()
  })

  it("identifica evidência de cStat 656 quando loja está pausada por consumo indevido", async () => {
    const now = new Date("2026-09-06T12:00:00.000Z")
    const client = createMockClient({
      storeId: "loja-throttled",
      pausedStoreIds: ["loja-throttled"],
      pauseLog: {
        cStat: "656",
        detalhe: { paused: true, scope: "store", cStat: "656", reason: "Consumo indevido" },
        mensagem: "Fila fiscal da loja pausada por consumo indevido (656).",
      },
    })

    const snapshot = await readFiscalObservabilitySnapshot(
      { storeId: "loja-throttled", now },
      client,
    )

    expect(snapshot.throttling.isPaused).toBe(true)
    expect(snapshot.throttling.pausedScope).toBe("store")
    expect(snapshot.throttling.cStat656Evidence).toBe(true)
    expect(snapshot.throttling.reason).toBe("cstat_656")
  })

  it("NÃO declara cStat 656 quando a pausa foi manual ou por outro motivo", async () => {
    const now = new Date("2026-09-06T12:00:00.000Z")
    const client = createMockClient({
      storeId: "loja-manual",
      pausedStoreIds: ["loja-manual"],
      pauseLog: {
        cStat: undefined,
        detalhe: { paused: true, scope: "store", reason: "Manutenção programada" },
        mensagem: "Fila pausada manualmente pelo operador.",
      },
    })

    const snapshot = await readFiscalObservabilitySnapshot(
      { storeId: "loja-manual", now },
      client,
    )

    expect(snapshot.throttling.isPaused).toBe(true)
    expect(snapshot.throttling.pausedScope).toBe("store")
    expect(snapshot.throttling.cStat656Evidence).toBe(false)
    expect(snapshot.throttling.reason).toBe("Manutenção programada")
  })

  it("fail-closed de segurança: não expõe chaves privadas, senhas, certificados ou XMLs", async () => {
    const now = new Date("2026-09-06T12:00:00.000Z")
    const client = createMockClient({
      storeId: "loja-segura",
      drainJobs: [
        {
          createdAt: now,
          payload: {
            deadlineAt: "2026-09-06T18:00:00.000Z",
            // payload interno sensível que NÃO deve vazar
            secretToken: "SUPER_SECRET",
            privateKey: "-----BEGIN RSA PRIVATE KEY-----",
            xmlAssinado: "<NFe>sensivel</NFe>",
          },
        },
      ],
    })

    const snapshot = await readFiscalObservabilitySnapshot(
      { storeId: "loja-segura", now },
      client,
    )

    const rawJson = JSON.stringify(snapshot)
    expect(rawJson).not.toContain("SUPER_SECRET")
    expect(rawJson).not.toContain("BEGIN RSA PRIVATE KEY")
    expect(rawJson).not.toContain("<NFe>sensivel</NFe>")
    expect(rawJson).not.toContain("privateKey")
    expect(rawJson).not.toContain("secretToken")
  })
})
