// ============================================================================
// Operações V4 — projeção da rail SLA (adapter puro).
// ----------------------------------------------------------------------------
// GOAL OPS-V4-TECNICO-BANCADA-FILA-016.
// Sem I/O, sem React, sem Prisma. A rail SLA tem identidade própria: agrupa
// OS ativas por situação de prazo (atrasada / em risco / no prazo / sem prazo)
// com o MESMO reader da Bancada/Fila (`lerSlaV3`). Nada inventa prazo.
// ============================================================================

import type { OrdemServico } from "@/types/os";
import {
  calcularAtrasoMinutosV3,
  lerSlaV3,
  tecnicosConhecidosV3,
  type PrioridadeV3,
  type SlaSituacaoV3,
  type TecnicoRefV3,
} from "@/lib/operacoes-v3/producao-model";
import {
  isOsProducaoAtivaV4,
  ordenarProducaoBancadaV4,
  projetarOsProducaoV4,
  type BancadaOsV4,
} from "@/lib/operacoes-v4/producao-v4";

export type { PrioridadeV3, SlaSituacaoV3, TecnicoRefV3 };

export const SEM_TECNICO_SLA_V4 = "__sem_tecnico__";

export type FiltroSlaRailV4 = "todas" | SlaSituacaoV3;
export type FiltroPrioridadeSlaV4 = PrioridadeV3 | "todas";

export interface FiltrosSlaV4 {
  busca: string;
  tecnicoId: string | null;
  prioridade: FiltroPrioridadeSlaV4;
  situacao: FiltroSlaRailV4;
}

export const FILTROS_SLA_VAZIOS: FiltrosSlaV4 = {
  busca: "",
  tecnicoId: null,
  prioridade: "todas",
  situacao: "todas",
};

export interface SlaOsV4 extends BancadaOsV4 {
  atrasoMinutos: number | null;
}

export interface SlaResumoV4 {
  ativas: number;
  atrasadas: number;
  emRisco: number;
  noPrazo: number;
  semPrazo: number;
}

export interface SlaProjectionV4 {
  /** true quando há OS operacional (não pré-OS, não finalizada). */
  temDados: boolean;
  resumo: SlaResumoV4;
  atrasadas: SlaOsV4[];
  emRisco: SlaOsV4[];
  noPrazo: SlaOsV4[];
  semPrazo: SlaOsV4[];
  lista: SlaOsV4[];
  tecnicosConhecidos: TecnicoRefV3[];
}

export function projetarOsSlaV4(os: OrdemServico, now: Date = new Date()): SlaOsV4 {
  return {
    ...projetarOsProducaoV4(os, now),
    atrasoMinutos: calcularAtrasoMinutosV3(os, now),
  };
}

export function buildSlaOperacionalV4(ordens: OrdemServico[], now: Date = new Date()): SlaProjectionV4 {
  const ativas = (ordens ?? []).filter(isOsProducaoAtivaV4);
  const ordenadas = ordenarProducaoBancadaV4(ativas, now);
  const lista = ordenadas.map((os) => projetarOsSlaV4(os, now));

  const atrasadas = lista.filter((r) => r.sla.situacao === "atrasada");
  const emRisco = lista.filter((r) => r.sla.situacao === "em_risco");
  const noPrazo = lista.filter((r) => r.sla.situacao === "no_prazo");
  const semPrazo = lista.filter((r) => r.sla.situacao === "sem_prazo");

  return {
    temDados: lista.length > 0,
    resumo: {
      ativas: lista.length,
      atrasadas: atrasadas.length,
      emRisco: emRisco.length,
      noPrazo: noPrazo.length,
      semPrazo: semPrazo.length,
    },
    atrasadas,
    emRisco,
    noPrazo,
    semPrazo,
    lista,
    tecnicosConhecidos: tecnicosConhecidosV3(ordens ?? []),
  };
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function matchBusca(row: SlaOsV4, busca: string): boolean {
  const q = norm(busca.trim());
  if (!q) return true;
  const hay = norm(`${row.numero} ${row.cliente} ${row.aparelho} ${row.defeito}`);
  return hay.includes(q);
}

function matchTecnico(row: SlaOsV4, tecnicoId: string | null): boolean {
  if (!tecnicoId) return true;
  if (tecnicoId === SEM_TECNICO_SLA_V4) return row.semTecnico;
  return row.tecnicoId === tecnicoId;
}

export function filtrarSlaV4(proj: SlaProjectionV4, filtros: FiltrosSlaV4): SlaProjectionV4 {
  const passa = (row: SlaOsV4) =>
    matchBusca(row, filtros.busca) &&
    matchTecnico(row, filtros.tecnicoId) &&
    (filtros.prioridade === "todas" || row.prioridade === filtros.prioridade) &&
    (filtros.situacao === "todas" || row.sla.situacao === filtros.situacao);

  const lista = proj.lista.filter(passa);
  return {
    ...proj,
    atrasadas: proj.atrasadas.filter(passa),
    emRisco: proj.emRisco.filter(passa),
    noPrazo: proj.noPrazo.filter(passa),
    semPrazo: proj.semPrazo.filter(passa),
    lista,
  };
}

export function filtrosSlaAtivosV4(filtros: FiltrosSlaV4): boolean {
  return Boolean(filtros.busca.trim()) || Boolean(filtros.tecnicoId) || filtros.prioridade !== "todas" || filtros.situacao !== "todas";
}

export function formatAtrasoSlaV4(minutos: number | null): string {
  if (minutos == null) return "";
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  if (h <= 0) return `${m} min`;
  return `${h}h ${String(m).padStart(2, "0")}min`;
}
