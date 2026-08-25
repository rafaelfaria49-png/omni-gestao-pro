/**
 * Adapter Prisma da fila fiscal.
 *
 * Aquisição usa select ordenado + updateMany compare-and-swap. O CAS revalida status, vencimento
 * e proprietário; dois workers podem enxergar o mesmo candidato, mas apenas um adquire o lock.
 */
import { prisma } from "@/lib/prisma"
import { emitirNotaFiscalVenda } from "../emission/emission-service"
import type { EmissionOutcome } from "../emission/emission.types"
import {
  createUncertainStateJobExecutor,
  type UncertainStateJobExecutorDependencies,
} from "../emission/uncertain-state-job-executor"
import { executeInutilizacaoJob } from "../inutilizacao/execute"
import { createPrismaInutilizacaoPorts } from "../inutilizacao/prisma-ports"
import { stubHomologacaoProvider } from "../provider/stub-homologacao"
import type { FiscalProvider } from "../provider/types"
import { sanitizeFiscalQueueError } from "./queue-policy"
import type {
  FiscalQueueAuditEvent,
  FiscalQueueExecutionResult,
  FiscalQueueJob,
  FiscalQueueLease,
  FiscalQueuePauseSnapshot,
  FiscalQueuePayload,
  FiscalQueueWorkerPorts,
} from "./queue.types"

export const GLOBAL_PAUSE_ACTION = "fiscal.queue.pause.global"
export const STORE_PAUSE_ACTION = "fiscal.queue.pause.store"

const JOB_SELECT = {
  id: true,
  storeId: true,
  vendaId: true,
  notaFiscalId: true,
  tipo: true,
  status: true,
  tentativas: true,
  maxTentativas: true,
  proximaTentativaEm: true,
  prioridade: true,
  lockOwner: true,
  lockedAt: true,
  lockExpiresAt: true,
  dedupeKey: true,
  payload: true,
  ultimoErro: true,
  concluidoEm: true,
  createdAt: true,
  updatedAt: true,
} as const

type QueuePrismaClient = {
  fiscalEmissaoJob: {
    findMany: (args: unknown) => Promise<unknown[]>
    findUnique: (args: unknown) => Promise<unknown | null>
    updateMany: (args: unknown) => Promise<{ count: number }>
  }
  fiscalLog: {
    findFirst: (args: unknown) => Promise<unknown | null>
    findMany: (args: unknown) => Promise<unknown[]>
    create: (args: unknown) => Promise<unknown>
  }
  configuracaoFiscalLoja: {
    findUnique: (args: unknown) => Promise<unknown | null>
  }
  notaFiscal: {
    findFirst: (args: unknown) => Promise<unknown | null>
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date) return value
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  return null
}

function toJob(value: unknown): FiscalQueueJob {
  const row = record(value)
  return {
    id: String(row.id ?? ""),
    storeId: String(row.storeId ?? ""),
    vendaId: String(row.vendaId ?? ""),
    notaFiscalId: row.notaFiscalId == null ? null : String(row.notaFiscalId),
    tipo: String(row.tipo ?? "EMISSAO") as FiscalQueueJob["tipo"],
    status: String(row.status ?? "PENDENTE") as FiscalQueueJob["status"],
    tentativas: Number(row.tentativas ?? 0),
    maxTentativas: Number(row.maxTentativas ?? 5),
    proximaTentativaEm: asDate(row.proximaTentativaEm),
    prioridade: Number(row.prioridade ?? 0),
    lockOwner: row.lockOwner == null ? null : String(row.lockOwner),
    lockedAt: asDate(row.lockedAt),
    lockExpiresAt: asDate(row.lockExpiresAt),
    dedupeKey: row.dedupeKey == null ? null : String(row.dedupeKey),
    payload: Object.keys(record(row.payload)).length > 0 ? record(row.payload) : null,
    ultimoErro: row.ultimoErro == null ? null : String(row.ultimoErro),
    concluidoEm: asDate(row.concluidoEm),
    createdAt: asDate(row.createdAt) ?? new Date(0),
    updatedAt: asDate(row.updatedAt) ?? new Date(0),
  }
}

function pausedFromDetail(value: unknown): boolean {
  return record(value).paused === true
}

