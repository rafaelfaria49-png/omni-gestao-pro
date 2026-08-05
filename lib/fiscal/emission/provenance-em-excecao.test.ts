/**
 * GOAL-016D-B · correção 002 — proveniência preservada em EXCEÇÃO (bloqueio 2 da revisão
 * cruzada do PR #44).
 *
 * ## O defeito
 *
 * `transmit`/`consult` que lançam depois de já terem tocado a rede subiam sem tratamento até o
 * `catch` genérico do `queue-worker`, que fabricava:
 *
 * ```ts
 * { kind: "transient", simulado: true, externalTransmissionAttempted: false }
 * ```
 *
 * Três mentiras numa linha. A trilha passava a dizer que uma execução REAL foi simulada e que
 * nada saiu da máquina; e `transient` significa **retry com backoff** — ou seja, retransmissão
 * automática de um documento que pode ter sido entregue à SEFAZ. Exatamente o cenário que
 * ADR-0017 existe para impedir.
 *
 * ## A correção
 *
 * O coordenador já anexava a proveniência ao erro (`attachProvenance`). O executor agora a lê
 * com `fiscalExecutionProvenanceOf` e produz `uncertain` com as flags REAIS. Erro sem
 * proveniência fiscal continua subindo — inventar proveniência seria o mesmo defeito espelhado.
 */
import { describe, expect, it, vi } from "vitest"
import { drainFiscalQueue } from "../queue/queue-worker"
import type { FiscalQueueJob, FiscalQueueWorkerPorts } from "../queue/queue.types"
import { createUncertainStateJobExecutor } from "./uncertain-state-job-executor"
import { fiscalBytesSha256, fiscalXmlBytes } from "./uncertain-state-coordinator"
import {
  IN_MEMORY_ONLY_FISCAL_PROVIDER,
  type FinalizedDocumentPreparer,
  type PersistedFiscalDocument,
  type UncertainStateFiscalProvider,
  type UncertainStatePersistence,
} from "./uncertain-state.types"

const XML = "<NFe><infNFe><ide><tpAmb>2</tpAmb></ide></infNFe></NFe>"
const SHA = fiscalBytesSha256(fiscalXmlBytes(XML))
const CHAVE = "35990199999999999999650999000000001199999999"
const PROTOCOLO = "999000000000001"

function documento(overrides: Partial<PersistedFiscalDocument> = {}): PersistedFiscalDocument {
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
    ...overrides,
  }
}

/**
 * Provider que **realmente registra contato externo** e então falha.
 *
 * ⚠️ Carrega `IN_MEMORY_ONLY_FISCAL_PROVIDER` apenas para atravessar o gate de capability (o
 * executor não recebe capability e bloquearia um provider externo antes de `transmit`), mas se
 * declara `simulado: false` e reporta tentativa externa. É essa combinação artificial que
 * permite testar o que importa: se as flags de auditoria sobrevivem à exceção.
 */
function providerQueFalhaAposContato(input: {
  mensagem: string
  registraContato?: boolean
  modo?: "transmit" | "consult" | "ambos"
}): UncertainStateFiscalProvider {
  const falhar = (chamada: { provenance?: { recordExternalTransmissionAttempted(): void } }) => {
    if (input.registraContato ?? true) chamada.provenance?.recordExternalTransmissionAttempted()
    throw new Error(input.mensagem)
  }
  const modo = input.modo ?? "ambos"
  return {
    simulado: false,
    [IN_MEMORY_ONLY_FISCAL_PROVIDER]: true as const,
    async transmit(chamada: Parameters<UncertainStateFiscalProvider["transmit"]>[0]) {
      if (modo === "consult") throw new Error("transmit não deveria ser chamado")
      return falhar(chamada)
    },
    async consult(chamada: Parameters<UncertainStateFiscalProvider["consult"]>[0]) {
      if (modo === "transmit") throw new Error("consult não deveria ser chamado")
      return falhar(chamada)
    },
  } as unknown as UncertainStateFiscalProvider
}

type PersistenciaEspiada = UncertainStatePersistence & {
  recordUncertainAndEnsureConsultation: ReturnType<typeof vi.fn>
}

