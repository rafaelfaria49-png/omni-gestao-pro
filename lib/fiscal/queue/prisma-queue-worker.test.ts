import { FiscalStatusVenda } from "@/generated/prisma"
import { describe, expect, it, vi } from "vitest"
import {
  createPrismaFiscalQueueWorkerPorts,
  createPrismaGoal012FiscalQueueWorkerPorts,
  readFiscalQueuePauseSnapshot,
} from "./prisma-queue-worker"
import type { FiscalQueueJob } from "./queue.types"

function jobRow(overrides: Partial<FiscalQueueJob> = {}): FiscalQueueJob {
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
    prioridade: 10,
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

function casClient(initial: FiscalQueueJob) {
  let current = { ...initial }
  const updateMany = vi.fn(async (args: {
    where: Record<string, unknown>
    data: Record<string, unknown>
  }) => {
    const now =
      ((args.where.OR as Array<Record<string, unknown>> | undefined)?.[0]?.AND as
        | Array<Record<string, unknown>>
        | undefined)?.[0] ?? null
    void now
    const isAcquire = typeof args.data.tentativas === "object"
    if (isAcquire) {
      const eligible =
        ["PENDENTE", "AGUARDANDO_RETRY"].includes(current.status) ||
        (current.status === "PROCESSANDO" &&
          current.lockExpiresAt != null &&
          current.lockExpiresAt.getTime() <= Date.parse("2026-07-23T00:00:00.000Z"))
      if (!eligible) return { count: 0 }
      current = {
        ...current,
        status: "PROCESSANDO",
        lockOwner: String(args.data.lockOwner),
        lockedAt: args.data.lockedAt as Date,
        lockExpiresAt: args.data.lockExpiresAt as Date,
        tentativas: current.tentativas + 1,
      }
      return { count: 1 }
    }
    const ownerMatches =
      current.status === "PROCESSANDO" &&
      current.lockOwner === args.where.lockOwner
    if (!ownerMatches) return { count: 0 }
    current = { ...current, ...args.data } as FiscalQueueJob
    return { count: 1 }
  })
  const client = {
    $transaction: async <T>(fn: (tx: never) => Promise<T>) => fn(client as never),
    fiscalEmissaoJob: {
      findMany: vi.fn(async () => [{ ...current }]),
      findUnique: vi.fn(async () => ({ ...current })),
      findFirst: vi.fn(async () => ({ ...current })),
      upsert: vi.fn(async () => ({ ...current })),
      updateMany,
    },
    fiscalLog: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      create: vi.fn(async () => ({})),
    },
    configuracaoFiscalLoja: {
      findUnique: vi.fn(async (): Promise<unknown | null> => null),
    },
    notaFiscal: {
      findFirst: vi.fn(async (): Promise<unknown | null> => null),
      updateMany: vi.fn(async () => ({ count: 1 })),
      create: vi.fn(),
    },
    notaFiscalItem: {
      findMany: vi.fn(async () => []),
      createMany: vi.fn(),
    },
    eventoFiscal: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: "ev-1" })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    venda: {
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  }
  return { client, updateMany, current: () => current }
}

