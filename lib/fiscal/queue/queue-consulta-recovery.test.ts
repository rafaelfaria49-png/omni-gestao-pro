/**
 * GOAL-016D-B · correção 003 — recuperação de consultas inconclusivas.
 *
 * ## O padrão que se repetiu três vezes
 *
 * `waitForConsultation` grava `AGUARDANDO_RETRY` + `proximaTentativaEm: null`, e
 * `eligibleWhere` exige `not: null` **e** vencido para readquirir nesse status. Logo esse
 * estado é **absorvente**: quem cai ali não roda nunca mais, e `reprocessFailedFiscalJob` só
 * alcança `FALHA`. Três caminhos distintos desembocavam nele:
 *
 *  1. job `CONSULTA` com `103/105` — corrigido na correção 002 (reconsulta dedicada);
 *  2. job `CONSULTA` com desfecho **inconclusivo** (SOAP Fault, XML ilegível, `108/109`,
 *     `UNKNOWN`) — corrigido aqui: vira `transient`, porque repetir uma LEITURA é seguro;
 *  3. job `CONSULTA` cuja execução **lançou exceção** — o executor já devolvia `transient`,
 *     mas o freio do GOAL-011 o rebaixava a `terminal` quando o provider não era simulado.
 *
 * E um quarto caso, de natureza oposta: transmissão incerta **sem consulta garantida**, que
 * seguia pelo estacionamento genérico afirmando aguardar uma consulta inexistente.
 */
import { describe, expect, it, vi } from "vitest"
import { drainFiscalQueue } from "./queue-worker"
import { createUncertainStateJobExecutor } from "../emission/uncertain-state-job-executor"
import { fiscalBytesSha256, fiscalXmlBytes } from "../emission/uncertain-state-coordinator"
import {
  IN_MEMORY_ONLY_FISCAL_PROVIDER,
  type FinalizedDocumentPreparer,
  type FiscalConsultationResult,
  type PersistedFiscalDocument,
  type UncertainStateFiscalProvider,
  type UncertainStatePersistence,
} from "../emission/uncertain-state.types"
import type {
  FiscalQueueExecutionResult,
  FiscalQueueJob,
  FiscalQueueWorkerPorts,
} from "./queue.types"

const XML = "<NFe><infNFe><ide><tpAmb>2</tpAmb></ide></infNFe></NFe>"
const SHA = fiscalBytesSha256(fiscalXmlBytes(XML))
const CHAVE = "35990199999999999999650999000000001199999999"

function documento(): PersistedFiscalDocument {
  return {
    storeId: "loja-piloto",
    vendaId: "venda-1",
    notaFiscalId: "nota-1",
    modelo: "NFCE",
    ambiente: "HOMOLOGACAO",
    serie: 1,
    numero: 1,
    chaveAcesso: CHAVE,
    status: "TRANSMITINDO",
    xmlAssinado: XML,
    xmlBytesSha256: SHA,
  }
}

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
    createdAt: new Date("2026-01-01T10:00:00Z"),
    updatedAt: new Date("2026-01-01T10:00:00Z"),
    ...overrides,
  }
}

type Portas = FiscalQueueWorkerPorts & {
  retry: ReturnType<typeof vi.fn>
  fail: ReturnType<typeof vi.fn>
  complete: ReturnType<typeof vi.fn>
  waitForConsultation: ReturnType<typeof vi.fn>
  parkUnresolvedTransmission: ReturnType<typeof vi.fn>
  parkThrottled: ReturnType<typeof vi.fn>
  pauseStoreForThrottling: ReturnType<typeof vi.fn>
  rescheduleProcessingConsultation: ReturnType<typeof vi.fn>
  acquireNextJob: ReturnType<typeof vi.fn>
  audit: ReturnType<typeof vi.fn>
}