function persistencia(
  doc: PersistedFiscalDocument,
  modo: "transmissao" | "consulta",
  opcoes: { consultaFalha?: boolean } = {},
): PersistenciaEspiada {
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
  } as unknown as PersistenciaEspiada
}

function preparer(doc: PersistedFiscalDocument): FinalizedDocumentPreparer {
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

function executor(input: {
  provider: UncertainStateFiscalProvider
  doc?: PersistedFiscalDocument
  modo: "transmissao" | "consulta"
}) {
  const doc = input.doc ?? documento()
  return createUncertainStateJobExecutor({
    persistence: persistencia(doc, input.modo),
    preparer: preparer(doc),
    provider: input.provider,
  })
}

describe("exceção após contato externo — transmissão", () => {
  it("preserva simulado=false e externalTransmissionAttempted=true", async () => {
    const executar = executor({
      provider: providerQueFalhaAposContato({ mensagem: "socket encerrado pelo par" }),
      modo: "transmissao",
    })
    const resultado = await executar(job())

    expect(resultado.kind).toBe("uncertain")
    expect(resultado.simulado).toBe(false)
    expect(resultado.externalTransmissionAttempted).toBe(true)
  })

  it("nunca vira transient — logo nunca percorre retry de transmissão", async () => {
    const executar = executor({
      provider: providerQueFalhaAposContato({ mensagem: "timeout de leitura" }),
      modo: "transmissao",
    })
    const resultado = await executar(job())
    expect(resultado.kind).not.toBe("transient")
    expect(resultado.kind).not.toBe("terminal")
    expect(resultado.kind).not.toBe("success")
  })

  it("mensagem é sanitizada: sem XML, sem chave, sem protocolo", async () => {
    const executar = executor({
      provider: providerQueFalhaAposContato({
        mensagem:
          `Falha ao enviar <nfeProc><NFe>${XML}</NFe></nfeProc> ` +
          `chave=${CHAVE} protocolo=${PROTOCOLO} senha=segredo123`,
      }),
      modo: "transmissao",
    })
    const resultado = await executar(job())

    expect(resultado.mensagem).not.toMatch(/[<>]/)
    expect(resultado.mensagem).not.toContain(CHAVE)
    expect(resultado.mensagem).not.toContain(PROTOCOLO)
    expect(resultado.mensagem).not.toContain("segredo123")
  })

  it("exceção ANTES de qualquer contato não inventa tentativa externa", async () => {
    const executar = executor({
      provider: providerQueFalhaAposContato({
        mensagem: "guard bloqueou antes do transporte",
        registraContato: false,
      }),
      modo: "transmissao",
    })
    const resultado = await executar(job())
    expect(resultado.externalTransmissionAttempted).toBe(false)
    expect(resultado.simulado).toBe(false)
  })
})

describe("a CONSULTA que resolve o estado incerto é GARANTIDA na exceção", () => {
  /**
   * Achado BLOQUEANTE da revisão cruzada da correção 002.
   *
   * O caminho de exceção devolvia `uncertain` sem nunca criar o job `CONSULTA` — o único ponto
   * do coordenador que fazia isso. O worker então estacionava o job com
   * `proximaTentativaEm: null`, e **nenhuma autoridade automática** restava: nem consulta, nem
   * retry, nem a rota administrativa (que só alcança `FALHA`). A nota ficava presa em
   * `TRANSMITINDO` para sempre — exatamente o documento que pode ter chegado à SEFAZ.
   */
  it("cria/reencontra a consulta deduplicada ANTES de o job estacionar", async () => {
    const doc = documento()
    const store = persistencia(doc, "transmissao")
    const executar = createUncertainStateJobExecutor({
      persistence: store,
      preparer: preparer(doc),
      provider: providerQueFalhaAposContato({ mensagem: "socket encerrado" }),
    })

    const resultado = await executar(job())

    expect(store.recordUncertainAndEnsureConsultation).toHaveBeenCalledTimes(1)
    expect(store.recordUncertainAndEnsureConsultation).toHaveBeenCalledWith(
      expect.objectContaining({ code: "PROVIDER_EXCEPTION" }),
    )
    expect(resultado.kind).toBe("uncertain")
    expect(resultado.detalhe?.consultationEnsured).toBe(true)
  })

  it("quando a consulta NÃO pôde ser criada, o desfecho o declara em vez de silenciar", async () => {
    const doc = documento()
    const store = persistencia(doc, "transmissao", { consultaFalha: true })
    const executar = createUncertainStateJobExecutor({
      persistence: store,
      preparer: preparer(doc),
      provider: providerQueFalhaAposContato({ mensagem: "socket encerrado" }),
    })

    const resultado = await executar(job())

    // A falha de persistência não engole a exceção original nem inventa sucesso...
    expect(resultado.detalhe?.consultationEnsured).toBe(false)
    // ...e continua sem retransmitir.
    expect(resultado.externalTransmissionAttempted).toBe(true)
    /**
     * ⚠️ `unresolved`, não `uncertain` (resíduo 3). `uncertain` levaria ao estacionamento
     * genérico, que afirma aguardar uma consulta deduplicada — e não existe consulta alguma.
     */
    expect(resultado.kind).toBe("unresolved")
    expect(resultado.code).toBe("transmissao_incerta_sem_consulta")
  })

  it("erro ANTES da invocação do provider não cria consulta alguma", async () => {
    const doc = documento()
    const store = persistencia(doc, "transmissao")
    const executar = createUncertainStateJobExecutor({
      persistence: {
        ...store,
        load: vi.fn(async () => {
          throw new Error("banco indisponível")
        }),
      } as unknown as UncertainStatePersistence,
      preparer: preparer(doc),
      provider: providerQueFalhaAposContato({ mensagem: "irrelevante" }),
    })

    await expect(executar(job())).rejects.toThrow(/banco indispon/i)
    expect(store.recordUncertainAndEnsureConsultation).not.toHaveBeenCalled()
  })
})

describe("provider que lança PRIMITIVO não perde a proveniência", () => {
  it("throw de string continua sendo tratado como tentativa externa", async () => {
    const doc = documento()
    const provider = {
      simulado: false,
      [IN_MEMORY_ONLY_FISCAL_PROVIDER]: true as const,
      async transmit(chamada: Parameters<UncertainStateFiscalProvider["transmit"]>[0]) {
        chamada.provenance?.recordExternalTransmissionAttempted()
        // Provider mal escrito de propósito: lança primitivo em vez de `Error`.
        throw "socket closed"
      },
      consult: vi.fn(),
    } as unknown as UncertainStateFiscalProvider

    const executar = createUncertainStateJobExecutor({
      persistence: persistencia(doc, "transmissao"),
      preparer: preparer(doc),
      provider,
    })
    const resultado = await executar(job())

    expect(resultado.kind).toBe("uncertain")
    expect(resultado.externalTransmissionAttempted).toBe(true)
    expect(resultado.simulado).toBe(false)
  })
})

describe("exceção após contato externo — consulta", () => {
  it("preserva a proveniência real também no caminho CONSULTA", async () => {
    const executar = executor({
      provider: providerQueFalhaAposContato({
        mensagem: "conexão perdida na consulta",
        modo: "consult",
      }),
      modo: "consulta",
    })
    const resultado = await executar(job({ tipo: "CONSULTA" }))

    expect(resultado.simulado).toBe(false)
    expect(resultado.externalTransmissionAttempted).toBe(true)
  })

  /**
   * Consultar é leitura: repetir é seguro e é o que se quer. Marcar a CONSULTA como
   * `uncertain` a mandaria para `waitForConsultation`, ou seja, ela ficaria **esperando por si
   * mesma** com `proximaTentativaEm: null` — o defeito do bloqueio 1, reencenado no caminho de
   * exceção, e uma regressão frente ao comportamento anterior, que a repetia.
   */
  it("a CONSULTA que falha continua repetível, não estaciona esperando por si mesma", async () => {
    const executar = executor({
      provider: providerQueFalhaAposContato({
        mensagem: "conexão perdida na consulta",
        modo: "consult",
      }),
      modo: "consulta",
    })
    const resultado = await executar(job({ tipo: "CONSULTA" }))
    expect(resultado.kind).toBe("transient")
    expect(resultado.kind).not.toBe("uncertain")
  })
})

describe("erro ANTES de o provider ser invocado mantém o fallback legado", () => {
  /**
   * O coordenador anexa proveniência a qualquer erro seu — inclusive a uma falha de banco em
   * `load`, anterior a qualquer chamada ao provider. Tratá-la como `uncertain` transformaria
   * uma indisponibilidade momentânea em job estacionado à espera de humano. Como nada foi
   * enviado, não há ambiguidade: o erro sobe e o worker faz o retry de sempre.
   */
  it("propaga a exceção para o worker em vez de estacionar o job", async () => {
    const executar = createUncertainStateJobExecutor({
      persistence: {
        load: vi.fn(async () => {
          throw new Error("banco indisponível")
        }),
      } as unknown as UncertainStatePersistence,
      preparer: preparer(documento()),
      provider: providerQueFalhaAposContato({ mensagem: "irrelevante" }),
    })

    await expect(executar(job())).rejects.toThrow(/banco indispon/i)
  })

  it("no worker, essa falha vira transient com retry — e sem tentativa externa", async () => {
    const executar = createUncertainStateJobExecutor({
      persistence: {
        load: vi.fn(async () => {
          throw new Error("banco indisponível")
        }),
      } as unknown as UncertainStatePersistence,
      preparer: preparer(documento()),
      provider: providerQueFalhaAposContato({ mensagem: "irrelevante" }),
    })
    const fila = [job()]
    const ports = {
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
      execute: executar,
      audit: vi.fn(async () => undefined),
    } as unknown as FiscalQueueWorkerPorts & { retry: ReturnType<typeof vi.fn> }

    const report = await drainFiscalQueue({ workerId: "w1", batchSize: 1 }, ports)
    expect(report.retried).toBe(1)
    const payload = ports.retry.mock.calls[0]![0].payload as Record<string, unknown>
    expect((payload.transmission as Record<string, unknown>).external).toBe(false)
  })
})

describe("ponta a ponta na fila", () => {
  function portas(execute: FiscalQueueWorkerPorts["execute"]) {
    const fila = [job()]
    return {
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
      execute,
      audit: vi.fn(async () => undefined),
    } as unknown as FiscalQueueWorkerPorts & {
      retry: ReturnType<typeof vi.fn>
      fail: ReturnType<typeof vi.fn>
      waitForConsultation: ReturnType<typeof vi.fn>
    }
  }

  it("a tentativa externa é estacionada, não reagendada com backoff", async () => {
    const executar = executor({
      provider: providerQueFalhaAposContato({ mensagem: "socket encerrado" }),
      modo: "transmissao",
    })
    const ports = portas(executar)
    const report = await drainFiscalQueue({ workerId: "w1", batchSize: 1 }, ports)

    expect(report.awaitingConsultation).toBe(1)
    expect(ports.retry).not.toHaveBeenCalled()
    expect(ports.fail).not.toHaveBeenCalled()
    expect(ports.waitForConsultation).toHaveBeenCalledTimes(1)
  })

  it("a trilha persistida registra o contato externo — não simulado", async () => {
    const executar = executor({
      provider: providerQueFalhaAposContato({ mensagem: "socket encerrado" }),
      modo: "transmissao",
    })
    const ports = portas(executar)
    await drainFiscalQueue({ workerId: "w1", batchSize: 1 }, ports)

    const payload = ports.waitForConsultation.mock.calls[0]![0].payload as Record<string, unknown>
    expect((payload.transmission as Record<string, unknown>).external).toBe(true)
    expect((payload.lastExecution as Record<string, unknown>).code).toBe(
      "execucao_fiscal_interrompida",
    )
  })

  it("REGRESSÃO: o freio do GOAL-011 não converte a tentativa externa em falha reprocessável", async () => {
    const executar = executor({
      provider: providerQueFalhaAposContato({ mensagem: "socket encerrado" }),
      modo: "transmissao",
    })
    const ports = portas(executar)
    const report = await drainFiscalQueue({ workerId: "w1", batchSize: 1 }, ports)
    // `terminal` viraria FALHA, que a rota administrativa reprocessa ⇒ retransmissão.
    expect(report.failed).toBe(0)
  })
})
