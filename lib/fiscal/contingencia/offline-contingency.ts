/**
 * Contingência offline manual da NFC-e — GOAL 020.
 *
 * Orquestra somente a entrada explícita em contingência e a outbox posterior.
 * Não acessa Prisma, rede, Caixa, Financeiro ou PDV. A transmissão usa as portas
 * já existentes do GOAL-012; este módulo nunca reconstrói o XML.
 */
import { createHash } from "node:crypto"

import type {
  FinalizedDocumentPreparer,
  FinalizedFiscalDocument,
  FiscalDocumentLocator,
} from "../emission/uncertain-state.types"
import { escapeXmlText } from "../xml/xml-writer"

export const OFFLINE_CONTINGENCY_TP_EMIS = 9 as const
export const AUTO_CONTINGENCY_ENABLED = false as const
export const OFFLINE_CONTINGENCY_DEDUPE_VERSION = 1 as const
export const OFFLINE_CONTINGENCY_WARN_BEFORE_MS = 2 * 60 * 60 * 1_000

export const OFFLINE_CONTINGENCY_PRODUCTION_ALLOWED = false as const
export const NUMBER_REUSE_COUNT = 0 as const
export const SIMULATED_CAN_AUTHORIZE = false as const

export type OfflineContingencyAlarm = "SAFE" | "APPROACHING" | "EXPIRED"

export type OfflineContingencyExisting = {
  status: string
  xmlAssinado: string | null
  bytesSha256: string | null
  dataContingencia: Date | string | null
  justContingencia: string | null
}

export type OfflineContingencyPersistence = {
  loadExisting(input: FiscalDocumentLocator): Promise<OfflineContingencyExisting | null>
  setMetadata(input: {
    locator: FiscalDocumentLocator
    dhCont: string
    xJust: string
    operador: string
  }): Promise<boolean>
  persist(input: {
    locator: FiscalDocumentLocator
    document: FinalizedFiscalDocument
    dhCont: string
    xJust: string
    deadlineAt: Date
    requestedBy: string
    now: Date
  }): Promise<{ idempotent: boolean }>
  enqueue(input: {
    locator: FiscalDocumentLocator
    document: FinalizedFiscalDocument
    dhCont: string
    xJust: string
    deadlineAt: Date
    now: Date
  }): Promise<{ jobId: string; created: boolean }>
  audit(input: {
    locator: FiscalDocumentLocator
    action: string
    level: "INFO" | "WARN" | "ERROR"
    message: string
    detail?: Record<string, unknown>
  }): Promise<void>
}

export type EnterOfflineContingencyInput = FiscalDocumentLocator & {
  operador: string
  manualConfirmation: boolean
  fiscalEnabled: boolean
  ambiente: string
  provider: string
  dhCont?: Date | string
  emissaoAt?: Date | string
  xJust: string
  now?: Date
}

export type EnterOfflineContingencyResult =
  | {
      ok: true
      idempotent: boolean
      jobId: string
      jobCreated: boolean
      dedupeKey: string
      dhCont: string
      deadlineAt: string
      bytesSha256: string
      tpEmis: 9
    }
  | { ok: false; code: string; error: string }

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function asValidDate(value: Date | string | undefined, fallback: Date): Date | null {
  if (value == null) return fallback
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

function formatContingencyDate(value: Date): string {
  const shifted = new Date(value.getTime() - 3 * 60 * 60 * 1_000)
  const p2 = (n: number) => String(n).padStart(2, "0")
  return `${shifted.getUTCFullYear()}-${p2(shifted.getUTCMonth() + 1)}-${p2(shifted.getUTCDate())}T${p2(shifted.getUTCHours())}:${p2(shifted.getUTCMinutes())}:${p2(shifted.getUTCSeconds())}-03:00`
}

function normalizeExistingContingencyDate(value: Date | string | null): string | null {
  const parsed = asValidDate(value ?? undefined, new Date(Number.NaN))
  return parsed ? formatContingencyDate(parsed) : null
}

function dateOnlyUtc(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()))
}

