/**
 * Classificador fail-closed do retorno de inutilização.
 *
 * UNKNOWN nunca autoriza retry automático. Nenhuma política de retransmissão neste GOAL.
 * Processo síncrono (MOC 7.0): não há resposta intermediária de lote (103/104/105).
 */

import { lookupInutilizacaoCStat } from "./cstat-matrix"
import { TPROT_PATTERN, TSTAT_PATTERN, type InutilizacaoClassification } from "./types"

const SEM_RETRY = false as const

function base(
  partial: Omit<InutilizacaoClassification, "retryAutomatico">,
): InutilizacaoClassification {
  return { ...partial, retryAutomatico: SEM_RETRY }
}

export function classifyInutilizacaoRetorno(parsed: {
  readonly cStat: string | null
  readonly xMotivo: string | null
  readonly nProt: string | null
  readonly malformed?: boolean
  readonly ambiguous?: boolean
}): InutilizacaoClassification {
  if (parsed.malformed) {
    return base({
      outcome: "MALFORMED",
      reason: "MALFORMED_RESPONSE",
      cStat: null,
      xMotivo: null,
      protocolo: null,
      rotulo: "Resposta malformada",
    })
  }
  if (parsed.ambiguous) {
    return base({
      outcome: "UNKNOWN",
      reason: "AMBIGUOUS_RESPONSE",
      cStat: null,
      xMotivo: null,
      protocolo: null,
      rotulo: "Resposta ambígua",
    })
  }
  if (!parsed.cStat || !TSTAT_PATTERN.test(parsed.cStat)) {
    return base({
      outcome: parsed.cStat ? "UNKNOWN" : "UNKNOWN",
      reason: "MISSING_CSTAT",
      cStat: parsed.cStat,
      xMotivo: parsed.xMotivo,
      protocolo: null,
      rotulo: "cStat ausente ou ilegível",
    })
  }

  const entrada = lookupInutilizacaoCStat(parsed.cStat)
  if (!entrada) {
    return base({
      outcome: "UNKNOWN",
      reason: "UNKNOWN",
      cStat: parsed.cStat,
      xMotivo: parsed.xMotivo,
      protocolo: parsed.nProt && TPROT_PATTERN.test(parsed.nProt) ? parsed.nProt : null,
      rotulo: "cStat fora da matriz oficial de inutilização",
    })
  }

  if (entrada.kind === "SUCCESS") {
    if (!parsed.nProt || !TPROT_PATTERN.test(parsed.nProt)) {
      return base({
        outcome: "UNKNOWN",
        reason: "INCOMPLETE_SUCCESS",
        cStat: parsed.cStat,
        xMotivo: parsed.xMotivo,
        protocolo: null,
        rotulo: "cStat 102 sem protocolo TProt verificável",
      })
    }
    return base({
      outcome: "SUCCESS",
      reason: "INUTILIZACAO_HOMOLOGADA",
      cStat: parsed.cStat,
      xMotivo: parsed.xMotivo,
      protocolo: parsed.nProt,
      rotulo: entrada.rotulo,
    })
  }

  return base({
    outcome: "REJECTED",
    reason: "REJEICAO_DEFINITIVA",
    cStat: parsed.cStat,
    xMotivo: parsed.xMotivo,
    protocolo: parsed.nProt && TPROT_PATTERN.test(parsed.nProt) ? parsed.nProt : null,
    rotulo: entrada.rotulo,
  })
}

/** Prova estrutural: UNKNOWN (e qualquer desfecho) jamais autoriza retry automático. */
export function inutilizacaoPermiteRetryAutomatico(
  classification: InutilizacaoClassification,
): false {
  void classification
  return false
}
