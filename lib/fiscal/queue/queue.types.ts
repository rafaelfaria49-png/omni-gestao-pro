/**
 * Contratos da fila fiscal operacional (GOAL-011).
 *
 * A fila permanece restrita ao provider simulado. Os contratos já carregam a trava que
 * impedirá retry de transmissão externa sem consulta autorizadora em GOAL futuro.
 */

export type FiscalQueueJobStatus =
  | "PENDENTE"
  | "PROCESSANDO"
  | "AGUARDANDO_RETRY"
  | "CONCLUIDO"
  | "FALHA"
  | "CANCELADO"

export type FiscalQueueJobType =
  | "EMISSAO"
  | "CANCELAMENTO"
  | "INUTILIZACAO"
  | "CONTINGENCIA_TRANSMISSAO"
  | "CONSULTA"

export type FiscalQueuePayload = Record<string, unknown>

export type FiscalQueueJob = {
  id: string
  storeId: string
  vendaId: string
  notaFiscalId: string | null
  tipo: FiscalQueueJobType
  status: FiscalQueueJobStatus
  tentativas: number
  maxTentativas: number
  proximaTentativaEm: Date | null
  prioridade: number
  lockOwner: string | null
  lockedAt: Date | null
  lockExpiresAt: Date | null
  dedupeKey: string | null
  payload: FiscalQueuePayload | null
  ultimoErro: string | null
  concluidoEm: Date | null
  createdAt: Date
  updatedAt: Date
}

export type FiscalQueueLease = {
  job: FiscalQueueJob
  takeover: boolean
}

export type FiscalQueuePauseSnapshot = {
  globalPaused: boolean
  globalSource: "none" | "environment" | "audit_log"
  pausedStoreIds: string[]
}

/**
 * Desfecho de execução de um job fiscal.
 *
 * ⚠️ `"throttled"` é um `kind` **dedicado** (GOAL-016D-B · D12.2 · F-5), e não um apelido de
 * outro. Reaproveitar qualquer um dos três existentes produziria justamente o comportamento
 * que o `cStat 656` proíbe:
 *
 * | `kind` | O que a fila faria | Por que é proibido |
 * |---|---|---|
 * | `transient` | retry com backoff | insistir é a causa documentada do `656` |
 * | `uncertain` | estaciona esperando `CONSULTA` | a consulta que D12.2 proíbe criar ⇒ espera infinita |
 * | `terminal` | vira `FALHA` | `FALHA` é reprocessável pela rota administrativa ⇒ retransmissão por operador |
 *
 * ⚠️ `"processing"` também é dedicado, e pela razão simétrica: um job **`CONSULTA`** que recebe
 * `cStat 103/105` precisa **voltar a consultar**. Tratá-lo como `uncertain` o mandaria para
 * `waitForConsultation`, que estaciona com `proximaTentativaEm: null` — ou seja, a consulta
 * ficaria esperando por ela mesma, para sempre, e o documento morreria em `TRANSMITINDO`.
 *
 * ⚠️ `"unresolved"` cobre o caso em que a transmissão é incerta **e a `CONSULTA` que a
 * resolveria não pôde ser criada**. `uncertain` afirmaria, em log e em estado, que se aguarda
 * uma consulta deduplicada — afirmação FALSA aqui, e é a falsidade que faz o documento sumir
 * sem alarme. Ver `parkUnresolvedTransmission`.
 */
export type FiscalQueueExecutionResult = {
  kind:
    | "success"
    | "transient"
    | "terminal"
    | "uncertain"
    | "throttled"
    | "processing"
    | "unresolved"
  code: string
  mensagem: string
  /** Sempre true no GOAL-011. Resultado false é bloqueado pelo worker. */
  simulado: boolean
  /**
   * Marca que houve transmissão externa possivelmente ambígua. No GOAL-011 é sempre false,
   * pois o único executor permitido usa STUB_HOMOLOGACAO.
   */
  externalTransmissionAttempted: boolean
  /**
   * O provider chegou a ser invocado NESTA execução? Deriva da proveniência tipada coletada
   * pelo coordenador — não é autodeclaração do executor.
   *
   * O worker usa isto para distinguir uma repetição SEGURA (consulta que falhou depois de o
   * provider responder ou lançar) de uma execução que sequer chegou lá. Ausente ⇒ desconhecido
   * ⇒ tratado como `false`, o lado conservador.
   */
  providerInvoked?: boolean
  detalhe?: Record<string, unknown>
}