function portas(input: {
  jobs: FiscalQueueJob[]
  execute: FiscalQueueWorkerPorts["execute"]
  parkUnresolvedOk?: boolean
  semPortaDeEstacionamento?: boolean
}): Portas {
  const fila = [...input.jobs]
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
    rescheduleProcessingConsultation: vi.fn(async () => true),
    parkUnresolvedTransmission: vi.fn(async () => input.parkUnresolvedOk ?? true),
    execute: input.execute,
    audit: vi.fn(async () => undefined),
  } as unknown as Portas
  if (input.semPortaDeEstacionamento) {
    delete (base as Partial<FiscalQueueWorkerPorts>).parkUnresolvedTransmission
  }
  return base
}

// ── Executor real, com provider dublê ───────────────────────────────────────────────────────

/**
 * ⚠️ `modo: "transmissao"` devolve `load: null` de propósito. Um documento já em
 * `TRANSMITINDO` é bloqueado pelo coordenador com `CONSULTATION_REQUIRED` **antes** de o
 * provider ser invocado — trava do GOAL-012 que estes testes não exercitam. O caminho aqui é o
 * de primeira transmissão: preparar → persistir → transmitir.
 */
function persistencia(
  opcoes: { consultaFalha?: boolean; modo?: "transmissao" | "consulta" } = {},
) {
  const doc = documento()
  const modo = opcoes.modo ?? "consulta"
  return {
    load: vi.fn(async () => (modo === "consulta" ? doc : null)),
    persistBeforeTransmission: vi.fn(async () => doc),
    recordUncertainAndEnsureConsultation: vi.fn(async () => {
      if (opcoes.consultaFalha) throw new Error("banco indisponível ao criar consulta")
      return { consultationJobId: "consulta-1", created: true }
    }),
    markAuthorized: vi.fn(async () => undefined),
    markRejected: vi.fn(async () => undefined),
    authorizeExactRetransmission: vi.fn(async () => undefined),
  } as unknown as UncertainStatePersistence & {
    authorizeExactRetransmission: ReturnType<typeof vi.fn>
    recordUncertainAndEnsureConsultation: ReturnType<typeof vi.fn>
  }
}

function preparerReal(): FinalizedDocumentPreparer {
  const doc = documento()
  return {
    prepare: vi.fn(async () => ({
      storeId: doc.storeId,
      vendaId: doc.vendaId,
      notaFiscalId: doc.notaFiscalId,
      modelo: doc.modelo,
      ambiente: doc.ambiente,
      serie: doc.serie,
      numero: doc.numero,
      chaveAcesso: doc.chaveAcesso,
      xmlAssinado: XML,
    })),
  } as unknown as FinalizedDocumentPreparer
}

const preparerInerte = { prepare: vi.fn() } as unknown as FinalizedDocumentPreparer

/**
 * Provider dublê de consulta.
 *
 * `simulado` é parametrizável porque o freio do GOAL-011 reage a ele: com `false`, desfechos
 * CONCLUSIVOS (`success`) são legitimamente rebaixados a `terminal`. Os testes que medem
 * roteamento usam `simulado: true`; os que medem proveniência e o próprio freio usam `false`.
 */
function providerDeConsulta(input: {
  resposta?: FiscalConsultationResult
  lanca?: boolean
  contatoExterno?: boolean
  simulado?: boolean
}): UncertainStateFiscalProvider {
  return {
    simulado: input.simulado ?? true,
    [IN_MEMORY_ONLY_FISCAL_PROVIDER]: true as const,
    transmit: vi.fn(),
    async consult(chamada: Parameters<UncertainStateFiscalProvider["consult"]>[0]) {
      if (input.contatoExterno ?? true) chamada.provenance?.recordExternalTransmissionAttempted()
      if (input.lanca) throw new Error("conexão perdida durante a consulta")
      return input.resposta!
    },
  } as unknown as UncertainStateFiscalProvider
}

function executorDeConsulta(provider: UncertainStateFiscalProvider) {
  return createUncertainStateJobExecutor({
    persistence: persistencia(),
    preparer: preparerInerte,
    provider,
  })
}

