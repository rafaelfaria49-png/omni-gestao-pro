/**
 * GOAL-016D-B — desfechos `PROCESSING` e `THROTTLED` no coordenador (plano 016D D12).
 *
 * Os providers destes testes **não são stubs de conveniência**: eles rodam o parser real sobre
 * as fixtures SOAP sintéticas. Assim o que se prova é a cadeia inteira — resposta → parser →
 * matriz → desfecho → persistência — e não um contrato imaginado no meio do caminho.
 *
 * Três regressões estão travadas aqui:
 *
 *  - `656` **não** pode agendar consulta (agendar é o que alimenta o consumo indevido);
 *  - `103/105` **não** podem retransmitir e precisam reencontrar a MESMA consulta;
 *  - a consulta **não** pode autorizar retransmissão por omissão — antes deste GOAL, qualquer
 *    desfecho que não fosse `AUTHORIZED`/`REJECTED` caía em `authorizeExactRetransmission`.
 */
import { describe, expect, it, vi } from "vitest"
import {
  fiscalBytesSha256,
  fiscalXmlBytes,
  reconcileUncertainDocument,
  transmitWithUncertainStateSafety,
} from "./uncertain-state-coordinator"
import {
  IN_MEMORY_ONLY_FISCAL_PROVIDER,
  type FinalizedDocumentPreparer,
  type FiscalConsultationResult,
  type FiscalTransmissionResult,
  type PersistedFiscalDocument,
  type UncertainStateFiscalProvider,
  type UncertainStatePersistence,
} from "./uncertain-state.types"
import {
  parseSefazSoapResponse,
  toFiscalConsultationResult,
  toFiscalTransmissionResult,
} from "../provider/sefaz/sefaz-response-parser"
import type { SefazServico } from "../provider/sefaz/sefaz-endpoint-catalog"
import * as F from "../provider/sefaz/__fixtures__/sefaz-soap-fixtures"

const XML = "<NFe><infNFe><ide><tpAmb>2</tpAmb></ide></infNFe></NFe>"
const SHA = fiscalBytesSha256(fiscalXmlBytes(XML))

function documento(overrides: Partial<PersistedFiscalDocument> = {}): PersistedFiscalDocument {
  return {
    storeId: "loja-piloto",
    vendaId: "venda-1",
    notaFiscalId: "nota-1",
    modelo: "NFCE",
    ambiente: "HOMOLOGACAO",
    serie: 1,
    numero: 1,
    // A MESMA chave das fixtures: o provider a repassa como `chaveAcessoEsperada`, então o
    // vínculo documento↔resposta é exercitado de verdade, não contornado.
    chaveAcesso: F.CHAVE_SINTETICA,
    status: "TRANSMITINDO",
    xmlAssinado: XML,
    xmlBytesSha256: SHA,
    ...overrides,
  }
}

/**
 * Provider que responde com FIXTURES reais passadas pelo parser. A marca de "somente memória"
 * é aposta porque não existe transporte algum aqui — nenhum socket, nenhuma fixture vem da rede.
 */
