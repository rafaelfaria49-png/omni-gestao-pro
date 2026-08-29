import {
  calculateFiscalQueueBackoffMs,
  canStartFiscalTransmission,
  sanitizeFiscalQueueError,
  withExecutionResult,
  withTransmissionStarted,
} from "./queue-policy"
import type {
  DrainFiscalQueueInput,
  DrainFiscalQueueItemResult,
  DrainFiscalQueueReport,
  FiscalQueueJob,
  FiscalQueueLease,
  FiscalQueuePayload,
  FiscalQueueWorkerPorts,
} from "./queue.types"

const DEFAULT_BATCH_SIZE = 10
const MAX_BATCH_SIZE = 50
const DEFAULT_LEASE_MS = 60_000

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isInteger(value)) return fallback
  return Math.min(max, Math.max(min, value as number))
}

function safeAudit(
  ports: FiscalQueueWorkerPorts,
  event: Parameters<FiscalQueueWorkerPorts["audit"]>[0],
): Promise<void> {
  return ports.audit(event).catch(() => undefined)
}

function startHeartbeat(input: {
  ports: FiscalQueueWorkerPorts
  job: FiscalQueueJob
  workerId: string
  leaseMs: number
  heartbeatMs: number
  now: () => Date
}): {
  lost: () => boolean
  stop: () => Promise<boolean>
} {
  let lockLost = false
  let pending = Promise.resolve()
  const beat = () => {
    pending = pending
      .then(async () => {
        const ok = await input.ports.heartbeat({
          jobId: input.job.id,
          workerId: input.workerId,
          now: input.now(),
          leaseMs: input.leaseMs,
        })
        if (!ok) lockLost = true
      })
      .catch(() => {
        lockLost = true
      })
  }
  const timer = setInterval(beat, input.heartbeatMs)
  timer.unref?.()
  return {
    lost: () => lockLost,
    stop: async () => {
      clearInterval(timer)
      await pending
      return !lockLost
    },
  }
}

/** `cStat` do consumo indevido. Lido do detalhe da execução; `656` é o único valor esperado. */
const CSTAT_CONSUMO_INDEVIDO = "656"

/**
 * Intervalo MÍNIMO entre a resposta `103/105` e a reconsulta do mesmo lote.
 *
 * Regra oficial, não escolha de engenharia: o MOC 7.00 §5.7 exige 15 s antes de consultar o
 * recibo. É um **piso** — nunca um teto — e é aplicado no worker para que nenhuma porta possa
 * reagendar antes disso, mesmo que peça.
 */
export const FISCAL_RECONSULTA_MIN_DELAY_MS = 15_000

function cStatDoThrottle(detalhe: Record<string, unknown> | undefined): string {
  const bruto = detalhe?.cStat
  return typeof bruto === "string" && /^\d{3}$/.test(bruto) ? bruto : CSTAT_CONSUMO_INDEVIDO
}

function reciboDoDetalhe(detalhe: Record<string, unknown> | undefined): string | null {
  const bruto = detalhe?.recibo
  return typeof bruto === "string" && /^\d{1,20}$/.test(bruto) ? bruto : null
}

/**
 * Reagenda o próprio job `CONSULTA` que recebeu `103/105` (D12.1 · bloqueio 1 da revisão
 * cruzada do PR #44).
 *
 * O defeito corrigido: `PROCESSING` numa CONSULTA descia para `waitForConsultation`, que
 * estaciona com `proximaTentativaEm: null`. O job ficava **esperando a consulta que ele
 * próprio é** — inelegível para sempre — e o documento morria em `TRANSMITINDO`, sem
 * autorização e sem rejeição.
 *
 * Aqui não há job novo, não há backoff de falha e não há retransmissão: o MESMO job volta para
 * `AGUARDANDO_RETRY` com data futura, mantendo `dedupeKey` e `nRec`.
 */
