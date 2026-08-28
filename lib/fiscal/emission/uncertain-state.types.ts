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
  /**
   * Metadados QR/XMLDSig persistidos **antes** da transmissão (GOAL 021).
   * Aditivos: construtores anteriores podem omiti-los. `load()` relê as colunas;
   * nunca são recalculados depois da persistência.
   */
  digestValue?: string | null
  qrCodeData?: string | null
  urlConsulta?: string | null
}

export type FinalizedFiscalDocument = FiscalDocumentIdentity & {
  xmlAssinado: string
  /**
   * Digest SHA-1 Base64 do `infNFe` (XMLDSig). Aditivo: o preparer canônico
   * preenche a partir de `signNfceXmlDetailed`, sem reparsear o XML.
   */
  digestValue?: string | null
  /**
   * Conteúdo textual de `<qrCode>` produzido com o XML. Aditivo. Origem
   * estrutural (`infNFeSupl.qrCode`), não extração posterior.
   */
  qrCodeData?: string | null
  /**
   * Conteúdo textual de `<urlChave>` produzido com o XML. Aditivo. Origem
   * estrutural (`infNFeSupl.urlChave`).
   */
  urlConsulta?: string | null
}

export type FinalizedDocumentPrepareOptions = {
  /**
   * Modalidade de emissão do documento construído. GOAL 020: a primeira
   * entrada em contingência passa 9 porque `NotaFiscal.tipoEmissao` só é
   * flipado para `CONTINGENCIA_OFFLINE` depois do prepare; sem isso o builder
   * recusaria dhCont/xJust para o tpEmis=1 derivado do estado persistido.
   */
  tpEmis?: number
  dhCont?: string | Date
  xJust?: string
}

/**
 * Consequências fiscais EXPLÍCITAS de uma rejeição (GOAL-016D-B · D12).
 *
 * Existe para que `requiresInutilizacao` deixe de ser o literal `true` que o coordenador
 * aplicava a qualquer rejeição. Quem decide é a matriz de `cStat`
 * (`lib/fiscal/provider/sefaz/sefaz-cstat-matrix.ts`); o coordenador obedece.
 *
 * Campo **opcional** no resultado: produtores anteriores ao 016D-B (stub de homologação,
 * `UncertainStateTestStub`, drills) não o enviam e mantêm o comportamento histórico. Um
 * produtor com matriz nunca omite.
 */
export type FiscalRejectionConsequences = {
  readonly terminal: boolean
  readonly numeroConsumido: boolean
  readonly requiresInutilizacao: boolean
  readonly requiresConsultation: boolean
}

/**
 * Desfecho incerto com **lote em processamento** — `cStat 103/105` (GOAL-016D-B · D12.1).
 *
 * Não é falha, não é timeout e não é rejeição: o lote JÁ está com a SEFAZ. Obriga consulta do
 * mesmo recibo e **proíbe** retransmissão — retransmitir aqui duplicaria o documento.
 */
export type ProcessingFiscalResult = {
  outcome: "UNCERTAIN"
  code: "PROCESSING"
  message: string
  cStat: string
  xMotivo: string
  /** `nRec` do lote. Sem ele não há o que consultar — o parser rebaixa para `UNKNOWN`. */
  recibo: string
  /** Literal: um `PROCESSING` sem consulta obrigatória seria um documento abandonado. */
  requiresConsultation: true
}

/**
 * Desfecho incerto com **consumo indevido** — `cStat 656` (GOAL-016D-B · D12.2).
 *
 * Parada dura. ⛔ Não agenda consulta (consultar é o que agrava o `656`), ⛔ não agenda retry,
 * ⛔ não é terminal. A nota permanece `TRANSMITINDO` e a retomada é **humana**.
 */
export type ThrottledFiscalResult = {
  outcome: "UNCERTAIN"
  code: "THROTTLED"
  message: string
  cStat: string
  xMotivo: string
}

export type FiscalTransmissionResult =
  | AuthorizedFiscalResult
  | {
      outcome: "UNCERTAIN"
      code: "TIMEOUT" | "CONNECTION_LOST" | "UNKNOWN"
      message: string
    }
  | ProcessingFiscalResult
  | ThrottledFiscalResult
  | {
      outcome: "REJECTED"
      cStat: string
      xMotivo: string
      consequences?: FiscalRejectionConsequences
    }

export type FiscalConsultationResult =
  | AuthorizedFiscalResult
  | {
      outcome: "NOT_FOUND"
      cStat: string
      xMotivo: string
    }
  | ProcessingFiscalResult
  | ThrottledFiscalResult
  | {
      outcome: "UNCERTAIN"
      code: "TIMEOUT" | "CONNECTION_LOST" | "UNKNOWN"
      message: string
    }
  | {
      outcome: "REJECTED"
      cStat: string
      xMotivo: string
      consequences?: FiscalRejectionConsequences
    }