function providerDeFixture(input: {
  transmissao?: Array<{ fixture: string; servico?: SefazServico }>
  consulta?: Array<{ fixture: string; servico?: SefazServico }>
  simulado?: boolean
}): UncertainStateFiscalProvider & {
  transmissoes: number
  consultas: number
} {
  let transmissoes = 0
  let consultas = 0
  const provider = {
    simulado: input.simulado ?? true,
    [IN_MEMORY_ONLY_FISCAL_PROVIDER]: true as const,
    // A chave esperada vem do DOCUMENTO em curso — é assim que o adapter real fará. Passar a
    // chave do documento (e não uma constante do teste) é o que torna o vínculo verificável.
    async transmit(
      chamada: Parameters<UncertainStateFiscalProvider["transmit"]>[0],
    ): Promise<FiscalTransmissionResult> {
      const passo = input.transmissao?.[Math.min(transmissoes, input.transmissao.length - 1)]
      transmissoes += 1
      if (!passo) throw new Error("provider sem resposta de transmissão configurada")
      return toFiscalTransmissionResult(
        parseSefazSoapResponse({
          servico: passo.servico ?? "NFeAutorizacao4",
          body: passo.fixture,
          chaveAcessoEsperada: chamada.document.chaveAcesso,
        }),
      )
    },
    async consult(
      chamada: Parameters<UncertainStateFiscalProvider["consult"]>[0],
    ): Promise<FiscalConsultationResult> {
      const passo = input.consulta?.[Math.min(consultas, input.consulta.length - 1)]
      consultas += 1
      if (!passo) throw new Error("provider sem resposta de consulta configurada")
      return toFiscalConsultationResult(
        parseSefazSoapResponse({
          servico: passo.servico ?? "NFeConsultaProtocolo4",
          body: passo.fixture,
          chaveAcessoEsperada: chamada.document.chaveAcesso,
        }),
      )
    },
    get transmissoes() {
      return transmissoes
    },
    get consultas() {
      return consultas
    },
  }
  return provider as unknown as UncertainStateFiscalProvider & {
    transmissoes: number
    consultas: number
  }
}

type PersistenciaEspiada = UncertainStatePersistence & {
  recordUncertainAndEnsureConsultation: ReturnType<typeof vi.fn>
  markRejected: ReturnType<typeof vi.fn>
  markAuthorized: ReturnType<typeof vi.fn>
  authorizeExactRetransmission: ReturnType<typeof vi.fn>
  persistBeforeTransmission: ReturnType<typeof vi.fn>
}

/** Dedupe de consulta POR DOCUMENTO — a mesma regra do adapter Prisma (`dedupeKey` por nota). */
function dedupePorNota() {
  const consultasPorNota = new Map<string, string>()
  return vi.fn(async ({ document }: { document: PersistedFiscalDocument }) => {
    const existente = consultasPorNota.get(document.notaFiscalId)
    if (existente) return { consultationJobId: existente, created: false }
    const id = `consulta-${document.notaFiscalId}`
    consultasPorNota.set(document.notaFiscalId, id)
    return { consultationJobId: id, created: true }
  })
}

/**
 * Persistência dublê.
 *
 * ⚠️ Na **transmissão**, `load` devolve `null` de propósito: um documento já em `TRANSMITINDO`
 * é bloqueado pelo coordenador com `CONSULTATION_REQUIRED` — trava do GOAL-012 que estes testes
 * não estão exercitando e que não deve ser contornada. O caminho aqui é o de primeira
 * transmissão: preparar → persistir → transmitir.
 */
function persistencia(
  doc: PersistedFiscalDocument = documento(),
  modo: "transmissao" | "consulta" = "transmissao",
): PersistenciaEspiada {
  return {
    load: vi.fn(async () => (modo === "consulta" ? doc : null)),
    persistBeforeTransmission: vi.fn(async () => doc),
    recordUncertainAndEnsureConsultation: dedupePorNota(),
    markAuthorized: vi.fn(async () => undefined),
    markRejected: vi.fn(async () => undefined),
    authorizeExactRetransmission: vi.fn(async () => undefined),
  } as unknown as PersistenciaEspiada
}