async function processReconsulta(input: {
  job: FiscalQueueJob
  takeover: boolean
  ports: FiscalQueueWorkerPorts
  workerId: string
  now: Date
  payload: FiscalQueuePayload
  execution: { code: string; mensagem: string; detalhe?: Record<string, unknown> }
}): Promise<DrainFiscalQueueItemResult> {
  const { job, takeover, ports, workerId, now } = input
  const base = { jobId: job.id, storeId: job.storeId, takeover, tentativas: job.tentativas }
  const recibo = reciboDoDetalhe(input.execution.detalhe)
  // Piso oficial aplicado AQUI: a porta recebe a data já calculada e não tem como antecipá-la.
  const nextAttemptAt = new Date(now.getTime() + FISCAL_RECONSULTA_MIN_DELAY_MS)

  if (!ports.rescheduleProcessingConsultation) {
    await safeAudit(ports, {
      job,
      acao: "fiscal.queue.processing.reschedule_unavailable",
      nivel: "ERROR",
      mensagem:
        "Fila sem porta de reagendamento de consulta; job mantido sob lock para não morrer " +
        "estacionado.",
      detalhe: { workerId, recibo },
    })
    return {
      ...base,
      status: "reconsulta_falhou",
      mensagem: "Lote em processamento sem porta de reagendamento; nada foi liberado.",
    }
  }

  const reagendado = await ports
    .rescheduleProcessingConsultation({
      job,
      workerId,
      now,
      nextAttemptAt,
      recibo,
      payload: input.payload,
    })
    .catch(() => false)

  if (!reagendado) {
    await safeAudit(ports, {
      job,
      acao: "fiscal.queue.processing.reschedule_failed",
      nivel: "ERROR",
      mensagem: "Reagendamento da consulta não confirmado; job mantido sob lock.",
      detalhe: { workerId, recibo, nextAttemptAt: nextAttemptAt.toISOString() },
    })
    return {
      ...base,
      status: "reconsulta_falhou",
      mensagem: "Reagendamento da consulta não confirmado; nada foi liberado.",
    }
  }

  await safeAudit(ports, {
    job,
    acao: "fiscal.queue.processing.rescheduled",
    nivel: "INFO",
    mensagem: "Lote em processamento; a MESMA consulta foi reagendada para o mesmo recibo.",
    detalhe: { workerId, recibo, nextAttemptAt: nextAttemptAt.toISOString() },
  })
  return {
    ...base,
    status: "reconsulta",
    mensagem: "Lote em processamento; reconsulta do mesmo recibo agendada.",
  }
}

/**
 * Trata `cStat 656` (D12.2): pausa a loja, audita e estaciona o job — nesta ordem.
 *
 * A pausa é a única barreira que impede os DEMAIS jobs da mesma loja de continuarem batendo na
 * SEFAZ. Por isso ela precede a liberação do lock e, se não puder ser persistida, nada é
 * liberado: o job permanece `PROCESSANDO` sob o lock deste worker (que ainda não expirou) e a
 * drenagem aborta. É o desfecho fail-closed possível sem inventar estado novo no schema.
 */
async function processThrottled(input: {
  job: FiscalQueueJob
  takeover: boolean
  ports: FiscalQueueWorkerPorts
  workerId: string
  now: Date
  error: string
  payload: FiscalQueuePayload
  execution: { code: string; mensagem: string; detalhe?: Record<string, unknown> }
}): Promise<DrainFiscalQueueItemResult> {
  const { job, takeover, ports, workerId, now } = input
  const cStat = cStatDoThrottle(input.execution.detalhe)
  const base = { jobId: job.id, storeId: job.storeId, takeover, tentativas: job.tentativas }

  await safeAudit(ports, {
    job,
    acao: "fiscal.queue.throttled.detected",
    nivel: "ERROR",
    mensagem: "Consumo indevido detectado; transmissões da loja serão pausadas.",
    detalhe: { workerId, cStat, code: input.execution.code },
  })

  const bloqueio = ports.pauseStoreForThrottling
    ? await ports
        .pauseStoreForThrottling({
          job,
          workerId,
          now,
          cStat,
          reason: `Consumo indevido (cStat ${cStat}) detectado pelo worker fiscal.`,
        })
        .catch(() => false)
    : false

  if (!bloqueio) {
    await safeAudit(ports, {
      job,
      acao: "fiscal.queue.throttled.pause_failed",
      nivel: "ERROR",
      mensagem:
        "Pausa da loja não pôde ser persistida após consumo indevido; job mantido sob lock e " +
        "drenagem abortada.",
      detalhe: { workerId, cStat, portaAusente: !ports.pauseStoreForThrottling },
    })
    return {
      ...base,
      status: "pausa_falhou",
      mensagem: "Consumo indevido sem pausa persistida; nada foi liberado.",
    }
  }

  // Pausa gravada: só agora o lock pode ser solto, e apenas para um estado inerte —
  // não elegível pelo worker e não reprocessável pela rota administrativa.
  if (!ports.parkThrottled) {
    await safeAudit(ports, {
      job,
      acao: "fiscal.queue.throttled.park_unavailable",
      nivel: "ERROR",
      mensagem: "Fila sem porta de estacionamento para consumo indevido; job mantido sob lock.",
      detalhe: { workerId, cStat },
    })
    return {
      ...base,
      status: "pausa_falhou",
      mensagem: "Loja pausada, porém o job não pôde ser estacionado.",
    }
  }

  const estacionado = await ports.parkThrottled({
    job,
    workerId,
    now,
    error: input.error,
    payload: input.payload,
  })
  if (!estacionado) {
    return { ...base, status: "lock_perdido", mensagem: "Lock perdido ao estacionar por 656." }
  }
  await safeAudit(ports, {
    job,
    acao: "fiscal.queue.throttled.parked",
    nivel: "ERROR",
    mensagem: "Job estacionado por consumo indevido; retomada exige ação humana explícita.",
    detalhe: { workerId, cStat },
  })
  return {
    ...base,
    status: "throttled",
    mensagem: "Consumo indevido: loja pausada e job estacionado sem retry nem consulta.",
  }
}

