import { describe, expect, it, vi } from "vitest"
import { drainFiscalQueue } from "./queue-worker"
import type {
  FiscalQueueExecutionResult,
  FiscalQueueJob,
  FiscalQueueLease,
  FiscalQueuePauseSnapshot,
  FiscalQueueWorkerPorts,
} from "./queue.types"

function job(overrides: Partial<FiscalQueueJob> = {}): FiscalQueueJob {
  const now = new Date("2026-07-23T00:00:00.000Z")
  return {
    id: "job-1",
    storeId: "store-matriz-fixture",
    vendaId: "venda-1",
    notaFiscalId: "nota-1",
    tipo: "EMISSAO",
    status: "PENDENTE",
    tentativas: 0,
    maxTentativas: 5,
    proximaTentativaEm: now,
    prioridade: 0,
    lockOwner: null,
    lockedAt: null,
    lockExpiresAt: null,
    dedupeKey: "fiscal:emissao:v1:venda:venda-1",
    payload: { transmission: { external: false } },
    ultimoErro: null,
    concluidoEm: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function memoryQueue(
  initialJobs: FiscalQueueJob[],
  execution:
    | FiscalQueueExecutionResult
    | ((current: FiscalQueueJob) => Promise<FiscalQueueExecutionResult>) = {
    kind: "success",
    code: "autorizada",
    mensagem: "Emissão simulada concluída.",
    simulado: true,
    externalTransmissionAttempted: false,
  },
) {
  const jobs = new Map(initialJobs.map((item) => [item.id, { ...item }]))
  const audits: string[] = []
  const execute = vi.fn(async (current: FiscalQueueJob) =>
    typeof execution === "function" ? execution(current) : execution,
  )
  let pause: FiscalQueuePauseSnapshot = {
    globalPaused: false,
    globalSource: "none",
    pausedStoreIds: [],
  }
  let heartbeatCount = 0

  function owns(current: FiscalQueueJob, workerId: string, now: Date): boolean {
    return (
      current.status === "PROCESSANDO" &&
      current.lockOwner === workerId &&
      current.lockExpiresAt != null &&
      current.lockExpiresAt.getTime() > now.getTime()
    )
  }

  const ports: FiscalQueueWorkerPorts = {
    readPauseSnapshot: async () => ({ ...pause, pausedStoreIds: [...pause.pausedStoreIds] }),
    acquireNextJob: async ({ workerId, now, leaseMs, pausedStoreIds }) => {
      const eligible = [...jobs.values()]
        .filter((current) => {
          if (pausedStoreIds.includes(current.storeId)) return false
          if (current.status === "PROCESSANDO") {
            return Boolean(current.lockExpiresAt && current.lockExpiresAt.getTime() <= now.getTime())
          }
          if (!["PENDENTE", "AGUARDANDO_RETRY"].includes(current.status)) return false
          if (
            current.status === "AGUARDANDO_RETRY" &&
            current.proximaTentativaEm == null
          ) return false
          if (current.proximaTentativaEm && current.proximaTentativaEm.getTime() > now.getTime()) return false
          return !current.lockExpiresAt || current.lockExpiresAt.getTime() <= now.getTime()
        })
        .sort((a, b) =>
          b.prioridade - a.prioridade ||
          a.createdAt.getTime() - b.createdAt.getTime() ||
          a.id.localeCompare(b.id),
        )
      const selected = eligible[0]
      if (!selected) return null
      const takeover = selected.status === "PROCESSANDO"
      selected.status = "PROCESSANDO"
      selected.lockOwner = workerId
      selected.lockedAt = now
      selected.lockExpiresAt = new Date(now.getTime() + leaseMs)
      selected.tentativas += 1
      return { job: { ...selected }, takeover } satisfies FiscalQueueLease
    },
    heartbeat: async ({ jobId, workerId, now, leaseMs }) => {
      const current = jobs.get(jobId)
      if (!current || !owns(current, workerId, now)) return false
      heartbeatCount += 1
      current.lockExpiresAt = new Date(now.getTime() + leaseMs)
      return true
    },
    markTransmissionStarted: async ({ job: leased, workerId, now, payload }) => {
      const current = jobs.get(leased.id)
      if (!current || !owns(current, workerId, now)) return false
      current.payload = payload
      return true
    },
    complete: async ({ job: leased, workerId, now, payload }) => {
      const current = jobs.get(leased.id)
      if (!current || !owns(current, workerId, now)) return false
      current.status = "CONCLUIDO"
      current.payload = payload
      current.concluidoEm = now
      current.ultimoErro = null
      current.proximaTentativaEm = null
      current.lockOwner = null
      current.lockedAt = null
      current.lockExpiresAt = null
      return true
    },
    retry: async ({ job: leased, workerId, now, nextAttemptAt, error, payload }) => {
      const current = jobs.get(leased.id)
      if (!current || !owns(current, workerId, now)) return false
      current.status = "PENDENTE"
      current.payload = payload
      current.ultimoErro = error
      current.proximaTentativaEm = nextAttemptAt
      current.lockOwner = null
      current.lockedAt = null
      current.lockExpiresAt = null
      return true
    },
    fail: async ({ job: leased, workerId, now, error, payload }) => {
      const current = jobs.get(leased.id)
      if (!current || !owns(current, workerId, now)) return false
      current.status = "FALHA"
      current.payload = payload
      current.ultimoErro = error
      current.proximaTentativaEm = null
      current.lockOwner = null
      current.lockedAt = null
      current.lockExpiresAt = null
      return true
    },
    waitForConsultation: async ({ job: leased, workerId, now, error, payload }) => {
      const current = jobs.get(leased.id)
      if (!current || !owns(current, workerId, now)) return false
      current.status = "AGUARDANDO_RETRY"
      current.payload = payload
      current.ultimoErro = error
      current.proximaTentativaEm = null
      current.lockOwner = null
      current.lockedAt = null
      current.lockExpiresAt = null
      return true
    },
    execute,
    audit: async (event) => {
      audits.push(event.acao)
    },
  }

  return {
    ports,
    jobs,
    audits,
    execute,
    setPause(next: FiscalQueuePauseSnapshot) {
      pause = next
    },
    heartbeatCount: () => heartbeatCount,
  }
}

describe("worker fiscal · concorrência e locks", () => {
  it("dois workers concorrentes processam cada job uma única vez", async () => {
    const initial = Array.from({ length: 20 }, (_, index) =>
      job({
        id: `job-${index.toString().padStart(2, "0")}`,
        vendaId: `venda-${index}`,
        notaFiscalId: `nota-${index}`,
        dedupeKey: `fiscal:emissao:v1:venda:venda-${index}`,
        prioridade: index % 3,
      }),
    )
    const state = memoryQueue(initial)
    const now = () => new Date("2026-07-23T00:00:00.000Z")
    const [a, b] = await Promise.all([
      drainFiscalQueue({ workerId: "worker-a", batchSize: 20, now }, state.ports),
      drainFiscalQueue({ workerId: "worker-b", batchSize: 20, now }, state.ports),
    ])

    expect(a.completed + b.completed).toBe(20)
    expect(state.execute).toHaveBeenCalledTimes(20)
    expect([...state.jobs.values()].every((item) => item.status === "CONCLUIDO")).toBe(true)
  })

  it("lock válido impede processamento paralelo e worker diferente não libera lock alheio", async () => {
    const state = memoryQueue([job()])
    const now = new Date("2026-07-23T00:00:00.000Z")
    const lease = await state.ports.acquireNextJob({
      workerId: "worker-a",
      now,
      leaseMs: 60_000,
      pausedStoreIds: [],
    })
    expect(lease?.job.lockOwner).toBe("worker-a")

    const second = await drainFiscalQueue(
      { workerId: "worker-b", batchSize: 1, now: () => now },
      state.ports,
    )
    expect(second.acquired).toBe(0)
    expect(
      await state.ports.complete({
        job: lease!.job,
        workerId: "worker-b",
        now,
        payload: {},
      }),
    ).toBe(false)
    expect(state.jobs.get("job-1")?.status).toBe("PROCESSANDO")
  })

  it("kill-test: lock expira, outro worker assume e converge sem emissão duplicada", async () => {
    const state = memoryQueue([job()])
    let clock = Date.parse("2026-07-23T00:00:00.000Z")
    const firstLease = await state.ports.acquireNextJob({
      workerId: "worker-morto",
      now: new Date(clock),
      leaseMs: 5_000,
      pausedStoreIds: [],
    })
    expect(firstLease).not.toBeNull()
    // Processo morre após adquirir, antes de marcar a fronteira de transmissão.
    clock += 5_001

    const recovered = await drainFiscalQueue(
      {
        workerId: "worker-recuperacao",
        batchSize: 1,
        leaseMs: 5_000,
        now: () => new Date(clock),
      },
      state.ports,
    )

    expect(recovered.completed).toBe(1)
    expect(recovered.items[0]?.takeover).toBe(true)
    expect(state.execute).toHaveBeenCalledTimes(1)
    expect(state.jobs.get("job-1")).toMatchObject({
      status: "CONCLUIDO",
      tentativas: 2,
      lockOwner: null,
    })
    expect(state.audits).toContain("fiscal.queue.lock.takeover")
  })

  it("kill-test após marcador local: takeover retoma provider simulado uma única vez", async () => {
    const state = memoryQueue([
      job({
        status: "PROCESSANDO",
        tentativas: 1,
        lockOwner: "worker-morto",
        lockedAt: new Date("2026-07-22T23:58:00.000Z"),
        lockExpiresAt: new Date("2026-07-22T23:59:00.000Z"),
        payload: {
          transmission: {
            external: false,
            startedAt: "2026-07-22T23:58:30.000Z",
            attempt: 1,
          },
        },
      }),
    ])

    const recovered = await drainFiscalQueue(
      {
        workerId: "worker-recuperacao",
        batchSize: 1,
        now: () => new Date("2026-07-23T00:00:00.000Z"),
      },
      state.ports,
    )

    expect(recovered.completed).toBe(1)
    expect(recovered.items[0]?.takeover).toBe(true)
    expect(state.execute).toHaveBeenCalledTimes(1)
    expect(state.jobs.get("job-1")).toMatchObject({
      status: "CONCLUIDO",
      tentativas: 2,
      lockOwner: null,
    })
  })

  it("heartbeat renova o lease durante execução longa", async () => {
    const state = memoryQueue(
      [job()],
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 650))
        return {
          kind: "success",
          code: "autorizada",
          mensagem: "ok",
          simulado: true,
          externalTransmissionAttempted: false,
        }
      },
    )
    const report = await drainFiscalQueue(
      {
        workerId: "worker-heartbeat",
        batchSize: 1,
        leaseMs: 5_000,
        heartbeatMs: 250,
      },
      state.ports,
    )
    expect(report.completed).toBe(1)
    expect(state.heartbeatCount()).toBeGreaterThanOrEqual(2)
  })
})

