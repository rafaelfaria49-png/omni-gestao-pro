/**
 * Classificação e precedência da evidência de consulta (GOAL 020D).
 *
 * Reusa a matriz `lookupSefazCStat` e os outcomes do parser 016D-B.
 * Não parseia SOAP, não chama SEFAZ, não inventa NOT_FOUND.
 */
import { lookupSefazCStat } from "../provider/sefaz/sefaz-cstat-matrix"
import {
  CONTINGENCIA_CONSULTA_SERVICO,
  CONTINGENCIA_EVIDENCE_PRECEDENCE,
  CONTINGENCIA_RECONCILIATION_EVIDENCE_KINDS,
  type ContingenciaConsultaSanitizada,
  type ContingenciaReconciliationEvidenceKind,
} from "./types"

const EVIDENCE_SET = new Set<string>(CONTINGENCIA_RECONCILIATION_EVIDENCE_KINDS)

/** Mesma regra de `numeroFiscal` do parser oficial: nProt numérico 1–20 dígitos. */
const PROTOCOLO_FISCAL = /^\d{1,20}$/

export function isCanonicalEvidenceKind(
  value: unknown,
): value is ContingenciaReconciliationEvidenceKind {
  return typeof value === "string" && EVIDENCE_SET.has(value)
}

export function isValidFiscalProtocolo(value: string | null | undefined): boolean {
  return typeof value === "string" && PROTOCOLO_FISCAL.test(value)
}

export function evidenceRank(kind: ContingenciaReconciliationEvidenceKind): number {
  return CONTINGENCIA_EVIDENCE_PRECEDENCE[kind]
}

/**
 * Deriva o kind canônico a partir do classificador oficial — nunca da ausência
 * local de linha, timeout, SOAP Fault, malformado ou cStat desconhecido.
 */
export function deriveEvidenceKind(
  consulta: ContingenciaConsultaSanitizada,
): ContingenciaReconciliationEvidenceKind {
  if (consulta.servico !== CONTINGENCIA_CONSULTA_SERVICO) return "UNKNOWN"
  if (consulta.uncertainCode === "TIMEOUT" || consulta.uncertainCode === "CONNECTION_LOST") {
    return "UNKNOWN"
  }
  if (
    consulta.reason === "SOAP_FAULT" ||
    consulta.reason === "MALFORMED_RESPONSE" ||
    consulta.reason === "AMBIGUOUS_RESPONSE" ||
    consulta.reason === "MISSING_CSTAT" ||
    consulta.reason === "SERVICE_MISMATCH" ||
    consulta.reason === "DOCUMENT_MISMATCH" ||
    consulta.reason === "MISSING_DOCUMENT_CONTEXT" ||
    consulta.reason === "INCOMPLETE_AUTHORIZATION"
  ) {
    return "UNKNOWN"
  }

  if (consulta.outcome === "NOT_FOUND" && consulta.reason === "NAO_CONSTA" && consulta.cStat) {
    const lookup = lookupSefazCStat(consulta.cStat, CONTINGENCIA_CONSULTA_SERVICO)
    if (lookup.ok && lookup.entry.outcome === "NOT_FOUND" && lookup.entry.reason === "NAO_CONSTA") {
      return "NOT_FOUND"
    }
    return "UNKNOWN"
  }

  if (consulta.outcome === "AUTHORIZED" && consulta.reason === "AUTORIZADO" && consulta.cStat) {
    const lookup = lookupSefazCStat(consulta.cStat, CONTINGENCIA_CONSULTA_SERVICO)
    if (
      lookup.ok &&
      lookup.entry.outcome === "AUTHORIZED" &&
      lookup.entry.exigeProtocolo &&
      isValidFiscalProtocolo(consulta.protocolo)
    ) {
      if (lookup.entry.exigeXmlAutorizado && !consulta.xmlAutorizado) return "UNKNOWN"
      return "AUTHORIZED"
    }
    return "UNKNOWN"
  }

  if (consulta.outcome === "REJECTED" && consulta.cStat) {
    const lookup = lookupSefazCStat(consulta.cStat, CONTINGENCIA_CONSULTA_SERVICO)
    if (
      lookup.ok &&
      lookup.entry.outcome === "REJECTED" &&
      lookup.entry.consequencias.terminal === true &&
      lookup.entry.reason === "REJEICAO_TERMINAL"
    ) {
      return "REJECTED_FINAL"
    }
  }

  return "UNKNOWN"
}

export type EvidenceConflict =
  | { ok: true; action: "apply" | "idempotent" }
  | { ok: false; code: "evidencia_conflitante" | "estado_terminal_nao_reabre" }

/**
 * Precedência fail-closed.
 *
 * - mesma evidência → idempotente
 * - UNKNOWN persistido → evidência nova pode aplicar (não trava)
 * - terminal persistido → qualquer outra evidência falha
 * - NOT_FOUND persistido → terminal posterior aplica; UNKNOWN posterior falha
 */
export function compareEvidencePrecedence(
  persisted: ContingenciaReconciliationEvidenceKind | null,
  incoming: ContingenciaReconciliationEvidenceKind,
): EvidenceConflict {
  if (persisted == null || persisted === incoming) {
    return { ok: true, action: persisted === incoming ? "idempotent" : "apply" }
  }
  if (persisted === "UNKNOWN") {
    return { ok: true, action: "apply" }
  }
  const persistedRank = evidenceRank(persisted)
  const incomingRank = evidenceRank(incoming)
  const persistedTerminal = persistedRank === CONTINGENCIA_EVIDENCE_PRECEDENCE.AUTHORIZED
  if (persistedTerminal) {
    return { ok: false, code: "estado_terminal_nao_reabre" }
  }
  if (incomingRank > persistedRank) {
    return { ok: true, action: "apply" }
  }
  return { ok: false, code: "evidencia_conflitante" }
}
