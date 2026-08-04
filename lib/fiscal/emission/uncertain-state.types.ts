export type FiscalDocumentLocator = {
  storeId: string
  vendaId: string
  notaFiscalId: string
}

export type FiscalDocumentIdentity = FiscalDocumentLocator & {
  modelo: "NFCE"
  ambiente: "HOMOLOGACAO"
  serie: number
  numero: number
  chaveAcesso: string
  /**
   * UF do emitente (ADR-0020 §2.6 — **aditivo**). Opcional para preservar todos os
   * construtores existentes; o adapter SEFAZ (016D-A) **bloqueia antes do transporte**
   * quando ausente. Não reconstrói XML, chave nem hash.
   */
  uf?: string
  /**
   * Correlação idempotente da execução (ADR-0020 §2.6 — **aditivo**). Mesma regra: opcional
   * no contrato, obrigatório no adapter real antes do transporte.
   */
  correlationId?: string
}

export type PersistedFiscalDocument = FiscalDocumentIdentity & {
  status:
    | "RASCUNHO"
    | "VALIDANDO"
    | "ASSINADA"
    | "TRANSMITINDO"
    | "AUTORIZADA"
    | "REJEITADA"
    | "DENEGADA"
    | "CONTINGENCIA"
    | "CANCELADA"
    | "INUTILIZADA"
    | "ERRO"
  xmlAssinado: string | null
  xmlBytesSha256: string | null
  protocolo?: string | null
  xmlAutorizado?: string | null
  cStat?: string | null
  xMotivo?: string | null
}

export type FinalizedFiscalDocument = FiscalDocumentIdentity & {
  xmlAssinado: string
}

export type FiscalTransmissionResult =
  | AuthorizedFiscalResult
  | {
      outcome: "UNCERTAIN"
      code: "TIMEOUT" | "CONNECTION_LOST" | "UNKNOWN"
      message: string
    }
  | {
      outcome: "REJECTED"
      cStat: string
      xMotivo: string
    }

export type FiscalConsultationResult =
  | AuthorizedFiscalResult
  | {
      outcome: "NOT_FOUND"
      cStat: string
      xMotivo: string
    }
  | {
      outcome: "REJECTED"
      cStat: string
      xMotivo: string
    }

/**
 * Resultado de autorização fiscal — ADR-0018 (GOAL-013).
 *
 * `digestValue`/`qrCodeData`/`urlConsulta` são **opcionais** para preservar
 * o contrato do `stubHomologacaoProvider` e do `UncertainStateTestStub` do
 * GOAL-012 — um provider real (F5/GOAL-021) passa a preenchê-los. O schema
 * já os suporta (`NotaFiscal.{digestValue,qrCodeData,urlConsulta}`).
 */
export type AuthorizedFiscalResult = {
  outcome: "AUTHORIZED"
  protocolo: string
  cStat: string
  xMotivo: string
  xmlAutorizado: string
  digestValue?: string | null
  qrCodeData?: string | null
  urlConsulta?: string | null
}

/**
 * Códigos estáveis de divergência de imutabilidade emitidos por `markAuthorized`
 * (ADR-0018). Nenhum XML é exposto; o código e identificadores documentam o
 * motivo sem conteúdo do documento.
 */
export type AuthorizedDivergenceCode =
  | "xml_autorizado_imutavel_diverge"
  | "protocolo_imutavel_diverge"
  | "metadados_autorizacao_divergem"

export class AuthorizedDivergenceError extends Error {
  readonly code: AuthorizedDivergenceCode
  constructor(code: AuthorizedDivergenceCode, message?: string) {
    super(message ?? code)
    this.name = "AuthorizedDivergenceError"
    this.code = code
  }
}

/**
 * Proveniência TIPADA de uma execução fiscal (GOAL-016D-A · plano 016D F-2).
 *
 * Existe para que a trilha de auditoria (`simulado` / `externalTransmissionAttempted` do
 * `FiscalQueueExecutionResult`) **derive do que realmente aconteceu**, em vez de literais
 * fixos. Literais mentiriam no instante em que houvesse transmissão real — exatamente o
 * achado F-2 do plano 016D.
 */
