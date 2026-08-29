/**
 * GOAL 020 · relatório 127 — freio GOAL-011 com PROVA TIPADA de autorização real.
 *
 * O freio continua bloqueando toda execução real não isenta. A única porta nova é a prova
 * tipada `contingencyExternalAuthorization`, produzida pelo executor sob capability desta
 * execução e CONFERIDA aqui contra o job (id/store/notaFiscal/kind). Prova forjada, órfã ou
 * de tipo trocado NÃO atravessa; generic drain (sem capability ⇒ sem prova) segue bloqueado.
 */
import { describe, expect, it, vi } from "vitest"
import { drainFiscalQueue } from "./queue-worker"
import type {
  FiscalQueueExecutionResult,
  FiscalQueueJob,
  FiscalQueueLease,
  FiscalQueuePauseSnapshot,
  FiscalQueueWorkerPorts,
} from "./queue.types"

const AGORA = new Date("2026-09-01T12:05:00.000Z")

function job(overrides: Partial<FiscalQueueJob> = {}): FiscalQueueJob {
  return {
    id: "job-drill-1",
    storeId: "loja-piloto",
    vendaId: "venda-1",
    notaFiscalId: "nota-1",
    tipo: "CONTINGENCIA_TRANSMISSAO",
    status: "PENDENTE",
    tentativas: 0,
    maxTentativas: 5,
    proximaTentativaEm: AGORA,
    prioridade: 0,
    lockOwner: null,
    lockedAt: null,
    lockExpiresAt: null,
    dedupeKey: "dedupe",
    payload: {},
    ultimoErro: null,
    concluidoEm: null,
    createdAt: AGORA,
    updatedAt: AGORA,
    ...overrides,
  }
}

function prova(input: Partial<NonNullable<FiscalQueueExecutionResult["contingencyExternalAuthorization"]>> = {}) {
  return {
    kind: "transmissao_autorizada" as const,
    jobId: "job-drill-1",
    storeId: "loja-piloto",
    notaFiscalId: "nota-1",
    concedidaPor: "contingencia-drill:v1:xxx:execucao-unica",
    ...input,
  }
}

function sucessoReal(provaTipada?: FiscalQueueExecutionResult["contingencyExternalAuthorization"]) {
  return {
    kind: "success" as const,
    code: "autorizada",
    mensagem: "Autorização real concluída com evidência fiscal completa.",
    simulado: false,
    externalTransmissionAttempted: true,
    providerInvoked: true,
    ...(provaTipada ? { contingencyExternalAuthorization: provaTipada } : {}),
  }
}

function memoryPorts(initial: FiscalQueueJob[], execute: (job: FiscalQueueJob) => Promise<FiscalQueueExecutionResult>) {
  const jobs = new Map(initial.map((item) => [item.id, { ...item }]))
  function owns(current: FiscalQueueJob, workerId: string, now: Date): boolean {
    return (
      current.status === "PROCESSANDO" &&
      current.lockOwner === workerId &&
      current.lockExpiresAt != null &&
      current.lockExpiresAt.getTime() > now.getTime()
    )
  }
  const ports: FiscalQueueWorkerPorts = {
    readPauseSnapshot: async (): Promise<FiscalQueuePauseSnapshot> => ({
      globalPaused: false,
      globalSource: "none",
      pausedStoreIds: [],
    }),
    acquireNextJob: async ({ workerId, now, leaseMs }) => {
      const selected = [...jobs.values()].find(
        (c) =>
          ["PENDENTE", "AGUARDANDO_RETRY"].includes(c.status) &&
          (!c.proximaTentativaEm || c.proximaTentativaEm.getTime() <= now.getTime()) &&
          (!c.lockExpiresAt || c.lockExpiresAt.getTime() <= now.getTime()),
      )
      if (!selected) return null
      const takeover = selected.status === "PROCESSANDO"
      selected.status = "PROCESSANDO"
      selected.lockOwner = workerId
      selected.lockExpiresAt = new Date(now.getTime() + leaseMs)
      selected.tentativas += 1
      return { job: { ...selected }, takeover } satisfies FiscalQueueLease
    },
    heartbeat: async () => true,
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
      current.lockExpiresAt = null
      return true
    },
    execute,
    audit: vi.fn(async () => undefined),
  }
  return { ports, jobs }
}

