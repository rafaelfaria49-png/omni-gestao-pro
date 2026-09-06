/**
 * Serviço consolidado de observabilidade fiscal — GOAL 021.
 *
 * Superfície unificada e somente leitura que agrega telemetria da fila fiscal,
 * estado incerto/reconciliação, contingência offline e estrangulamento/pausa.
 *
 * Scoped estritamente por storeId (sem fallback multi-loja).
 * Reutiliza contratos canônicos existentes; zero motores fiscais duplicados.
 * Não expõe XMLs, certificados, senhas, tokens ou segredos internos.
 */

import { prisma } from "@/lib/prisma"
import {
  readFiscalQueueMetrics,
  type FiscalQueueMetrics,
} from "../queue/queue-metrics"
import {
  readFiscalQueuePauseSnapshot,
  STORE_PAUSE_ACTION,
  GLOBAL_PAUSE_ACTION,
} from "../queue/prisma-queue-worker"
import {
  collectUncertainStateMetrics,
  type UncertainStateMetrics,
} from "../reconciliation/uncertain-metrics"
import {
  offlineContingencyAlarmFromPayload,
  type OfflineContingencyAlarm,
} from "../contingencia/offline-contingency"

export type FiscalContingencyObservability = {
  contingencyNotesCount: number
  pendingDrainJobsCount: number
  oldestPendingDrainAgeMs: number | null
  nearestDeadlineAt: string | null
  nearestAlarm: OfflineContingencyAlarm | null
  alarms: {
    safe: number
    approaching: number
    expired: number
  }
}

export type FiscalThrottlingObservability = {
  isPaused: boolean
  pausedScope: "global" | "store" | "none"
  source: string
  cStat656Evidence: boolean
  reason: string | null
}

export type FiscalObservabilitySnapshot = {
  observedAt: string
  storeId: string
  queue: FiscalQueueMetrics
  uncertain: UncertainStateMetrics
  contingency: FiscalContingencyObservability
  throttling: FiscalThrottlingObservability
}

