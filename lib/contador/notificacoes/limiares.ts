/**
 * Contador HUB · limiares temporais dos alertas (GOAL 017).
 *
 * Só entram números já aprovados no domínio. Sem invenção silenciosa.
 *
 * Canônico (GOAL 016): `GUIAS_VENCENDO_DIAS = 7`.
 * Reuso: fechamento “próximo” usa a mesma janela de 7 dias civis até o último
 * dia da competência (America/Sao_Paulo) — não é `competenciaAbertaAposDia`.
 *
 * Sem valor aprovado (não inventados; ver THRESHOLD_HUMAN_DECISION_REQUIRED):
 *  - `docPendenteDiasAntesFechamento` — a regra é de ESTADO (`PENDENTE`).
 *  - `competenciaAbertaAposDia` — dia civil do mês nunca foi ratificado.
 */
import { GUIAS_VENCENDO_DIAS } from "@/lib/contador/agenda/tipos"

export { GUIAS_VENCENDO_DIAS }

/** Janela canônica de 7 dias — guias e “fechamento próximo”. */
export const JANELA_OPERACIONAL_DIAS = GUIAS_VENCENDO_DIAS

/**
 * Limiares pedidos no comando 17/19 que NÃO têm número aprovado nos docs
 * do Passo 0 / masterplan / GOAL 016. Não usar como constante numérica.
 */
export const THRESHOLD_HUMAN_DECISION_REQUIRED = [
  "docPendenteDiasAntesFechamento",
  "competenciaAbertaAposDia",
] as const