export function calculateOfflineTransmissionDeadline(
  emittedAt: Date | string,
  isBusinessDay: (date: Date) => boolean = (date) => {
    const day = date.getUTCDay()
    return day !== 0 && day !== 6
  },
): Date {
  const parsed = asValidDate(emittedAt, new Date(0))
  if (!parsed) throw new Error("Data de emissão inválida para calcular prazo de contingência.")
  const candidate = dateOnlyUtc(parsed)
  candidate.setUTCDate(candidate.getUTCDate() + 1)
  while (!isBusinessDay(candidate)) candidate.setUTCDate(candidate.getUTCDate() + 1)
  candidate.setUTCHours(23, 59, 59, 999)
  return candidate
}

export function offlineContingencyAlarm(
  now: Date,
  deadlineAt: Date,
  warnBeforeMs = OFFLINE_CONTINGENCY_WARN_BEFORE_MS,
): OfflineContingencyAlarm {
  if (now.getTime() >= deadlineAt.getTime()) return "EXPIRED"
  return deadlineAt.getTime() - now.getTime() <= Math.max(0, warnBeforeMs)
    ? "APPROACHING"
    : "SAFE"
}

export function offlineContingencyAlarmFromPayload(
  payload: Record<string, unknown> | null,
  now: Date,
): OfflineContingencyAlarm | null {
  const raw = payload?.deadlineAt
  if (typeof raw !== "string") return null
  const deadline = new Date(raw)
  if (!Number.isFinite(deadline.getTime())) return null
  return offlineContingencyAlarm(now, deadline)
}

export function buildOfflineContingencyDedupeKey(notaFiscalId: string): string {
  const id = text(notaFiscalId)
  if (!id) throw new Error("notaFiscalId obrigatório para deduplicar contingência.")
  return `fiscal:contingencia:v${OFFLINE_CONTINGENCY_DEDUPE_VERSION}:nota:${id}`
}

export function fiscalBytesSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function exactBytes(xml: string): Uint8Array {
  return new TextEncoder().encode(xml)
}

function sameExistingBytes(existing: OfflineContingencyExisting, bytesSha256: string): boolean {
  return existing.status === "CONTINGENCIA" && existing.bytesSha256 === bytesSha256
}

function validateInput(input: EnterOfflineContingencyInput): string | null {
  if (!text(input.storeId) || !text(input.vendaId) || !text(input.notaFiscalId)) {
    return "storeId, vendaId e notaFiscalId são obrigatórios."
  }
  if (!text(input.operador)) return "Operador obrigatório."
  if (!input.manualConfirmation) return "A entrada em contingência exige confirmação manual explícita."
  if (!input.fiscalEnabled) return "Loja fiscalmente desabilitada; contingência recusada."
  if (text(input.ambiente) !== "HOMOLOGACAO") return "Contingência offline deste piloto exige HOMOLOGACAO."
  if (text(input.provider) !== "SEFAZ_DIRETO") return "Contingência offline exige provider SEFAZ_DIRETO."
  const justification = text(input.xJust)
  if (justification.length < 15 || justification.length > 256) {
    return "xJust deve ter entre 15 e 256 caracteres."
  }
  return null
}

