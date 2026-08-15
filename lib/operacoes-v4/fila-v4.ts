// ============================================================================
// Operações V4 — projeção da FILA operacional (adapter puro).
// ----------------------------------------------------------------------------
// GOAL OPS-V4-FILA-KANBAN-WRITE-004.
// Sem I/O, sem React, sem Prisma. A Fila só projeta, agrupa e classifica destinos.
// Autoridade de transição: máquina V3. Recorte de write rápido: política
// compartilhada `transicoes-producao-v4` (Fila e Bancada usam a mesma).
// Write: `aplicarTransicaoStatusV3`. Técnico / prioridade / SLA vêm dos mesmos
// readers da Bancada (`projetarOsProducaoV4`). Nada inventa prazo ou status.
//
// Drag NÃO cobre fluxos com contrato extra:
//   enviar orçamento · aprovar orçamento · recebimento · entrega · cancelamento.
// ============================================================================

import type { OrdemServico } from "@/types/os";
import {
  PRIORIDADE_META_V3,
  PRIORIDADES_V3,
  tecnicosConhecidosV3,
  type PrioridadeV3,
  type SlaSituacaoV3,
  type TecnicoRefV3,
} from "@/lib/operacoes-v3/producao-model";
import {
  LABEL_TRANSICAO_V3,
  isOperacaoStatusV3,
  statusMetaV3,
  statusV3FromOS,
  type OperacaoStatusV3,
} from "@/lib/operacoes-v3/status-machine";
import { resolverIdentidadeAparelhoV4 } from "@/lib/operacoes-v4/identidade-aparelho";
import {
  isOsProducaoAtivaV4,
  labelAcaoBancadaV4,
  ordenarProducaoBancadaV4,
  projetarOsProducaoV4,
  type BancadaOsV4,
} from "@/lib/operacoes-v4/producao-v4";
import {
  DESTINOS_RAPIDOS_PRODUCAO_V4,
  TRANSICOES_COMERCIAIS_PROTEGIDAS_V4,
  destinosRapidosProducaoV4,
  hintCockpitComercialV4,
  isDestinoRapidoProducaoV4,
  isTransicaoComercialProtegidaV4,
  vereditoTransicaoRapidaProducaoV4,
} from "@/lib/operacoes-v4/transicoes-producao-v4";

export type { PrioridadeV3, SlaSituacaoV3, TecnicoRefV3 };

export const SEM_TECNICO_FILA_V4 = "__sem_tecnico__";
export const FILA_VIEW_PREF_KEY = "omnigestao:operacoes-v4:fila-view:v1";

/**
 * Kanban de produção. `recebida` fica na Entrega (não é chão de oficina).
 * `entregue` / `cancelada` são terminais e já saem de `isOsProducaoAtivaV4`.
 */
export const COLUNAS_FILA_V4: readonly OperacaoStatusV3[] = [
  "aberta",
  "diagnostico",
  "aguardando_aprovacao",
  "aprovado",
  "aguardando_peca",
  "em_execucao",
  "pronta",
];

/** Alias estável da Fila sobre a política compartilhada Fila+Bancada. */
export const DESTINOS_WRITE_FILA_V4 = DESTINOS_RAPIDOS_PRODUCAO_V4;
export const TRANSICOES_COMERCIAIS_FORA_DRAG_V4 = TRANSICOES_COMERCIAIS_PROTEGIDAS_V4;

const COLUNA = new Set<OperacaoStatusV3>(COLUNAS_FILA_V4);

export type ModoFilaV4 = "lista" | "kanban";
export type FiltroSlaFilaV4 = "todas" | "em_risco" | "atrasada";
export type FiltroPrioridadeFilaV4 = PrioridadeV3 | "todas";

export interface FiltrosFilaV4 {
  busca: string;
  tecnicoId: string | null;
  prioridade: FiltroPrioridadeFilaV4;
  sla: FiltroSlaFilaV4;
}