describe("GOAL-011 · prova tipada do drill atravessa o freio; resto continua bloqueado", () => {
  it("sucesso REAL de CONTINGENCIA_TRANSMISSAO com prova coerente ⇒ CONCLUIDO", async () => {
    const { ports, jobs } = memoryPorts([job()], async () => sucessoReal(prova()))
    const report = await drainFiscalQueue({ workerId: "w", now: () => AGORA }, ports)
    expect(report.items[0]?.status).toBe("concluido")
    expect(jobs.get("job-drill-1")?.status).toBe("CONCLUIDO")
  })

  it("sucesso real SEM prova ⇒ provider_real_bloqueado (FALHA)", async () => {
    const { ports, jobs } = memoryPorts([job()], async () => sucessoReal(undefined))
    const report = await drainFiscalQueue({ workerId: "w", now: () => AGORA }, ports)
    expect(report.items[0]?.status).toBe("falha")
    expect(jobs.get("job-drill-1")?.status).toBe("FALHA")
    expect(jobs.get("job-drill-1")?.ultimoErro).toContain("GOAL-011")
  })

  it("prova FORJADA com jobId de outro job ⇒ bloqueada", async () => {
    const { ports, jobs } = memoryPorts(
      [job()],
      async () => sucessoReal(prova({ jobId: "job-OUTRO" })),
    )
    const report = await drainFiscalQueue({ workerId: "w", now: () => AGORA }, ports)
    expect(report.items[0]?.status).toBe("falha")
    expect(jobs.get("job-drill-1")?.status).toBe("FALHA")
  })

  it("prova FORJADA com notaFiscalId divergente ⇒ bloqueada", async () => {
    const { ports, jobs } = memoryPorts(
      [job()],
      async () => sucessoReal(prova({ notaFiscalId: "nota-OUTRA" })),
    )
    const report = await drainFiscalQueue({ workerId: "w", now: () => AGORA }, ports)
    expect(report.items[0]?.status).toBe("falha")
    expect(jobs.get("job-drill-1")?.status).toBe("FALHA")
  })

  it("prova com kind TROCADO (consulta_autorizada num job de transmissão) ⇒ bloqueada", async () => {
    const { ports, jobs } = memoryPorts(
      [job()],
      async () => sucessoReal(prova({ kind: "consulta_autorizada" })),
    )
    const report = await drainFiscalQueue({ workerId: "w", now: () => AGORA }, ports)
    expect(report.items[0]?.status).toBe("falha")
    expect(jobs.get("job-drill-1")?.status).toBe("FALHA")
  })

  it("CONSULTA real autorizada com prova coerente ⇒ CONCLUIDO", async () => {
    const consulta = job({ id: "job-consulta", tipo: "CONSULTA" })
    const { ports, jobs } = memoryPorts(
      [consulta],
      async () => sucessoReal(prova({ kind: "consulta_autorizada", jobId: "job-consulta" })),
    )
    const report = await drainFiscalQueue({ workerId: "w", now: () => AGORA }, ports)
    expect(report.items[0]?.status).toBe("concluido")
    expect(jobs.get("job-consulta")?.status).toBe("CONCLUIDO")
  })

  it("CONSULTA real autorizada SEM prova ⇒ bloqueada (comportamento inalterado)", async () => {
    const consulta = job({ id: "job-consulta", tipo: "CONSULTA" })
    const { ports, jobs } = memoryPorts([consulta], async () => sucessoReal(undefined))
    const report = await drainFiscalQueue({ workerId: "w", now: () => AGORA }, ports)
    expect(report.items[0]?.status).toBe("falha")
    expect(jobs.get("job-consulta")?.status).toBe("FALHA")
  })

  it("generic drain: execução real sem prova em EMISSAO segue provider_real_bloqueado", async () => {
    const emissao = job({ id: "job-emissao", tipo: "EMISSAO" })
    const { ports, jobs } = memoryPorts(
      [emissao],
      async () => sucessoReal(prova({ jobId: "job-emissao" })),
    )
    const report = await drainFiscalQueue({ workerId: "w", now: () => AGORA }, ports)
    expect(report.items[0]?.status).toBe("falha")
    expect(jobs.get("job-emissao")?.status).toBe("FALHA")
  })
})