// ── 1. Exceção em CONSULTA continua repetível ──────────────────────────────────────────────

describe("exceção em CONSULTA continua transient até a fila", () => {
  it("chama retry, não fail, não waitForConsultation — e preserva a proveniência real", async () => {
    // `simulado: false` de propósito: é o provider REAL que o freio do GOAL-011 rebaixaria.
    const executar = executorDeConsulta(providerDeConsulta({ lanca: true, simulado: false }))
    const ports = portas({ jobs: [job()], execute: executar })

    const report = await drainFiscalQueue({ workerId: "w1", batchSize: 1 }, ports)

    expect(report.retried).toBe(1)
    expect(ports.retry).toHaveBeenCalledTimes(1)
    expect(ports.fail).not.toHaveBeenCalled()
    expect(ports.waitForConsultation).not.toHaveBeenCalled()

    // O freio do GOAL-011 não converteu em terminal, e a trilha continua honesta.
    const payload = ports.retry.mock.calls[0]![0].payload as Record<string, unknown>
    expect((payload.transmission as Record<string, unknown>).external).toBe(true)
    expect((payload.lastExecution as Record<string, unknown>).code).toBe("consulta_interrompida")
  })

  it("a mesma exceção numa EMISSAO NÃO ganha retry — lá repetir pode duplicar", async () => {
    const provider = {
      simulado: false,
      [IN_MEMORY_ONLY_FISCAL_PROVIDER]: true as const,
      async transmit(chamada: Parameters<UncertainStateFiscalProvider["transmit"]>[0]) {
        chamada.provenance?.recordExternalTransmissionAttempted()
        throw new Error("conexão perdida durante a transmissão")
      },
      consult: vi.fn(),
    } as unknown as UncertainStateFiscalProvider

    const store = persistencia({ modo: "transmissao" })
    const executar = createUncertainStateJobExecutor({
      persistence: store,
      preparer: preparerReal(),
      provider,
    })
    const ports = portas({ jobs: [job({ id: "job-emissao", tipo: "EMISSAO" })], execute: executar })

    const report = await drainFiscalQueue({ workerId: "w1", batchSize: 1 }, ports)

    expect(ports.retry).not.toHaveBeenCalled()
    expect(report.awaitingConsultation).toBe(1)
    expect(ports.waitForConsultation).toHaveBeenCalledTimes(1)
  })
})

// ── 2. Consulta inconclusiva vira retry de leitura ─────────────────────────────────────────