/**
 * Estaciona uma transmissão incerta cuja `CONSULTA` não pôde ser criada, com alarme honesto.
 *
 * Resíduo 3 da revisão cruzada. O caminho genérico de incerteza afirma — na mensagem do worker
 * e no log do adapter Prisma — que o job "aguarda consulta deduplicada". Quando a consulta não
 * existe, essa frase é a diferença entre um documento que alguém vai procurar e um que some em
 * silêncio: o estado é idêntico, e o operador que lê o log conclui que há um processo em curso.
 *
 * Aqui o estado é o mesmo (inerte, não elegível, não reprocessável) e o log é `ERROR` dizendo
 * exatamente o que faltou. A drenagem é interrompida em seguida: uma consulta que não pôde ser
 * persistida é forte indício de que a próxima também não será.
 */
async function processSemConsulta(input: {
  job: FiscalQueueJob
  takeover: boolean
  ports: FiscalQueueWorkerPorts
  workerId: string
  now: Date
  error: string
  payload: FiscalQueuePayload
}): Promise<DrainFiscalQueueItemResult> {
  const { job, takeover, ports, workerId, now } = input
  const base = { jobId: job.id, storeId: job.storeId, takeover, tentativas: job.tentativas }

  await safeAudit(ports, {
    job,
    acao: "fiscal.queue.uncertain.without_consultation",
    nivel: "ERROR",
    mensagem:
      "Transmissão de desfecho desconhecido SEM consulta confirmada; nenhuma autoridade " +
      "automática resolverá este documento. Exige diagnóstico humano.",
    detalhe: { workerId, consultationEnsured: false },
  })

  if (!ports.parkUnresolvedTransmission) {
    await safeAudit(ports, {
      job,
      acao: "fiscal.queue.uncertain.park_unavailable",
      nivel: "ERROR",
      mensagem: "Fila sem porta de estacionamento honesto; job mantido sob lock.",
      detalhe: { workerId },
    })
    return {
      ...base,
      status: "sem_consulta_falhou",
      mensagem: "Transmissão incerta sem consulta e sem porta de estacionamento.",
    }
  }

  const estacionado = await ports
    .parkUnresolvedTransmission({
      job,
      workerId,
      now,
      error: input.error,
      payload: input.payload,
    })
    .catch(() => false)

  if (!estacionado) {
    return {
      ...base,
      status: "sem_consulta_falhou",
      mensagem: "Estacionamento da transmissão incerta não confirmado; nada foi liberado.",
    }
  }
  return {
    ...base,
    status: "sem_consulta",
    mensagem:
      "Transmissão incerta estacionada SEM consulta confirmada; retomada exige diagnóstico humano.",
  }
}

