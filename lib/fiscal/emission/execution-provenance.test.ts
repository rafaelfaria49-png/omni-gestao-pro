/**
 * GOAL-016D-A — proveniência de execução e gate de execução externa
 * (plano 016D **F-1/F-2** · correção 002 · bloqueios 2 e 3).
 *
 * Três defeitos são cobertos aqui:
 *
 *  - **F-2 original**: `simulado`/`externalTransmissionAttempted` eram LITERAIS nos retornos do
 *    executor e mentiriam assim que houvesse transmissão real.
 *  - **Bloqueio 3**: a primeira correção guardou a proveniência num campo MUTÁVEL do provider,
 *    acumulado monotonicamente. Isso responde "alguma execução desta instância já tentou
 *    rede?" — não "esta execução tentou?". Sob reuso de instância, jobs se contaminavam.
 *  - **Bloqueio 2**: a autorização derivava de `if (!provider.simulado)`, um rótulo
 *    autodeclarado. Um provider real que mentisse era autorizado.
 */
import { describe, expect, it, vi } from "vitest"
import {
  createUncertainStateJobExecutor,
  auditFlagsFromProvenance,
} from "./uncertain-state-job-executor"
import {
  fiscalBytesSha256,
  fiscalXmlBytes,
  transmitWithUncertainStateSafety,
} from "./uncertain-state-coordinator"
import {
  EXTERNAL_EXECUTION_DENIED,
  IN_MEMORY_ONLY_FISCAL_PROVIDER,
  PROVIDER_NOT_INVOKED_PROVENANCE,
  type FinalizedDocumentPreparer,
  type FiscalExternalExecutionCapability,
  type PersistedFiscalDocument,
  type UncertainStateFiscalProvider,
  type UncertainStatePersistence,
} from "./uncertain-state.types"
import type { FiscalQueueJob } from "../queue/queue.types"

const XML = "<NFe><infNFe><ide><tpAmb>2</tpAmb></ide></infNFe></NFe>"
const SHA = fiscalBytesSha256(fiscalXmlBytes(XML))

/** Concessão explícita — existe SOMENTE em teste, para provar que a propagação funciona. */
const CAPABILITY_DE_TESTE: FiscalExternalExecutionCapability = {
  allowExternalProviderExecution: true,
  concedidaPor: "teste",
}

type ProviderFake = UncertainStateFiscalProvider & { transmit: ReturnType<typeof vi.fn> }

/**
 * Provider dublê. Por default NÃO carrega a marca de "somente memória" — ou seja, é tratado
 * como externo e precisa de capability, exatamente como o adapter real.
 */
function providerFalso(
  overrides: Partial<UncertainStateFiscalProvider> & { inMemory?: boolean } = {},
): ProviderFake {
  const { inMemory, ...resto } = overrides
  const base: Record<PropertyKey, unknown> = {
    simulado: true,
    transmit: vi.fn(),
    consult: vi.fn(),
    ...resto,
  }
  if (inMemory) base[IN_MEMORY_ONLY_FISCAL_PROVIDER] = true
  return base as unknown as ProviderFake
}

function documentoPersistido(): PersistedFiscalDocument {
  return {
    storeId: "loja-x",
    vendaId: "venda-1",
    notaFiscalId: "nota-1",
    modelo: "NFCE",
    ambiente: "HOMOLOGACAO",
    serie: 1,
    numero: 1,
    chaveAcesso: "3".repeat(44),
    status: "TRANSMITINDO",
    xmlAssinado: XML,
    xmlBytesSha256: SHA,
  }
}

function persistenciaQuePermiteTransmitir(
  documento: PersistedFiscalDocument = documentoPersistido(),
): UncertainStatePersistence {
  return {
    load: vi.fn(async () => documento),
    persistBeforeTransmission: vi.fn(async () => documento),
    recordUncertainAndEnsureConsultation: vi.fn(async () => ({
      consultationJobId: "consulta-1",
      created: true,
    })),
    markAuthorized: vi.fn(async () => undefined),
    markRejected: vi.fn(async () => undefined),
    authorizeExactRetransmission: vi.fn(async () => undefined),
  } as unknown as UncertainStatePersistence
}

