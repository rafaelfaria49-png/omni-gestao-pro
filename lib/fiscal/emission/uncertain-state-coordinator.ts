import { createHash } from "node:crypto"
import {
  EXTERNAL_EXECUTION_DENIED,
  IN_MEMORY_ONLY_FISCAL_PROVIDER,
  type ConsultationOutcome,
  type ConsultationOutcomeKind,
  type FinalizedFiscalDocument,
  type FiscalDocumentLocator,
  type FiscalExecutionProvenance,
  type FiscalExecutionProvenanceSink,
  type FiscalExternalExecutionCapability,
  type FiscalRejectionConsequences,
  type PersistedFiscalDocument,
  type SafeEmissionOutcome,
  type SafeEmissionOutcomeKind,
  type UncertainStateFiscalProvider,
  type UncertainStatePersistence,
  type FinalizedDocumentPreparer,
} from "./uncertain-state.types"

/**
 * Coletor de proveniência de UMA execução (correção 002 · bloqueio 3).
 *
 * É uma closure criada por chamada: dois jobs concorrentes têm coletores distintos e não há
 * campo de instância a contaminar. Nenhuma acumulação monotônica entre execuções.
 */
type ExecutionProvenanceRecorder = FiscalExecutionProvenanceSink & {
  markProviderInvoked(simulado: boolean): void
  snapshot(): FiscalExecutionProvenance
}

function createExecutionProvenanceRecorder(): ExecutionProvenanceRecorder {
  let providerInvoked = false
  let providerSimulado = false
  let externalTransmissionAttempted = false
  return {
    markProviderInvoked(simulado: boolean) {
      providerInvoked = true
      providerSimulado = simulado
    },
    recordExternalTransmissionAttempted() {
      externalTransmissionAttempted = true
    },
    snapshot() {
      return { providerInvoked, providerSimulado, externalTransmissionAttempted }
    },
  }
}

/**
 * Anexa a proveniência da execução ao erro propagado, preservando identidade e `instanceof`.
 * Sem isso, uma execução que falhasse APÓS alcançar o transporte perderia o registro da
 * tentativa — exatamente a lacuna de trilha que a proveniência existe para fechar.
 */
export function fiscalExecutionProvenanceOf(error: unknown): FiscalExecutionProvenance | null {
  if (typeof error !== "object" || error === null) return null
  const carried = (error as { fiscalExecutionProvenance?: FiscalExecutionProvenance })
    .fiscalExecutionProvenance
  return carried ?? null
}

function attachProvenance(error: unknown, provenance: FiscalExecutionProvenance): unknown {
  if (typeof error === "object" && error !== null) {
    Object.defineProperty(error, "fiscalExecutionProvenance", {
      value: provenance,
      enumerable: false,
      configurable: true,
      writable: true,
    })
  }
  return error
}

/**
 * Gate de execução de provider EXTERNO (correção 002 · bloqueio 2).
 *
 * `simulado` NÃO participa desta decisão. Um provider é dispensado da capability apenas se
 * carregar a marca estrutural `IN_MEMORY_ONLY_FISCAL_PROVIDER`; qualquer outro é tratado como
 * externo e exige capability explicitamente concedida — que no 016D-A nasce negada.
 */
function externalExecutionBlock(
  provider: UncertainStateFiscalProvider,
  capability: FiscalExternalExecutionCapability | undefined,
): Extract<SafeEmissionOutcomeKind, { kind: "blocked" }> | null {
  if (provider[IN_MEMORY_ONLY_FISCAL_PROVIDER] === true) return null
  const efetiva = capability ?? EXTERNAL_EXECUTION_DENIED
  if (efetiva.allowExternalProviderExecution === true) return null
  return {
    kind: "blocked",
    code: "EXTERNAL_EXECUTION_NOT_AUTHORIZED",
    message:
      "Execução de provider externo não autorizada: capability ausente ou negada " +
      `(${efetiva.concedidaPor}).`,
  }
}

/**
 * Comportamento HISTÓRICO para rejeições sem decisão de matriz (GOAL-012).
 *
 * O stub de homologação e o `UncertainStateTestStub` não sabem nada de `cStat` real e sempre
 * produziram "número consumido, exige inutilização". Preservar esse default mantém os drills
 * existentes válidos. Produtores com matriz (016D-B em diante) SEMPRE enviam `consequences` e
 * nunca chegam aqui — é o que impede que `110` (denegação) herde uma inutilização indevida.
 */
