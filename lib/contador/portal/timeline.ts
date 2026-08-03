/**
 * Contador HUB · Portal externo read-only — timeline da competência (GOAL 015).
 *
 * REUSA `carregarTimeline` do domínio (GOAL 011) com contexto `compartilhado` —
 * read-only, com o corte de comentários `interna` na consulta e a metadata dos
 * eventos projetada por allowlist. A pseudonimização (P2-2 da auditoria 013) é
 * aplicada aqui, na fronteira do portal: `atorId` de ator INTERNO (ids técnicos
 * do AdminUser) vira pseudônimo estável `u_<hash>`; ator EXTERNO permanece —
 * é o id do próprio contador que está vendo a trilha.
 */
import type { ContadorScopeExterno } from "@/lib/contador/auth-externa/escopo-externo"
import { pseudonimoAtor } from "@/lib/contador/fechamento/canonico"
import {
  carregarTimeline,
  type DepsTimeline,
  type TimelineResultado,
} from "@/lib/contador/timeline/service"
import type { TimelineItemDto } from "@/lib/contador/timeline/projecao"
import { escopoEstruturalPortal } from "./escopo"

export type EntradaTimelinePortal = Readonly<{
  competencia: unknown
  limite?: number
}>

/** Pseudonimiza o ator INTERNO do item (P2-2); ator externo permanece. */
function pseudonimizarAtorItem(item: TimelineItemDto): TimelineItemDto {
  if (item.atorTipo !== "interno") return item
  return Object.freeze({ ...item, atorId: pseudonimoAtor(item.atorId) })
}

/** Timeline compartilhada da competência para a loja do escopo. SOMENTE LEITURA. */
export async function carregarTimelinePortal(
  escopo: ContadorScopeExterno,
  entrada: EntradaTimelinePortal,
  deps: DepsTimeline,
): Promise<TimelineResultado> {
  const resultado = await carregarTimeline(
    escopoEstruturalPortal(escopo),
    {
      competencia: entrada.competencia,
      // Contexto FIXO: a trilha interna não cruza a fronteira do portal.
      contexto: "compartilhado",
      ...(entrada.limite !== undefined ? { limite: entrada.limite } : {}),
    },
    deps,
  )
  return Object.freeze({
    ...resultado,
    timeline: Object.freeze({
      ...resultado.timeline,
      itens: Object.freeze(resultado.timeline.itens.map(pseudonimizarAtorItem)),
    }),
  })
}