function preparerDe(doc: PersistedFiscalDocument): FinalizedDocumentPreparer {
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

/** Persistência para o caminho de CONSULTA: a nota já existe e está em TRANSMITINDO. */
const persistenciaDeConsulta = () => persistencia(documento(), "consulta")

function transmitir(input: {
  provider: UncertainStateFiscalProvider
  persistence: UncertainStatePersistence
  doc?: PersistedFiscalDocument
}) {
  const doc = input.doc ?? documento()
  return transmitWithUncertainStateSafety({
    locator: { storeId: doc.storeId, vendaId: doc.vendaId, notaFiscalId: doc.notaFiscalId },
    persistence: input.persistence,
    preparer: preparerDe(doc),
    provider: input.provider,
  })
}

function consultar(input: {
  provider: UncertainStateFiscalProvider
  persistence: UncertainStatePersistence
  doc?: PersistedFiscalDocument
}) {
  const doc = input.doc ?? documento()
  return reconcileUncertainDocument({
    locator: { storeId: doc.storeId, vendaId: doc.vendaId, notaFiscalId: doc.notaFiscalId },
    persistence: input.persistence,
    provider: input.provider,
  })
}

describe("PROCESSING (cStat 103/105) na transmissão", () => {
  it("mantém TRANSMITINDO, agenda consulta com o recibo e NÃO retransmite", async () => {
    const provider = providerDeFixture({
      transmissao: [{ fixture: F.AUTORIZACAO_LOTE_RECEBIDO_103 }],
    })
    const store = persistencia()
    const outcome = await transmitir({ provider, persistence: store })

    expect(outcome.kind).toBe("processing")
    if (outcome.kind !== "processing") throw new Error("desfecho inesperado")
    expect(outcome.recibo).toBe(F.RECIBO_SINTETICO)
    expect(outcome.document.status).toBe("TRANSMITINDO")
    expect(outcome.consultationJobCreated).toBe(true)

    expect(store.recordUncertainAndEnsureConsultation).toHaveBeenCalledWith(
      expect.objectContaining({ code: "PROCESSING", recibo: F.RECIBO_SINTETICO }),
    )
    // ⛔ Nada de retransmissão: o provider foi chamado UMA vez e nenhuma retomada foi liberada.
    expect(provider.transmissoes).toBe(1)
    expect(store.authorizeExactRetransmission).not.toHaveBeenCalled()
    expect(store.markAuthorized).not.toHaveBeenCalled()
    expect(store.markRejected).not.toHaveBeenCalled()
  })

  it("103 seguido de 105 reutiliza a MESMA consulta e o mesmo recibo", async () => {
    const store = persistencia()
    const primeiro = await transmitir({
      provider: providerDeFixture({ transmissao: [{ fixture: F.AUTORIZACAO_LOTE_RECEBIDO_103 }] }),
      persistence: store,
    })
    const segundo = await transmitir({
      provider: providerDeFixture({
        transmissao: [
          { fixture: F.RET_AUTORIZACAO_EM_PROCESSAMENTO_105, servico: "NFeRetAutorizacao4" },
        ],
      }),
      persistence: store,
    })

    if (primeiro.kind !== "processing" || segundo.kind !== "processing") {
      throw new Error("ambos os desfechos deveriam ser processing")
    }
    expect(segundo.consultationJobId).toBe(primeiro.consultationJobId)
    expect(segundo.consultationJobCreated).toBe(false)
    expect(segundo.recibo).toBe(primeiro.recibo)
  })

  it("103 sem recibo não vira PROCESSING — cai no incerto genérico", async () => {
    const store = persistencia()
    const outcome = await transmitir({
      provider: providerDeFixture({
        transmissao: [{ fixture: F.AUTORIZACAO_LOTE_RECEBIDO_SEM_RECIBO }],
      }),
      persistence: store,
    })
    expect(outcome.kind).toBe("uncertain")
    expect(store.recordUncertainAndEnsureConsultation).toHaveBeenCalledWith(
      expect.objectContaining({ code: "UNKNOWN" }),
    )
  })
})

describe("204 (duplicidade) consulta antes de convergir", () => {
  it("agenda consulta e não autoriza retransmissão nem marca desfecho", async () => {
    const store = persistencia()
    const outcome = await transmitir({
      provider: providerDeFixture({ transmissao: [{ fixture: F.AUTORIZACAO_DUPLICIDADE_204 }] }),
      persistence: store,
    })

    expect(outcome.kind).toBe("uncertain")
    expect(store.recordUncertainAndEnsureConsultation).toHaveBeenCalledTimes(1)
    expect(store.authorizeExactRetransmission).not.toHaveBeenCalled()
    expect(store.markRejected).not.toHaveBeenCalled()
    expect(store.markAuthorized).not.toHaveBeenCalled()
  })

  it("a convergência vem da CONSULTA, e só dela", async () => {
    // Fase 1 — a transmissão vê `204` e apenas enfileira a consulta: nada converge aqui.
    const transmissao = persistencia()
    await transmitir({
      provider: providerDeFixture({ transmissao: [{ fixture: F.AUTORIZACAO_DUPLICIDADE_204 }] }),
      persistence: transmissao,
    })
    expect(transmissao.markAuthorized).not.toHaveBeenCalled()

    // Fase 2 — a nota, agora em TRANSMITINDO, é resolvida pela consulta.
    const reconciliacao = persistenciaDeConsulta()
    const consulta = await consultar({
      provider: providerDeFixture({ consulta: [{ fixture: F.CONSULTA_AUTORIZADA_100 }] }),
      persistence: reconciliacao,
    })
    expect(consulta.kind).toBe("authorized")
    expect(reconciliacao.markAuthorized).toHaveBeenCalledTimes(1)
  })
})

describe("THROTTLED (cStat 656) na transmissão", () => {
  it("NÃO agenda consulta, não persiste desfecho e mantém a nota TRANSMITINDO", async () => {
    const store = persistencia()
    const outcome = await transmitir({
      provider: providerDeFixture({ transmissao: [{ fixture: F.AUTORIZACAO_CONSUMO_INDEVIDO_656 }] }),
      persistence: store,
    })

    expect(outcome.kind).toBe("throttled")
    if (outcome.kind !== "throttled") throw new Error("desfecho inesperado")
    expect(outcome.cStat).toBe("656")
    expect(outcome.document.status).toBe("TRANSMITINDO")

    // ⛔ O invariante central do D12.2: nenhuma consulta é criada.
    expect(store.recordUncertainAndEnsureConsultation).not.toHaveBeenCalled()
    expect(store.authorizeExactRetransmission).not.toHaveBeenCalled()
    expect(store.markRejected).not.toHaveBeenCalled()
    expect(store.markAuthorized).not.toHaveBeenCalled()
  })

  it("um 656 repetido continua sem produzir consulta", async () => {
    const store = persistencia()
    for (let i = 0; i < 3; i++) {
      const outcome = await transmitir({
        provider: providerDeFixture({
          transmissao: [{ fixture: F.AUTORIZACAO_CONSUMO_INDEVIDO_656 }],
        }),
        persistence: store,
      })
      expect(outcome.kind).toBe("throttled")
    }
    expect(store.recordUncertainAndEnsureConsultation).not.toHaveBeenCalled()
  })
})

describe("consulta — cada desfecho é explícito", () => {

  it("217 autoriza retransmissão exata pelo fluxo já existente", async () => {
    const store = persistenciaDeConsulta()
    const outcome = await consultar({
      provider: providerDeFixture({ consulta: [{ fixture: F.CONSULTA_NAO_CONSTA_217 }] }),
      persistence: store,
    })
    expect(outcome.kind).toBe("not_found")
    expect(store.authorizeExactRetransmission).toHaveBeenCalledTimes(1)
  })

  it("100 em consulta converge para AUTHORIZED com protocolo e XML válidos", async () => {
    const store = persistenciaDeConsulta()
    const outcome = await consultar({
      provider: providerDeFixture({ consulta: [{ fixture: F.CONSULTA_AUTORIZADA_100 }] }),
      persistence: store,
    })
    expect(outcome.kind).toBe("authorized")
    expect(store.markAuthorized).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "CONSULTATION",
        result: expect.objectContaining({ protocolo: F.PROTOCOLO_SINTETICO }),
      }),
    )
  })

  it("PROCESSING em consulta reagenda a MESMA consulta e nunca autoriza transmissão", async () => {
    const store = persistenciaDeConsulta()
    const outcome = await consultar({
      provider: providerDeFixture({
        consulta: [
          { fixture: F.RET_AUTORIZACAO_EM_PROCESSAMENTO_105, servico: "NFeRetAutorizacao4" },
        ],
      }),
      persistence: store,
    })
    expect(outcome.kind).toBe("processing")
    if (outcome.kind !== "processing") throw new Error("desfecho inesperado")
    expect(outcome.recibo).toBe(F.RECIBO_SINTETICO)
    expect(outcome.document.status).toBe("TRANSMITINDO")
    expect(store.authorizeExactRetransmission).not.toHaveBeenCalled()
  })

  it("656 em consulta pausa o fluxo e NÃO agenda nova consulta", async () => {
    const store = persistenciaDeConsulta()
    const outcome = await consultar({
      provider: providerDeFixture({ consulta: [{ fixture: F.CONSULTA_CONSUMO_INDEVIDO_656 }] }),
      persistence: store,
    })
    expect(outcome.kind).toBe("throttled")
    expect(store.recordUncertainAndEnsureConsultation).not.toHaveBeenCalled()
    expect(store.authorizeExactRetransmission).not.toHaveBeenCalled()
  })

  it("REGRESSÃO: consulta não conclusiva NÃO autoriza retransmissão", async () => {
    // Antes deste GOAL, `NOT_FOUND` era o `else` de `runConsultation`: um SOAP Fault liberava
    // um novo envio sem que a SEFAZ jamais tivesse dito que o documento não existe.
    for (const fixture of [F.SOAP_FAULT, F.RESPOSTA_SEM_CSTAT, F.XML_TRUNCADO]) {
      const store = persistenciaDeConsulta()
      const outcome = await consultar({
        provider: providerDeFixture({ consulta: [{ fixture }] }),
        persistence: store,
      })
      expect(outcome.kind).toBe("uncertain")
      expect(store.authorizeExactRetransmission).not.toHaveBeenCalled()
      expect(store.markAuthorized).not.toHaveBeenCalled()
      expect(store.markRejected).not.toHaveBeenCalled()
    }
  })
})

