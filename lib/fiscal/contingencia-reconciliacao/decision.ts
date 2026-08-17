/**
 * Decisão pura da reconciliação 020D sobre a máquina 020A.
 *
 * Não afrouxa 020A: UNKNOWN nunca vai a TX_ANDAMENTO, terminais não reabrem,
 * retryAutomatico permanece false. AUTORIZAR/REJEITAR do grafo 020A continuam
 * reservados ao caminho de transmissão; 020D decide por evidência classificada.
 */
import { evaluateUnknown } from "../contingencia/policy"
import type { ContingenciaDocumentoEstado } from "../contingencia/types"
import { compareEvidencePrecedence } from "./evidence"
import type { ContingenciaReconciliationEvidenceKind } from "./types"

export type ContingenciaReconciliationDecision =
  | {
      ok: true
      action: "apply" | "idempotent"
      from: ContingenciaDocumentoEstado
      to: ContingenciaDocumentoEstado
      evidenceKind: ContingenciaReconciliationEvidenceKind
      retryAutomatico: false
      executeAutomatico: false
      eligibilityCreated: boolean
      requiresHumanIntervention: boolean
      podeConsultar: boolean
    }
  | {
      ok: false
      code: "evidencia_conflitante" | "estado_terminal_nao_reabre" | "transicao_invalida"
      from: ContingenciaDocumentoEstado
      evidenceKind: ContingenciaReconciliationEvidenceKind
      retryAutomatico: false
      executeAutomatico: false
      eligibilityCreated: false
    }

const TERMINAIS = new Set<ContingenciaDocumentoEstado>(["AUTORIZADO_POST", "REJEITADO_DEF"])
const ORIGENS_RECONCILIAVEIS = new Set<ContingenciaDocumentoEstado>([
  "PENDENTE_TX",
  "UNKNOWN",
])

function destinoPorEvidencia(
  from: ContingenciaDocumentoEstado,
  evidence: ContingenciaReconciliationEvidenceKind,
): ContingenciaDocumentoEstado {
  if (evidence === "AUTHORIZED") return "AUTORIZADO_POST"
  if (evidence === "REJECTED_FINAL") return "REJEITADO_DEF"
  if (evidence === "UNKNOWN") {
    return from === "UNKNOWN" ? "UNKNOWN" : from
  }
  return from
}

/**
 * Mapeia PENDENTE_TX / UNKNOWN → resultado da reconciliação.
 * TX_ANDAMENTO não é persistido nesta trilha e não é inventado.
 */
export function decideContingenciaReconciliation(input: {
  from: ContingenciaDocumentoEstado
  evidenceKind: ContingenciaReconciliationEvidenceKind
  persistedEvidence: ContingenciaReconciliationEvidenceKind | null
}): ContingenciaReconciliationDecision {
  const unknown = evaluateUnknown()
  const baseFail = {
    retryAutomatico: false as const,
    executeAutomatico: false as const,
    eligibilityCreated: false as const,
  }

  if (input.from === "TX_ANDAMENTO") {
    return {
      ok: false,
      code: "transicao_invalida",
      from: input.from,
      evidenceKind: input.evidenceKind,
      ...baseFail,
    }
  }

  if (TERMINAIS.has(input.from)) {
    const expected: ContingenciaReconciliationEvidenceKind =
      input.from === "AUTORIZADO_POST" ? "AUTHORIZED" : "REJECTED_FINAL"
    if (input.evidenceKind === expected) {
      return {
        ok: true,
        action: "idempotent",
        from: input.from,
        to: input.from,
        evidenceKind: input.evidenceKind,
        retryAutomatico: false,
        executeAutomatico: false,
        eligibilityCreated: false,
        requiresHumanIntervention: input.from === "REJEITADO_DEF",
        podeConsultar: false,
      }
    }
    return {
      ok: false,
      code: "estado_terminal_nao_reabre",
      from: input.from,
      evidenceKind: input.evidenceKind,
      ...baseFail,
    }
  }

  if (!ORIGENS_RECONCILIAVEIS.has(input.from)) {
    return {
      ok: false,
      code: "transicao_invalida",
      from: input.from,
      evidenceKind: input.evidenceKind,
      ...baseFail,
    }
  }

  const precedence = compareEvidencePrecedence(input.persistedEvidence, input.evidenceKind)
  if (!precedence.ok) {
    return {
      ok: false,
      code: precedence.code,
      from: input.from,
      evidenceKind: input.evidenceKind,
      ...baseFail,
    }
  }

  const to = destinoPorEvidencia(input.from, input.evidenceKind)
  if (to === "TX_ANDAMENTO") {
    return {
      ok: false,
      code: "transicao_invalida",
      from: input.from,
      evidenceKind: input.evidenceKind,
      ...baseFail,
    }
  }

  const eligibilityCreated =
    precedence.action === "apply" && input.evidenceKind === "NOT_FOUND"
  const podeConsultar =
    input.evidenceKind === "UNKNOWN" || input.evidenceKind === "NOT_FOUND"

  return {
    ok: true,
    action: precedence.action,
    from: input.from,
    to,
    evidenceKind: input.evidenceKind,
    retryAutomatico: false,
    executeAutomatico: false,
    eligibilityCreated,
    requiresHumanIntervention: input.evidenceKind === "REJECTED_FINAL",
    podeConsultar: podeConsultar || (input.evidenceKind === "UNKNOWN" && unknown.podeConsultar),
  }
}