export type FiscalQueueAuditEvent = {
  job: FiscalQueueJob
  acao: string
  nivel: "INFO" | "WARN" | "ERROR"
  mensagem: string
  operador?: string | null
  detalhe?: Record<string, unknown>
}

export type FiscalQueueWorkerPorts = {
  readPauseSnapshot: () => Promise<FiscalQueuePauseSnapshot>
  acquireNextJob: (input: {
    workerId: string
    now: Date
    leaseMs: number
    pausedStoreIds: string[]
  }) => Promise<FiscalQueueLease | null>
  heartbeat: (input: {
    jobId: string
    workerId: string
    now: Date
    leaseMs: number
  }) => Promise<boolean>
  markTransmissionStarted: (input: {
    job: FiscalQueueJob
    workerId: string
    now: Date
    payload: FiscalQueuePayload
  }) => Promise<boolean>
  complete: (input: {
    job: FiscalQueueJob
    workerId: string
    now: Date
    payload: FiscalQueuePayload
  }) => Promise<boolean>
  retry: (input: {
    job: FiscalQueueJob
    workerId: string
    now: Date
    nextAttemptAt: Date
    error: string
    payload: FiscalQueuePayload
  }) => Promise<boolean>
  fail: (input: {
    job: FiscalQueueJob
    workerId: string
    now: Date
    error: string
    payload: FiscalQueuePayload
  }) => Promise<boolean>
  /**
   * Estaciona uma transmissão ambígua sem agendar retry. A consulta deduplicada
   * já deve ter sido persistida atomicamente pelo executor antes deste retorno.
   */
  waitForConsultation?: (input: {
    job: FiscalQueueJob
    workerId: string
    now: Date
    error: string
    payload: FiscalQueuePayload
  }) => Promise<boolean>
  /**
   * Persiste a **pausa da loja** após um `cStat 656` (D12.2).
   *
   * ⛔ Não é best-effort: precisa devolver `true` somente quando a pausa está gravada e será
   * lida por `readPauseSnapshot`. É chamada **antes** de o lock do job ser liberado, para que
   * nunca exista uma janela em que o job já esteja solto e a loja ainda ativa.
   *
   * Porta ausente ⇒ a fila não tem como parar a loja e falha fechada: o job **não** é
   * liberado. Nenhum `auto-unpause` existe — a retomada é humana.
   */
  pauseStoreForThrottling?: (input: {
    job: FiscalQueueJob
    workerId: string
    now: Date
    cStat: string
    reason: string
  }) => Promise<boolean>
  /**
   * Estaciona o job estrangulado **sem retry e sem consulta**.
   *
   * Distinta de `waitForConsultation` de propósito: aquela existe para desfechos que aguardam
   * uma `CONSULTA` que D12.2 proíbe criar. Ter portas separadas é o que torna verificável, por
   * teste, que um `656` nunca percorre o caminho da incerteza.
   */
  parkThrottled?: (input: {
    job: FiscalQueueJob
    workerId: string
    now: Date
    error: string
    payload: FiscalQueuePayload
  }) => Promise<boolean>
  /**
   * Reagenda **o próprio job `CONSULTA`** que acabou de receber `cStat 103/105` (D12.1).
   *
   * ⛔ Não cria job novo: a consulta deduplicada já existe e é esta. Reutiliza o mesmo
   * `dedupeKey`, preserva o mesmo `nRec` no payload e devolve o job a `AGUARDANDO_RETRY` com
   * `proximaTentativaEm = nextAttemptAt` — que o worker garante ser **no mínimo `now + 15 s`**
   * (MOC 7.00 §5.7). Não é o backoff genérico de falha: um lote em processamento não é falha.
   *
   * O lock só pode ser solto **junto** com a nova data, numa única escrita CAS pelo mesmo
   * `lockOwner`. Porta ausente ou escrita não confirmada ⇒ fail-closed: lock preservado.
   */
  rescheduleProcessingConsultation?: (input: {
    job: FiscalQueueJob
    workerId: string
    now: Date
    nextAttemptAt: Date
    recibo: string | null
    payload: FiscalQueuePayload
  }) => Promise<boolean>
  /**
   * Estaciona uma transmissão incerta cuja **`CONSULTA` não pôde ser criada**.
   *
   * Distinta de `waitForConsultation` porque a afirmação que aquela porta grava — "estacionado
   * até consulta deduplicada" — seria **mentira** aqui: não existe consulta alguma a aguardar.
   * Um estado inerte com log honesto é recuperável por um humano; um estado inerte com log
   * enganoso é um documento que some sem ninguém procurar.
   *
   * O estado gravado é o mesmo (`AGUARDANDO_RETRY` + `proximaTentativaEm: null`): não elegível
   * pelo worker, não reprocessável pela rota administrativa. O que muda é a **auditoria**, que
   * é `ERROR` e diz exatamente o que faltou.
   *
   * Porta ausente ou escrita não confirmada ⇒ fail-closed: lock preservado.
   */
  parkUnresolvedTransmission?: (input: {
    job: FiscalQueueJob
    workerId: string
    now: Date
    error: string
    payload: FiscalQueuePayload
  }) => Promise<boolean>
  execute: (job: FiscalQueueJob) => Promise<FiscalQueueExecutionResult>
  audit: (event: FiscalQueueAuditEvent) => Promise<void>
}

