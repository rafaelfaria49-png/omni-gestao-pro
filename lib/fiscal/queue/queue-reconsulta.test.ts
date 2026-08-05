/**
 * GOAL-016D-B · correção 002 — reconsulta após `cStat 103/105` (bloqueio 1 da revisão cruzada).
 *
 * ## O defeito
 *
 * Um job `CONSULTA` que recebia `103/105` era classificado como `uncertain`. O worker então
 * chamava `waitForConsultation`, que grava `AGUARDANDO_RETRY` com **`proximaTentativaEm: null`**
 * — e `eligibleWhere` exige `proximaTentativaEm` **não nulo e vencido** para readquirir um job
 * nesse status. Resultado: **a consulta ficava esperando por si mesma**, para sempre. O
 * documento morria em `TRANSMITINDO`, sem autorização e sem rejeição, e nenhum alarme disparava
 * porque nada havia falhado.
 *
 * ## A correção
 *
 * `kind: "processing"` dedicado + porta `rescheduleProcessingConsultation`, que devolve o MESMO
 * job para `AGUARDANDO_RETRY` com data futura — piso oficial de 15 s (MOC 7.00 §5.7).
 */
import { describe, expect, it, vi } from "vitest"
import { FISCAL_RECONSULTA_MIN_DELAY_MS, drainFiscalQueue } from "./queue-worker"
import { eligibleWhere } from "./prisma-queue-worker"
import type {
  FiscalQueueExecutionResult,
  FiscalQueueJob,
  FiscalQueueWorkerPorts,
} from "./queue.types"

const AGORA = new Date("2026-01-01T10:00:00.000Z")
const RECIBO = "999000000000042"

function job(overrides: Partial<FiscalQueueJob> = {}): FiscalQueueJob {
  return {
    id: "job-consulta",
    storeId: "loja-piloto",
    vendaId: "venda-1",
    notaFiscalId: "nota-1",
    tipo: "CONSULTA",
    status: "PROCESSANDO",
    tentativas: 1,
    maxTentativas: 10,
    proximaTentativaEm: null,
    prioridade: 100,
    lockOwner: "w1",
    lockedAt: null,
    lockExpiresAt: null,
    dedupeKey: "fiscal:consulta:v1:nota:nota-1",
    payload: { version: 2, operation: "CONSULTA" },
    ultimoErro: null,
    concluidoEm: null,
    createdAt: AGORA,
    updatedAt: AGORA,
    ...overrides,
  }
}

const RESULTADO_PROCESSING: FiscalQueueExecutionResult = {
  kind: "processing",
  code: "consulta_lote_em_processamento",
  mensagem: "cStat 105 (Lote em processamento) classificado como PROCESSING.",
  simulado: false,
  externalTransmissionAttempted: true,
  detalhe: { consultationOutcome: "PROCESSING", cStat: "105", recibo: RECIBO },
}

type Portas = FiscalQueueWorkerPorts & {
  retry: ReturnType<typeof vi.fn>
  fail: ReturnType<typeof vi.fn>
  complete: ReturnType<typeof vi.fn>
  waitForConsultation: ReturnType<typeof vi.fn>
  parkThrottled: ReturnType<typeof vi.fn>
  pauseStoreForThrottling: ReturnType<typeof vi.fn>
  rescheduleProcessingConsultation: ReturnType<typeof vi.fn>
  acquireNextJob: ReturnType<typeof vi.fn>
  audit: ReturnType<typeof vi.fn>
  execute: ReturnType<typeof vi.fn>
}

