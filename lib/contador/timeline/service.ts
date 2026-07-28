/**
 * Contador HUB · serviço de leitura da timeline (GOAL 011).
 *
 * SOMENTE LEITURA — não cria competência, não grava evento, não muta nada. Uma
 * competência inexistente devolve timeline vazia (estado honesto), nunca erro.
 *
 * A competência é resolvida no SERVIDOR a partir de `AAAA-MM` + loja ativa do
 * escopo; o cliente nunca informa `competenciaId` nem `storeId`.
 */
import type { Competencia } from "@/lib/contador/competencia"
import {
  competenciaOuErro,
  contextoOuErro,
  type ContextoLeitura,
} from "@/lib/contador/comentarios/service"
import {
  montarTimeline,
  type ComentarioTimeline,
  type EventoTimeline,
  type TimelineDto,
} from "./projecao"

export const LIMITE_PADRAO = 200
export const LIMITE_MAX = 500

export type EscopoTimeline = Readonly<{ storeId: string; userId: string }>

export type CompetenciaRefTimeline = { id: string; ano: number; mes: number; status: string }

export interface TimelineRepo {
  acharCompetencia(storeId: string, comp: Competencia): Promise<CompetenciaRefTimeline | null>
  listarEventos(args: {
    competenciaId: string
    storeId: string
    limite: number
  }): Promise<EventoTimeline[]>
  listarComentarios(args: {
    competenciaId: string
    storeId: string
    /** Quando informado, restringe a consulta a essa visibilidade. */
    visibilidade?: "interna" | "compartilhada"
    limite: number
  }): Promise<ComentarioTimeline[]>
}

export type DepsTimeline = Readonly<{ repo: TimelineRepo }>

export type EntradaTimeline = Readonly<{
  competencia: unknown
  contexto?: unknown
  limite?: number
}>

export type TimelineResultado = Readonly<{
  competencia: string
  competenciaId: string | null
  timeline: TimelineDto
}>

/** Timeline da competência para a loja ativa, no contexto informado. */
export async function carregarTimeline(
  escopo: EscopoTimeline,
  entrada: EntradaTimeline,
  deps: DepsTimeline,
): Promise<TimelineResultado> {
  const comp = competenciaOuErro(entrada.competencia)
  const contexto: ContextoLeitura = contextoOuErro(entrada.contexto)
  const limite = normalizarLimite(entrada.limite)
  const codigo = `${String(comp.ano).padStart(4, "0")}-${String(comp.mes).padStart(2, "0")}`

  const competencia = await deps.repo.acharCompetencia(escopo.storeId, comp)
  if (!competencia) {
    return Object.freeze({
      competencia: codigo,
      competenciaId: null,
      timeline: montarTimeline({ eventos: [], comentarios: [], contexto, limite }),
    })
  }

  const [eventos, comentarios] = await Promise.all([
    deps.repo.listarEventos({ competenciaId: competencia.id, storeId: escopo.storeId, limite }),
    deps.repo.listarComentarios({
      competenciaId: competencia.id,
      storeId: escopo.storeId,
      // Corte na CONSULTA: comentário interno nem sai do banco no caminho externo.
      ...(contexto === "compartilhado" ? { visibilidade: "compartilhada" as const } : {}),
      limite,
    }),
  ])

  return Object.freeze({
    competencia: codigo,
    competenciaId: competencia.id,
    timeline: montarTimeline({ eventos, comentarios, contexto, limite }),
  })
}

function normalizarLimite(valor: number | undefined): number {
  if (typeof valor !== "number" || !Number.isFinite(valor)) return LIMITE_PADRAO
  return Math.min(Math.max(1, Math.trunc(valor)), LIMITE_MAX)
}