describe("consulta inconclusiva não espera por si mesma", () => {
  const inconclusivos: Array<[string, FiscalConsultationResult]> = [
    [
      "SOAP Fault",
      { outcome: "UNCERTAIN", code: "UNKNOWN", message: "Resposta SEFAZ é um SOAP Fault." },
    ],
    [
      "XML malformado",
      { outcome: "UNCERTAIN", code: "UNKNOWN", message: "Resposta SEFAZ não é XML bem-formado." },
    ],
    [
      "serviço indisponível (108/109)",
      { outcome: "UNCERTAIN", code: "UNKNOWN", message: "cStat 108 classificado como UNCERTAIN." },
    ],
    [
      "cStat desconhecido",
      { outcome: "UNCERTAIN", code: "UNKNOWN", message: "cStat 999 não consta da matriz." },
    ],
    [
      "timeout",
      { outcome: "UNCERTAIN", code: "TIMEOUT", message: "Tempo excedido na consulta." },
    ],
  ]

  it.each(inconclusivos)("%s ⇒ retry de leitura, sem estacionar", async (_nome, resposta) => {
    const executar = executorDeConsulta(providerDeConsulta({ resposta }))
    const ports = portas({ jobs: [job()], execute: executar })

    const report = await drainFiscalQueue({ workerId: "w1", batchSize: 1 }, ports)

    expect(report.retried).toBe(1)
    expect(ports.waitForConsultation).not.toHaveBeenCalled()
    expect(ports.fail).not.toHaveBeenCalled()
    expect(ports.complete).not.toHaveBeenCalled()
  })

  it("a retomada de leitura NÃO autoriza retransmissão exata", async () => {
    const store = persistencia()
    const executar = createUncertainStateJobExecutor({
      persistence: store,
      preparer: preparerInerte,
      provider: providerDeConsulta({
        resposta: { outcome: "UNCERTAIN", code: "UNKNOWN", message: "SOAP Fault." },
      }),
    })
    await drainFiscalQueue({ workerId: "w1", batchSize: 1 }, portas({ jobs: [job()], execute: executar }))

    // Só `NOT_FOUND` explícito da SEFAZ pode liberar um novo envio.
    expect(store.authorizeExactRetransmission).not.toHaveBeenCalled()
  })

  it("os desfechos CONCLUSIVOS e os dedicados permanecem inalterados", async () => {
    // NOT_FOUND ⇒ sucesso, e é ele quem autoriza a retransmissão exata.
    const store = persistencia()
    const executarNotFound = createUncertainStateJobExecutor({
      persistence: store,
      preparer: preparerInerte,
      provider: providerDeConsulta({
        resposta: { outcome: "NOT_FOUND", cStat: "217", xMotivo: "NF-e nao consta." },
      }),
    })
    const portsNotFound = portas({ jobs: [job()], execute: executarNotFound })
    const notFound = await drainFiscalQueue({ workerId: "w1", batchSize: 1 }, portsNotFound)
    expect(notFound.completed).toBe(1)
    expect(store.authorizeExactRetransmission).toHaveBeenCalledTimes(1)
    expect(portsNotFound.retry).not.toHaveBeenCalled()

    // THROTTLED ⇒ pausa a loja, sem retry.
    const executarThrottled = executorDeConsulta(
      providerDeConsulta({
        resposta: {
          outcome: "UNCERTAIN",
          code: "THROTTLED",
          message: "Consumo indevido.",
          cStat: "656",
          xMotivo: "Rejeicao: Consumo Indevido",
        },
      }),
    )
    const portsThrottled = portas({ jobs: [job()], execute: executarThrottled })
    const throttled = await drainFiscalQueue({ workerId: "w1", batchSize: 1 }, portsThrottled)
    expect(throttled.throttled).toBe(1)
    expect(portsThrottled.retry).not.toHaveBeenCalled()
    expect(portsThrottled.pauseStoreForThrottling).toHaveBeenCalledTimes(1)

    // PROCESSING ⇒ reconsulta dedicada de 15 s, não o backoff genérico.
    const executarProcessing = executorDeConsulta(
      providerDeConsulta({
        resposta: {
          outcome: "UNCERTAIN",
          code: "PROCESSING",
          message: "Lote em processamento.",
          cStat: "105",
          xMotivo: "Lote em processamento",
          recibo: "999000000000042",
          requiresConsultation: true,
        },
      }),
    )
    const portsProcessing = portas({ jobs: [job()], execute: executarProcessing })
    const processing = await drainFiscalQueue({ workerId: "w1", batchSize: 1 }, portsProcessing)
    expect(processing.processingRescheduled).toBe(1)
    expect(portsProcessing.retry).not.toHaveBeenCalled()
    expect(portsProcessing.waitForConsultation).not.toHaveBeenCalled()
  })

  it("maxTentativas esgotado continua fail-closed, sem retransmitir", async () => {
    const executar = executorDeConsulta(
      providerDeConsulta({
        resposta: { outcome: "UNCERTAIN", code: "UNKNOWN", message: "SOAP Fault." },
      }),
    )
    // `tentativas > maxTentativas` é avaliado no topo do processamento, antes da execução.
    const ports = portas({
      jobs: [job({ tentativas: 11, maxTentativas: 10 })],
      execute: executar,
    })
    const report = await drainFiscalQueue({ workerId: "w1", batchSize: 1 }, ports)

    expect(report.failed).toBe(1)
    expect(ports.fail).toHaveBeenCalledTimes(1)
    expect(ports.retry).not.toHaveBeenCalled()
  })
})