export const FILTROS_FILA_VAZIOS: FiltrosFilaV4 = {
  busca: "",
  tecnicoId: null,
  prioridade: "todas",
  sla: "todas",
};

export const PRIORIDADES_FILTRO_FILA_V4: readonly PrioridadeV3[] = PRIORIDADES_V3;

export type DestinoFilaKindV4 = "aceita" | "recusada" | "origem" | "neutra";

export interface DestinoFilaV4 {
  to: OperacaoStatusV3;
  label: string;
  primaria: boolean;
}

export type FilaOsV4 = BancadaOsV4 & {
  imei: string;
  destinos: DestinoFilaV4[];
  /** Microcopy honesta quando o próximo passo comercial não é drag. */
  hintCockpit: string | null;
  /** Orçamento só quando o status comercial é relevante (enviado/recusado). */
  orcamentoLabel: string | null;
};

export interface FilaColunaV4 {
  status: OperacaoStatusV3;
  label: string;
  aceitaWrite: boolean;
  itens: FilaOsV4[];
}

export interface FilaResumoV4 {
  ativas: number;
  semTecnico: number;
  emRisco: number;
  atrasadas: number;
}

export interface FilaProjectionV4 {
  temFila: boolean;
  resumo: FilaResumoV4;
  colunas: FilaColunaV4[];
  lista: FilaOsV4[];
  tecnicosConhecidos: TecnicoRefV3[];
}

export function isDestinoWriteFilaV4(to: unknown): to is OperacaoStatusV3 {
  return isDestinoRapidoProducaoV4(to);
}

export function isColunaFilaV4(status: unknown): status is OperacaoStatusV3 {
  return typeof status === "string" && COLUNA.has(status as OperacaoStatusV3);
}

export function isOsFilaAtivaV4(os: OrdemServico): boolean {
  if (!isOsProducaoAtivaV4(os)) return false;
  return statusV3FromOS(os) !== "recebida";
}

export function labelAcaoFilaV4(from: OperacaoStatusV3, to: OperacaoStatusV3): string {
  return labelAcaoBancadaV4(from, to);
}

export function isTransicaoComercialForaDragV4(from: unknown, to: unknown): boolean {
  return isTransicaoComercialProtegidaV4(from, to);
}

export function hintCockpitFilaV4(from: unknown): string | null {
  return hintCockpitComercialV4(from);
}

/** Destinos de drag/menu — mesma política da Bancada. */
export function vereditoDestinoFilaV4(
  from: unknown,
  to: unknown,
): { ok: true } | { ok: false; motivo: string } {
  return vereditoTransicaoRapidaProducaoV4(from, to);
}

export function destinosPermitidosFilaV4(from: unknown): OperacaoStatusV3[] {
  return destinosRapidosProducaoV4(from);
}

export function destinosWriteFilaV4(from: unknown): DestinoFilaV4[] {
  return destinosPermitidosFilaV4(from).map((to, i) => ({
    to,
    label: isOperacaoStatusV3(from) ? labelAcaoFilaV4(from, to) : LABEL_TRANSICAO_V3[to],
    primaria: i === 0,
  }));
}

export function classificarColunaFilaV4(
  from: OperacaoStatusV3 | null,
  coluna: OperacaoStatusV3,
): DestinoFilaKindV4 {
  if (!from) return "neutra";
  if (coluna === from) return "origem";
  return vereditoDestinoFilaV4(from, coluna).ok ? "aceita" : "recusada";
}

export function podeMoverStatusFilaV4(
  os: OrdemServico | null | undefined,
  to: OperacaoStatusV3,
): { ok: true } | { ok: false; motivo: string } {
  if (!os) return { ok: false, motivo: "OS não encontrada." };
  return vereditoDestinoFilaV4(statusV3FromOS(os), to);
}

function statusOrcamentoDe(os: OrdemServico): string {
  const s = (os as { orcamento?: { status?: unknown } }).orcamento?.status;
  return typeof s === "string" ? s.trim() : "";
}