export async function readFiscalQueuePauseSnapshot(
  client: QueuePrismaClient = prisma as unknown as QueuePrismaClient,
): Promise<FiscalQueuePauseSnapshot> {
  const envPaused = process.env.FISCAL_QUEUE_GLOBAL_PAUSED?.trim() === "1"
  const [globalEvent, storeEvents] = await Promise.all([
    client.fiscalLog.findFirst({
      where: { acao: GLOBAL_PAUSE_ACTION },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { detalhe: true },
    }),
    client.fiscalLog.findMany({
      where: { acao: STORE_PAUSE_ACTION },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { storeId: true, detalhe: true },
      take: 10_000,
    }),
  ])

  const latestByStore = new Map<string, boolean>()
  for (const raw of storeEvents) {
    const event = record(raw)
    const storeId = String(event.storeId ?? "").trim()
    if (storeId && !latestByStore.has(storeId)) {
      latestByStore.set(storeId, pausedFromDetail(event.detalhe))
    }
  }
  const pausedStoreIds = [...latestByStore.entries()]
    .filter(([, paused]) => paused)
    .map(([storeId]) => storeId)
    .sort()

  const auditPaused = pausedFromDetail(record(globalEvent).detalhe)
  return {
    globalPaused: envPaused || auditPaused,
    globalSource: envPaused ? "environment" : auditPaused ? "audit_log" : "none",
    pausedStoreIds,
  }
}

/**
 * Filtro de elegibilidade da fila.
 *
 * Exportado para que a regra de `AGUARDANDO_RETRY` seja **verificável por teste**: é ela que
 * distingue um job estacionado à espera de humano (`proximaTentativaEm: null`) de um job
 * reagendado para reconsultar (`proximaTentativaEm` futuro). Um erro aqui não aparece em
 * nenhum outro lugar — o job simplesmente nunca mais roda.
 */
export function eligibleWhere(now: Date, pausedStoreIds: string[]): Record<string, unknown> {
  return {
    ...(pausedStoreIds.length > 0 ? { storeId: { notIn: pausedStoreIds } } : {}),
    OR: [
      {
        status: "PENDENTE",
        AND: [
          {
            OR: [
              { proximaTentativaEm: null },
              { proximaTentativaEm: { lte: now } },
            ],
          },
          {
            OR: [
              { lockExpiresAt: null },
              { lockExpiresAt: { lte: now } },
            ],
          },
        ],
      },
      {
        status: "AGUARDANDO_RETRY",
        proximaTentativaEm: { not: null, lte: now },
        OR: [
          { lockExpiresAt: null },
          { lockExpiresAt: { lte: now } },
        ],
      },
      {
        status: "PROCESSANDO",
        lockExpiresAt: { lte: now },
      },
    ],
  }
}

async function acquireNextJob(
  client: QueuePrismaClient,
  input: {
    workerId: string
    now: Date
    leaseMs: number
    pausedStoreIds: string[]
  },
): Promise<FiscalQueueLease | null> {
  const where = eligibleWhere(input.now, input.pausedStoreIds)
  const candidates = await client.fiscalEmissaoJob.findMany({
    where,
    orderBy: [
      { prioridade: "desc" },
      { proximaTentativaEm: "asc" },
      { createdAt: "asc" },
      { id: "asc" },
    ],
    take: 25,
    select: JOB_SELECT,
  })

  for (const raw of candidates) {
    const candidate = toJob(raw)
    const acquired = await client.fiscalEmissaoJob.updateMany({
      where: {
        id: candidate.id,
        ...eligibleWhere(input.now, input.pausedStoreIds),
      },
      data: {
        status: "PROCESSANDO",
        lockOwner: input.workerId,
        lockedAt: input.now,
        lockExpiresAt: new Date(input.now.getTime() + input.leaseMs),
        tentativas: { increment: 1 },
      },
    })
    if (acquired.count !== 1) continue
    const locked = await client.fiscalEmissaoJob.findUnique({
      where: { id: candidate.id },
      select: JOB_SELECT,
    })
    if (!locked) return null
    return {
      job: toJob(locked),
      takeover: candidate.status === "PROCESSANDO",
    }
  }
  return null
}

function ownedLockWhere(
  jobId: string,
  workerId: string,
  now: Date,
): Record<string, unknown> {
  return {
    id: jobId,
    status: "PROCESSANDO",
    lockOwner: workerId,
    lockExpiresAt: { gt: now },
  }
}

