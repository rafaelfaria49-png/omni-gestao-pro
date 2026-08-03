/**
 * Contador HUB · Portal externo read-only — resumo da competência (GOAL 015).
 *
 * Duas origens honestas, nunca misturadas:
 *  - competência FECHADA → dados do SNAPSHOT oficial imutável (`ContadorCompetencia
 *    .snapshot`, GOAL 012) com o selo `oficial vN` — é a fotografia que o fechamento
 *    congelou, não uma releitura dos dados vivos;
 *  - competência aberta → dados VIVOS via `construirDadosContador` com o escopo
 *    nominal read-only do portal (`fabricarEscopoPortalExterno`) + checklist puro
 *    (`montarChecklistFechamento`).
 *
 * Honestidade (herdada dos readers e mantida aqui): falha de uma fonte NUNCA vira
 * zero silencioso — o DTO dos readers já carrega `disponibilidade` por métrica e
 * o checklist marca `nao_disponivel`. Se a leitura viva inteira falhar, o resumo
 * devolve `dados: null` + checklist todo `nao_disponivel` com o motivo, sem erro
 * 500 e sem número inventado.
 */
import type { Competencia } from "@/lib/contador/competencia"
import type { ContadorScopeExterno } from "@/lib/contador/auth-externa/escopo-externo"
import { construirDadosContador } from "@/lib/contador/readers"
import type { ContadorDadosReais } from "@/lib/contador/readers/tipos"
import type { ContadorScopeInterno } from "@/lib/contador/scope-core"
import {
  carregarEstadoFechamento,
  type FechamentoRepo,
} from "@/lib/contador/fechamento/service"
import type { SnapshotFechamentoV2 } from "@/lib/contador/fechamento/snapshot"
import { montarChecklistFechamento } from "@/lib/contador/fechamento/montar-checklist"
import type { ChecklistFechamento } from "@/lib/contador/fechamento/tipos"
import { CAPACIDADES_PORTAL_READONLY, escopoEstruturalPortal, escopoNominalPortal } from "./escopo"

/** Porta de leitura viva injetável — produção usa `construirDadosContador`. */
export type CarregarDadosVivos = (
  scope: ContadorScopeInterno,
  comp: Competencia,
) => Promise<ContadorDadosReais>

export type DepsResumoPortal = Readonly<{
  repo: Pick<FechamentoRepo, "acharCompetencia" | "listarPacotes">
  carregarDados?: CarregarDadosVivos
}>

/** Recorte do snapshot oficial exposto ao portal — sem campos internos. */
export type SnapshotPortalDto = Readonly<{
  versao: number
  fechadaEm: string
  totais: SnapshotFechamentoV2["totais"]
  checklist: SnapshotFechamentoV2["checklist"]
  pendenciasAssumidas: readonly string[]
  documentos: SnapshotFechamentoV2["documentos"]
}>

export type ResumoPortalDto = Readonly<{
  competencia: string
  status: string
  fechada: boolean
  versao: number
  fechadaEm: string | null
  snapshotHash: string | null
  /** Selo da versão oficial (`oficial vN`) — só quando fechada com snapshot. */
  selo: string | null
  origem: "snapshot" | "vivo"
  /** Presente só na origem `snapshot`. */
  snapshot: SnapshotPortalDto | null
  /** Presente só na origem `vivo` (null = leitura falhou; ver checklist). */
  dados: ContadorDadosReais | null
  /** Checklist vivo; null na origem `snapshot` (o do snapshot vai em `snapshot.checklist`). */
  checklist: ChecklistFechamento | null
}>

function snapshotValido(valor: unknown): valor is SnapshotFechamentoV2 {
  if (!valor || typeof valor !== "object") return false
  const s = valor as Partial<SnapshotFechamentoV2>
  return typeof s.versao === "number" && !!s.totais && typeof s.totais === "object"
}

/** Resumo da competência para a loja do escopo. SOMENTE LEITURA. */
export async function carregarResumoPortal(
  escopo: ContadorScopeExterno,
  comp: Competencia,
  deps: DepsResumoPortal,
  agora: Date = new Date(),
): Promise<ResumoPortalDto> {
  const estado = await carregarEstadoFechamento(
    escopoEstruturalPortal(escopo),
    CAPACIDADES_PORTAL_READONLY,
    comp,
    { repo: deps.repo as FechamentoRepo },
  )

  if (estado.fechada) {
    const row = await deps.repo.acharCompetencia(escopo.storeId, comp)
    const snap = row ? row.snapshot : null
    if (snapshotValido(snap)) {
      return Object.freeze({
        competencia: estado.competencia,
        status: estado.status,
        fechada: true,
        versao: estado.versao,
        fechadaEm: estado.fechadaEm,
        snapshotHash: estado.snapshotHash,
        selo: `oficial v${snap.versao}`,
        origem: "snapshot" as const,
        snapshot: Object.freeze({
          versao: snap.versao,
          fechadaEm: snap.fechadaEm,
          totais: snap.totais,
          checklist: snap.checklist,
          pendenciasAssumidas: snap.pendenciasAssumidas,
          documentos: snap.documentos,
        }),
        dados: null,
        checklist: null,
      })
    }
    // Fechada sem snapshot legível é inconsistência real: cai no caminho vivo com
    // o checklist honesto — nunca inventa totais.
  }

  let dados: ContadorDadosReais | null = null
  let motivoIndisponivel: string | null = null
  try {
    const carregar = deps.carregarDados ?? construirDadosContador
    dados = await carregar(escopoNominalPortal(escopo), comp)
  } catch {
    motivoIndisponivel =
      "A leitura dos dados vivos da competência falhou. Nenhum valor foi substituído por zero."
  }
  const checklist = montarChecklistFechamento({ dados, competencia: comp, agora, motivoIndisponivel })

  return Object.freeze({
    competencia: estado.competencia,
    status: estado.status,
    fechada: estado.fechada,
    versao: estado.versao,
    fechadaEm: estado.fechadaEm,
    snapshotHash: estado.snapshotHash,
    selo: null,
    origem: "vivo" as const,
    snapshot: null,
    dados,
    checklist,
  })
}