function portas(input: {
  jobs?: FiscalQueueJob[]
  execution?: FiscalQueueExecutionResult
  rescheduleOk?: boolean
  semPortaDeReagendamento?: boolean
} = {}): Portas {
  const fila = [...(input.jobs ?? [job()])]
  const base = {
    readPauseSnapshot: vi.fn(async () => ({
      globalPaused: false,
      globalSource: "none" as const,
      pausedStoreIds: [] as string[],
    })),
    acquireNextJob: vi.fn(async () => {
      const proximo = fila.shift()
      return proximo ? { job: proximo, takeover: false } : null
    }),
    heartbeat: vi.fn(async () => true),
    markTransmissionStarted: vi.fn(async () => true),
    complete: vi.fn(async () => true),
    retry: vi.fn(async () => true),
    fail: vi.fn(async () => true),
    waitForConsultation: vi.fn(async () => true),
    pauseStoreForThrottling: vi.fn(async () => true),
    parkThrottled: vi.fn(async () => true),
    rescheduleProcessingConsultation: vi.fn(async () => input.rescheduleOk ?? true),
    execute: vi.fn(async () => input.execution ?? RESULTADO_PROCESSING),
    audit: vi.fn(async () => undefined),
  } as unknown as Portas
  if (input.semPortaDeReagendamento) {
    delete (base as Partial<FiscalQueueWorkerPorts>).rescheduleProcessingConsultation
  }
  return base
}

function drenar(ports: FiscalQueueWorkerPorts, batchSize = 1) {
  return drainFiscalQueue({ workerId: "w1", batchSize, now: () => AGORA }, ports)
}

describe("105 em CONSULTA reagenda o MESMO job", () => {
  it("reagenda para no mínimo now + 15 s", async () => {
    const ports = portas()
    const report = await drenar(ports)

    expect(report.processingRescheduled).toBe(1)
    expect(report.items[0]?.status).toBe("reconsulta")

    const chamada = ports.rescheduleProcessingConsultation.mock.calls[0]![0]
    const atraso = chamada.nextAttemptAt.getTime() - AGORA.getTime()
    expect(atraso).toBeGreaterThanOrEqual(15_000)
    expect(FISCAL_RECONSULTA_MIN_DELAY_MS).toBe(15_000)
  })

  it("preserva o mesmo job, o mesmo dedupeKey e o mesmo recibo", async () => {
    const ports = portas()
    await drenar(ports)
    const chamada = ports.rescheduleProcessingConsultation.mock.calls[0]![0]
    expect(chamada.job.id).toBe("job-consulta")
    expect(chamada.job.tipo).toBe("CONSULTA")
    expect(chamada.job.dedupeKey).toBe("fiscal:consulta:v1:nota:nota-1")
    expect(chamada.recibo).toBe(RECIBO)
  })

  it("NÃO chama waitForConsultation — era ali que o job morria", async () => {
    const ports = portas()
    await drenar(ports)
    expect(ports.waitForConsultation).not.toHaveBeenCalled()
  })

  it("NÃO usa retry, fail, complete nem o caminho de throttle", async () => {
    const ports = portas()
    const report = await drenar(ports)
    expect(ports.retry).not.toHaveBeenCalled()
    expect(ports.fail).not.toHaveBeenCalled()
    expect(ports.complete).not.toHaveBeenCalled()
    expect(ports.parkThrottled).not.toHaveBeenCalled()
    expect(ports.pauseStoreForThrottling).not.toHaveBeenCalled()
    expect(report).toMatchObject({ retried: 0, failed: 0, completed: 0, awaitingConsultation: 0 })
  })

  it("nenhuma EMISSAO nova nasce daqui — a fila sequer tem porta que crie job", async () => {
    const ports = portas()
    await drenar(ports)
    // O contrato do worker não possui nenhuma porta de criação; a única escrita é sobre o job
    // já adquirido, e ela mantém `tipo: CONSULTA`.
    const portasQueEscrevem = Object.keys(ports).filter((nome) => /create|enqueue|produce/i.test(nome))
    expect(portasQueEscrevem).toEqual([])
    expect(ports.rescheduleProcessingConsultation.mock.calls[0]![0].job.tipo).toBe("CONSULTA")
  })

  it("audita o reagendamento com recibo e horário", async () => {
    const ports = portas()
    await drenar(ports)
    const evento = ports.audit.mock.calls
      .map((c) => c[0])
      .find((e) => e.acao === "fiscal.queue.processing.rescheduled")
    expect(evento).toBeTruthy()
    expect(evento?.detalhe?.recibo).toBe(RECIBO)
  })
})