const REJEICAO_SEM_MATRIZ_EXIGE_INUTILIZACAO = true

function exigeInutilizacao(consequences: FiscalRejectionConsequences | undefined): boolean {
  return consequences?.requiresInutilizacao ?? REJEICAO_SEM_MATRIZ_EXIGE_INUTILIZACAO
}

export function fiscalXmlBytes(xmlAssinado: string): Uint8Array {
  return new TextEncoder().encode(xmlAssinado)
}

export function fiscalBytesSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function sameLocator(
  locator: FiscalDocumentLocator,
  document: PersistedFiscalDocument | FinalizedFiscalDocument,
): boolean {
  return (
    document.storeId === locator.storeId &&
    document.vendaId === locator.vendaId &&
    document.notaFiscalId === locator.notaFiscalId
  )
}

function validFiscalIdentity(document: FinalizedFiscalDocument | PersistedFiscalDocument): boolean {
  return (
    document.modelo === "NFCE" &&
    document.ambiente === "HOMOLOGACAO" &&
    Number.isInteger(document.serie) &&
    document.serie > 0 &&
    Number.isInteger(document.numero) &&
    document.numero > 0 &&
    document.numero <= 999_999_999 &&
    /^\d{44}$/.test(document.chaveAcesso)
  )
}

function persistedBytes(
  document: PersistedFiscalDocument,
): { bytes: Uint8Array; sha256: string } | null {
  if (!document.xmlAssinado || !document.xmlBytesSha256) return null
  const bytes = fiscalXmlBytes(document.xmlAssinado)
  const sha256 = fiscalBytesSha256(bytes)
  return sha256 === document.xmlBytesSha256 ? { bytes, sha256 } : null
}

function assertPersistedDocument(
  locator: FiscalDocumentLocator,
  document: PersistedFiscalDocument,
): Extract<SafeEmissionOutcomeKind, { kind: "blocked" }> | null {
  if (!sameLocator(locator, document) || !validFiscalIdentity(document)) {
    return {
      kind: "blocked",
      code: "SCOPE_MISMATCH",
      message: "Documento persistido não pertence ao escopo fiscal solicitado.",
    }
  }
  if (!document.xmlAssinado || !document.xmlBytesSha256) {
    return {
      kind: "blocked",
      code: "PERSISTED_BYTES_MISSING",
      message: "XML assinado exato não está persistido; transmissão bloqueada.",
    }
  }
  if (!persistedBytes(document)) {
    return {
      kind: "blocked",
      code: "PERSISTED_BYTES_MISMATCH",
      message: "SHA-256 diverge dos bytes persistidos; transmissão bloqueada.",
    }
  }
  return null
}

/**
 * A única fronteira que pode chamar `provider.transmit` no GOAL-012.
 * Em retomada, jamais chama preparer: relê e transmite os bytes persistidos.
 */
export async function transmitWithUncertainStateSafety(input: {
  locator: FiscalDocumentLocator
  persistence: UncertainStatePersistence
  preparer: FinalizedDocumentPreparer
  provider: UncertainStateFiscalProvider
  now?: Date
  retryAuthorizedByConsultation?: boolean
  /** Capability de execução externa. Ausente ⇒ negada (016D-A). */
  capability?: FiscalExternalExecutionCapability
}): Promise<SafeEmissionOutcome> {
  const recorder = createExecutionProvenanceRecorder()
  try {
    const outcome = await runTransmission(input, recorder)
    return { ...outcome, provenance: recorder.snapshot() }
  } catch (error) {
    throw attachProvenance(error, recorder.snapshot())
  }
}

