/**
 * Máquina de estados pura do documento em contingência off-line (GOAL 020A).
 *
 * Distinta da máquina online ADR-0017. Uma nota não ocupa os dois caminhos.
 * Transições inválidas falham de forma estruturada. UNKNOWN é fail-closed.
 */
import { exactBytesRequirement, evaluateUnknown } from "./policy"
import type {
  ContingenciaDocumentoEstado,
  ContingenciaEvento,
  ContingenciaTransitionResult,
  ReconciliacaoNecessaria,
} from "./types"

const RECONCILIACAO: ReconciliacaoNecessaria = {
  kind: "RECONCILIATION_REQUIRED",
  retryAutomatico: false,
  autorizaNovaEmissaoAutomatica: false,
  retornoDiretoTxAndamento: false,
  implementacao: "020D",
}

/** Grafo explícito: origem → evento → destino. CONSULTAR em UNKNOWN permanece UNKNOWN. */
const TRANSICOES: Readonly<
  Partial<Record<ContingenciaDocumentoEstado, Partial<Record<ContingenciaEvento, ContingenciaDocumentoEstado>>>>
> = {
  PREPARADO: {
    EMITIR_LOCAL: "EMITIDO_LOCAL",
    INTERVIR: "INTERVENCAO_MANUAL",
  },
  EMITIDO_LOCAL: {
    ENFILEIRAR_TX: "PENDENTE_TX",
    INTERVIR: "INTERVENCAO_MANUAL",
  },
  PENDENTE_TX: {
    INICIAR_TX: "TX_ANDAMENTO",
    INTERVIR: "INTERVENCAO_MANUAL",
  },
  TX_ANDAMENTO: {
    AUTORIZAR: "AUTORIZADO_POST",
    REJEITAR: "REJEITADO_DEF",
    PERDER_RESPOSTA: "UNKNOWN",
    INTERVIR: "INTERVENCAO_MANUAL",
  },
  AUTORIZADO_POST: {
    INTERVIR: "INTERVENCAO_MANUAL",
  },
  REJEITADO_DEF: {
    INTERVIR: "INTERVENCAO_MANUAL",
  },
  UNKNOWN: {
    CONSULTAR: "UNKNOWN",
    DECIDIR_RECONCILIACAO: "INTERVENCAO_MANUAL",
  },
  INTERVENCAO_MANUAL: {},
}

export function allowedTransition(
  from: ContingenciaDocumentoEstado,
  event: ContingenciaEvento,
): ContingenciaDocumentoEstado | null {
  return TRANSICOES[from]?.[event] ?? null
}

function fail(
  code: Extract<
    ContingenciaTransitionResult,
    { ok: false }
  >["code"],
  from: ContingenciaDocumentoEstado,
  event: ContingenciaEvento,
  extra?: { reconcilicao?: ReconciliacaoNecessaria },
): ContingenciaTransitionResult {
  return {
    ok: false,
    code,
    from,
    event,
    retryAutomatico: false,
    autorizaNovaEmissaoAutomatica: false,
    ...(extra?.reconcilicao ? { reconcilicao: extra.reconcilicao } : {}),
  }
}

/**
 * Aplica um evento à máquina. Nunca lança. UNKNOWN nunca devolve retryAutomatico=true
 * e nunca transita diretamente para TX_ANDAMENTO.
 */
export function applyContingenciaEvent(
  from: ContingenciaDocumentoEstado,
  event: ContingenciaEvento,
): ContingenciaTransitionResult {
  if (from === "UNKNOWN") {
    if (event === "INICIAR_TX") {
      return fail("unknown_nao_retorna_tx_andamento", from, event, { reconcilicao: RECONCILIACAO })
    }
    if (event === "EMITIR_LOCAL") {
      return fail("unknown_nao_autoriza_emissao", from, event, { reconcilicao: RECONCILIACAO })
    }
  }

  const to = allowedTransition(from, event)
  if (!to) {
    if (from === "UNKNOWN") {
      return fail("unknown_requer_reconciliacao", from, event, { reconcilicao: RECONCILIACAO })
    }
    return fail("transicao_invalida", from, event)
  }

  return {
    ok: true,
    from,
    event,
    to,
    retryAutomatico: false,
    exactBytes: exactBytesRequirement(to, from),
  }
}

export { evaluateUnknown, TRANSICOES }