describe("rejeição usa a decisão EXPLÍCITA da matriz", () => {
  it("110 é terminal, consome o número e NÃO pede inutilização", async () => {
    const store = persistencia()
    const outcome = await transmitir({
      provider: providerDeFixture({ transmissao: [{ fixture: F.AUTORIZACAO_DENEGADA_110 }] }),
      persistence: store,
    })
    expect(outcome.kind).toBe("rejected")
    if (outcome.kind !== "rejected") throw new Error("desfecho inesperado")
    expect(outcome.requiresInutilizacao).toBe(false)
    expect(store.markRejected).toHaveBeenCalledWith(
      expect.objectContaining({ requiresInutilizacao: false }),
    )
  })

  it("produtor SEM matriz preserva o comportamento histórico do GOAL-012", async () => {
    const store = persistencia()
    const legado = {
      simulado: true,
      [IN_MEMORY_ONLY_FISCAL_PROVIDER]: true as const,
      transmit: async (): Promise<FiscalTransmissionResult> => ({
        outcome: "REJECTED",
        cStat: "999",
        xMotivo: "Rejeição simulada do drill.",
      }),
      consult: vi.fn(),
    } as unknown as UncertainStateFiscalProvider
    const outcome = await transmitir({ provider: legado, persistence: store })
    expect(outcome.kind).toBe("rejected")
    if (outcome.kind !== "rejected") throw new Error("desfecho inesperado")
    expect(outcome.requiresInutilizacao).toBe(true)
  })

  it("110 em consulta também preserva a decisão da matriz", async () => {
    const store = persistenciaDeConsulta()
    const consultaDenegada = F.CONSULTA_NAO_CONSTA_217.replace(
      "<cStat>217</cStat><xMotivo>NF-e nao consta na base de dados da SEFAZ</xMotivo>",
      "<cStat>110</cStat><xMotivo>Uso Denegado</xMotivo>",
    )
    const outcome = await consultar({
      provider: providerDeFixture({ consulta: [{ fixture: consultaDenegada }] }),
      persistence: store,
    })
    expect(outcome.kind).toBe("rejected")
    if (outcome.kind !== "rejected") throw new Error("desfecho inesperado")
    expect(outcome.requiresInutilizacao).toBe(false)
  })
})