const preparerInerte = { prepare: vi.fn() } as unknown as FinalizedDocumentPreparer

function job(overrides: Partial<FiscalQueueJob> = {}): FiscalQueueJob {
  return {
    id: "job-1",
    storeId: "loja-x",
    vendaId: "venda-1",
    notaFiscalId: "nota-1",
    tipo: "EMISSAO",
    status: "PROCESSANDO",
    tentativas: 1,
    maxTentativas: 3,
    proximaTentativaEm: null,
    prioridade: 0,
    lockOwner: "w1",
    lockedAt: null,
    lockExpiresAt: null,
    dedupeKey: null,
    payload: { version: 2 },
    ultimoErro: null,
    concluidoEm: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

describe("auditFlagsFromProvenance — derivação, não literal", () => {
  it("provider não invocado ⇒ execução não-real e sem tentativa externa", () => {
    expect(auditFlagsFromProvenance(PROVIDER_NOT_INVOKED_PROVENANCE)).toEqual({
      simulado: true,
      externalTransmissionAttempted: false,
      // `providerInvoked` passou a ser propagado ao contrato da fila (correção 003): é o que
      // permite ao worker distinguir repetição segura de consulta de execução que nem começou.
      providerInvoked: false,
    })
  })

  it("`simulado` REFLETE o provider que executou — não é constante", () => {
    expect(
      auditFlagsFromProvenance({
        providerInvoked: true,
        providerSimulado: false,
        externalTransmissionAttempted: false,
      }).simulado,
    ).toBe(false)
  })

  it("a derivação PRECISA ser capaz de propagar `true` (senão é o próprio F-2)", () => {
    expect(
      auditFlagsFromProvenance({
        providerInvoked: true,
        providerSimulado: false,
        externalTransmissionAttempted: true,
      }).externalTransmissionAttempted,
    ).toBe(true)
  })
})

describe("gate de execução externa — `simulado` não autoriza nem bloqueia (bloqueio 2)", () => {
  it("provider externo SEM capability é bloqueado, mesmo declarando simulado=true", async () => {
    /**
     * O caso que a mecânica antiga liberava: um provider real que mentisse `simulado: true`
     * era autorizado a transmitir. Agora o rótulo é irrelevante — falta a marca estrutural.
     */
    const provider = providerFalso({ simulado: true })
    const outcome = await transmitWithUncertainStateSafety({
      locator: { storeId: "loja-x", vendaId: "venda-1", notaFiscalId: "nota-1" },
      persistence: persistenciaQuePermiteTransmitir(),
      preparer: preparerInerte,
      provider,
    })
    expect(outcome).toMatchObject({
      kind: "blocked",
      code: "EXTERNAL_EXECUTION_NOT_AUTHORIZED",
    })
    expect(provider.transmit).not.toHaveBeenCalled()
  })

  it("provider em memória executa mesmo declarando simulado=false", async () => {
    /**
     * O espelho do caso acima: um stub honesto que se declarasse "não simulado" era barrado
     * pela mecânica antiga. A autorização não depende mais desse rótulo.
     */
    const provider = providerFalso({
      simulado: false,
      inMemory: true,
      transmit: vi.fn(async () => ({
        outcome: "AUTHORIZED" as const,
        protocolo: "p",
        cStat: "100",
        xMotivo: "ok",
        xmlAutorizado: "<nfeProc/>",
      })),
    })
    const outcome = await transmitWithUncertainStateSafety({
      locator: { storeId: "loja-x", vendaId: "venda-1", notaFiscalId: "nota-1" },
      persistence: persistenciaQuePermiteTransmitir(),
      preparer: preparerInerte,
      provider,
      retryAuthorizedByConsultation: true,
    })
    expect(outcome.kind).toBe("authorized")
    expect(provider.transmit).toHaveBeenCalled()
    // O rótulo continua na trilha, apenas sem poder de decisão.
    expect(outcome.provenance.providerSimulado).toBe(false)
  })

  it("a capability default do slice é NEGADA", () => {
    expect(EXTERNAL_EXECUTION_DENIED.allowExternalProviderExecution).toBe(false)
  })

  it("capability explicitamente negada não libera provider externo", async () => {
    const provider = providerFalso({ simulado: false })
    const outcome = await transmitWithUncertainStateSafety({
      locator: { storeId: "loja-x", vendaId: "venda-1", notaFiscalId: "nota-1" },
      persistence: persistenciaQuePermiteTransmitir(),
      preparer: preparerInerte,
      provider,
      capability: { allowExternalProviderExecution: false, concedidaPor: "negada" },
    })
    expect(outcome).toMatchObject({ code: "EXTERNAL_EXECUTION_NOT_AUTHORIZED" })
    expect(provider.transmit).not.toHaveBeenCalled()
  })
})

describe("proveniência é ESCOPADA POR EXECUÇÃO (bloqueio 3)", () => {
  /** Provider que reporta contato externo somente quando mandado. */
  function providerQueTentaRede(tentar: () => boolean): UncertainStateFiscalProvider {
    return providerFalso({
      simulado: false,
      transmit: vi.fn(async (input: Parameters<UncertainStateFiscalProvider["transmit"]>[0]) => {
        if (tentar()) input.provenance?.recordExternalTransmissionAttempted()
        return {
          outcome: "UNCERTAIN" as const,
          code: "TIMEOUT" as const,
          message: "sem resposta",
        }
      }),
    })
  }

  it("uma execução que reporta true NÃO contamina a execução seguinte", async () => {
    let deveTentar = true
    const provider = providerQueTentaRede(() => deveTentar)
    const comum = {
      locator: { storeId: "loja-x", vendaId: "venda-1", notaFiscalId: "nota-1" },
      persistence: persistenciaQuePermiteTransmitir(),
      preparer: preparerInerte,
      provider,
      retryAuthorizedByConsultation: true,
      capability: CAPABILITY_DE_TESTE,
    }

    const primeira = await transmitWithUncertainStateSafety(comum)
    expect(primeira.provenance.externalTransmissionAttempted).toBe(true)

    // MESMA instância de provider, execução seguinte que não alcança a rede.
    deveTentar = false
    const segunda = await transmitWithUncertainStateSafety(comum)
    expect(segunda.provenance.externalTransmissionAttempted).toBe(false)
  })

  it("dois jobs CONCORRENTES na mesma instância não compartilham proveniência", async () => {
    /**
     * O cenário do worker pool. Com estado de instância, o job offline lia o registro do job
     * que tentou rede (ou o sobrescrevia). Com coletor por execução, cada um descreve a si.
     */
    const ordem: string[] = []
    const provider = providerFalso({
      simulado: false,
      transmit: vi.fn(async (input: Parameters<UncertainStateFiscalProvider["transmit"]>[0]) => {
        const tentaRede = input.document.vendaId === "venda-com-rede"
        // Cede o event loop no meio da execução para forçar entrelaçamento real.
        await new Promise((r) => setTimeout(r, tentaRede ? 5 : 1))
        if (tentaRede) input.provenance?.recordExternalTransmissionAttempted()
        ordem.push(input.document.vendaId)
        return { outcome: "UNCERTAIN" as const, code: "TIMEOUT" as const, message: "x" }
      }),
    })

    function execucao(vendaId: string) {
      const doc = { ...documentoPersistido(), vendaId }
      return transmitWithUncertainStateSafety({
        locator: { storeId: "loja-x", vendaId, notaFiscalId: "nota-1" },
        persistence: persistenciaQuePermiteTransmitir(doc),
        preparer: preparerInerte,
        provider,
        retryAuthorizedByConsultation: true,
        capability: CAPABILITY_DE_TESTE,
      })
    }

    const [comRede, semRede] = await Promise.all([
      execucao("venda-com-rede"),
      execucao("venda-sem-rede"),
    ])

    // Entrelaçamento de fato aconteceu (a offline terminou primeiro).
    expect(ordem).toEqual(["venda-sem-rede", "venda-com-rede"])
    expect(comRede.provenance.externalTransmissionAttempted).toBe(true)
    expect(semRede.provenance.externalTransmissionAttempted).toBe(false)
  })

  it("erro DEPOIS do transporte preserva a proveniência daquela tentativa", async () => {
    const provider = providerFalso({
      simulado: false,
      transmit: vi.fn(async (input: Parameters<UncertainStateFiscalProvider["transmit"]>[0]) => {
        input.provenance?.recordExternalTransmissionAttempted()
        throw new Error("conexão caiu depois de enviar")
      }),
    })
    const { fiscalExecutionProvenanceOf } = await import("./uncertain-state-coordinator")

    const erro = await transmitWithUncertainStateSafety({
      locator: { storeId: "loja-x", vendaId: "venda-1", notaFiscalId: "nota-1" },
      persistence: persistenciaQuePermiteTransmitir(),
      preparer: preparerInerte,
      provider,
      retryAuthorizedByConsultation: true,
      capability: CAPABILITY_DE_TESTE,
    }).catch((e: unknown) => e)

    expect(erro).toBeInstanceOf(Error)
    const proveniencia = fiscalExecutionProvenanceOf(erro)
    // Perder isto seria perder o registro de uma transmissão que pode ter chegado à SEFAZ.
    expect(proveniencia?.externalTransmissionAttempted).toBe(true)
    expect(proveniencia?.providerInvoked).toBe(true)
  })

  it("atalho idempotente (já AUTORIZADA) não conta como invocação", async () => {
    const autorizado = { ...documentoPersistido(), status: "AUTORIZADA" as const }
    const provider = providerFalso({ inMemory: true })

    const outcome = await transmitWithUncertainStateSafety({
      locator: { storeId: "loja-x", vendaId: "venda-1", notaFiscalId: "nota-1" },
      persistence: persistenciaQuePermiteTransmitir(autorizado),
      preparer: preparerInerte,
      provider,
    })

    expect(outcome).toMatchObject({ kind: "authorized", idempotent: true })
    expect(provider.transmit).not.toHaveBeenCalled()
    expect(outcome.provenance.providerInvoked).toBe(false)
    expect(outcome.provenance.externalTransmissionAttempted).toBe(false)
  })
})

describe("executor — bloqueio antes do transporte registra false", () => {
  const persistence = {
    load: vi.fn(async () => null),
    persistBeforeTransmission: vi.fn(),
    recordUncertainAndEnsureConsultation: vi.fn(),
    markAuthorized: vi.fn(),
    markRejected: vi.fn(),
    authorizeExactRetransmission: vi.fn(),
  } as unknown as UncertainStatePersistence

  it("provider externo bloqueado pelo gate ⇒ externalTransmissionAttempted=false", async () => {
    const executor = createUncertainStateJobExecutor({
      persistence,
      preparer: preparerInerte,
      provider: providerFalso({ simulado: false }),
    })
    const resultado = await executor(job())
    expect(resultado.kind).toBe("terminal")
    expect(resultado.code).toBe("external_execution_not_authorized")
    expect(resultado.externalTransmissionAttempted).toBe(false)
  })

  it("job sem notaFiscalId e tipo não suportado também registram false", async () => {
    const executor = createUncertainStateJobExecutor({
      persistence,
      preparer: preparerInerte,
      provider: providerFalso({ simulado: false }),
    })
    const semNota = await executor(job({ notaFiscalId: null }))
    expect(semNota.externalTransmissionAttempted).toBe(false)

    const tipoErrado = await executor(job({ tipo: "CANCELAMENTO" }))
    expect(tipoErrado.externalTransmissionAttempted).toBe(false)
  })

  it("nenhum caminho do slice produz externalTransmissionAttempted = true", async () => {
    const executor = createUncertainStateJobExecutor({
      persistence,
      preparer: preparerInerte,
      provider: providerFalso({ simulado: false }),
    })
    const resultados = [
      await executor(job()),
      await executor(job({ notaFiscalId: null })),
      await executor(job({ tipo: "INUTILIZACAO" })),
    ]
    for (const r of resultados) expect(r.externalTransmissionAttempted).toBe(false)
  })
})
