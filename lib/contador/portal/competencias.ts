/**
 * Contador HUB · Portal externo read-only — janela de competências (GOAL 015).
 *
 * Lista a competência ATUAL + as 12 anteriores (janela móvel de 13 meses no fuso
 * canônico America/Sao_Paulo). SOMENTE LEITURA: consulta direta ao repo de
 * fechamento (`acharCompetencia`) — competência inexistente é reportada como
 * ABERTA sem nunca ser criada.
 */
import {
  competenciaAnterior,
  competenciaAtual,
  formatCompetencia,
  type Competencia,
} from "@/lib/contador/competencia"
import type { ContadorScopeExterno } from "@/lib/contador/auth-externa/escopo-externo"
import type { FechamentoRepo } from "@/lib/contador/fechamento/service"

/** Atual + 12 anteriores. */
export const JANELA_COMPETENCIAS_PORTAL = 13

export type DepsCompetenciasPortal = Readonly<{
  repo: Pick<FechamentoRepo, "acharCompetencia">
}>

export type CompetenciaPortalDto = Readonly<{
  /** Código canônico `AAAA-MM`. */
  codigo: string
  ano: number
  mes: number
  /** Status persistido; "ABERTA" quando a competência nunca foi materializada. */
  status: string
  fechada: boolean
  versao: number | null
  /** Selo honesto da versão oficial — `oficial vN`, só quando fechada. */
  selo: string | null
}>

/** Janela móvel [atual, atual−1, …, atual−12]. Pura — `agora` injetável. */
export function listarCompetenciasDaJanela(agora: Date = new Date()): Competencia[] {
  const atual = competenciaAtual(agora)
  const janela: Competencia[] = [atual]
  for (let i = 0; i < JANELA_COMPETENCIAS_PORTAL - 1; i++) {
    janela.push(competenciaAnterior(janela[janela.length - 1]!))
  }
  return janela
}

/** Lista a janela de competências da loja do escopo. Read-only, sem criação. */
export async function listarCompetenciasPortal(
  escopo: ContadorScopeExterno,
  deps: DepsCompetenciasPortal,
  agora: Date = new Date(),
): Promise<CompetenciaPortalDto[]> {
  const janela = listarCompetenciasDaJanela(agora)
  const linhas = await Promise.all(
    janela.map((comp) => deps.repo.acharCompetencia(escopo.storeId, comp)),
  )
  return janela.map((comp, i) => {
    const row = linhas[i] ?? null
    const fechada = row?.status === "FECHADA"
    return Object.freeze({
      codigo: formatCompetencia(comp),
      ano: comp.ano,
      mes: comp.mes,
      status: row?.status ?? "ABERTA",
      fechada,
      versao: row?.versao ?? null,
      selo: fechada && row ? `oficial v${row.versao}` : null,
    })
  })
}