describe("worker fiscal · retry, dead-letter e trava de transmissão", () => {
  it("erro transitório volta a PENDENTE com backoff exponencial e depois conclui", async () => {
    let calls = 0
    const state = memoryQueue([job()], async () => {
      calls += 1
      return calls === 1
        ? {
            kind: "transient",
            code: "timeout_simulado",
            mensagem: "timeout token=segredo-que-nao-pode-vazar",
            simulado: true,
            externalTransmissionAttempted: false,
          }
        : {
            kind: "success",
            code: "autorizada",
            mensagem: "ok",
            simulado: true,
            externalTransmissionAttempted: false,
          }
    })
    let clock = Date.parse("2026-07-23T00:00:00.000Z")
    const first = await drainFiscalQueue(
      {
        workerId: "worker-retry",
        batchSize: 1,
        baseBackoffMs: 1_000,
        maxBackoffMs: 8_000,
        now: () => new Date(clock),
      },
      state.ports,
    )
    const pending = state.jobs.get("job-1")!
    expect(first.retried).toBe(1)
    expect(pending.status).toBe("PENDENTE")
    expect(pending.proximaTentativaEm?.getTime()).toBe(clock + 1_000)
    expect(pending.ultimoErro).not.toContain("segredo-que-nao-pode-vazar")

    clock += 1_000
    const second = await drainFiscalQueue(
      { workerId: "worker-retry", batchSize: 1, now: () => new Date(clock) },
      state.ports,
    )
    expect(second.completed).toBe(1)
    expect(state.jobs.get("job-1")?.tentativas).toBe(2)
  })

  it("erro terminal ou tentativas esgotadas vai para FALHA", async () => {
    const terminal = memoryQueue([
      job({ id: "terminal" }),
      job({ id: "exhausted", maxTentativas: 1 }),
    ], async (current) =>
      current.id === "terminal"
        ? {
            kind: "terminal",
            code: "snapshot_invalido",
            mensagem: "snapshot inválido",
            simulado: true,
            externalTransmissionAttempted: false,
          }
        : {
            kind: "transient",
            code: "timeout",
            mensagem: "timeout",
            simulado: true,
            externalTransmissionAttempted: false,
          },
    )
    const report = await drainFiscalQueue(
      { workerId: "worker-dlq", batchSize: 2 },
      terminal.ports,
    )
    expect(report.failed).toBe(2)
    expect(terminal.jobs.get("terminal")?.status).toBe("FALHA")
    expect(terminal.jobs.get("exhausted")?.status).toBe("FALHA")
  })

  it("retry de transmissão externa fica bloqueado sem consulta autorizadora", async () => {
    const state = memoryQueue([
      job({
        tentativas: 1,
        payload: {
          transmission: {
            external: true,
            startedAt: "2026-07-22T23:59:00.000Z",
            uncertainAt: "2026-07-22T23:59:30.000Z",
          },
        },
      }),
    ])
    const report = await drainFiscalQueue(
      { workerId: "worker-guard", batchSize: 1 },
      state.ports,
    )
    expect(report.failed).toBe(1)
    expect(state.execute).not.toHaveBeenCalled()
    expect(state.audits).toContain("fiscal.queue.transmission.blocked")
  })

  it("timeout fica estacionado sem backoff e sem retransmissão automática", async () => {
    const state = memoryQueue([job()], {
      kind: "uncertain",
      code: "timeout_simulado",
      mensagem: "resultado desconhecido",
      simulado: true,
      externalTransmissionAttempted: false,
    })
    const first = await drainFiscalQueue(
      { workerId: "worker-incerto", batchSize: 1 },
      state.ports,
    )
    expect(first.awaitingConsultation).toBe(1)
    expect(state.jobs.get("job-1")).toMatchObject({
      status: "AGUARDANDO_RETRY",
      proximaTentativaEm: null,
    })
    const second = await drainFiscalQueue(
      { workerId: "worker-incerto", batchSize: 1 },
      state.ports,
    )
    expect(second.acquired).toBe(0)
    expect(state.execute).toHaveBeenCalledTimes(1)
  })

  it("INUTILIZACAO real não é reescrita pelo freio do GOAL-011 (GOAL 019)", async () => {
    const state = memoryQueue(
      [job({ tipo: "INUTILIZACAO", dedupeKey: "fiscal:inutilizacao:v1:store-matriz-fixture:NFCE:HOMOLOGACAO:1:19:19" })],
      {
        kind: "success",
        code: "inutilizacao_homologada",
        mensagem: "Inutilização homologada com protocolo válido.",
        simulado: false,
        externalTransmissionAttempted: true,
        detalhe: { protocolo: "135260000000001", cStat: "102" },
      },
    )
    const report = await drainFiscalQueue(
      { workerId: "worker-inut", batchSize: 1 },
      state.ports,
    )
    expect(report.completed).toBe(1)
    const finished = state.jobs.get("job-1")!
    expect(finished.status).toBe("CONCLUIDO")
    expect(finished.ultimoErro).toBeNull()
    const lastExecution = (finished.payload as { lastExecution?: { code?: string } }).lastExecution
    expect(lastExecution?.code).toBe("inutilizacao_homologada")
  })

  it("EMISSAO real continua freada pelo GOAL-011", async () => {
    const state = memoryQueue([job()], {
      kind: "success",
      code: "autorizada",
      mensagem: "Emissão real concluída.",
      simulado: false,
      externalTransmissionAttempted: true,
    })
    await drainFiscalQueue({ workerId: "worker-freio", batchSize: 1 }, state.ports)
    const finished = state.jobs.get("job-1")!
    expect(finished.status).toBe("FALHA")
    expect(finished.ultimoErro).toContain("GOAL-011 bloqueia provider ou transmissão real")
  })
})