async function processLease(input: {
  lease: FiscalQueueLease
  ports: FiscalQueueWorkerPorts
  workerId: string
  leaseMs: number
  heartbeatMs: number
  baseBackoffMs: number
  maxBackoffMs: number
  now: () => Date
}): Promise<DrainFiscalQueueItemResult> {
  const { job, takeover } = input.lease
  await safeAudit(input.ports, {
    job,
    acao: takeover ? "fiscal.queue.lock.takeover" : "fiscal.queue.lock.acquired",
    nivel: takeover ? "WARN" : "INFO",
    mensagem: takeover
      ? "Lock fiscal vencido assumido por outro worker."
      : "Job fiscal adquirido pelo worker.",
    detalhe: { workerId: input.workerId, tentativas: job.tentativas },
  })

  if (job.tentativas > job.maxTentativas) {
    const error = sanitizeFiscalQueueError(
      `Máximo de ${job.maxTentativas} tentativa(s) excedido.`,
    )
    await input.ports.fail({
      job,
      workerId: input.workerId,
      now: input.now(),
      error,
      payload: job.payload ?? {},
    })
    return {
      jobId: job.id,
      storeId: job.storeId,
      status: "falha",
      takeover,
      tentativas: job.tentativas,
      mensagem: error,
    }
  }

  const guard =
    job.tipo === "EMISSAO"
      ? canStartFiscalTransmission(job)
      : { allowed: true, reason: "operacao_sem_transmissao" }
  if (!guard.allowed) {
    const error = sanitizeFiscalQueueError(
      "Nova transmissão bloqueada: consulta autorizadora obrigatória.",
    )
    await input.ports.fail({
      job,
      workerId: input.workerId,
      now: input.now(),
      error,
      payload: job.payload ?? {},
    })
    await safeAudit(input.ports, {
      job,
      acao: "fiscal.queue.transmission.blocked",
      nivel: "ERROR",
      mensagem: error,
      detalhe: { reasonCode: guard.reason },
    })
    return {
      jobId: job.id,
      storeId: job.storeId,
      status: "falha",
      takeover,
      tentativas: job.tentativas,
      mensagem: error,
    }
  }

  const startedAt = input.now()
  const startedPayload = withTransmissionStarted(job, startedAt)
  const marked = await input.ports.markTransmissionStarted({
    job,
    workerId: input.workerId,
    now: startedAt,
    payload: startedPayload,
  })
  if (!marked) {
    return {
      jobId: job.id,
      storeId: job.storeId,
      status: "lock_perdido",
      takeover,
      tentativas: job.tentativas,
      mensagem: "Lock perdido antes da execução.",
    }
  }

  const heartbeat = startHeartbeat({
    ports: input.ports,
    job,
    workerId: input.workerId,
    leaseMs: input.leaseMs,
    heartbeatMs: input.heartbeatMs,
    now: input.now,
  })

  let execution
  try {
    execution = await input.ports.execute({ ...job, payload: startedPayload })
  } catch (error) {
    execution = {
      kind: "transient" as const,
      code: "executor_exception",
      mensagem: sanitizeFiscalQueueError(error),
      simulado: true,
      externalTransmissionAttempted: false,
    }
  }
  const heartbeatOk = await heartbeat.stop()
  if (!heartbeatOk || heartbeat.lost()) {
    await safeAudit(input.ports, {
      job,
      acao: "fiscal.queue.lock.lost",
      nivel: "WARN",
      mensagem: "Worker perdeu o lock; resultado não foi persistido pelo proprietário antigo.",
      detalhe: { workerId: input.workerId },
    })
    return {
      jobId: job.id,
      storeId: job.storeId,
      status: "lock_perdido",
      takeover,
      tentativas: job.tentativas,
      mensagem: "Lock perdido durante a execução.",
    }
  }

  /**
   * Freio do GOAL-011: execução não simulada vira terminal.
   *
   * ⚠️ Correções do 016D-B, todas de segurança:
   *
   * 1. **`simulado` permanece `false`** (F-2). A versão anterior reescrevia para `true`, ou
   *    seja, gravava na trilha que uma execução REAL fora simulada. Bloquear é legítimo;
   *    mentir sobre a proveniência do que foi bloqueado não é.
   * 2. **Desfechos MAIS restritivos que `terminal` não são rebaixados.** `terminal` vira
   *    `FALHA`, e `FALHA` é reprocessável pela rota administrativa — ou seja, rebaixar aqui
   *    *abriria* um caminho de retransmissão. Ficam de fora:
   *    - `throttled` — pausa a loja e estaciona sem reprocesso (rebaixá-lo é justamente o que
   *      agrava o `656`);
   *    - `processing` — reagenda a consulta do mesmo recibo, sem retransmitir;
   *    - `unresolved` — estaciona com alarme, sem reprocesso;
   *    - `uncertain` **que já registrou tentativa externa** — estaciona sem retry e sem
   *      reprocesso; convertê-lo em `FALHA` deixaria um operador retransmitir um documento que
   *      pode ter chegado à SEFAZ.
   * 3. **Repetição de CONSULTA não é rebaixada.** Consultar é LEITURA: repetir é seguro, barato
   *    e é a única forma de o documento sair do limbo. Rebaixar a consulta que falhou produziria
   *    `FALHA`, e a nota ficaria `TRANSMITINDO` sem ninguém consultando. A liberação exige
   *    `providerInvoked` — que deriva da proveniência tipada, não de autodeclaração — e **não
   *    vale para `EMISSAO`**, onde repetir pode duplicar o documento.
   *
   * `externalTransmissionAttempted: true` é deliberadamente conservador: sinaliza contato
   * externo POSSÍVEL, forçando reconciliação humana em vez de presumir que nada saiu.
   *
   * 4. **`INUTILIZACAO` não é freada (GOAL 019).** A transmissão real de inutilização é a
   *    própria entrega deste GOAL: o executor fail-closeia fora de NFCE/HOMOLOGACAO, exige
   *    provider injetado (stub silencioso proibido) e baixa a marca somente com cStat 102 +
   *    TProt real. Reescrever o resultado real como bloqueio gravaria job CONCLUIDO com
   *    falso `provider_real_bloqueado` e drenagem reportando `lock_perdido`.
   */
  const repeticaoDeConsultaSegura =
    job.tipo === "CONSULTA" &&
    execution.kind === "transient" &&
    execution.providerInvoked === true
  const maisRestritivoQueTerminal =
    execution.kind === "throttled" ||
    execution.kind === "processing" ||
    execution.kind === "unresolved" ||
    (execution.kind === "uncertain" && execution.externalTransmissionAttempted)
  const inutilizacaoRealAutorizada = job.tipo === "INUTILIZACAO"
  /**
   * Prova tipada do drill de contingência (GOAL 020 · relatório 127): o executor só a produz
   * com capability desta execução + provider invocado + autorização com evidência fiscal
   * persistida. Aqui ela é CONFERIDA contra o job em processamento (id/store/notaFiscal) —
   * prova órfã, de outro job ou de outro tipo não atravessa.
   */
  const prova = execution.contingencyExternalAuthorization
  const provaTipadaCoerente =
    !!prova &&
    prova.jobId === job.id &&
    prova.storeId === job.storeId &&
    prova.notaFiscalId === String(job.notaFiscalId ?? "") &&
    ((job.tipo === "CONTINGENCIA_TRANSMISSAO" && prova.kind === "transmissao_autorizada") ||
      (job.tipo === "CONSULTA" && prova.kind === "consulta_autorizada"))
  if (
    !maisRestritivoQueTerminal &&
    !repeticaoDeConsultaSegura &&
    !inutilizacaoRealAutorizada &&
    !provaTipadaCoerente &&
    !execution.simulado
  ) {
    execution = {
      kind: "terminal" as const,
      code: "provider_real_bloqueado",
      mensagem: "GOAL-011 bloqueia provider ou transmissão real.",
      simulado: false,
      externalTransmissionAttempted: true,
    }
  }

  const now = input.now()
  const error = sanitizeFiscalQueueError(execution.mensagem)
  const payload = withExecutionResult(startedPayload, {
    now,
    code: execution.code,
    kind: execution.kind,
    externalTransmissionAttempted: execution.externalTransmissionAttempted,
    detalhe: execution.detalhe,
  })

  if (execution.kind === "success") {
    const completed = await input.ports.complete({
      job,
      workerId: input.workerId,
      now,
      payload,
    })
    return {
      jobId: job.id,
      storeId: job.storeId,
      status: completed ? "concluido" : "lock_perdido",
      takeover,
      tentativas: job.tentativas,
      mensagem: completed ? execution.mensagem : "Lock perdido ao concluir.",
    }
  }

  /**
   * `cStat 656` — consumo indevido (D12.2). Caminho DEDICADO, avaliado antes de qualquer
   * outro: ⛔ sem retry, ⛔ sem backoff, ⛔ sem `waitForConsultation`, ⛔ sem `CONSULTA`,
   * ⛔ sem `FALHA` reprocessável.
   *
   * Ordem obrigatória: **pausa persistida → lock liberado**. Enquanto a pausa não estiver
   * gravada, soltar o lock abriria uma janela em que o job volta a ser elegível e a loja
   * segue ativa — o loop que o `656` pune.
   */
  /**
   * `cStat 103/105` num job `CONSULTA` — reconsulta do MESMO recibo, nunca estacionamento.
   * Avaliado antes de `uncertain` justamente porque era ali que morria.
   */
  if (execution.kind === "processing") {
    return await processReconsulta({
      job,
      takeover,
      ports: input.ports,
      workerId: input.workerId,
      now,
      payload,
      execution,
    })
  }

  /**
   * Transmissão incerta cuja `CONSULTA` NÃO pôde ser criada. Caminho próprio porque o
   * estacionamento genérico grava, em log e em semântica, que se aguarda uma consulta
   * deduplicada — afirmação falsa aqui, e é a falsidade que faz o documento sumir sem alarme.
   */
  if (execution.kind === "unresolved") {
    return await processSemConsulta({
      job,
      takeover,
      ports: input.ports,
      workerId: input.workerId,
      now,
      error,
      payload,
    })
  }

  if (execution.kind === "throttled") {
    return await processThrottled({
      job,
      takeover,
      ports: input.ports,
      workerId: input.workerId,
      now,
      error,
      payload,
      execution,
    })
  }

  if (execution.kind === "uncertain") {
    if (!input.ports.waitForConsultation) {
      const failed = await input.ports.fail({
        job,
        workerId: input.workerId,
        now,
        error: "Executor não oferece estacionamento para consulta obrigatória.",
        payload,
      })
      return {
        jobId: job.id,
        storeId: job.storeId,
        status: failed ? "falha" : "lock_perdido",
        takeover,
        tentativas: job.tentativas,
        mensagem: failed
          ? "Transmissão incerta bloqueada por ausência do port de consulta."
          : "Lock perdido ao bloquear transmissão incerta.",
      }
    }
    const waiting = await input.ports.waitForConsultation({
      job,
      workerId: input.workerId,
      now,
      error,
      payload,
    })
    return {
      jobId: job.id,
      storeId: job.storeId,
      status: waiting ? "consulta" : "lock_perdido",
      takeover,
      tentativas: job.tentativas,
      mensagem: waiting
        ? "Resultado incerto; retransmissão bloqueada até CONSULTA."
        : "Lock perdido ao estacionar para consulta.",
    }
  }

  const exhausted = job.tentativas >= job.maxTentativas
  if (execution.kind === "terminal" || exhausted) {
    const failed = await input.ports.fail({
      job,
      workerId: input.workerId,
      now,
      error,
      payload,
    })
    return {
      jobId: job.id,
      storeId: job.storeId,
      status: failed ? "falha" : "lock_perdido",
      takeover,
      tentativas: job.tentativas,
      mensagem: failed ? error : "Lock perdido ao registrar falha.",
    }
  }

  const delay = calculateFiscalQueueBackoffMs(
    job.tentativas,
    input.baseBackoffMs,
    input.maxBackoffMs,
  )
  const retried = await input.ports.retry({
    job,
    workerId: input.workerId,
    now,
    nextAttemptAt: new Date(now.getTime() + delay),
    error,
    payload,
  })
  return {
    jobId: job.id,
    storeId: job.storeId,
    status: retried ? "retry" : "lock_perdido",
    takeover,
    tentativas: job.tentativas,
    mensagem: retried ? error : "Lock perdido ao agendar retry.",
  }
}