async function bestEffortAudit(
  client: QueuePrismaClient,
  event: FiscalQueueAuditEvent,
): Promise<void> {
  await client.fiscalLog.create({
    data: {
      storeId: event.job.storeId,
      vendaId: event.job.vendaId,
      notaFiscalId: event.job.notaFiscalId,
      jobId: event.job.id,
      nivel: event.nivel,
      acao: event.acao,
      mensagem: event.mensagem,
      operador: event.operador ?? null,
      detalhe: {
        worker: event.detalhe?.workerId ?? null,
        tentativas: event.job.tentativas,
        ...event.detalhe,
      },
    },
  }).then(() => undefined).catch(() => undefined)
}

async function executeFiscalJob(
  client: QueuePrismaClient,
  job: FiscalQueueJob,
  emit: (input: {
    storeId: string
    vendaId: string
    operador?: string | null
  }) => Promise<EmissionOutcome>,
  executeGoal012?: (job: FiscalQueueJob) => Promise<FiscalQueueExecutionResult>,
  inutilizacaoProvider?: FiscalProvider,
): Promise<FiscalQueueExecutionResult> {
  const config = record(await client.configuracaoFiscalLoja.findUnique({
    where: { storeId: job.storeId },
    select: {
      provider: true,
      ambiente: true,
      modeloFiscal: true,
      fiscalEnabled: true,
    },
  }))
  if (job.tipo === "INUTILIZACAO") {
    if (config.ambiente !== "HOMOLOGACAO" || config.modeloFiscal !== "NFCE") {
      return {
        kind: "terminal",
        code: "contexto_simulado_obrigatorio",
        mensagem: "Inutilização bloqueada: somente NFCE/HOMOLOGACAO.",
        simulado: true,
        externalTransmissionAttempted: false,
      }
    }
    if (config.provider === "SEFAZ_DIRETO" && !inutilizacaoProvider) {
      return {
        kind: "terminal",
        code: "inutilizacao_provider_nao_configurado",
        mensagem:
          "SEFAZ_DIRETO exige provider de inutilização injetado; stub silencioso é proibido.",
        simulado: true,
        externalTransmissionAttempted: false,
      }
    }
    if (config.provider !== "STUB_HOMOLOGACAO" && config.provider !== "SEFAZ_DIRETO") {
      return {
        kind: "terminal",
        code: "contexto_simulado_obrigatorio",
        mensagem: "Inutilização bloqueada: provider da loja não suportado.",
        simulado: true,
        externalTransmissionAttempted: false,
      }
    }
    return executeInutilizacaoJob(job, {
      ports: createPrismaInutilizacaoPorts(client as never),
      provider: inutilizacaoProvider ?? stubHomologacaoProvider,
    })
  }
  if (!["EMISSAO", "CONSULTA"].includes(job.tipo)) {
    return {
      kind: "terminal",
      code: "tipo_nao_suportado",
      mensagem: `GOAL-012 processa somente EMISSAO/CONSULTA; recebido ${job.tipo}.`,
      simulado: true,
      externalTransmissionAttempted: false,
    }
  }
  const homologacaoNfceHabilitada =
    config.ambiente === "HOMOLOGACAO" &&
    config.modeloFiscal === "NFCE" &&
    config.fiscalEnabled === true
  if (!homologacaoNfceHabilitada) {
    return {
      kind: "terminal",
      code: "contexto_simulado_obrigatorio",
      mensagem: "Job bloqueado: somente NFCE/HOMOLOGACAO habilitado é permitido.",
      simulado: true,
      externalTransmissionAttempted: false,
    }
  }
  if (config.provider !== "STUB_HOMOLOGACAO" && config.provider !== "SEFAZ_DIRETO") {
    return {
      kind: "terminal",
      code: "contexto_simulado_obrigatorio",
      mensagem: "Job bloqueado: somente STUB_HOMOLOGACAO/NFCE/HOMOLOGACAO habilitado é permitido.",
      simulado: true,
      externalTransmissionAttempted: false,
    }
  }
  /**
   * SEFAZ_DIRETO nunca cai no pipeline legado (`emitirNotaFiscalVenda`).
   * Sem executor GOAL-012 o job termina bloqueado. Com executor, a capability
   * default do piloto permanece negada e a execução para em
   * `EXTERNAL_EXECUTION_NOT_AUTHORIZED` — sem prepare, A1, persistência ou rede.
   */
  if (config.provider === "SEFAZ_DIRETO" && !executeGoal012) {
    return {
      kind: "terminal",
      code: "goal012_executor_nao_configurado",
      mensagem:
        "Executor seguro do GOAL-012 não configurado; transmissão SEFAZ_DIRETO bloqueada.",
      simulado: true,
      externalTransmissionAttempted: false,
    }
  }
  const nota = record(await client.notaFiscal.findFirst({
    where: {
      ...(job.notaFiscalId ? { id: job.notaFiscalId } : { vigente: true }),
      storeId: job.storeId,
      vendaId: job.vendaId,
      modelo: "NFCE",
      ambiente: "HOMOLOGACAO",
    },
    select: { id: true, modelo: true, ambiente: true },
  }))
  if (!nota.id) {
    return {
      kind: "terminal",
      code: "nota_homologacao_ausente",
      mensagem: "NotaFiscal NFC-e de homologação não encontrada no escopo do job.",
      simulado: true,
      externalTransmissionAttempted: false,
    }
  }

  const payloadVersion = Number(record(job.payload).version ?? 1)
  const sefazDireto = config.provider === "SEFAZ_DIRETO"
  if (sefazDireto || job.tipo === "CONSULTA" || payloadVersion >= 2) {
    if (!executeGoal012) {
      return {
        kind: "terminal",
        code: "goal012_executor_nao_configurado",
        mensagem:
          "Executor seguro do GOAL-012 não configurado; transmissão bloqueada.",
        simulado: true,
        externalTransmissionAttempted: false,
      }
    }
    return executeGoal012(job)
  }

  const outcome = await emit({
    storeId: job.storeId,
    vendaId: job.vendaId,
    operador: `fiscal-queue:${job.lockOwner ?? "worker"}`,
  })
  if (!outcome.simulado) {
    return {
      kind: "terminal",
      code: "provider_real_bloqueado",
      mensagem: "Executor devolveu provider real, bloqueado no GOAL-011.",
      simulado: false,
      externalTransmissionAttempted: true,
    }
  }
  if (
    outcome.ok &&
    (outcome.resultado === "autorizada" || outcome.resultado === "ja_autorizada")
  ) {
    return {
      kind: "success",
      code: outcome.resultado,
      mensagem: outcome.mensagem,
      simulado: true,
      externalTransmissionAttempted: false,
      detalhe: { fiscalStatusNovo: outcome.fiscalStatusNovo },
    }
  }
  const transient =
    outcome.resultado === "pendente" ||
    outcome.resultado === "contingencia" ||
    outcome.errorCode === "erro_interno"
  return {
    kind: transient ? "transient" : "terminal",
    code: outcome.errorCode ?? outcome.resultado,
    mensagem: outcome.mensagem,
    simulado: true,
    externalTransmissionAttempted: false,
  }
}

