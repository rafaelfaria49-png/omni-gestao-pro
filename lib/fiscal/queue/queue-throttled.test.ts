/**
 * GOAL-016D-B — `cStat 656` na fila fiscal (plano 016D D12.2 · F-5).
 *
 * O `656` só é seguro se a fila tiver um caminho **dedicado**. Reaproveitar qualquer `kind`
 * existente reproduz exatamente o comportamento que o código denuncia:
 *
 *  - `transient` → retry com backoff (insistir);
 *  - `uncertain` → estaciona esperando uma `CONSULTA` que D12.2 proíbe criar (espera infinita);
 *  - `terminal`  → `FALHA`, que a rota administrativa reprocessa (retransmissão por operador).
 *
 * Cada teste abaixo prova a ausência de uma dessas rotas, além da ordem obrigatória
 * **pausa persistida → lock liberado** e do seu comportamento fail-closed.
 */
import { describe, expect, it, vi } from "vitest"
import { drainFiscalQueue } from "./queue-worker"
import type {
  FiscalQueueExecutionResult,
  FiscalQueueJob,
  FiscalQueueWorkerPorts,
} from "./queue.types"

function job(overrides: Partial<FiscalQueueJob> = {}): FiscalQueueJob {
  return {
    id: "job-1",
    storeId: "loja-piloto",
    vendaId: "venda-1",
    notaFiscalId: "nota-1",
    tipo: "EMISSAO",
    status: "PROCESSANDO",
    tentativas: 1,
    maxTentativas: 5,
    proximaTentativaEm: null,
    prioridade: 0,
    lockOwner: "w1",
    lockedAt: null,
    lockExpiresAt: null,
    dedupeKey: null,
    payload: { version: 2 },
    ultimoErro: null,
    concluidoEm: null,
    createdAt: new Date("2026-01-01T10:00:00Z"),
    updatedAt: new Date("2026-01-01T10:00:00Z"),
    ...overrides,
  }
}

const RESULTADO_THROTTLED: FiscalQueueExecutionResult = {
  kind: "throttled",
  code: "consumo_indevido_bloqueado",
  mensagem: "cStat 656 (Consumo indevido) classificado como THROTTLED.",
  simulado: false,
  externalTransmissionAttempted: true,
  detalhe: { cStat: "656" },
}

type Portas = FiscalQueueWorkerPorts & {
  acquireNextJob: ReturnType<typeof vi.fn>
  retry: ReturnType<typeof vi.fn>
  fail: ReturnType<typeof vi.fn>
  complete: ReturnType<typeof vi.fn>
  waitForConsultation: ReturnType<typeof vi.fn>
  pauseStoreForThrottling: ReturnType<typeof vi.fn>
  parkThrottled: ReturnType<typeof vi.fn>
  audit: ReturnType<typeof vi.fn>
  execute: ReturnType<typeof vi.fn>
}

function portas(input: {
  execution?: FiscalQueueExecutionResult
  jobs?: FiscalQueueJob[]
  pauseOk?: boolean
  parkOk?: boolean
  semPortaDePausa?: boolean
  semPortaDeEstacionamento?: boolean
  pausedStoreIds?: string[]
}): Portas {
  const fila = [...(input.jobs ?? [job()])]
  const base = {
    readPauseSnapshot: vi.fn(async () => ({
      globalPaused: false,
      globalSource: "none" as const,
      pausedStoreIds: input.pausedStoreIds ?? [],
    })),
    acquireNextJob: vi.fn(async ({ pausedStoreIds }: { pausedStoreIds: string[] }) => {
      const proximo = fila.find((j) => !pausedStoreIds.includes(j.storeId))
      if (!proximo) return null
      fila.splice(fila.indexOf(proximo), 1)
      return { job: proximo, takeover: false }
    }),
    heartbeat: vi.fn(async () => true),
    markTransmissionStarted: vi.fn(async () => true),
    complete: vi.fn(async () => true),
    retry: vi.fn(async () => true),
    fail: vi.fn(async () => true),
    waitForConsultation: vi.fn(async () => true),
    pauseStoreForThrottling: vi.fn(async () => input.pauseOk ?? true),
    parkThrottled: vi.fn(async () => input.parkOk ?? true),
    execute: vi.fn(async () => input.execution ?? RESULTADO_THROTTLED),
    audit: vi.fn(async () => undefined),
  } as unknown as Portas
  if (input.semPortaDePausa) delete (base as Partial<FiscalQueueWorkerPorts>).pauseStoreForThrottling
  if (input.semPortaDeEstacionamento) delete (base as Partial<FiscalQueueWorkerPorts>).parkThrottled
  return base
}

function drenar(ports: FiscalQueueWorkerPorts, batchSize = 1) {
  return drainFiscalQueue({ workerId: "w1", batchSize }, ports)
}

