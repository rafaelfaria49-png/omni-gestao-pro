import type { FiscalQueueJob, FiscalQueuePayload } from "./queue.types"

const DEFAULT_MAX_ERROR_LENGTH = 500

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {}
}

/** Remove XML, quebras e valores de campos sensíveis antes de persistir/logar erros. */
export function sanitizeFiscalQueueError(
  value: unknown,
  maxLength = DEFAULT_MAX_ERROR_LENGTH,
): string {
  const raw = value instanceof Error ? value.message : String(value ?? "")
  const withoutXml = raw.replace(/<\?xml[\s\S]*$/gi, "[xml_removido]").replace(/<[^>]+>/g, "[markup_removido]")
  const withoutSecrets = withoutXml.replace(
    /\b(authorization|senha|password|token|secret|certificado|pfx|private[_ -]?key|xml)\b\s*[:=]\s*([^\s,;]+)/gi,
    "$1=[redigido]",
  )
  const compact = withoutSecrets.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim()
  return (compact || "Falha fiscal não especificada.").slice(0, Math.max(64, maxLength))
}

/** Backoff exponencial determinístico, sem jitter, com teto operacional. */
export function calculateFiscalQueueBackoffMs(
  attempt: number,
  baseMs = 30_000,
  maxMs = 30 * 60_000,
): number {
  const safeAttempt = Number.isInteger(attempt) ? Math.max(1, attempt) : 1
  const safeBase = Math.max(1_000, Math.floor(baseMs))
  const safeMax = Math.max(safeBase, Math.floor(maxMs))
  return Math.min(safeMax, safeBase * 2 ** Math.min(20, safeAttempt - 1))
}

type TransmissionState = {
  startedAt?: string | null
  lastStartedAt?: string | null
  completedAt?: string | null
  external?: boolean
  attempt?: number
  uncertainAt?: string | null
  consultationOutcome?: "AUTHORIZED" | "NOT_FOUND" | "REJECTED" | null
  consultationCompletedAt?: string | null
  retryAuthorizedAt?: string | null
  retryAuthorizationConsumedAt?: string | null
}

export function readTransmissionState(payload: FiscalQueuePayload | null): TransmissionState {
  const root = asRecord(payload)
  return asRecord(root.transmission) as TransmissionState
}

/**
 * Retry de transmissão ambígua é fail-closed: só CONSULTA=NOT_FOUND registrada pode
 * autorizar uma única nova transmissão. A regra também vale para o stub de drill.
 */
export function canStartFiscalTransmission(job: FiscalQueueJob): {
  allowed: boolean
  reason: string
} {
  const transmission = readTransmissionState(job.payload)
  if (!transmission.startedAt || transmission.completedAt || !transmission.uncertainAt) {
    return { allowed: true, reason: "sem_transmissao_ambigua_pendente" }
  }
  if (
    transmission.consultationOutcome === "NOT_FOUND" &&
    transmission.retryAuthorizedAt &&
    !transmission.retryAuthorizationConsumedAt
  ) {
    return { allowed: true, reason: "consulta_autorizou_retry" }
  }
  return {
    allowed: false,
    reason: "consulta_obrigatoria_antes_de_nova_transmissao",
  }
}

export function withTransmissionStarted(
  job: FiscalQueueJob,
  now: Date,
): FiscalQueuePayload {
  const payload = asRecord(job.payload)
  const previous = readTransmissionState(job.payload)
  const consumesAuthorization =
    Boolean(previous.retryAuthorizedAt) &&
    !previous.retryAuthorizationConsumedAt
  return {
    ...payload,
    transmission: {
      ...previous,
      startedAt: previous.startedAt ?? now.toISOString(),
      lastStartedAt: now.toISOString(),
      completedAt: null,
      external: false,
      attempt: job.tentativas,
      retryAuthorizationConsumedAt: consumesAuthorization
        ? now.toISOString()
        : previous.retryAuthorizationConsumedAt,
    },
  }
}

export function withExecutionResult(
  payload: FiscalQueuePayload,
  input: {
    now: Date
    code: string
    kind:
      | "success"
      | "transient"
      | "terminal"
      | "uncertain"
      | "throttled"
      | "processing"
      | "unresolved"
    externalTransmissionAttempted: boolean
    detalhe?: Record<string, unknown>
  },
): FiscalQueuePayload {
  const root = asRecord(payload)
  const transmission = readTransmissionState(root)
  const executionDetail = asRecord(input.detalhe)
  return {
    ...root,
    ...executionDetail,
    transmission: {
      ...transmission,
      external: input.externalTransmissionAttempted,
      completedAt: input.kind === "success" ? input.now.toISOString() : null,
      /**
       * `unresolved` marca `uncertainAt` junto com `uncertain`: a transmissão é incerta nos
       * dois casos — o que os distingue é apenas se a CONSULTA pôde ser criada. Sem esta
       * marca, `canStartFiscalTransmission` liberaria uma nova transmissão caso o job voltasse
       * a rodar, que é exatamente o que não pode acontecer com desfecho desconhecido.
       */
      uncertainAt:
        input.kind === "uncertain" || input.kind === "unresolved"
          ? input.now.toISOString()
          : transmission.uncertainAt ?? null,
    },
    lastExecution: {
      at: input.now.toISOString(),
      code: input.code,
      kind: input.kind,
      detalhe: executionDetail,
    },
  }
}
