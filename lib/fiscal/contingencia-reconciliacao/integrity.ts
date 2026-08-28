/**
 * Integridade do par exactBytes persistido (GOAL 020D).
 *
 * Reusa as proteções do fix 795d51a: storeId, chave, sha256, xmlAssinado,
 * tpEmis=9, job correspondente. Nunca repara silenciosamente.
 */
import { createHash } from "node:crypto"
import { CONTINGENCIA_TP_EMIS } from "../contingencia/types"
import {
  CONTINGENCIA_OUTBOX_JOB_STATUS_DORMENTE,
  CONTINGENCIA_OUTBOX_JOB_TIPO,
} from "../contingencia-outbox/types"
import { buildContingenciaOutboxDedupeKey } from "../contingencia-outbox/identity"
import type { ContingenciaDocumentoEstado } from "../contingencia/types"

const SHA256_HEX = /^[0-9a-f]{64}$/
const CHAVE_44 = /^\d{44}$/

export type ContingenciaPairNota = {
  id: string
  storeId: string
  vendaId: string
  chaveAcesso: string | null
  xmlAssinado: string | null
  status: string
  tipoEmissao: string
  serie: number | null
  numero: number | null
  protocolo: string | null
}

export type ContingenciaPairJob = {
  id: string
  storeId: string
  vendaId: string
  notaFiscalId: string | null
  tipo: string
  status: string
  dedupeKey: string | null
  payload: unknown
  proximaTentativaEm: Date | null
}

export type PairIntegrityOk = {
  ok: true
  xml: string
  sha256: string
  estado: ContingenciaDocumentoEstado
  persistedEvidence: "AUTHORIZED" | "NOT_FOUND" | "REJECTED_FINAL" | "UNKNOWN" | null
  eligibilityConsumed: boolean
}

export type PairIntegrityFail = {
  ok: false
  code: "par_inconsistente" | "identidade_fiscal_conflito" | "chave_bytes_conflito" | "documento_ausente"
  mensagem: string
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim()
}

export function sha256Utf8(xml: string): string {
  return createHash("sha256").update(Buffer.from(xml, "utf8")).digest("hex")
}

function xmlContainsIssuedIdentity(xml: string, chave: string, nNF: number, serie: number): boolean {
  return (
    xml.includes(chave) &&
    xml.includes(`Id="NFe${chave}"`) &&
    xml.includes("<tpEmis>9</tpEmis>") &&
    xml.includes(`<nNF>${nNF}</nNF>`) &&
    xml.includes(`<serie>${serie}</serie>`)
  )
}

function readEstado(payload: unknown): ContingenciaDocumentoEstado | null {
  const estado = str(record(record(payload).contingencia).estado)
  const allowed: ContingenciaDocumentoEstado[] = [
    "PREPARADO",
    "EMITIDO_LOCAL",
    "PENDENTE_TX",
    "TX_ANDAMENTO",
    "AUTORIZADO_POST",
    "REJEITADO_DEF",
    "UNKNOWN",
    "INTERVENCAO_MANUAL",
  ]
  return allowed.includes(estado as ContingenciaDocumentoEstado)
    ? (estado as ContingenciaDocumentoEstado)
    : null
}

function readPersistedEvidence(
  payload: unknown,
): PairIntegrityOk["persistedEvidence"] {
  const kind = str(record(record(payload).contingencia).lastEvidenceKind)
  if (
    kind === "AUTHORIZED" ||
    kind === "NOT_FOUND" ||
    kind === "REJECTED_FINAL" ||
    kind === "UNKNOWN"
  ) {
    return kind
  }
  return null
}

/**
 * Confere o par persistido. Recusa par incompleto, hash divergente, tpEmis≠9
 * ou job que não é a outbox desta contingência.
 */