export type FiscalObservabilityClient = {
  fiscalEmissaoJob: {
    groupBy: (args: unknown) => Promise<Array<{ status: unknown; _count: { _all: number } }>>
    count: (args: unknown) => Promise<number>
    findFirst: (args: unknown) => Promise<{ createdAt: Date; payload?: unknown } | null>
    findMany: (args: unknown) => Promise<Array<{ createdAt: Date; payload?: unknown }>>
  }
  fiscalLog: {
    findFirst: (args: unknown) => Promise<unknown | null>
    findMany: (args: unknown) => Promise<unknown[]>
    count: (args: unknown) => Promise<number>
  }
  notaFiscal: {
    count: (args: unknown) => Promise<number>
    findFirst: (args: unknown) => Promise<unknown | null>
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export async function readFiscalObservabilitySnapshot(
  input: { storeId: string; now?: Date },
  client: FiscalObservabilityClient = prisma as unknown as FiscalObservabilityClient,
): Promise<FiscalObservabilitySnapshot> {
  const storeId = String(input.storeId ?? "").trim()
  if (!storeId) {
    throw new Error("storeId obrigatório para snapshot de observabilidade fiscal.")
  }

  const now = input.now ?? new Date()
  const queuedDrainStatuses = ["PENDENTE", "PROCESSANDO", "AGUARDANDO_RETRY"]

  const [
    queueMetrics,
    uncertainMetrics,
    pauseSnapshot,
    contingencyNotesCount,
    pendingDrainJobsCount,
    oldestDrainJob,
    activeDrainJobs,
    latestStorePauseLog,
    latestGlobalPauseLog,
  ] = await Promise.all([
    readFiscalQueueMetrics({ storeId, now }, client as never),
    collectUncertainStateMetrics({ storeId, now }, client as never),
    readFiscalQueuePauseSnapshot(client as never),
    client.notaFiscal.count({
      where: {
        storeId,
        status: "CONTINGENCIA",
      },
    }),
    client.fiscalEmissaoJob.count({
      where: {
        storeId,
        tipo: "CONTINGENCIA_TRANSMISSAO",
        status: { in: queuedDrainStatuses },
      },
    }),
    client.fiscalEmissaoJob.findFirst({
      where: {
        storeId,
        tipo: "CONTINGENCIA_TRANSMISSAO",
        status: { in: queuedDrainStatuses },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { createdAt: true },
    }),
    client.fiscalEmissaoJob.findMany({
      where: {
        storeId,
        tipo: "CONTINGENCIA_TRANSMISSAO",
        status: { in: queuedDrainStatuses },
      },
      select: { createdAt: true, payload: true },
    }),
    client.fiscalLog.findFirst({
      where: {
        storeId,
        acao: STORE_PAUSE_ACTION,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { cStat: true, detalhe: true, mensagem: true },
    }),
    client.fiscalLog.findFirst({
      where: {
        acao: GLOBAL_PAUSE_ACTION,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { cStat: true, detalhe: true, mensagem: true },
    }),
  ])

  // --- Contingência ---
  let nearestDeadline: Date | null = null
  let nearestAlarm: OfflineContingencyAlarm | null = null
  const alarmsCount = { safe: 0, approaching: 0, expired: 0 }

  for (const job of activeDrainJobs) {
    const payload = record(job.payload)
    const alarm = offlineContingencyAlarmFromPayload(payload, now)
    if (alarm === "SAFE") alarmsCount.safe += 1
    else if (alarm === "APPROACHING") alarmsCount.approaching += 1
    else if (alarm === "EXPIRED") alarmsCount.expired += 1

    const rawDeadline = payload.deadlineAt
    if (typeof rawDeadline === "string") {
      const parsedDeadline = new Date(rawDeadline)
      if (Number.isFinite(parsedDeadline.getTime())) {
        if (!nearestDeadline || parsedDeadline.getTime() < nearestDeadline.getTime()) {
          nearestDeadline = parsedDeadline
          nearestAlarm = alarm
        }
      }
    }
  }

  const oldestPendingDrainAgeMs = oldestDrainJob?.createdAt
    ? Math.max(0, now.getTime() - oldestDrainJob.createdAt.getTime())
    : null

  // --- Throttling / Pausa ---
  const storeIsPaused = pauseSnapshot.pausedStoreIds.includes(storeId)
  const isPaused = pauseSnapshot.globalPaused || storeIsPaused
  const pausedScope: "global" | "store" | "none" = pauseSnapshot.globalPaused
    ? "global"
    : storeIsPaused
      ? "store"
      : "none"

  let cStat656Evidence = false
  let pauseReason: string | null = null

  if (isPaused) {
    const relevantLog = pausedScope === "store" ? latestStorePauseLog : (latestGlobalPauseLog ?? latestStorePauseLog)
    const logRec = record(relevantLog)
    const detalhe = record(logRec.detalhe)
    const cStat = String(logRec.cStat ?? detalhe.cStat ?? "").trim()

    if (cStat === "656") {
      cStat656Evidence = true
      pauseReason = "cstat_656"
    } else if (typeof detalhe.reason === "string" && detalhe.reason.trim()) {
      pauseReason = detalhe.reason.trim()
    } else if (typeof logRec.mensagem === "string" && logRec.mensagem.trim()) {
      pauseReason = logRec.mensagem.trim()
    } else {
      pauseReason = "unknown"
    }
  }

  return {
    observedAt: now.toISOString(),
    storeId,
    queue: queueMetrics,
    uncertain: uncertainMetrics,
    contingency: {
      contingencyNotesCount,
      pendingDrainJobsCount,
      oldestPendingDrainAgeMs,
      nearestDeadlineAt: nearestDeadline ? nearestDeadline.toISOString() : null,
      nearestAlarm,
      alarms: alarmsCount,
    },
    throttling: {
      isPaused,
      pausedScope,
      source: pauseSnapshot.globalPaused ? pauseSnapshot.globalSource : (storeIsPaused ? "store_pause_log" : "none"),
      cStat656Evidence,
      reason: pauseReason,
    },
  }
}