describe("concorrência não mistura recibo nem proveniência", () => {
  it("dois documentos processados em paralelo mantêm recibo e consulta próprios", async () => {
    const docA = documento({ notaFiscalId: "nota-A", vendaId: "venda-A" })
    const docB = documento({ notaFiscalId: "nota-B", vendaId: "venda-B" })
    const reciboB = "999000000000777"
    const fixtureB = F.AUTORIZACAO_LOTE_RECEBIDO_103.replace(F.RECIBO_SINTETICO, reciboB)

    // Uma única persistência compartilhada: se houvesse estado cruzado, apareceria aqui.
    const consultasPorNota = new Map<string, string>()
    const store = {
      load: vi.fn(async () => null),
      persistBeforeTransmission: vi.fn(
        async ({ document }: { document: { notaFiscalId: string } }) =>
          document.notaFiscalId === "nota-A" ? docA : docB,
      ),
      recordUncertainAndEnsureConsultation: vi.fn(
        async ({ document }: { document: PersistedFiscalDocument }) => {
          const existente = consultasPorNota.get(document.notaFiscalId)
          if (existente) return { consultationJobId: existente, created: false }
          const id = `consulta-${document.notaFiscalId}`
          consultasPorNota.set(document.notaFiscalId, id)
          return { consultationJobId: id, created: true }
        },
      ),
      markAuthorized: vi.fn(),
      markRejected: vi.fn(),
      authorizeExactRetransmission: vi.fn(),
    } as unknown as UncertainStatePersistence

    const [a, b] = await Promise.all([
      transmitir({
        provider: providerDeFixture({ transmissao: [{ fixture: F.AUTORIZACAO_LOTE_RECEBIDO_103 }] }),
        persistence: store,
        doc: docA,
      }),
      transmitir({
        provider: providerDeFixture({ transmissao: [{ fixture: fixtureB }] }),
        persistence: store,
        doc: docB,
      }),
    ])

    if (a.kind !== "processing" || b.kind !== "processing") {
      throw new Error("ambos deveriam ser processing")
    }
    expect(a.recibo).toBe(F.RECIBO_SINTETICO)
    expect(b.recibo).toBe(reciboB)
    expect(a.consultationJobId).not.toBe(b.consultationJobId)
    expect(a.document.notaFiscalId).toBe("nota-A")
    expect(b.document.notaFiscalId).toBe("nota-B")
  })

  it("proveniência de execuções concorrentes não vaza entre providers", async () => {
    const externo = providerDeFixture({
      transmissao: [{ fixture: F.AUTORIZACAO_CONSUMO_INDEVIDO_656 }],
      simulado: false,
    })
    const simulado = providerDeFixture({
      transmissao: [{ fixture: F.AUTORIZACAO_LOTE_RECEBIDO_103 }],
      simulado: true,
    })
    const [a, b] = await Promise.all([
      transmitir({ provider: externo, persistence: persistencia() }),
      transmitir({ provider: simulado, persistence: persistencia() }),
    ])
    expect(a.provenance.providerSimulado).toBe(false)
    expect(b.provenance.providerSimulado).toBe(true)
    expect(a.provenance.providerInvoked).toBe(true)
    expect(b.provenance.providerInvoked).toBe(true)
  })
})