describe("cStat 656 — caminho dedicado da fila", () => {
  it("pausa a loja, estaciona o job e reporta throttled", async () => {
    const ports = portas({})
    const report = await drenar(ports)

    expect(report.throttled).toBe(1)
    expect(report.items[0]?.status).toBe("throttled")
    expect(ports.pauseStoreForThrottling).toHaveBeenCalledTimes(1)
    expect(ports.pauseStoreForThrottling).toHaveBeenCalledWith(
      expect.objectContaining({ cStat: "656", workerId: "w1" }),
    )
    expect(ports.parkThrottled).toHaveBeenCalledTimes(1)
  })

  it("NÃO agenda retry nem calcula backoff", async () => {
    const ports = portas({})
    await drenar(ports)
    expect(ports.retry).not.toHaveBeenCalled()
    const report = await drenar(portas({}))
    expect(report.retried).toBe(0)
  })

  it("NÃO chama waitForConsultation — nenhum job CONSULTA nasce daqui", async () => {
    const ports = portas({})
    await drenar(ports)
    expect(ports.waitForConsultation).not.toHaveBeenCalled()
  })

  it("NÃO marca falha (que seria reprocessável) nem conclusão", async () => {
    const ports = portas({})
    const report = await drenar(ports)
    expect(ports.fail).not.toHaveBeenCalled()
    expect(ports.complete).not.toHaveBeenCalled()
    expect(report.failed).toBe(0)
    expect(report.completed).toBe(0)
    expect(report.awaitingConsultation).toBe(0)
  })

  it("não é contado como transient, uncertain nem terminal em nenhum contador", async () => {
    const report = await drenar(portas({}))
    expect(report).toMatchObject({
      completed: 0,
      retried: 0,
      awaitingConsultation: 0,
      failed: 0,
      lockLost: 0,
      throttled: 1,
      throttlePauseFailed: 0,
    })
  })

  it("audita o bloqueio com o cStat 656", async () => {
    const ports = portas({})
    await drenar(ports)
    const acoes = ports.audit.mock.calls.map((c) => c[0].acao)
    expect(acoes).toContain("fiscal.queue.throttled.detected")
    expect(acoes).toContain("fiscal.queue.throttled.parked")
    const deteccao = ports.audit.mock.calls.find(
      (c) => c[0].acao === "fiscal.queue.throttled.detected",
    )?.[0]
    expect(deteccao?.nivel).toBe("ERROR")
    expect(deteccao?.detalhe?.cStat).toBe("656")
  })
})

describe("cStat 656 — ordem obrigatória e fail-closed", () => {
  it("a pausa é persistida ANTES de o lock ser liberado", async () => {
    const ordem: string[] = []
    const ports = portas({})
    ports.pauseStoreForThrottling.mockImplementation(async () => {
      ordem.push("pausa")
      return true
    })
    ports.parkThrottled.mockImplementation(async () => {
      ordem.push("liberacao_do_lock")
      return true
    })
    await drenar(ports)
    expect(ordem).toEqual(["pausa", "liberacao_do_lock"])
  })

  it("pausa que falha ⇒ o lock NÃO é liberado e a drenagem aborta", async () => {
    const ports = portas({ pauseOk: false, jobs: [job(), job({ id: "job-2" })], })
    const report = await drenar(ports, 5)

    expect(ports.parkThrottled).not.toHaveBeenCalled()
    expect(ports.retry).not.toHaveBeenCalled()
    expect(ports.fail).not.toHaveBeenCalled()
    expect(ports.waitForConsultation).not.toHaveBeenCalled()
    expect(report.throttlePauseFailed).toBe(1)
    expect(report.items).toHaveLength(1)
    // O segundo job sequer chegou a ser adquirido.
    expect(ports.acquireNextJob).toHaveBeenCalledTimes(1)
  })

  it("pausa que lança exceção é tratada como falha, não como sucesso", async () => {
    const ports = portas({})
    ports.pauseStoreForThrottling.mockRejectedValue(new Error("banco indisponível"))
    const report = await drenar(ports)
    expect(report.throttlePauseFailed).toBe(1)
    expect(ports.parkThrottled).not.toHaveBeenCalled()
  })

  it("fila SEM porta de pausa falha fechada — nada é liberado", async () => {
    const ports = portas({ semPortaDePausa: true })
    const report = await drenar(ports)
    expect(report.throttlePauseFailed).toBe(1)
    expect(ports.parkThrottled).not.toHaveBeenCalled()
    expect(ports.fail).not.toHaveBeenCalled()
    const acoes = ports.audit.mock.calls.map((c) => c[0].acao)
    expect(acoes).toContain("fiscal.queue.throttled.pause_failed")
  })

  it("fila SEM porta de estacionamento mantém o lock mesmo com a pausa gravada", async () => {
    const ports = portas({ semPortaDeEstacionamento: true })
    const report = await drenar(ports)
    expect(ports.pauseStoreForThrottling).toHaveBeenCalledTimes(1)
    expect(report.throttlePauseFailed).toBe(1)
    expect(ports.fail).not.toHaveBeenCalled()
  })

  it("estacionamento que perde o lock é reportado como lock perdido", async () => {
    const ports = portas({ parkOk: false })
    const report = await drenar(ports)
    expect(report.lockLost).toBe(1)
    expect(report.throttled).toBe(0)
  })
})