function orcamentoLabelDe(os: OrdemServico): string | null {
  const st = statusOrcamentoDe(os);
  if (st === "enviado") return "Orçamento enviado";
  if (st === "recusado") return "Orçamento recusado";
  return null;
}

export function projetarOsFilaV4(os: OrdemServico, now: Date = new Date()): FilaOsV4 {
  const base = projetarOsProducaoV4(os, now);
  return {
    ...base,
    imei: resolverIdentidadeAparelhoV4(os).imei.value,
    destinos: destinosWriteFilaV4(base.status),
    hintCockpit: hintCockpitFilaV4(base.status),
    orcamentoLabel: orcamentoLabelDe(os),
  };
}

export function buildFilaOperacionalV4(ordens: OrdemServico[], now: Date = new Date()): FilaProjectionV4 {
  const ativas = (ordens ?? []).filter(isOsFilaAtivaV4);
  const ordenadas = ordenarProducaoBancadaV4(ativas, now);
  const lista = ordenadas.map((os) => projetarOsFilaV4(os, now));

  const porStatus = new Map<OperacaoStatusV3, FilaOsV4[]>();
  for (const row of lista) {
    const list = porStatus.get(row.status);
    if (list) list.push(row);
    else porStatus.set(row.status, [row]);
  }

  const colunas: FilaColunaV4[] = COLUNAS_FILA_V4.map((status) => ({
    status,
    label: statusMetaV3(status).label,
    aceitaWrite: isDestinoWriteFilaV4(status),
    itens: porStatus.get(status) ?? [],
  }));

  return {
    temFila: lista.length > 0,
    resumo: {
      ativas: lista.length,
      semTecnico: lista.filter((r) => r.semTecnico).length,
      emRisco: lista.filter((r) => r.sla.situacao === "em_risco").length,
      atrasadas: lista.filter((r) => r.sla.situacao === "atrasada").length,
    },
    colunas,
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

function matchBusca(row: FilaOsV4, busca: string): boolean {
  const q = norm(busca.trim());
  if (!q) return true;
  const hay = norm(`${row.numero} ${row.cliente} ${row.aparelho} ${row.defeito} ${row.imei}`);
  return hay.includes(q);
}

function matchTecnico(row: FilaOsV4, tecnicoId: string | null): boolean {
  if (!tecnicoId) return true;
  if (tecnicoId === SEM_TECNICO_FILA_V4) return row.semTecnico;
  return row.tecnicoId === tecnicoId;
}

function matchSla(row: FilaOsV4, sla: FiltroSlaFilaV4): boolean {
  if (sla === "todas") return true;
  return row.sla.situacao === sla;
}

export function filtrarFilaV4(proj: FilaProjectionV4, filtros: FiltrosFilaV4): FilaProjectionV4 {
  const passa = (row: FilaOsV4) =>
    matchBusca(row, filtros.busca) &&
    matchTecnico(row, filtros.tecnicoId) &&
    (filtros.prioridade === "todas" || row.prioridade === filtros.prioridade) &&
    matchSla(row, filtros.sla);

  const lista = proj.lista.filter(passa);
  const colunas = proj.colunas.map((col) => ({ ...col, itens: col.itens.filter(passa) }));

  return {
    ...proj,
    temFila: lista.length > 0,
    lista,
    colunas,
  };
}

export function filtrosFilaAtivosV4(filtros: FiltrosFilaV4): boolean {
  return Boolean(filtros.busca.trim()) || Boolean(filtros.tecnicoId) || filtros.prioridade !== "todas" || filtros.sla !== "todas";
}

export function lerModoFilaV4(raw: string | null | undefined): ModoFilaV4 {
  return raw === "lista" ? "lista" : "kanban";
}

export const MSG_ERRO_MOVER_FILA_V4 =
  "Não foi possível mover a OS. O status foi atualizado por outra operação ou a transição não é mais permitida.";

export const MSG_SEM_TECNICO_INICIO_V4 = "OS iniciada sem técnico responsável";