describe("elegibilidade real do job reagendado", () => {
  /**
   * Avalia a cláusula `AGUARDANDO_RETRY` do filtro REAL da fila. Não é uma reimplementação da
   * regra: os operadores vêm de `eligibleWhere`, e o teste apenas os aplica a um job.
   */
  function elegivelComoAguardandoRetry(proximaTentativaEm: Date | null, agora: Date): boolean {
    const where = eligibleWhere(agora, []) as { OR: Array<Record<string, unknown>> }
    const clausula = where.OR.find((c) => c.status === "AGUARDANDO_RETRY") as {
      proximaTentativaEm: { not: null; lte: Date }
    }
    // Espelha exatamente os dois operadores declarados na cláusula.
    expect(clausula.proximaTentativaEm).toEqual({ not: null, lte: agora })
    if (proximaTentativaEm === null) return false
    return proximaTentativaEm.getTime() <= clausula.proximaTentativaEm.lte.getTime()
  }

  const reagendadoPara = new Date(AGORA.getTime() + FISCAL_RECONSULTA_MIN_DELAY_MS)

  it("ANTES do horário permanece inelegível", () => {
    const umSegundoAntes = new Date(reagendadoPara.getTime() - 1_000)
    expect(elegivelComoAguardandoRetry(reagendadoPara, umSegundoAntes)).toBe(false)
  })

  it("NO horário volta a ser elegível", () => {
    expect(elegivelComoAguardandoRetry(reagendadoPara, reagendadoPara)).toBe(true)
  })

  it("DEPOIS do horário continua elegível", () => {
    const depois = new Date(reagendadoPara.getTime() + 60_000)
    expect(elegivelComoAguardandoRetry(reagendadoPara, depois)).toBe(true)
  })

  it("REGRESSÃO: proximaTentativaEm nulo (o que waitForConsultation gravava) é inelegível para sempre", () => {
    expect(elegivelComoAguardandoRetry(null, reagendadoPara)).toBe(false)
    expect(elegivelComoAguardandoRetry(null, new Date(reagendadoPara.getTime() + 86_400_000))).toBe(
      false,
    )
  })
})

describe("reagendamento fail-closed", () => {
  it("falha ao reagendar mantém o lock e aborta a drenagem", async () => {
    const ports = portas({
      rescheduleOk: false,
      jobs: [job(), job({ id: "job-consulta-2" })],
    })
    const report = await drenar(ports, 5)

    expect(report.processingRescheduleFailed).toBe(1)
    expect(report.items).toHaveLength(1)
    // Nada foi liberado por outro caminho...
    expect(ports.waitForConsultation).not.toHaveBeenCalled()
    expect(ports.fail).not.toHaveBeenCalled()
    expect(ports.retry).not.toHaveBeenCalled()
    // ...e o segundo job sequer chegou a ser adquirido.
    expect(ports.acquireNextJob).toHaveBeenCalledTimes(1)
  })

  it("exceção na porta é tratada como falha, não como sucesso", async () => {
    const ports = portas()
    ports.rescheduleProcessingConsultation.mockRejectedValue(new Error("banco indisponível"))
    const report = await drenar(ports)
    expect(report.processingRescheduleFailed).toBe(1)
    expect(ports.waitForConsultation).not.toHaveBeenCalled()
  })

  it("fila SEM a porta falha fechada em vez de estacionar para sempre", async () => {
    const ports = portas({ semPortaDeReagendamento: true })
    const report = await drenar(ports)
    expect(report.processingRescheduleFailed).toBe(1)
    expect(ports.waitForConsultation).not.toHaveBeenCalled()
    const acoes = ports.audit.mock.calls.map((c) => c[0].acao)
    expect(acoes).toContain("fiscal.queue.processing.reschedule_unavailable")
  })

  it("processing de provider externo NÃO é rebaixado a terminal pelo freio do GOAL-011", async () => {
    // `RESULTADO_PROCESSING.simulado === false`. Rebaixar produziria FALHA — reprocessável —,
    // abrindo justamente o caminho de retransmissão que o lote em processamento proíbe.
    const ports = portas()
    const report = await drenar(ports)
    expect(report.processingRescheduled).toBe(1)
    expect(ports.fail).not.toHaveBeenCalled()
  })
})