export async function enterManualOfflineContingency(
  input: EnterOfflineContingencyInput,
  dependencies: {
    preparer: FinalizedDocumentPreparer
    persistence: OfflineContingencyPersistence
    isBusinessDay?: (date: Date) => boolean
  },
): Promise<EnterOfflineContingencyResult> {
  const invalid = validateInput(input)
  if (invalid) return { ok: false, code: "entrada_invalida", error: invalid }

  const now = input.now ?? new Date()
  const dhContDate = asValidDate(input.dhCont, now)
  const emissaoDate = asValidDate(input.emissaoAt, now)
  if (!dhContDate || !emissaoDate) {
    return { ok: false, code: "data_invalida", error: "dhCont/emissaoAt inválida." }
  }
  const dhCont = formatContingencyDate(dhContDate)
  const deadlineAt = calculateOfflineTransmissionDeadline(emissaoDate, dependencies.isBusinessDay)
  const locator: FiscalDocumentLocator = {
    storeId: text(input.storeId),
    vendaId: text(input.vendaId),
    notaFiscalId: text(input.notaFiscalId),
  }

  const existing = await dependencies.persistence.loadExisting(locator)
  if (
    existing &&
    existing.status === "CONTINGENCIA" &&
    text(existing.justContingencia) === text(input.xJust) &&
    normalizeExistingContingencyDate(existing.dataContingencia) === dhCont
  ) {
    const prepared = await dependencies.preparer.prepare(locator)
    const bytesSha256 = fiscalBytesSha256(exactBytes(prepared.xmlAssinado))
    if (sameExistingBytes(existing, bytesSha256)) {
      const job = await dependencies.persistence.enqueue({
        locator,
        document: prepared,
        dhCont,
        xJust: text(input.xJust),
        deadlineAt,
        now,
      })
      return {
        ok: true,
        idempotent: true,
        jobId: job.jobId,
        jobCreated: job.created,
        dedupeKey: buildOfflineContingencyDedupeKey(locator.notaFiscalId),
        dhCont,
        deadlineAt: deadlineAt.toISOString(),
        bytesSha256,
        tpEmis: OFFLINE_CONTINGENCY_TP_EMIS,
      }
    }
    return {
      ok: false,
      code: "xml_contingencia_imutavel_diverge",
      error: "Nota já contingenciada com bytes divergentes; nova composição recusada.",
    }
  }

  const prepared = await dependencies.preparer.prepare(locator, {
    dhCont,
    xJust: text(input.xJust),
  })
  if (
    prepared.storeId !== locator.storeId ||
    prepared.vendaId !== locator.vendaId ||
    prepared.notaFiscalId !== locator.notaFiscalId ||
    prepared.modelo !== "NFCE" ||
    prepared.ambiente !== "HOMOLOGACAO" ||
    !Number.isInteger(prepared.serie) ||
    prepared.serie <= 0 ||
    !Number.isInteger(prepared.numero) ||
    prepared.numero <= 0
  ) {
    return { ok: false, code: "escopo_invalido", error: "Documento preparado fora do escopo NFC-e solicitado." }
  }
  if (!prepared.xmlAssinado.includes("<tpEmis>9</tpEmis>") ||
      !prepared.xmlAssinado.includes(`<dhCont>${dhCont}</dhCont>`) ||
      !prepared.xmlAssinado.includes(`<xJust>${escapeXmlText(text(input.xJust))}</xJust>`)) {
    return { ok: false, code: "xml_contingencia_invalido", error: "XML offline não contém tpEmis=9, dhCont e xJust." }
  }
  const metadataSaved = await dependencies.persistence.setMetadata({
    locator,
    dhCont,
    xJust: text(input.xJust),
    operador: text(input.operador),
  })
  if (!metadataSaved) {
    return { ok: false, code: "estado_concorrente", error: "Estado da nota mudou antes da entrada em contingência." }
  }
  const bytesSha256 = fiscalBytesSha256(exactBytes(prepared.xmlAssinado))
  const persisted = await dependencies.persistence.persist({
    locator,
    document: prepared,
    dhCont,
    xJust: text(input.xJust),
    deadlineAt,
    requestedBy: text(input.operador),
    now,
  })
  const job = await dependencies.persistence.enqueue({
    locator,
    document: prepared,
    dhCont,
    xJust: text(input.xJust),
    deadlineAt,
    now,
  })
  await dependencies.persistence.audit({
    locator,
    action: persisted.idempotent ? "fiscal.contingencia.manual_idempotente" : "fiscal.contingencia.manual_entered",
    level: "INFO",
    message: "Contingência offline manual registrada; transmissão posterior enfileirada.",
    detail: {
      tpEmis: OFFLINE_CONTINGENCY_TP_EMIS,
      dhCont,
      deadlineAt: deadlineAt.toISOString(),
      bytesSha256,
      autoContingency: AUTO_CONTINGENCY_ENABLED,
      numberReuseCount: NUMBER_REUSE_COUNT,
      simulatedCanAuthorize: SIMULATED_CAN_AUTHORIZE,
      queueJobId: job.jobId,
    },
  })
  return {
    ok: true,
    idempotent: persisted.idempotent,
    jobId: job.jobId,
    jobCreated: job.created,
    dedupeKey: buildOfflineContingencyDedupeKey(locator.notaFiscalId),
    dhCont,
    deadlineAt: deadlineAt.toISOString(),
    bytesSha256,
    tpEmis: OFFLINE_CONTINGENCY_TP_EMIS,
  }
}
