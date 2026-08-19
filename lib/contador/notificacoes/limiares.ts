/**
 * Contador HUB · limiares temporais dos alertas (GOAL 017).
 *
 * Ratificação humana (revisão independente / corretivo 002):
 *  - documento_pendente = somente status PENDENTE (sem N dias);
 *  - fechamento_proximo = últimos 7 dias civis até o fim da competência,
 *    reutilizando JANELA_OPERACIONAL_DIAS=7 (mesmo valor canônico das guias).
 *
 * Sem terceiro limiar. Sem preferência persistente. Sem schema.
 */
import { GUIAS_VENCENDO_DIAS } from "@/lib/contador/agenda/tipos"

export { GUIAS_VENCENDO_DIAS }

/** Janela canônica de 7 dias — guias e “fechamento próximo”. */
export const JANELA_OPERACIONAL_DIAS = GUIAS_VENCENDO_DIAS

/** `documento_pendente` não tem limiar temporal — só o estado PENDENTE. */
export const DOCUMENTO_PENDENTE_THRESHOLD = "STATE_ONLY" as const

/** Últimos 7 dias civis até o fim da competência (America/Sao_Paulo). */
export const FECHAMENTO_PROXIMO_DAYS = JANELA_OPERACIONAL_DIAS

/**
 * Limiares pedidos no comando original que o humano ratificou sem número extra.
 * `false` = nada pendente de decisão.
 */
export const THRESHOLD_HUMAN_DECISION_REQUIRED = false as const