export type FiscalExecutionProvenance = {
  /** O provider chegou a ser invocado (`transmit`/`consult`)? Bloqueio antes ⇒ `false`. */
  readonly providerInvoked: boolean
  /** O provider que executou declara-se simulado? */
  readonly providerSimulado: boolean
  /** Algum transporte REALMENTE iniciou contato externo? Offline ⇒ sempre `false`. */
  readonly externalTransmissionAttempted: boolean
}

/**
 * Contrato do provider de transmissão segura (P2 — ADR-0017/ADR-0020).
 *
 * ⚠️ `simulado` é **rótulo de trilha, NUNCA controle de segurança** (plano 016D F-1). O tipo
 * é `boolean` — e não o literal `true` — justamente para que um provider real possa se
 * declarar **honestamente** como não simulado. A barreira mecânica é o coordenador
 * (`transmitWithUncertainStateSafety` ⇒ `REAL_PROVIDER_BLOCKED`), que continua bloqueando
 * qualquer provider não simulado ANTES de chamar `transmit`.
 */
export interface UncertainStateFiscalProvider {
  readonly simulado: boolean
  /**
   * Proveniência de rede da ÚLTIMA execução deste provider. Ausente ⇒ provider puramente em
   * memória (jamais alcança rede) ⇒ o caller deriva `false`.
   */
  readonly reportExternalTransmissionAttempted?: () => boolean
  transmit(input: {
    document: FiscalDocumentIdentity
    exactBytes: Uint8Array
    bytesSha256: string
  }): Promise<FiscalTransmissionResult>
  consult(input: {
    document: FiscalDocumentIdentity
  }): Promise<FiscalConsultationResult>
}

export interface FinalizedDocumentPreparer {
  prepare(locator: FiscalDocumentLocator): Promise<FinalizedFiscalDocument>
}

export interface UncertainStatePersistence {
  load(locator: FiscalDocumentLocator): Promise<PersistedFiscalDocument | null>
  /**
   * Persiste identidade, numeração, chave, XML assinado e TRANSMITINDO em uma
   * única fronteira local. Deve devolver o registro relido do armazenamento.
   */
  persistBeforeTransmission(input: {
    document: FinalizedFiscalDocument
    bytesSha256: string
    now: Date
  }): Promise<PersistedFiscalDocument>
  /**
   * Mantém a nota em TRANSMITINDO e cria/reencontra o job CONSULTA na mesma
   * unidade atômica. Nunca agenda retransmissão.
   */
  recordUncertainAndEnsureConsultation(input: {
    document: PersistedFiscalDocument
    code: string
    message: string
    now: Date
  }): Promise<{ consultationJobId: string; created: boolean }>
  markAuthorized(input: {
    document: PersistedFiscalDocument
    result: Extract<FiscalTransmissionResult | FiscalConsultationResult, { outcome: "AUTHORIZED" }>
    now: Date
    source: "TRANSMISSION" | "CONSULTATION"
  }): Promise<void>
  markRejected(input: {
    document: PersistedFiscalDocument
    result: Extract<FiscalTransmissionResult | FiscalConsultationResult, { outcome: "REJECTED" }>
    now: Date
    source: "TRANSMISSION" | "CONSULTATION"
    requiresInutilizacao: boolean
  }): Promise<void>
  authorizeExactRetransmission(input: {
    document: PersistedFiscalDocument
    now: Date
  }): Promise<void>
}

export type SafeEmissionOutcome =
  | {
      kind: "authorized"
      document: PersistedFiscalDocument
      idempotent: boolean
      bytesSha256: string
    }
  | {
      kind: "uncertain"
      document: PersistedFiscalDocument
      consultationJobId: string
      consultationJobCreated: boolean
      bytesSha256: string
      message: string
    }
  | {
      kind: "rejected"
      document: PersistedFiscalDocument
      requiresInutilizacao: true
      bytesSha256: string
    }
  | {
      kind: "blocked"
      code:
        | "CONSULTATION_REQUIRED"
        | "DOCUMENT_ALREADY_REJECTED"
        | "PERSISTED_BYTES_MISSING"
        | "PERSISTED_BYTES_MISMATCH"
        | "SCOPE_MISMATCH"
        | "REAL_PROVIDER_BLOCKED"
      message: string
    }

export type ConsultationOutcome =
  | { kind: "authorized"; document: PersistedFiscalDocument }
  | { kind: "not_found"; document: PersistedFiscalDocument; retransmissionAuthorized: true }
  | { kind: "rejected"; document: PersistedFiscalDocument; requiresInutilizacao: true }