/** Drena sequencialmente um lote; cada aquisição é CAS e cada resultado exige o mesmo lockOwner. */
export async function drainFiscalQueue(
  input: DrainFiscalQueueInput,
  ports: FiscalQueueWorkerPorts,
): Promise<DrainFiscalQueueReport> {
  const workerId = String(input.workerId ?? "").trim()
  if (!workerId) throw new Error("workerId obrigatório.")
  const now = input.now ?? (() => new Date())
  const batchSize = clampInt(input.batchSize, DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE)
  const leaseMs = clampInt(input.leaseMs, DEFAULT_LEASE_MS, 5_000, 15 * 60_000)
  const heartbeatMs = clampInt(
    input.heartbeatMs,
    Math.max(1_000, Math.floor(leaseMs / 3)),
    250,
    Math.max(250, leaseMs - 100),
  )
  const baseBackoffMs = clampInt(input.baseBackoffMs, 30_000, 1_000, 60 * 60_000)
  const maxBackoffMs = clampInt(input.maxBackoffMs, 30 * 60_000, baseBackoffMs, 24 * 60 * 60_000)

  const report: DrainFiscalQueueReport = {
    workerId,
    paused: false,
    pauseSource: "none",
    acquired: 0,
    completed: 0,
    retried: 0,
    awaitingConsultation: 0,
    failed: 0,
    lockLost: 0,
    throttled: 0,
    throttlePauseFailed: 0,
    processingRescheduled: 0,
    processingRescheduleFailed: 0,
    unresolvedWithoutConsultation: 0,
    unresolvedParkFailed: 0,
    items: [],
  }

  for (let index = 0; index < batchSize; index++) {
    const pause = await ports.readPauseSnapshot()
    if (pause.globalPaused) {
      report.paused = true
      report.pauseSource = pause.globalSource
      break
    }
    const lease = await ports.acquireNextJob({
      workerId,
      now: now(),
      leaseMs,
      pausedStoreIds: pause.pausedStoreIds,
    })
    if (!lease) break
    report.acquired += 1
    const item = await processLease({
      lease,
      ports,
      workerId,
      leaseMs,
      heartbeatMs,
      baseBackoffMs,
      maxBackoffMs,
      now,
    })
    report.items.push(item)
    if (item.status === "concluido") report.completed += 1
    else if (item.status === "retry") report.retried += 1
    else if (item.status === "consulta") report.awaitingConsultation += 1
    else if (item.status === "falha") report.failed += 1
    else if (item.status === "throttled") report.throttled += 1
    else if (item.status === "pausa_falhou") report.throttlePauseFailed += 1
    else if (item.status === "reconsulta") report.processingRescheduled += 1
    else if (item.status === "reconsulta_falhou") report.processingRescheduleFailed += 1
    else if (item.status === "sem_consulta") report.unresolvedWithoutConsultation += 1
    else if (item.status === "sem_consulta_falhou") report.unresolvedParkFailed += 1
    else report.lockLost += 1

    /**
     * Consumo indevido sem pausa persistida: o worker **para**. Continuar drenando seria seguir
     * chamando a SEFAZ com a loja ainda ativa — a causa documentada do `656`.
     *
     * Já no caso `throttled` bem-sucedido a drenagem PROSSEGUE de propósito: a pausa é de loja,
     * e a próxima volta relê `readPauseSnapshot`, que passa a excluir aquele `storeId`. Jobs de
     * outras lojas não são punidos pelo `656` de uma delas.
     */
    if (item.status === "pausa_falhou") break

    /**
     * Reagendamento de reconsulta não confirmado: o job continua `PROCESSANDO` sob nosso lock.
     * Seguir drenando arriscaria repetir a mesma falha de persistência em cada job da fila, e
     * cada repetição é mais uma chamada à SEFAZ sem desfecho registrado.
     */
    if (item.status === "reconsulta_falhou") break

    /**
     * Documento incerto sem consulta garantida — nos DOIS desfechos, com ou sem estacionamento
     * confirmado. A drenagem para: a causa mais provável é indisponibilidade de persistência, e
     * seguir emitindo produziria mais documentos na mesma condição, cada um exigindo o mesmo
     * diagnóstico humano.
     */
    if (item.status === "sem_consulta" || item.status === "sem_consulta_falhou") break
  }

  return report
}