// ── 3. Consulta não garantida exige alarme honesto ─────────────────────────────────────────

describe("transmissão incerta SEM consulta garantida", () => {
  function executorDeEmissaoQueFalha(consultaFalha: boolean) {
    const store = persistencia({ consultaFalha, modo: "transmissao" })
    const provider = {
      simulado: false,
      [IN_MEMORY_ONLY_FISCAL_PROVIDER]: true as const,
      async transmit(chamada: Parameters<UncertainStateFiscalProvider["transmit"]>[0]) {
        chamada.provenance?.recordExternalTransmissionAttempted()
        throw new Error("socket encerrado pelo par")
      },
      consult: vi.fn(),
    } as unknown as UncertainStateFiscalProvider
    return {
      store,
      executar: createUncertainStateJobExecutor({
        persistence: store,
        preparer: preparerReal(),
        provider,
      }),
    }
  }

  const jobEmissao = () => job({ id: "job-emissao", tipo: "EMISSAO" })

  it("consulta GARANTIDA segue pelo estacionamento normal", async () => {
    const { executar } = executorDeEmissaoQueFalha(false)
    const ports = portas({ jobs: [jobEmissao()], execute: executar })
    const report = await drainFiscalQueue({ workerId: "w1", batchSize: 1 }, ports)

    expect(report.awaitingConsultation).toBe(1)
    expect(report.unresolvedWithoutConsultation).toBe(0)
    expect(ports.waitForConsultation).toHaveBeenCalledTimes(1)
    expect(ports.parkUnresolvedTransmission).not.toHaveBeenCalled()
  })

  it("consulta NÃO garantida usa o caminho dedicado e NÃO chama waitForConsultation", async () => {
    const { executar } = executorDeEmissaoQueFalha(true)
    const ports = portas({ jobs: [jobEmissao()], execute: executar })
    const report = await drainFiscalQueue({ workerId: "w1", batchSize: 1 }, ports)

    expect(report.unresolvedWithoutConsultation).toBe(1)
    expect(report.items[0]?.status).toBe("sem_consulta")
    expect(ports.parkUnresolvedTransmission).toHaveBeenCalledTimes(1)
    expect(ports.waitForConsultation).not.toHaveBeenCalled()
    // Nem retry (retransmitiria) nem fail (seria reprocessável).
    expect(ports.retry).not.toHaveBeenCalled()
    expect(ports.fail).not.toHaveBeenCalled()
  })

  it("audita ERROR dizendo que a consulta não foi confirmada — sem a frase enganosa", async () => {
    const { executar } = executorDeEmissaoQueFalha(true)
    const ports = portas({ jobs: [jobEmissao()], execute: executar })
    await drainFiscalQueue({ workerId: "w1", batchSize: 1 }, ports)

    const evento = ports.audit.mock.calls
      .map((c) => c[0])
      .find((e) => e.acao === "fiscal.queue.uncertain.without_consultation")
    expect(evento?.nivel).toBe("ERROR")
    expect(evento?.detalhe?.consultationEnsured).toBe(false)

    for (const chamada of ports.audit.mock.calls) {
      expect(chamada[0].mensagem).not.toContain("até consulta deduplicada")
    }
    expect(ports.audit.mock.calls.map((c) => c[0].mensagem).join(" ")).toContain(
      "nenhuma autoridade automática",
    )
  })

  it("interrompe a drenagem após estacionar", async () => {
    const { executar } = executorDeEmissaoQueFalha(true)
    const ports = portas({
      jobs: [jobEmissao(), job({ id: "job-2", tipo: "EMISSAO" })],
      execute: executar,
    })
    const report = await drainFiscalQueue({ workerId: "w1", batchSize: 5 }, ports)

    expect(report.items).toHaveLength(1)
    expect(ports.acquireNextJob).toHaveBeenCalledTimes(1)
  })

  it("falha ao estacionar mantém o lock e aborta a drenagem", async () => {
    const { executar } = executorDeEmissaoQueFalha(true)
    const ports = portas({
      jobs: [jobEmissao(), job({ id: "job-2", tipo: "EMISSAO" })],
      execute: executar,
      parkUnresolvedOk: false,
    })
    const report = await drainFiscalQueue({ workerId: "w1", batchSize: 5 }, ports)

    expect(report.unresolvedParkFailed).toBe(1)
    expect(report.items).toHaveLength(1)
    expect(ports.acquireNextJob).toHaveBeenCalledTimes(1)
    expect(ports.fail).not.toHaveBeenCalled()
    expect(ports.retry).not.toHaveBeenCalled()
    expect(ports.waitForConsultation).not.toHaveBeenCalled()
  })

  it("fila SEM a porta dedicada falha fechada", async () => {
    const { executar } = executorDeEmissaoQueFalha(true)
    const ports = portas({
      jobs: [jobEmissao()],
      execute: executar,
      semPortaDeEstacionamento: true,
    })
    const report = await drainFiscalQueue({ workerId: "w1", batchSize: 1 }, ports)

    expect(report.unresolvedParkFailed).toBe(1)
    expect(ports.waitForConsultation).not.toHaveBeenCalled()
    expect(ports.fail).not.toHaveBeenCalled()
  })

  it("o payload persistido marca a transmissão como incerta", async () => {
    const { executar } = executorDeEmissaoQueFalha(true)
    const ports = portas({ jobs: [jobEmissao()], execute: executar })
    await drainFiscalQueue({ workerId: "w1", batchSize: 1 }, ports)

    const payload = ports.parkUnresolvedTransmission.mock.calls[0]![0].payload as Record<
      string,
      unknown
    >
    // `uncertainAt` é o que impede `canStartFiscalTransmission` de liberar novo envio.
    expect((payload.transmission as Record<string, unknown>).uncertainAt).toBeTruthy()
    expect((payload.transmission as Record<string, unknown>).external).toBe(true)
  })
})