describe("worker fiscal · pausa global e por loja", () => {
  it("pausa global mantém jobs PENDENTE e despausa retoma normalmente", async () => {
    const state = memoryQueue([job()])
    state.setPause({
      globalPaused: true,
      globalSource: "audit_log",
      pausedStoreIds: [],
    })
    const paused = await drainFiscalQueue(
      { workerId: "worker-pause", batchSize: 1 },
      state.ports,
    )
    expect(paused.paused).toBe(true)
    expect(state.jobs.get("job-1")?.status).toBe("PENDENTE")

    state.setPause({
      globalPaused: false,
      globalSource: "none",
      pausedStoreIds: [],
    })
    const resumed = await drainFiscalQueue(
      { workerId: "worker-pause", batchSize: 1 },
      state.ports,
    )
    expect(resumed.completed).toBe(1)
  })

  it("pausa por loja isola a loja pausada sem perder seus jobs", async () => {
    const state = memoryQueue([
      job({ id: "matriz", storeId: "store-matriz", prioridade: 10 }),
      job({ id: "filial", storeId: "store-filial", vendaId: "venda-2", notaFiscalId: "nota-2" }),
    ])
    state.setPause({
      globalPaused: false,
      globalSource: "none",
      pausedStoreIds: ["store-matriz"],
    })
    const report = await drainFiscalQueue(
      { workerId: "worker-store-pause", batchSize: 2 },
      state.ports,
    )
    expect(report.completed).toBe(1)
    expect(state.jobs.get("filial")?.status).toBe("CONCLUIDO")
    expect(state.jobs.get("matriz")?.status).toBe("PENDENTE")
  })
})
