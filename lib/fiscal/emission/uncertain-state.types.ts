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
 *
 * ⚠️ **Escopo de EXECUÇÃO, nunca de instância** (correção 002 · bloqueio 3). Uma versão
 * anterior guardava a proveniência num campo mutável do provider e a acumulava de forma
 * monotônica. Isso responde "alguma execução desta instância já tentou rede?", que não é a
 * pergunta da auditoria: sob reuso de instância num worker pool, o job B herdava o `true` do
 * job A e registrava contato externo para uma execução que não fez nenhum. Agora cada
 * execução recebe um coletor novo e a trilha descreve exatamente aquela execução.
 */
export type FiscalExecutionProvenance = {
  /** O provider chegou a ser invocado (`transmit`/`consult`)? Bloqueio antes ⇒ `false`. */
  readonly providerInvoked: boolean
  /** O provider que executou declara-se simulado? */
  readonly providerSimulado: boolean
  /** Algum transporte REALMENTE iniciou contato externo NESTA execução? Offline ⇒ `false`. */
  readonly externalTransmissionAttempted: boolean
}

/**
 * Coletor de proveniência de UMA execução. O coordenador cria um por chamada e o repassa ao
 * provider; o provider só sabe *reportar*, nunca ler o estado de outra execução.
 */
export interface FiscalExecutionProvenanceSink {
  /** Chamado quando um transporte REALMENTE iniciou contato externo nesta execução. */
  recordExternalTransmissionAttempted(): void
}

/** Proveniência de uma execução que sequer chegou a invocar o provider. */
export const PROVIDER_NOT_INVOKED_PROVENANCE: FiscalExecutionProvenance = Object.freeze({
  providerInvoked: false,
  providerSimulado: false,
  externalTransmissionAttempted: false,
})

/**
 * Marca de provider **puramente em memória** (correção 002 · bloqueio 2).
 *
 * `Symbol(...)` de módulo — não `Symbol.for(...)` — de modo que a marca só possa ser aposta
 * por quem importa este contrato, e seja grep-ável numa auditoria.
 *
 * O sentido da marca é **fail-closed**: a AUSÊNCIA classifica o provider como externo e exige
 * capability injetada. Ela não é o inverso de `simulado`: `simulado` é um rótulo de trilha que
 * qualquer provider pode declarar à vontade (inclusive mentindo) e que NÃO concede nem remove
 * autorização; esta marca é uma afirmação estrutural de que não existe transporte de rede
 * naquela implementação, e mentir nela exige importar e apor o símbolo deliberadamente.
 */
export const IN_MEMORY_ONLY_FISCAL_PROVIDER = Symbol("fiscal.provider.in-memory-only")

/**
 * Capability de execução de provider EXTERNO — injetada por execução (correção 002 · bloqueio 2).
 *
 * Substitui o acoplamento `if (!provider.simulado) → REAL_PROVIDER_BLOCKED`, que deixava a
 * autorização nas mãos de um rótulo autodeclarado: um provider real que se dissesse simulado
 * era autorizado, e um stub honesto que se dissesse real era barrado. Agora a autorização vem
 * de fora do provider e **nasce negada**.
 */
export type FiscalExternalExecutionCapability = {
  readonly allowExternalProviderExecution: boolean
  /** Procedência da concessão — vai para a trilha; nunca contém segredo. */
  readonly concedidaPor: string
}

/**
 * Capability DEFAULT do 016D-A: negada. Nenhum caller deste slice recebe autorização; o
 * desbloqueio pertence ao 016D-D e exigirá GOAL próprio.
 */
export const EXTERNAL_EXECUTION_DENIED: FiscalExternalExecutionCapability = Object.freeze({
  allowExternalProviderExecution: false,
  concedidaPor:
    "016D-A: execução de provider externo nasce negada; liberação pertence ao 016D-D.",
})

/**
 * Contrato do provider de transmissão segura (P2 — ADR-0017/ADR-0020).
 *
 * ⚠️ `simulado` é **rótulo de trilha, NUNCA controle de segurança** (plano 016D F-1). Nenhuma
 * decisão de autorização o consulta: quem autoriza é `FiscalExternalExecutionCapability`, e
 * quem dispensa a autorização é a marca `IN_MEMORY_ONLY_FISCAL_PROVIDER`.
 */
export interface UncertainStateFiscalProvider {
  /** Rótulo de AUDITORIA apenas. Não concede nem remove autorização. */
  readonly simulado: boolean
  /** Marca estrutural de provider sem transporte de rede. Ausente ⇒ tratado como externo. */
  readonly [IN_MEMORY_ONLY_FISCAL_PROVIDER]?: true
  transmit(input: {
    document: FiscalDocumentIdentity
    exactBytes: Uint8Array
    bytesSha256: string
    /** Coletor desta execução. Ausente ⇒ o provider não tem onde reportar contato externo. */
    provenance?: FiscalExecutionProvenanceSink
  }): Promise<FiscalTransmissionResult>
  consult(input: {
    document: FiscalDocumentIdentity
    provenance?: FiscalExecutionProvenanceSink
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

/**
 * Desfecho da emissão segura. `provenance` descreve **esta** execução (correção 002 ·
 * bloqueio 3) e é a única fonte das flags de auditoria da fila.
 */
export type SafeEmissionOutcome = SafeEmissionOutcomeKind & {
  readonly provenance: FiscalExecutionProvenance
}

export type SafeEmissionOutcomeKind =
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
        /**
         * Execução de provider EXTERNO sem capability concedida (correção 002 · bloqueio 2).
         * Substitui `REAL_PROVIDER_BLOCKED`, cujo nome e mecânica ligavam a autorização ao
         * rótulo autodeclarado `simulado`.
         */
        | "EXTERNAL_EXECUTION_NOT_AUTHORIZED"
      message: string
    }

export type ConsultationOutcome = ConsultationOutcomeKind & {
  readonly provenance: FiscalExecutionProvenance
}

export type ConsultationOutcomeKind =
  | { kind: "authorized"; document: PersistedFiscalDocument }
  | { kind: "not_found"; document: PersistedFiscalDocument; retransmissionAuthorized: true }
  | { kind: "rejected"; document: PersistedFiscalDocument; requiresInutilizacao: true }