/**
 * Resultado de autorização fiscal — ADR-0018 (GOAL-013).
 *
 * `digestValue`/`qrCodeData`/`urlConsulta` são **opcionais** para preservar
 * o contrato do `stubHomologacaoProvider` e do `UncertainStateTestStub` do
 * GOAL-012. O caminho canônico da NFC-e (GOAL 021) já os persiste em
 * `persistBeforeTransmission` a partir do XML finalizado. `markAuthorized`
 * não apaga valores já persistidos quando o resultado os omite; valor
 * divergente falha fechado. O schema já os suporta
 * (`NotaFiscal.{digestValue,qrCodeData,urlConsulta}`).
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
  | "metadados_qr_imutavel_diverge"

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

/**
 * Produtor do documento fiscal finalizado **antes** da fronteira de transmissão.
 *
 * O produtor canônico da NFC-e é `createFinalizedNfcePreparer`: XML embutível
 * + QR v3 + XMLDSig na mesma construção. Stubs de teste podem omitir QR.
 */
export interface FinalizedDocumentPreparer {
  prepare(
    locator: FiscalDocumentLocator,
    options?: FinalizedDocumentPrepareOptions,
  ): Promise<FinalizedFiscalDocument>
}

export interface UncertainStatePersistence {
  load(locator: FiscalDocumentLocator): Promise<PersistedFiscalDocument | null>
  /** Promove uma nota contingenciada, já persistida, para TRANSMITINDO sem tocar nos bytes. */
  beginTransmission?(input: {
    document: PersistedFiscalDocument
    now: Date
  }): Promise<PersistedFiscalDocument>
  /**
   * Persiste identidade, numeração, chave, XML assinado, SHA-256 dos
   * exactBytes e metadados QR (`digestValue`/`qrCodeData`/`urlConsulta`) e
   * TRANSMITINDO em uma única fronteira local. Deve devolver o registro
   * relido do armazenamento — sem recalcular QR nem reconstruir XML.
   */
  persistBeforeTransmission(input: {
    document: FinalizedFiscalDocument
    bytesSha256: string
    now: Date
  }): Promise<PersistedFiscalDocument>
  /**
   * Mantém a nota em TRANSMITINDO e cria/reencontra o job CONSULTA na mesma
   * unidade atômica. Nunca agenda retransmissão.
   *
   * `recibo` (GOAL-016D-B · D12.1) é **aditivo e opcional**: quando o desfecho é
   * `PROCESSING`, o `nRec` do lote é persistido no payload existente do job de EMISSÃO —
   * sem schema novo, sem coluna nova. A deduplicação continua sendo por documento, de modo
   * que `103`/`105` repetidos reencontram a MESMA consulta em vez de enfileirar outra.
   */
  recordUncertainAndEnsureConsultation(input: {
    document: PersistedFiscalDocument
    code: string
    message: string
    now: Date
    recibo?: string | null
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
      /**
       * ⚠️ `boolean`, não o literal `true` (GOAL-016D-B). Rejeições diferem: `110` (denegação)
       * é terminal e consome o número, mas **não** pede inutilização. Fixar `true` no tipo
       * obrigava toda rejeição a pedir uma ação fiscal destrutiva.
       */
      requiresInutilizacao: boolean
      bytesSha256: string
    }
  /**
   * `cStat 103/105` — lote com a SEFAZ (D12.1). A nota permanece `TRANSMITINDO`, a consulta
   * deduplicada do MESMO documento/recibo é criada ou reencontrada, e **nada é retransmitido**.
   */
  | {
      kind: "processing"
      document: PersistedFiscalDocument
      consultationJobId: string
      consultationJobCreated: boolean
      recibo: string
      cStat: string
      xMotivo: string
      bytesSha256: string
      message: string
    }
  /**
   * `cStat 656` — consumo indevido (D12.2). Nenhuma consulta é agendada, nenhum retry é
   * calculado. A pausa da loja e o estacionamento do job pertencem à fila.
   */
  | {
      kind: "throttled"
      document: PersistedFiscalDocument
      cStat: string
      xMotivo: string
      bytesSha256: string
      message: string
    }
  | {
      kind: "blocked"
      code:
        | "CONSULTATION_REQUIRED"
        | "DOCUMENT_ALREADY_REJECTED"
        | "PERSISTED_BYTES_MISSING"
        | "PERSISTED_BYTES_MISMATCH"
        | "SCOPE_MISMATCH"
        | "CONTINGENCY_TRANSMISSION_PORT_UNAVAILABLE"
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
  | { kind: "rejected"; document: PersistedFiscalDocument; requiresInutilizacao: boolean }
  /** `103/105` em consulta: nova consulta do MESMO recibo — jamais nova transmissão. */
  | {
      kind: "processing"
      document: PersistedFiscalDocument
      consultationJobId: string
      consultationJobCreated: boolean
      recibo: string
      cStat: string
      xMotivo: string
      message: string
    }
  /** `656` em consulta: pausa a loja e **não** agenda nova consulta. */
  | {
      kind: "throttled"
      document: PersistedFiscalDocument
      cStat: string
      xMotivo: string
      message: string
    }
  /**
   * Consulta que não resolveu nada (SOAP Fault, serviço fora do ar, resposta ilegível).
   *
   * ⚠️ Este ramo existe porque a ausência dele era um **fail-open**: `runConsultation` tratava
   * "não é AUTHORIZED nem REJECTED" como `NOT_FOUND` e chamava
   * `authorizeExactRetransmission`. Qualquer desfecho novo — inclusive `THROTTLED` — passaria a
   * autorizar retransmissão sem que a SEFAZ tivesse dito que o documento não existe.
   */
  | {
      kind: "uncertain"
      document: PersistedFiscalDocument
      code: string
      message: string
    }