export function createPrismaFiscalQueueWorkerPorts(
  client: QueuePrismaClient = prisma as unknown as QueuePrismaClient,
  emit: (input: {
    storeId: string
    vendaId: string
    operador?: string | null
  }) => Promise<EmissionOutcome> = emitirNotaFiscalVenda,
  executeGoal012?: (job: FiscalQueueJob) => Promise<FiscalQueueExecutionResult>,
  inutilizacaoProvider?: FiscalProvider,
): FiscalQueueWorkerPorts {
  return {
    readPauseSnapshot: () => readFiscalQueuePauseSnapshot(client),
    acquireNextJob: (input) => acquireNextJob(client, input),
    heartbeat: async ({ jobId, workerId, now, leaseMs }) => {
      const updated = await client.fiscalEmissaoJob.updateMany({
        where: ownedLockWhere(jobId, workerId, now),
        data: { lockExpiresAt: new Date(now.getTime() + leaseMs) },
      })
      return updated.count === 1
    },
    markTransmissionStarted: async ({ job, workerId, now, payload }) => {
      const updated = await client.fiscalEmissaoJob.updateMany({
        where: ownedLockWhere(job.id, workerId, now),
        data: { payload },
      })
      return updated.count === 1
    },
    complete: async ({ job, workerId, now, payload }) => {
      const updated = await client.fiscalEmissaoJob.updateMany({
        where: ownedLockWhere(job.id, workerId, now),
        data: {
          status: "CONCLUIDO",
          payload,
          ultimoErro: null,
          concluidoEm: now,
          proximaTentativaEm: null,
          lockOwner: null,
          lockedAt: null,
          lockExpiresAt: null,
        },
      })
      if (updated.count === 1) {
        await bestEffortAudit(client, {
          job,
          acao: "fiscal.queue.completed",
          nivel: "INFO",
          mensagem: "Job fiscal concluído pelo provider simulado.",
          detalhe: { workerId },
        })
      }
      return updated.count === 1
    },
    retry: async ({ job, workerId, now, nextAttemptAt, error, payload }) => {
      const updated = await client.fiscalEmissaoJob.updateMany({
        where: ownedLockWhere(job.id, workerId, now),
        data: {
          status: "PENDENTE",
          payload,
          ultimoErro: error,
          proximaTentativaEm: nextAttemptAt,
          lockOwner: null,
          lockedAt: null,
          lockExpiresAt: null,
        },
      })
      if (updated.count === 1) {
        await bestEffortAudit(client, {
          job,
          acao: "fiscal.queue.retry.scheduled",
          nivel: "WARN",
          mensagem: "Retry fiscal agendado com backoff.",
          detalhe: { workerId, nextAttemptAt: nextAttemptAt.toISOString(), errorCode: error },
        })
      }
      return updated.count === 1
    },
    fail: async ({ job, workerId, now, error, payload }) => {
      const updated = await client.fiscalEmissaoJob.updateMany({
        where: ownedLockWhere(job.id, workerId, now),
        data: {
          status: "FALHA",
          payload,
          ultimoErro: error,
          proximaTentativaEm: null,
          lockOwner: null,
          lockedAt: null,
          lockExpiresAt: null,
        },
      })
      if (updated.count === 1) {
        await bestEffortAudit(client, {
          job,
          acao: "fiscal.queue.dead_letter",
          nivel: "ERROR",
          mensagem: "Job fiscal enviado para dead-letter.",
          detalhe: { workerId, errorCode: error },
        })
      }
      return updated.count === 1
    },
    /**
     * Pausa da loja após `cStat 656` (GOAL-016D-B · D12.2).
     *
     * Grava exatamente o evento que `readFiscalQueuePauseSnapshot` já lê — mesma `acao`, mesmo
     * `detalhe.paused` — de modo que a próxima aquisição exclua a loja. Escrever o evento
     * inline (em vez de chamar `setFiscalQueuePause`) evita o ciclo de import
     * `prisma-queue-worker → queue-admin → prisma-queue-worker`.
     *
     * ⛔ **Não** é best-effort: diferente de `bestEffortAudit`, a falha propaga como `false` e
     * a fila mantém o job sob lock. Nenhum `auto-unpause` é criado — a retomada exige
     * `setFiscalQueuePause({ paused: false })` por um humano, com ator e motivo registrados.
     */
    pauseStoreForThrottling: async ({ job, workerId, now, cStat, reason }) => {
      try {
        await client.fiscalLog.create({
          data: {
            storeId: job.storeId,
            vendaId: job.vendaId,
            notaFiscalId: job.notaFiscalId,
            jobId: job.id,
            nivel: "ERROR",
            acao: STORE_PAUSE_ACTION,
            cStat,
            mensagem: "Fila fiscal da loja pausada por consumo indevido (656).",
            operador: `fiscal-queue:${workerId}`,
            detalhe: {
              paused: true,
              scope: "store",
              reason: sanitizeFiscalQueueError(reason, 300),
              cStat,
              changedAt: now.toISOString(),
              retomada: "somente por ação humana explícita após diagnóstico",
            },
          },
        })
        return true
      } catch {
        return false
      }
    },
    /**
     * Estaciona o job estrangulado. `AGUARDANDO_RETRY` + `proximaTentativaEm: null` é o único
     * estado inerte disponível sem tocar no schema, e é inerte nas DUAS pontas:
     *  - o worker não o adquire (`eligibleWhere` exige `proximaTentativaEm` não nulo e vencido);
     *  - a rota administrativa não o reprocessa (`reprocessFailedFiscalJob` só aceita `FALHA`).
     */
    parkThrottled: async ({ job, workerId, now, error, payload }) => {
      const updated = await client.fiscalEmissaoJob.updateMany({
        where: ownedLockWhere(job.id, workerId, now),
        data: {
          status: "AGUARDANDO_RETRY",
          payload,
          ultimoErro: error,
          proximaTentativaEm: null,
          lockOwner: null,
          lockedAt: null,
          lockExpiresAt: null,
        },
      })
      return updated.count === 1
    },
    /**
     * Reagenda a PRÓPRIA `CONSULTA` após `cStat 103/105` (GOAL-016D-B · D12.1).
     *
     * Uma única escrita CAS pelo mesmo `lockOwner`: status, nova data e liberação do lock
     * entram juntos, de modo que não existe instante em que o job esteja solto sem a data
     * futura gravada. `updated.count !== 1` significa que o lock já era de outro worker — nada
     * foi tocado, e o chamador mantém o desfecho fail-closed.
     *
     * ⛔ Não cria job: `dedupeKey`, `tipo` e `notaFiscalId` permanecem os do próprio registro.
     * O `nRec` é preservado no payload para que a próxima execução consulte o MESMO lote.
     */
    rescheduleProcessingConsultation: async ({
      job,
      workerId,
      now,
      nextAttemptAt,
      recibo,
      payload,
    }) => {
      const updated = await client.fiscalEmissaoJob.updateMany({
        where: ownedLockWhere(job.id, workerId, now),
        data: {
          status: "AGUARDANDO_RETRY",
          payload: recibo ? { ...payload, recibo } : payload,
          ultimoErro: null,
          proximaTentativaEm: nextAttemptAt,
          lockOwner: null,
          lockedAt: null,
          lockExpiresAt: null,
        },
      })
      if (updated.count === 1) {
        await bestEffortAudit(client, {
          job,
          acao: "fiscal.queue.processing.reschedule.persisted",
          nivel: "INFO",
          mensagem: "Consulta reagendada para o mesmo recibo, sem criar job novo.",
          detalhe: { workerId, nextAttemptAt: nextAttemptAt.toISOString(), reciboRegistrado: Boolean(recibo) },
        })
      }
      return updated.count === 1
    },
    /**
     * Estacionamento HONESTO de transmissão incerta sem consulta confirmada (correção 003).
     *
     * O estado gravado é idêntico ao de `waitForConsultation` — e é proposital: inerte nas duas
     * pontas (não elegível em `eligibleWhere`, não reprocessável em `reprocessFailedFiscalJob`).
     * O que muda é a **auditoria**: nível `ERROR` e uma mensagem que diz o que realmente
     * aconteceu, em vez de "aguardando consulta deduplicada" — frase que, sem consulta alguma
     * existindo, faria um operador supor um processo em curso e nunca procurar o documento.
     */
    parkUnresolvedTransmission: async ({ job, workerId, now, error, payload }) => {
      const updated = await client.fiscalEmissaoJob.updateMany({
        where: ownedLockWhere(job.id, workerId, now),
        data: {
          status: "AGUARDANDO_RETRY",
          payload,
          ultimoErro: error,
          proximaTentativaEm: null,
          lockOwner: null,
          lockedAt: null,
          lockExpiresAt: null,
        },
      })
      if (updated.count === 1) {
        await bestEffortAudit(client, {
          job,
          acao: "fiscal.queue.transmission.unresolved",
          nivel: "ERROR",
          mensagem:
            "Transmissão de desfecho desconhecido estacionada SEM consulta confirmada; " +
            "nenhuma autoridade automática resolverá este documento.",
          detalhe: { workerId, consultationEnsured: false },
        })
      }
      return updated.count === 1
    },
    waitForConsultation: async ({ job, workerId, now, error, payload }) => {
      const updated = await client.fiscalEmissaoJob.updateMany({
        where: ownedLockWhere(job.id, workerId, now),
        data: {
          status: "AGUARDANDO_RETRY",
          payload,
          ultimoErro: error,
          proximaTentativaEm: null,
          lockOwner: null,
          lockedAt: null,
          lockExpiresAt: null,
        },
      })
      if (updated.count === 1) {
        await bestEffortAudit(client, {
          job,
          acao: "fiscal.queue.transmission.uncertain",
          nivel: "WARN",
          mensagem: "Resultado incerto; job estacionado até consulta deduplicada.",
          detalhe: { workerId },
        })
      }
      return updated.count === 1
    },
    execute: (job) => executeFiscalJob(client, job, emit, executeGoal012, inutilizacaoProvider),
    audit: (event) => bestEffortAudit(client, event),
  }
}

/**
 * Wiring explícito do GOAL-012. Exige preparer, persistência e provider
 * injetados; a factory legada continua fail-closed para payload v2 sem wiring.
 * SEFAZ_DIRETO só alcança este executor — nunca o pipeline legado.
 */
export function createPrismaGoal012FiscalQueueWorkerPorts(
  dependencies: UncertainStateJobExecutorDependencies,
  client: QueuePrismaClient = prisma as unknown as QueuePrismaClient,
): FiscalQueueWorkerPorts {
  return createPrismaFiscalQueueWorkerPorts(
    client,
    emitirNotaFiscalVenda,
    createUncertainStateJobExecutor(dependencies),
  )
}