async function runTransmission(
  input: Parameters<typeof transmitWithUncertainStateSafety>[0],
  recorder: ExecutionProvenanceRecorder,
): Promise<SafeEmissionOutcomeKind> {
  const now = input.now ?? new Date()
  const naoAutorizado = externalExecutionBlock(input.provider, input.capability)
  if (naoAutorizado) return naoAutorizado

  let document = await input.persistence.load(input.locator)
  if (document?.status === "AUTORIZADA") {
    const invalid = assertPersistedDocument(input.locator, document)
    if (invalid) return invalid
    return {
      kind: "authorized",
      document,
      idempotent: true,
      bytesSha256: document.xmlBytesSha256!,
    }
  }
  if (document?.status === "REJEITADA") {
    return {
      kind: "blocked",
      code: "DOCUMENT_ALREADY_REJECTED",
      message: "Número consumido por rejeição; reutilização bloqueada.",
    }
  }

  if (document?.status === "TRANSMITINDO") {
    const invalid = assertPersistedDocument(input.locator, document)
    if (invalid) return invalid
    if (!input.retryAuthorizedByConsultation) {
      return {
        kind: "blocked",
        code: "CONSULTATION_REQUIRED",
        message: "Consulta obrigatória antes de qualquer retransmissão.",
      }
    }
  } else {
    const prepared = await input.preparer.prepare(input.locator)
    if (
      !sameLocator(input.locator, prepared) ||
      !validFiscalIdentity(prepared) ||
      !prepared.xmlAssinado
    ) {
      return {
        kind: "blocked",
        code: "SCOPE_MISMATCH",
        message: "Documento finalizado é inválido ou não pertence ao escopo solicitado.",
      }
    }
    const bytes = fiscalXmlBytes(prepared.xmlAssinado)
    document = await input.persistence.persistBeforeTransmission({
      document: prepared,
      bytesSha256: fiscalBytesSha256(bytes),
      now,
    })
    const invalid = assertPersistedDocument(input.locator, document)
    if (invalid) return invalid
  }

  const exact = persistedBytes(document)
  if (!exact) {
    return {
      kind: "blocked",
      code: "PERSISTED_BYTES_MISMATCH",
      message: "Bytes persistidos não puderam ser verificados.",
    }
  }
  // A partir daqui o provider É invocado. O atalho idempotente acima retorna ANTES desta
  // marcação — é por isso que a proveniência deriva do que foi executado, não da posição.
  recorder.markProviderInvoked(input.provider.simulado)
  const result = await input.provider.transmit({
    document,
    exactBytes: exact.bytes,
    bytesSha256: exact.sha256,
    provenance: recorder,
  })
  if (result.outcome === "AUTHORIZED") {
    await input.persistence.markAuthorized({
      document,
      result,
      now,
      source: "TRANSMISSION",
    })
    return {
      kind: "authorized",
      document,
      idempotent: false,
      bytesSha256: exact.sha256,
    }
  }
  if (result.outcome === "REJECTED") {
    const requiresInutilizacao = exigeInutilizacao(result.consequences)
    await input.persistence.markRejected({
      document,
      result,
      now,
      source: "TRANSMISSION",
      requiresInutilizacao,
    })
    return {
      kind: "rejected",
      document,
      requiresInutilizacao,
      bytesSha256: exact.sha256,
    }
  }
  /**
   * `656` — consumo indevido (D12.2). ⛔ Sai ANTES de
   * `recordUncertainAndEnsureConsultation`: cair no ramo genérico de incerteza criaria um job
   * `CONSULTA`, ou seja, mais uma chamada — exatamente o *looping* que o `656` denuncia.
   * Nada é persistido aqui: a nota já está `TRANSMITINDO` e a pausa/estacionamento pertencem
   * à fila, que os aplica antes de liberar o lock.
   */
  if (result.outcome === "UNCERTAIN" && result.code === "THROTTLED") {
    return {
      kind: "throttled",
      document,
      cStat: result.cStat,
      xMotivo: result.xMotivo,
      bytesSha256: exact.sha256,
      message: result.message,
    }
  }
  /**
   * `103/105` — lote recebido/em processamento (D12.1). A nota permanece `TRANSMITINDO` e a
   * consulta deduplicada do MESMO documento é criada ou reencontrada, com o recibo persistido
   * no payload existente. ⛔ Nenhuma retransmissão: o lote já está com a SEFAZ.
   */
  if (result.outcome === "UNCERTAIN" && result.code === "PROCESSING") {
    const emProcessamento = await input.persistence.recordUncertainAndEnsureConsultation({
      document,
      code: result.code,
      message: result.message,
      now,
      recibo: result.recibo,
    })
    return {
      kind: "processing",
      document,
      consultationJobId: emProcessamento.consultationJobId,
      consultationJobCreated: emProcessamento.created,
      recibo: result.recibo,
      cStat: result.cStat,
      xMotivo: result.xMotivo,
      bytesSha256: exact.sha256,
      message: result.message,
    }
  }
  const consultation = await input.persistence.recordUncertainAndEnsureConsultation({
    document,
    code: result.code,
    message: result.message,
    now,
  })
  return {
    kind: "uncertain",
    document,
    consultationJobId: consultation.consultationJobId,
    consultationJobCreated: consultation.created,
    bytesSha256: exact.sha256,
    message: result.message,
  }
}