describe("adapter Prisma da fila fiscal", () => {
  it("aquisição CAS deixa somente um de dois workers com o mesmo job", async () => {
    const state = casClient(jobRow())
    const ports = createPrismaFiscalQueueWorkerPorts(state.client as never)
    const input = {
      now: new Date("2026-07-23T00:00:00.000Z"),
      leaseMs: 60_000,
      pausedStoreIds: [],
    }

    const [first, second] = await Promise.all([
      ports.acquireNextJob({ ...input, workerId: "worker-a" }),
      ports.acquireNextJob({ ...input, workerId: "worker-b" }),
    ])

    expect([first, second].filter(Boolean)).toHaveLength(1)
    expect(state.current()).toMatchObject({
      status: "PROCESSANDO",
      tentativas: 1,
    })
    expect(state.client.fiscalEmissaoJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [
          { prioridade: "desc" },
          { proximaTentativaEm: "asc" },
          { createdAt: "asc" },
          { id: "asc" },
        ],
        take: 25,
      }),
    )
  })

  it("lock PROCESSANDO vencido permite takeover e incrementa tentativa", async () => {
    const state = casClient(
      jobRow({
        status: "PROCESSANDO",
        tentativas: 2,
        lockOwner: "worker-morto",
        lockedAt: new Date("2026-07-22T23:58:00.000Z"),
        lockExpiresAt: new Date("2026-07-22T23:59:00.000Z"),
      }),
    )
    const ports = createPrismaFiscalQueueWorkerPorts(state.client as never)

    const lease = await ports.acquireNextJob({
      workerId: "worker-recuperacao",
      now: new Date("2026-07-23T00:00:00.000Z"),
      leaseMs: 60_000,
      pausedStoreIds: [],
    })

    expect(lease?.takeover).toBe(true)
    expect(lease?.job).toMatchObject({
      tentativas: 3,
      lockOwner: "worker-recuperacao",
      status: "PROCESSANDO",
    })
  })

  it("operações de lock exigem o mesmo owner", async () => {
    const state = casClient(
      jobRow({
        status: "PROCESSANDO",
        lockOwner: "worker-a",
        lockExpiresAt: new Date("2026-07-23T00:01:00.000Z"),
      }),
    )
    const ports = createPrismaFiscalQueueWorkerPorts(state.client as never)

    expect(
      await ports.heartbeat({
        jobId: "job-1",
        workerId: "worker-b",
        now: new Date("2026-07-23T00:00:00.000Z"),
        leaseMs: 60_000,
      }),
    ).toBe(false)
    expect(
      await ports.complete({
        job: state.current(),
        workerId: "worker-b",
        now: new Date("2026-07-23T00:00:00.000Z"),
        payload: {},
      }),
    ).toBe(false)
    expect(state.current().lockOwner).toBe("worker-a")
  })

  it("executor chama somente o provider simulado em NFC-e/homologação", async () => {
    const state = casClient(
      jobRow({
        status: "PROCESSANDO",
        lockOwner: "worker-a",
        lockExpiresAt: new Date("2026-07-23T00:01:00.000Z"),
      }),
    )
    state.client.configuracaoFiscalLoja.findUnique.mockResolvedValue({
      provider: "STUB_HOMOLOGACAO",
      ambiente: "HOMOLOGACAO",
      modeloFiscal: "NFCE",
      fiscalEnabled: true,
    })
    state.client.notaFiscal.findFirst.mockResolvedValue({
      id: "nota-1",
      modelo: "NFCE",
      ambiente: "HOMOLOGACAO",
    })
    const emit = vi.fn(async () => ({
      ok: true,
      resultado: "autorizada",
      simulado: true,
      provider: "STUB_HOMOLOGACAO",
      fiscalStatusAnterior: FiscalStatusVenda.PENDENTE,
      fiscalStatusNovo: FiscalStatusVenda.AUTORIZADA,
      idempotente: false,
      notaFiscalId: "nota-1",
      dados: null,
      mensagem: "Autorização simulada.",
      pendencias: [],
      erros: [],
      errorCode: null,
      etapas: [],
      durationMs: 1,
    }))
    const ports = createPrismaFiscalQueueWorkerPorts(
      state.client as never,
      emit as never,
    )

    const result = await ports.execute(state.current())

    expect(result).toMatchObject({
      kind: "success",
      simulado: true,
      externalTransmissionAttempted: false,
    })
    expect(emit).toHaveBeenCalledWith({
      storeId: "store-matriz-fixture",
      vendaId: "venda-1",
      operador: "fiscal-queue:worker-a",
    })
  })

  it("executor bloqueia produção ou provider real antes de emitir", async () => {
    const state = casClient(jobRow())
    state.client.configuracaoFiscalLoja.findUnique.mockResolvedValue({
      provider: "SEFAZ_DIRETO",
      ambiente: "PRODUCAO",
      modeloFiscal: "NFCE",
      fiscalEnabled: true,
    })
    const emit = vi.fn()
    const ports = createPrismaFiscalQueueWorkerPorts(
      state.client as never,
      emit as never,
    )

    const result = await ports.execute(state.current())

    expect(result).toMatchObject({
      kind: "terminal",
      code: "contexto_simulado_obrigatorio",
      simulado: true,
      externalTransmissionAttempted: false,
    })
    expect(emit).not.toHaveBeenCalled()
  })

  it("payload v2 é roteado ao executor seguro sem chamar o pipeline legado", async () => {
    const state = casClient(
      jobRow({
        status: "PROCESSANDO",
        lockOwner: "worker-a",
        lockExpiresAt: new Date("2026-07-23T00:01:00.000Z"),
        payload: { version: 2, operation: "EMISSAO" },
      }),
    )
    state.client.configuracaoFiscalLoja.findUnique.mockResolvedValue({
      provider: "STUB_HOMOLOGACAO",
      ambiente: "HOMOLOGACAO",
      modeloFiscal: "NFCE",
      fiscalEnabled: true,
    })
    state.client.notaFiscal.findFirst.mockResolvedValue({
      id: "nota-1",
      modelo: "NFCE",
      ambiente: "HOMOLOGACAO",
    })
    const legacyEmit = vi.fn()
    const goal012 = vi.fn(async () => ({
      kind: "uncertain" as const,
      code: "timeout_simulado",
      mensagem: "consulta obrigatória",
      simulado: true as const,
      externalTransmissionAttempted: false,
    }))
    const ports = createPrismaFiscalQueueWorkerPorts(
      state.client as never,
      legacyEmit as never,
      goal012,
    )

    await expect(ports.execute(state.current())).resolves.toMatchObject({
      kind: "uncertain",
      code: "timeout_simulado",
    })
    expect(goal012).toHaveBeenCalledTimes(1)
    expect(legacyEmit).not.toHaveBeenCalled()
  })

  it("SEFAZ_DIRETO sem executor GOAL-012 é bloqueado e não cai no legado", async () => {
    const state = casClient(jobRow())
    state.client.configuracaoFiscalLoja.findUnique.mockResolvedValue({
      provider: "SEFAZ_DIRETO",
      ambiente: "HOMOLOGACAO",
      modeloFiscal: "NFCE",
      fiscalEnabled: true,
    })
    const emit = vi.fn()
    const ports = createPrismaFiscalQueueWorkerPorts(
      state.client as never,
      emit as never,
    )

    const result = await ports.execute(state.current())

    expect(result).toMatchObject({
      kind: "terminal",
      code: "goal012_executor_nao_configurado",
      simulado: true,
      externalTransmissionAttempted: false,
    })
    expect(emit).not.toHaveBeenCalled()
    expect(state.client.notaFiscal.findFirst).not.toHaveBeenCalled()
  })

  it("SEFAZ_DIRETO com executor alcança GOAL-012 mesmo em payload v1 e nunca chama o legado", async () => {
    const state = casClient(
      jobRow({
        status: "PROCESSANDO",
        lockOwner: "worker-a",
        lockExpiresAt: new Date("2026-07-23T00:01:00.000Z"),
        payload: { version: 1, operation: "EMISSAO" },
      }),
    )
    state.client.configuracaoFiscalLoja.findUnique.mockResolvedValue({
      provider: "SEFAZ_DIRETO",
      ambiente: "HOMOLOGACAO",
      modeloFiscal: "NFCE",
      fiscalEnabled: true,
    })
    state.client.notaFiscal.findFirst.mockResolvedValue({
      id: "nota-1",
      modelo: "NFCE",
      ambiente: "HOMOLOGACAO",
    })
    const emit = vi.fn()
    const goal012 = vi.fn(async () => ({
      kind: "terminal" as const,
      code: "external_execution_not_authorized",
      mensagem: "capability negada",
      simulado: true as const,
      externalTransmissionAttempted: false,
      providerInvoked: false,
    }))
    const ports = createPrismaFiscalQueueWorkerPorts(
      state.client as never,
      emit as never,
      goal012,
    )

    await expect(ports.execute(state.current())).resolves.toMatchObject({
      kind: "terminal",
      code: "external_execution_not_authorized",
      providerInvoked: false,
      externalTransmissionAttempted: false,
    })
    expect(goal012).toHaveBeenCalledTimes(1)
    expect(emit).not.toHaveBeenCalled()
  })

  it("INUTILIZACAO com SEFAZ_DIRETO sem provider injetado falha fechado (sem stub silencioso)", async () => {
    const state = casClient(jobRow({ tipo: "INUTILIZACAO" }))
    state.client.configuracaoFiscalLoja.findUnique.mockResolvedValue({
      provider: "SEFAZ_DIRETO",
      ambiente: "HOMOLOGACAO",
      modeloFiscal: "NFCE",
      fiscalEnabled: true,
    })
    const emit = vi.fn()
    const ports = createPrismaFiscalQueueWorkerPorts(state.client as never, emit as never)
    const result = await ports.execute(state.current())
    expect(result).toMatchObject({
      kind: "terminal",
      code: "inutilizacao_provider_nao_configurado",
      simulado: true,
      externalTransmissionAttempted: false,
    })
    expect(emit).not.toHaveBeenCalled()
  })

  it("createPrismaGoal012FiscalQueueWorkerPorts injeta o provider no caminho INUTILIZACAO", async () => {
    const state = casClient(
      jobRow({
        tipo: "INUTILIZACAO",
        payload: {
          version: 1,
          operation: "INUTILIZACAO",
          mark: "A_INUTILIZAR",
          storeId: "store-matriz-fixture",
          modelo: "NFCE",
          ambiente: "HOMOLOGACAO",
          serie: 1,
          numeroInicial: 1,
          numeroFinal: 1,
          justificativa: "Numero NFC-e rejeitado pela SEFAZ; faixa inutilizada para nao reutilizar.",
          motivo: "rejeicao_definitiva",
          notaFiscalId: "nota-1",
          vendaId: "venda-1",
          protocolo: null,
          cStat: null,
          xMotivo: null,
          inutilizadoEm: null,
          requestedAt: "2026-08-25T00:00:00.000Z",
          requestedBy: "op",
        },
      }),
    )
    state.client.configuracaoFiscalLoja.findUnique.mockResolvedValue({
      provider: "SEFAZ_DIRETO",
      ambiente: "HOMOLOGACAO",
      modeloFiscal: "NFCE",
      fiscalEnabled: true,
    })
    const inutilizar = vi.fn(async () => ({
      ok: false,
      operacao: "inutilizar",
      resultado: "erro",
      simulado: false,
      provider: "SEFAZ_DIRETO",
      ambiente: "HOMOLOGACAO",
      statusNota: null,
      dados: null,
      mensagem: "assinatura recusada no teste",
      pendencias: [],
      erros: [],
      eventos: [],
    }))
    const provider = {
      simulado: false,
      inutilizar,
      transmit: vi.fn(),
      consult: vi.fn(),
    }
    const ports = createPrismaGoal012FiscalQueueWorkerPorts(
      {
        persistence: {
          load: vi.fn(),
          persistBeforeTransmission: vi.fn(),
          recordUncertainAndEnsureConsultation: vi.fn(),
          markAuthorized: vi.fn(),
          markRejected: vi.fn(),
          authorizeExactRetransmission: vi.fn(),
        } as never,
        preparer: { prepare: vi.fn() },
        provider: provider as never,
      },
      state.client as never,
    )
    await ports.execute(state.current())
    expect(inutilizar).toHaveBeenCalled()
  })

  it("configuração inválida continua bloqueada (ambiente, modelo, flag)", async () => {
    const emit = vi.fn()
    const goal012 = vi.fn()
    const cases = [
      {
        provider: "SEFAZ_DIRETO",
        ambiente: "PRODUCAO",
        modeloFiscal: "NFCE",
        fiscalEnabled: true,
      },
      {
        provider: "SEFAZ_DIRETO",
        ambiente: "HOMOLOGACAO",
        modeloFiscal: "NFE",
        fiscalEnabled: true,
      },
      {
        provider: "STUB_HOMOLOGACAO",
        ambiente: "HOMOLOGACAO",
        modeloFiscal: "NFCE",
        fiscalEnabled: false,
      },
    ]
    for (const config of cases) {
      const state = casClient(jobRow())
      state.client.configuracaoFiscalLoja.findUnique.mockResolvedValue(config)
      const ports = createPrismaFiscalQueueWorkerPorts(
        state.client as never,
        emit as never,
        goal012,
      )
      await expect(ports.execute(state.current())).resolves.toMatchObject({
        kind: "terminal",
        code: "contexto_simulado_obrigatorio",
        externalTransmissionAttempted: false,
      })
    }
    expect(emit).not.toHaveBeenCalled()
    expect(goal012).not.toHaveBeenCalled()
  })
})

describe("leitura de pausa persistida", () => {
  it("usa o último evento por loja e respeita kill switch de ambiente", async () => {
    const previous = process.env.FISCAL_QUEUE_GLOBAL_PAUSED
    process.env.FISCAL_QUEUE_GLOBAL_PAUSED = "1"
    const client = {
      fiscalLog: {
        findFirst: vi.fn(async () => ({ detalhe: { paused: false } })),
        findMany: vi.fn(async () => [
          { storeId: "store-a", detalhe: { paused: false } },
          { storeId: "store-a", detalhe: { paused: true } },
          { storeId: "store-b", detalhe: { paused: true } },
        ]),
      },
    }
    try {
      const pause = await readFiscalQueuePauseSnapshot(client as never)
      expect(pause).toEqual({
        globalPaused: true,
        globalSource: "environment",
        pausedStoreIds: ["store-b"],
      })
    } finally {
      if (previous === undefined) delete process.env.FISCAL_QUEUE_GLOBAL_PAUSED
      else process.env.FISCAL_QUEUE_GLOBAL_PAUSED = previous
    }
  })
})
