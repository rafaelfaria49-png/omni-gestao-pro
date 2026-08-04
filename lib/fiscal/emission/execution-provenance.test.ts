/**
 * GOAL-016D-A — flags de auditoria derivadas de proveniência tipada (plano 016D **F-2**).
 *
 * O achado F-2 era que `simulado` e `externalTransmissionAttempted` eram LITERAIS nos sete
 * retornos do executor, de modo que a trilha registraria `false` mesmo depois de uma chamada
 * real à SEFAZ. Aqui provamos que ambos passam a derivar do que aconteceu — e que nenhum
 * caminho deste slice produz `externalTransmissionAttempted = true`.
 */
import { describe, expect, it, vi } from "vitest"
import {
  createUncertainStateJobExecutor,
  deriveExecutionAuditFlags,
} from "./uncertain-state-job-executor"
import type {
  FinalizedDocumentPreparer,
  UncertainStateFiscalProvider,
  UncertainStatePersistence,
} from "./uncertain-state.types"
import type { FiscalQueueJob } from "../queue/queue.types"

function providerFalso(overrides: Partial<UncertainStateFiscalProvider> = {}): UncertainStateFiscalProvider {
  return {
    simulado: true,
    transmit: vi.fn(),
    consult: vi.fn(),
    ...overrides,
  } as UncertainStateFiscalProvider
}

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

describe("deriveExecutionAuditFlags — derivação, não literal", () => {
  it("provider não invocado ⇒ execução não-real e sem tentativa externa", () => {
    const flags = deriveExecutionAuditFlags({
      provider: providerFalso({ simulado: false }),
      providerInvoked: false,
    })
    expect(flags).toEqual({ simulado: true, externalTransmissionAttempted: false })
  })

  it("provider simulado invocado ⇒ simulado=true, sem tentativa externa", () => {
    const flags = deriveExecutionAuditFlags({
      provider: providerFalso({ simulado: true }),
      providerInvoked: true,
    })
    expect(flags).toEqual({ simulado: true, externalTransmissionAttempted: false })
  })

  it("`simulado` REFLETE o provider que executou — não é constante", () => {
    const real = deriveExecutionAuditFlags({
      provider: providerFalso({ simulado: false }),
      providerInvoked: true,
    })
    expect(real.simulado).toBe(false)
  })

  it("`externalTransmissionAttempted` vem do provider, não de literal", () => {
    const comTentativa = deriveExecutionAuditFlags({
      provider: providerFalso({
        simulado: false,
        reportExternalTransmissionAttempted: () => true,
      }),
      providerInvoked: true,
    })
    /**
     * A derivação PRECISA ser capaz de propagar `true` — uma função que devolvesse `false`
     * sempre seria o próprio bug F-2 reescrito. O que este slice garante é que NENHUM
     * caminho de produto chega aqui: o único provider real existente é bloqueado pelo
     * coordenador antes de `transmit`, e o único transporte existente recusa sem abrir
     * socket. A prova está em "nenhum caminho do slice produz ... = true", abaixo.
     */
    expect(comTentativa.externalTransmissionAttempted).toBe(true)
  })

  it("provider que reporta tentativa mas NÃO foi invocado continua false", () => {
    const flags = deriveExecutionAuditFlags({
      provider: providerFalso({ reportExternalTransmissionAttempted: () => true }),
      providerInvoked: false,
    })
    expect(flags.externalTransmissionAttempted).toBe(false)
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

  it("provider real bloqueado pelo coordenador ⇒ externalTransmissionAttempted=false", async () => {
    const provider = providerFalso({
      simulado: false,
      reportExternalTransmissionAttempted: () => true, // mentiria se fosse consultado
    })
    const executor = createUncertainStateJobExecutor({
      persistence,
      preparer: { prepare: vi.fn() } as unknown as FinalizedDocumentPreparer,
      provider,
    })
    const resultado = await executor(job())
    expect(resultado.kind).toBe("terminal")
    expect(resultado.code).toBe("real_provider_blocked")
    // Nada foi transmitido: a trilha NÃO pode dizer que houve tentativa externa.
    expect(resultado.externalTransmissionAttempted).toBe(false)
  })

  it("job sem notaFiscalId e tipo não suportado também registram false", async () => {
    const executor = createUncertainStateJobExecutor({
      persistence,
      preparer: { prepare: vi.fn() } as unknown as FinalizedDocumentPreparer,
      provider: providerFalso({ simulado: false }),
    })
    const semNota = await executor(job({ notaFiscalId: null }))
    expect(semNota.externalTransmissionAttempted).toBe(false)

    const tipoErrado = await executor(job({ tipo: "CANCELAMENTO" }))
    expect(tipoErrado.externalTransmissionAttempted).toBe(false)
  })

  it("documento JÁ AUTORIZADA (atalho idempotente) não é auditado como invocação", async () => {
    /**
     * O coordenador retorna `authorized`/`idempotent: true` num atalho que acontece ANTES de
     * `provider.transmit`. Derivar a proveniência da posição no fluxo (em vez do desfecho)
     * marcaria essa execução como invocada e propagaria o relatório de rede do provider —
     * uma tentativa externa registrada para uma execução que não chamou ninguém.
     */
    const persistidoAutorizado = {
      storeId: "loja-x",
      vendaId: "venda-1",
      notaFiscalId: "nota-1",
      modelo: "NFCE" as const,
      ambiente: "HOMOLOGACAO" as const,
      serie: 1,
      numero: 1,
      chaveAcesso: "3".repeat(44),
      status: "AUTORIZADA" as const,
      xmlAssinado: "<NFe><tpAmb>2</tpAmb></NFe>",
      xmlBytesSha256: "",
    }
    const { fiscalBytesSha256, fiscalXmlBytes } = await import("./uncertain-state-coordinator")
    persistidoAutorizado.xmlBytesSha256 = fiscalBytesSha256(
      fiscalXmlBytes(persistidoAutorizado.xmlAssinado),
    )

    const transmit = vi.fn()
    const provider = providerFalso({
      simulado: true,
      transmit,
      reportExternalTransmissionAttempted: () => true, // resíduo de execução anterior
    })
    const executor = createUncertainStateJobExecutor({
      persistence: {
        ...persistence,
        load: vi.fn(async () => persistidoAutorizado),
      } as unknown as UncertainStatePersistence,
      preparer: { prepare: vi.fn() } as unknown as FinalizedDocumentPreparer,
      provider,
    })

    const resultado = await executor(job())
    expect(resultado.code).toBe("ja_autorizada")
    expect(transmit).not.toHaveBeenCalled()
    // Nenhuma invocação ⇒ nenhuma tentativa externa pode ser registrada.
    expect(resultado.externalTransmissionAttempted).toBe(false)
  })

  it("nenhum caminho do slice produz externalTransmissionAttempted = true", async () => {
    const executor = createUncertainStateJobExecutor({
      persistence,
      preparer: { prepare: vi.fn() } as unknown as FinalizedDocumentPreparer,
      provider: providerFalso({ simulado: false, reportExternalTransmissionAttempted: () => true }),
    })
    const resultados = [
      await executor(job()),
      await executor(job({ notaFiscalId: null })),
      await executor(job({ tipo: "INUTILIZACAO" })),
    ]
    for (const r of resultados) expect(r.externalTransmissionAttempted).toBe(false)
  })
})