export function verifyContingenciaExactBytesPair(input: {
  storeId: string
  chave: string
  nota: ContingenciaPairNota | null
  job: ContingenciaPairJob | null
  notaFiscalId?: string | null
  jobId?: string | null
}): PairIntegrityOk | PairIntegrityFail {
  const { storeId, chave, nota, job } = input
  if (!nota && !job) {
    return { ok: false, code: "documento_ausente", mensagem: "Documento de contingência não encontrado nesta loja." }
  }
  if (!nota || !job) {
    return {
      ok: false,
      code: "par_inconsistente",
      mensagem: "Par documento+outbox incompleto; recusado para não completar parcialmente.",
    }
  }
  if (input.notaFiscalId && input.notaFiscalId !== nota.id) {
    return { ok: false, code: "identidade_fiscal_conflito", mensagem: "notaFiscalId informado diverge do persistido." }
  }
  if (input.jobId && input.jobId !== job.id) {
    return { ok: false, code: "identidade_fiscal_conflito", mensagem: "jobId informado diverge do persistido." }
  }
  if (nota.storeId !== storeId || job.storeId !== storeId) {
    return { ok: false, code: "identidade_fiscal_conflito", mensagem: "Documento/job não pertence à loja solicitada." }
  }
  if (nota.chaveAcesso !== chave || !CHAVE_44.test(chave) || chave[34] !== "9") {
    return { ok: false, code: "identidade_fiscal_conflito", mensagem: "chaveAcesso persistida diverge ou não é tpEmis=9." }
  }
  if (nota.tipoEmissao !== "CONTINGENCIA_OFFLINE") {
    return { ok: false, code: "identidade_fiscal_conflito", mensagem: "Documento persistido não está em contingência off-line." }
  }
  if (!nota.xmlAssinado) {
    return { ok: false, code: "par_inconsistente", mensagem: "exactBytes persistidos ausentes; recusado." }
  }
  if (
    !Number.isInteger(nota.numero) ||
    !Number.isInteger(nota.serie) ||
    (nota.numero ?? 0) <= 0 ||
    (nota.serie ?? -1) < 0
  ) {
    return { ok: false, code: "par_inconsistente", mensagem: "nNF/série persistidos ausentes; recusado." }
  }
  if (!xmlContainsIssuedIdentity(nota.xmlAssinado, chave, nota.numero as number, nota.serie as number)) {
    return {
      ok: false,
      code: "par_inconsistente",
      mensagem: "Bytes persistidos não conferem com chave/tpEmis=9/nNF/série.",
    }
  }
  const sha256 = sha256Utf8(nota.xmlAssinado)
  if (!SHA256_HEX.test(sha256)) {
    return { ok: false, code: "par_inconsistente", mensagem: "sha256 dos exactBytes é inválido." }
  }
  const payload = record(job.payload)
  const contingencia = record(payload.contingencia)
  const hashJob = str(contingencia.sha256).toLowerCase()
  if (hashJob && hashJob !== sha256) {
    return { ok: false, code: "chave_bytes_conflito", mensagem: "sha256 do job diverge dos exactBytes da nota." }
  }
  if (str(contingencia.chave) && str(contingencia.chave) !== chave) {
    return { ok: false, code: "identidade_fiscal_conflito", mensagem: "chave do payload diverge da nota." }
  }
  if (Number(contingencia.tpEmis) !== CONTINGENCIA_TP_EMIS) {
    return { ok: false, code: "par_inconsistente", mensagem: "tpEmis do payload não é 9." }
  }
  if (
    job.tipo !== CONTINGENCIA_OUTBOX_JOB_TIPO ||
    job.notaFiscalId !== nota.id ||
    job.vendaId !== nota.vendaId ||
    job.dedupeKey !== buildContingenciaOutboxDedupeKey(chave)
  ) {
    return { ok: false, code: "identidade_fiscal_conflito", mensagem: "Job persistido não é a outbox desta contingência." }
  }
  const estado = readEstado(job.payload)
  if (!estado) {
    return { ok: false, code: "par_inconsistente", mensagem: "Estado de domínio ausente no payload." }
  }
  const eligibility = record(contingencia.retransmissionEligibility)
  return {
    ok: true,
    xml: nota.xmlAssinado,
    sha256,
    estado,
    persistedEvidence: readPersistedEvidence(job.payload),
    eligibilityConsumed: Boolean(str(eligibility.consumedAt)),
  }
}

/** Outbox ainda dormente: inelegível ao worker GOAL-012. */
export function isDormantContingenciaOutbox(job: ContingenciaPairJob): boolean {
  return (
    job.tipo === CONTINGENCIA_OUTBOX_JOB_TIPO &&
    job.status === CONTINGENCIA_OUTBOX_JOB_STATUS_DORMENTE &&
    job.proximaTentativaEm == null
  )
}