export type DrainFiscalQueueInput = {
  workerId: string
  batchSize?: number
  leaseMs?: number
  heartbeatMs?: number
  baseBackoffMs?: number
  maxBackoffMs?: number
  now?: () => Date
}

export type DrainFiscalQueueItemResult = {
  jobId: string
  storeId: string
  status:
    | "concluido"
    | "retry"
    | "consulta"
    | "falha"
    | "lock_perdido"
    /** `656`: loja pausada e job estacionado sem retry nem consulta. */
    | "throttled"
    /** `656` cujo bloqueio NÃO pôde ser persistido — lock não liberado, drenagem abortada. */
    | "pausa_falhou"
    /** `103/105` em CONSULTA: o mesmo job foi reagendado para reconsultar o mesmo recibo. */
    | "reconsulta"
    /** Reagendamento da reconsulta não confirmado — lock não liberado, drenagem abortada. */
    | "reconsulta_falhou"
    /** Transmissão incerta SEM consulta garantida: estacionada com alarme, drenagem abortada. */
    | "sem_consulta"
    /** Nem o estacionamento do caso acima foi confirmado — lock não liberado. */
    | "sem_consulta_falhou"
  takeover: boolean
  tentativas: number
  mensagem: string
}

export type DrainFiscalQueueReport = {
  workerId: string
  paused: boolean
  pauseSource: FiscalQueuePauseSnapshot["globalSource"]
  acquired: number
  completed: number
  retried: number
  awaitingConsultation: number
  failed: number
  lockLost: number
  /** Jobs parados por `cStat 656`, com a loja pausada. */
  throttled: number
  /** Jobs em que a pausa por `656` não pôde ser persistida. Drenagem abortou. */
  throttlePauseFailed: number
  /** Consultas reagendadas por `cStat 103/105`, para o mesmo recibo. */
  processingRescheduled: number
  /** Reagendamentos de reconsulta não confirmados. Drenagem abortou. */
  processingRescheduleFailed: number
  /**
   * Transmissões incertas estacionadas **sem consulta garantida**.
   *
   * Qualquer valor > 0 exige diagnóstico humano: existe documento cujo desfecho é desconhecido
   * e para o qual nenhuma autoridade automática foi criada.
   */
  unresolvedWithoutConsultation: number
  /** Estacionamentos do caso acima que sequer puderam ser persistidos. */
  unresolvedParkFailed: number
  items: DrainFiscalQueueItemResult[]
}