/** CONSULTA é a única autoridade que resolve o estado incerto. */
export async function reconcileUncertainDocument(input: {
  locator: FiscalDocumentLocator
  persistence: UncertainStatePersistence
  provider: UncertainStateFiscalProvider
  now?: Date
  capability?: FiscalExternalExecutionCapability
}): Promise<ConsultationOutcome> {
  const recorder = createExecutionProvenanceRecorder()
  try {
    const outcome = await runConsultation(input, recorder)
    return { ...outcome, provenance: recorder.snapshot() }
  } catch (error) {
    throw attachProvenance(error, recorder.snapshot())
  }
}

async function runConsultation(
  input: Parameters<typeof reconcileUncertainDocument>[0],
  recorder: ExecutionProvenanceRecorder,
): Promise<ConsultationOutcomeKind> {
  const now = input.now ?? new Date()
  // Autorização PRIMEIRO, espelhando `runTransmission`: uma execução não autorizada não deve
  // sequer revelar se o documento existe ou é válido.
  const naoAutorizado = externalExecutionBlock(input.provider, input.capability)
  if (naoAutorizado) throw new Error(naoAutorizado.message)

  const document = await input.persistence.load(input.locator)
  if (!document || document.status !== "TRANSMITINDO") {
    throw new Error("Consulta exige NotaFiscal TRANSMITINDO no mesmo storeId.")
  }
  const invalid = assertPersistedDocument(input.locator, document)
  if (invalid) throw new Error(invalid.message)

  recorder.markProviderInvoked(input.provider.simulado)
  const result = await input.provider.consult({ document, provenance: recorder })
  if (result.outcome === "AUTHORIZED") {
    await input.persistence.markAuthorized({
      document,
      result,
      now,
      source: "CONSULTATION",
    })
    return { kind: "authorized", document }
  }
  if (result.outcome === "REJECTED") {
    const requiresInutilizacao = exigeInutilizacao(result.consequences)
    await input.persistence.markRejected({
      document,
      result,
      now,
      source: "CONSULTATION",
      requiresInutilizacao,
    })
    return { kind: "rejected", document, requiresInutilizacao }
  }
  /**
   * ⚠️ A partir daqui **cada desfecho é tratado explicitamente**, e `NOT_FOUND` deixou de ser
   * o `else` (GOAL-016D-B).
   *
   * A versão anterior autorizava retransmissão exata para tudo que não fosse `AUTHORIZED` nem
   * `REJECTED`. Com o contrato ampliado, um `THROTTLED` ou um SOAP Fault cairiam ali e
   * liberariam um novo envio sem que a SEFAZ jamais tivesse dito que o documento não existe —
   * um fail-OPEN no ponto mais caro da máquina de estado.
   */
  if (result.outcome === "UNCERTAIN" && result.code === "THROTTLED") {
    // ⛔ Nenhuma nova consulta é agendada: insistir é a causa documentada do `656`.
    return {
      kind: "throttled",
      document,
      cStat: result.cStat,
      xMotivo: result.xMotivo,
      message: result.message,
    }
  }
  if (result.outcome === "UNCERTAIN" && result.code === "PROCESSING") {
    // Lote ainda em processamento: reencontra a MESMA consulta do documento/recibo. A nota
    // segue `TRANSMITINDO` e nenhuma transmissão nova é autorizada.
    const emProcessamento = await input.persistence.recordUncertainAndEnsureConsultation({
      document,
      code: result.code,
      message: result.message,
      now,
      recibo: result.recibo,
    })
    return {
      kind: "processing",
      document,
      consultationJobId: emProcessamento.consultationJobId,
      consultationJobCreated: emProcessamento.created,
      recibo: result.recibo,
      cStat: result.cStat,
      xMotivo: result.xMotivo,
      message: result.message,
    }
  }
  if (result.outcome === "UNCERTAIN") {
    // Consulta que não resolveu nada. O documento continua incerto e **nenhuma** retransmissão
    // é autorizada: só `NOT_FOUND` explícito da SEFAZ pode fazer isso.
    return { kind: "uncertain", document, code: result.code, message: result.message }
  }
  await input.persistence.authorizeExactRetransmission({ document, now })
  return { kind: "not_found", document, retransmissionAuthorized: true }
}