// ── Invariante de escopo ───────────────────────────────────────────────────────────────────

describe("nenhum caminho novo transmite", () => {
  it("nenhum dos desfechos desta correção invoca transmissão", async () => {
    const transmit = vi.fn()
    const provider = {
      simulado: false,
      [IN_MEMORY_ONLY_FISCAL_PROVIDER]: true as const,
      transmit,
      async consult(chamada: Parameters<UncertainStateFiscalProvider["consult"]>[0]) {
        chamada.provenance?.recordExternalTransmissionAttempted()
        return {
          outcome: "UNCERTAIN",
          code: "UNKNOWN",
          message: "SOAP Fault.",
        } as FiscalConsultationResult
      },
    } as unknown as UncertainStateFiscalProvider

    const executar = createUncertainStateJobExecutor({
      persistence: persistencia(),
      preparer: preparerInerte,
      provider,
    })
    await drainFiscalQueue(
      { workerId: "w1", batchSize: 1 },
      portas({ jobs: [job()], execute: executar }),
    )

    expect(transmit).not.toHaveBeenCalled()
    expect(preparerInerte.prepare).not.toHaveBeenCalled()
  })

  it("o resultado de execução expõe providerInvoked derivado da proveniência", async () => {
    const executar = executorDeConsulta(
      providerDeConsulta({
        resposta: { outcome: "UNCERTAIN", code: "UNKNOWN", message: "SOAP Fault." },
        simulado: false,
      }),
    )
    const resultado: FiscalQueueExecutionResult = await executar(job())
    expect(resultado.providerInvoked).toBe(true)
    // Derivado do provider que de fato executou — não de literal.
    expect(resultado.simulado).toBe(false)
  })
})