describe("cStat 656 — escopo da pausa e retomada", () => {
  it("a loja pausada deixa de ser elegível na volta seguinte da drenagem", async () => {
    const pausadas: string[] = []
    const ports = portas({ jobs: [job(), job({ id: "job-2" })] })
    ports.pauseStoreForThrottling.mockImplementation(async ({ job: j }: { job: FiscalQueueJob }) => {
      pausadas.push(j.storeId)
      return true
    })
    ports.readPauseSnapshot = vi.fn(async () => ({
      globalPaused: false,
      globalSource: "none" as const,
      pausedStoreIds: [...pausadas],
    })) as unknown as FiscalQueueWorkerPorts["readPauseSnapshot"]

    const report = await drenar(ports, 5)
    expect(report.throttled).toBe(1)
    // O segundo job da MESMA loja não foi processado após a pausa entrar em vigor.
    expect(ports.execute).toHaveBeenCalledTimes(1)
  })

  it("jobs de OUTRA loja seguem sendo drenados — a pausa é de loja, não global", async () => {
    const pausadas: string[] = []
    const ports = portas({
      jobs: [job(), job({ id: "job-2", storeId: "loja-outra" })],
    })
    ports.pauseStoreForThrottling.mockImplementation(async ({ job: j }: { job: FiscalQueueJob }) => {
      pausadas.push(j.storeId)
      return true
    })
    ports.readPauseSnapshot = vi.fn(async () => ({
      globalPaused: false,
      globalSource: "none" as const,
      pausedStoreIds: [...pausadas],
    })) as unknown as FiscalQueueWorkerPorts["readPauseSnapshot"]
    ports.execute.mockImplementation(async (j: FiscalQueueJob) =>
      j.storeId === "loja-piloto"
        ? RESULTADO_THROTTLED
        : {
            kind: "success" as const,
            code: "autorizada",
            mensagem: "ok",
            simulado: true,
            externalTransmissionAttempted: false,
          },
    )

    const report = await drenar(ports, 5)
    expect(report.throttled).toBe(1)
    expect(report.completed).toBe(1)
  })

  it("não existe auto-unpause: nada na fila retoma a loja", async () => {
    const ports = portas({})
    await drenar(ports)
    const acoes = ports.audit.mock.calls.map((c) => c[0].acao)
    expect(acoes.some((acao: string) => /unpause|retomad|resume/i.test(acao))).toBe(false)
    expect(ports.pauseStoreForThrottling).toHaveBeenCalledWith(
      expect.objectContaining({ cStat: "656" }),
    )
    // A porta de pausa nunca é chamada para DESPAUSAR — seu contrato só sabe pausar.
    for (const chamada of ports.pauseStoreForThrottling.mock.calls) {
      expect(chamada[0]).not.toHaveProperty("paused", false)
    }
  })
})

describe("auditoria de proveniência — F-2", () => {
  it("execução externa NÃO é auditada como simulada quando bloqueada pelo freio do GOAL-011", async () => {
    const ports = portas({
      execution: {
        kind: "success",
        code: "autorizada",
        mensagem: "Autorizada por provider externo.",
        simulado: false,
        externalTransmissionAttempted: true,
      },
    })
    await drenar(ports)
    // O freio converte para terminal, mas a trilha continua dizendo que a execução foi REAL.
    const payload = ports.fail.mock.calls[0]?.[0]?.payload as Record<string, unknown>
    expect((payload.lastExecution as Record<string, unknown>).code).toBe("provider_real_bloqueado")
    expect((payload.transmission as Record<string, unknown>).external).toBe(true)
  })

  it("um THROTTLED de provider externo NÃO é rebaixado a terminal", async () => {
    const ports = portas({ execution: RESULTADO_THROTTLED })
    const report = await drenar(ports)
    // `RESULTADO_THROTTLED.simulado === false`: antes desta correção o freio o transformaria em
    // terminal ⇒ FALHA ⇒ reprocessável, e o 656 viraria retransmissão.
    expect(report.throttled).toBe(1)
    expect(ports.fail).not.toHaveBeenCalled()
    expect(ports.pauseStoreForThrottling).toHaveBeenCalledTimes(1)
  })
})
