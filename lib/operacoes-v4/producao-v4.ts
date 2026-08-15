// ============================================================================
// Operações V4 — projeção de PRODUÇÃO / BANCADA (adapter puro).
// ----------------------------------------------------------------------------
// GOAL OPS-V4-PRODUCAO-TECNICO-BANCADA-003.
// Sem I/O, sem React, sem Prisma. Transforma OS reais nos view-models da Bancada
// V4 reusando integralmente os readers/máquina da V3:
//   producao-model · status-machine · dados-basicos · recepção · pre-OS.
// Nada aqui escreve. Nada inventa técnico, SLA, capacidade ou produtividade.
//
// Ordenação operacional (determinística, `now` injetável):
//   1. atrasadas
//   2. SLA em risco
//   3. prioridade urgente
//   4. garantia/retorno
//   5. prioridade alta
//   6. mais antigas (criadoEm)
//   7. demais (normal → baixa; sem data vai ao fim)
// ============================================================================

import type { OrdemServico } from "@/types/os";
import {
  PRIORIDADE_META_V3,
  SLA_SITUACAO_META_V3,
  filaProducaoV3,
  isAtrasadaV3,
  lerPrioridadeV3,
  lerSlaV3,
  metricasPorTecnicoV3,
  producaoDoDiaV3,
  tecnicosConhecidosV3,
  type MetricasTecnicoV3,
  type PrioridadeV3,
  type SlaSituacaoV3,
  type TecnicoRefV3,
} from "@/lib/operacoes-v3/producao-model";
import {
  LABEL_TRANSICAO_V3,
  acaoPrimariaV3,
  podeTransicionarV3,
  proximasTransicoesV3,
  statusMetaV3,
  statusV3FromOS,
  type OperacaoStatusV3,
} from "@/lib/operacoes-v3/status-machine";
import { lerDadosBasicosV3, LOCAL_FISICO_LABEL_V3 } from "@/lib/operacoes-v3/dados-basicos-model";
import { lerRecepcaoV3 } from "@/lib/operacoes-v3/workspace-model";
import { isOrcamentoPreOsAtivoV4 } from "@/lib/operacoes-v4/orcamento-pre-os";

export type { PrioridadeV3, SlaSituacaoV3, TecnicoRefV3 };

const SEM_TECNICO_ID = "__sem_tecnico__";

/** Destinos de chão de oficina. Entrega/recebida/cancelada ficam fora da ação rápida. */
export const DESTINOS_RAPIDOS_BANCADA_V4: readonly OperacaoStatusV3[] = [
  "diagnostico",
  "aguardando_aprovacao",
  "aprovado",
  "aguardando_peca",
  "em_execucao",
  "pronta",
];

const DESTINO_RAPIDO = new Set<OperacaoStatusV3>(DESTINOS_RAPIDOS_BANCADA_V4);

export type FiltroBancadaV4 = "todos" | "sem_tecnico" | "em_execucao" | "aguardando_peca" | "pronta";

export const FILTROS_BANCADA_V4: { id: FiltroBancadaV4; label: string }[] = [
  { id: "todos", label: "Todos" },
  { id: "sem_tecnico", label: "Sem técnico" },
  { id: "em_execucao", label: "Em execução" },
  { id: "aguardando_peca", label: "Aguardando peça" },
  { id: "pronta", label: "Prontas" },
];

export interface AcaoRapidaBancadaV4 {
  to: OperacaoStatusV3;
  label: string;
  primaria: boolean;
}

export interface BancadaSlaV4 {
  situacao: SlaSituacaoV3;
  label: string;
  /** Relógio honesto (`HH:MM`) só quando há prazo real. Vazio se sem SLA. */
  relogio: string;
  /** Texto curto para a linha: "SLA 01:42" / "ATRASADA 00:38" / "Sem SLA". */
  texto: string;
}

export interface BancadaOsV4 {
  osId: string;
  numero: string;
  cliente: string;
  aparelho: string;
  defeito: string;
  status: OperacaoStatusV3;
  statusLabel: string;
  prioridade: PrioridadeV3;
  prioridadeLabel: string;
  tecnicoId: string | null;
  tecnicoNome: string | null;
  semTecnico: boolean;
  sla: BancadaSlaV4;
  localFisico: string;
  criadoEm: string;
  acoesRapidas: AcaoRapidaBancadaV4[];
}

export interface BancadaResumoV4 {
  semTecnico: number;
  aguardandoInicio: number;
  emExecucao: number;
  aguardandoPeca: number;
  prontas: number;
  emRisco: number;
  atrasadas: number;
  ativas: number;
}

export interface TecnicoCargaV4 {
  tecnicoId: string;
  tecnicoNome: string;
  atribuidas: number;
  emExecucao: number;
  aguardandoPeca: number;
  prontas: number;
  atrasadas: number;
  emRisco: number;
}

export interface TecnicoBucketV4 {
  tecnicoId: string;
  tecnicoNome: string;
  carga: TecnicoCargaV4;
  ordens: BancadaOsV4[];
}

export interface BancadaProjectionV4 {
  /** true quando há ao menos uma OS operacional (não pré-OS, não finalizada). */
  temProducao: boolean;
  resumo: BancadaResumoV4;
  semTecnico: BancadaOsV4[];
  tecnicos: TecnicoBucketV4[];
  tecnicosConhecidos: TecnicoRefV3[];
}

function txt(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function parseIso(iso?: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** OS que entram na bancada: ativas, não pré-OS comercial. */
export function isOsProducaoAtivaV4(os: OrdemServico): boolean {
  if (isOrcamentoPreOsAtivoV4(os)) return false;
  const st = statusV3FromOS(os);
  return st !== "entregue" && st !== "cancelada";
}

export function ordensDeProducaoV4(ordens: OrdemServico[]): OrdemServico[] {
  return (ordens ?? []).filter(isOsProducaoAtivaV4);
}

function aparelhoDe(os: OrdemServico): string {
  const eq = os.equipamento;
  if (!eq) return "";
  const marcaModelo = [txt(eq.marca), txt(eq.modelo)].filter(Boolean).join(" ");
  return marcaModelo || txt(eq.tipo);
}

function formatRelogioMs(ms: number): string {
  const totalMin = Math.max(0, Math.round(Math.abs(ms) / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function montarSlaBancadaV4(os: OrdemServico, now: Date = new Date()): BancadaSlaV4 {
  const sla = lerSlaV3(os, now);
  const label = SLA_SITUACAO_META_V3[sla.situacao].label;
  if (sla.situacao === "sem_prazo" || typeof sla.restanteMs !== "number") {
    return {
      situacao: sla.situacao,
      label,
      relogio: "",
      texto: sla.situacao === "sem_prazo" ? "Sem SLA" : label,
    };
  }
  const relogio = formatRelogioMs(sla.restanteMs);
  if (sla.situacao === "atrasada") return { situacao: sla.situacao, label, relogio, texto: `ATRASADA ${relogio}` };
  return { situacao: sla.situacao, label, relogio, texto: `SLA ${relogio}` };
}

export function isDestinoRapidoBancadaV4(to: unknown): to is OperacaoStatusV3 {
  return typeof to === "string" && DESTINO_RAPIDO.has(to as OperacaoStatusV3);
}

/** Rótulo de chão de oficina — destino continua vindo da máquina V3. */
export function labelAcaoBancadaV4(from: OperacaoStatusV3, to: OperacaoStatusV3): string {
  if (to === "em_execucao" && from === "aguardando_peca") return "Peça chegou";
  if (to === "em_execucao") return "Iniciar serviço";
  if (to === "pronta") return "Marcar pronta";
  return LABEL_TRANSICAO_V3[to];
}

/** Ações rápidas: só o que `podeTransicionarV3` autoriza e o chão de oficina aceita. */
export function acoesRapidasBancadaV4(os: OrdemServico): AcaoRapidaBancadaV4[] {
  const from = statusV3FromOS(os);
  const primary = acaoPrimariaV3(from);
  const acoes: AcaoRapidaBancadaV4[] = [];
  const seen = new Set<OperacaoStatusV3>();

  const tentar = (to: OperacaoStatusV3, primaria: boolean) => {
    if (seen.has(to) || !isDestinoRapidoBancadaV4(to)) return;
    if (!podeTransicionarV3(from, to).ok) return;
    seen.add(to);
    acoes.push({ to, label: labelAcaoBancadaV4(from, to), primaria });
  };

  if (primary) tentar(primary.to, true);
  for (const to of proximasTransicoesV3(from)) {
    if (to === primary?.to) continue;
    tentar(to, false);
  }
  return acoes;
}

export function projetarOsProducaoV4(os: OrdemServico, now: Date = new Date()): BancadaOsV4 {
  const status = statusV3FromOS(os);
  const prioridade = lerPrioridadeV3(os);
  const tecnicoNome = txt(os.tecnico?.nome) || null;
  const tecnicoId = txt(os.tecnico?.id) || (tecnicoNome ? SEM_TECNICO_ID : null);
  const semTecnico = !txt(os.tecnico?.id);
  const localRaw = lerRecepcaoV3(os).localFisico ?? "";
  const localFisico = LOCAL_FISICO_LABEL_V3[localRaw] || localRaw;
  return {
    osId: os.id,
    numero: txt(os.codigo) || "OS",
    cliente: txt(os.cliente?.nome) || "Cliente não informado",
    aparelho: aparelhoDe(os),
    defeito: txt(lerDadosBasicosV3(os).defeitoRelatado) || txt((os as { defeito?: unknown }).defeito),
    status,
    statusLabel: statusMetaV3(status).label,
    prioridade,
    prioridadeLabel: PRIORIDADE_META_V3[prioridade].label,
    tecnicoId: semTecnico ? null : tecnicoId,
    tecnicoNome: semTecnico ? null : tecnicoNome,
    semTecnico,
    sla: montarSlaBancadaV4(os, now),
    localFisico,
    criadoEm: txt(os.criadoEm),
    acoesRapidas: acoesRapidasBancadaV4(os),
  };
}

const SLA_ORDEM: Record<SlaSituacaoV3, number> = {
  atrasada: 0,
  em_risco: 1,
  no_prazo: 2,
  sem_prazo: 3,
};

const PRIO_ORDEM: Record<PrioridadeV3, number> = {
  urgente: 0,
  garantia: 1,
  alta: 2,
  normal: 3,
  baixa: 4,
};

/**
 * Ordenação operacional da Bancada V4.
 * SLA crítico prevalece sobre a prioridade manual (atrasada → em risco → demais).
 * Empate: urgente → garantia → alta → idade (`criadoEm` crescente) → normal/baixa.
 */
export function ordenarProducaoBancadaV4(ordens: OrdemServico[], now: Date = new Date()): OrdemServico[] {
  return [...(ordens ?? [])].sort((a, b) => {
    const sa = lerSlaV3(a, now).situacao;
    const sb = lerSlaV3(b, now).situacao;
    if (SLA_ORDEM[sa] !== SLA_ORDEM[sb]) return SLA_ORDEM[sa] - SLA_ORDEM[sb];
    const pa = PRIO_ORDEM[lerPrioridadeV3(a)];
    const pb = PRIO_ORDEM[lerPrioridadeV3(b)];
    if (pa !== pb) return pa - pb;
    const ta = parseIso(a.criadoEm)?.getTime() ?? Number.POSITIVE_INFINITY;
    const tb = parseIso(b.criadoEm)?.getTime() ?? Number.POSITIVE_INFINITY;
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  });
}

function cargaDe(
  metricas: MetricasTecnicoV3 | undefined,
  ordens: BancadaOsV4[],
  fallbackId: string,
  fallbackNome: string,
): TecnicoCargaV4 {
  return {
    tecnicoId: metricas?.tecnicoId ?? fallbackId,
    tecnicoNome: metricas?.tecnicoNome ?? fallbackNome,
    atribuidas: ordens.length,
    emExecucao: metricas?.emExecucao ?? ordens.filter((o) => o.status === "em_execucao").length,
    aguardandoPeca: ordens.filter((o) => o.status === "aguardando_peca").length,
    prontas: metricas?.prontas ?? ordens.filter((o) => o.status === "pronta").length,
    atrasadas: metricas?.atrasadas ?? ordens.filter((o) => o.sla.situacao === "atrasada").length,
    emRisco: ordens.filter((o) => o.sla.situacao === "em_risco").length,
  };
}

export function buildProducaoBancadaV4(ordens: OrdemServico[], now: Date = new Date()): BancadaProjectionV4 {
  const producao = ordensDeProducaoV4(ordens);
  const fila = filaProducaoV3(producao, now);
  const dia = producaoDoDiaV3(producao, now);
  const metricas = metricasPorTecnicoV3(ordens ?? [], now);
  const metricasById = new Map(metricas.map((m) => [m.tecnicoId, m]));

  const ordenadas = ordenarProducaoBancadaV4(producao, now);
  const rows = ordenadas.map((os) => projetarOsProducaoV4(os, now));

  const semTecnico = rows.filter((r) => r.semTecnico);
  const porTecnico = new Map<string, BancadaOsV4[]>();
  for (const row of rows) {
    if (row.semTecnico || !row.tecnicoId) continue;
    const list = porTecnico.get(row.tecnicoId);
    if (list) list.push(row);
    else porTecnico.set(row.tecnicoId, [row]);
  }

  const tecnicos: TecnicoBucketV4[] = [...porTecnico.entries()]
    .map(([tecnicoId, list]) => {
      const nome = list[0]?.tecnicoNome || "Técnico";
      const m = metricasById.get(tecnicoId);
      return {
        tecnicoId,
        tecnicoNome: m?.tecnicoNome || nome,
        carga: cargaDe(m, list, tecnicoId, nome),
        ordens: list,
      };
    })
    .sort((a, b) => b.ordens.length - a.ordens.length || a.tecnicoNome.localeCompare(b.tecnicoNome, "pt-BR"));

  const emRisco = producao.filter((os) => lerSlaV3(os, now).situacao === "em_risco").length;
  const atrasadas = producao.filter((os) => isAtrasadaV3(os, now)).length;

  return {
    temProducao: producao.length > 0,
    resumo: {
      semTecnico: semTecnico.length,
      aguardandoInicio: fila.aguardando_diagnostico.length,
      emExecucao: dia.emExecucao,
      aguardandoPeca: fila.aguardando_peca.length,
      prontas: dia.prontas,
      emRisco,
      atrasadas,
      ativas: dia.ativasTotal,
    },
    semTecnico,
    tecnicos,
    tecnicosConhecidos: tecnicosConhecidosV3(ordens ?? []),
  };
}

function matchBusca(row: BancadaOsV4, q: string): boolean {
  if (!q) return true;
  const hay = `${row.numero} ${row.cliente} ${row.aparelho} ${row.defeito}`.toLowerCase();
  return hay.includes(q);
}

function matchFiltro(row: BancadaOsV4, filtro: FiltroBancadaV4): boolean {
  if (filtro === "todos") return true;
  if (filtro === "sem_tecnico") return row.semTecnico;
  if (filtro === "em_execucao") return row.status === "em_execucao";
  if (filtro === "aguardando_peca") return row.status === "aguardando_peca";
  if (filtro === "pronta") return row.status === "pronta";
  return true;
}

/** Filtro client-side sobre a projeção já lida. Não reconsulta o servidor. */
export function filtrarBancadaV4(
  proj: BancadaProjectionV4,
  filtro: FiltroBancadaV4,
  tecnicoId: string | null,
  busca: string,
): BancadaProjectionV4 {
  const q = busca.trim().toLowerCase();
  const passa = (row: BancadaOsV4) => matchFiltro(row, filtro) && matchBusca(row, q);

  const semTecnico =
    tecnicoId && tecnicoId !== SEM_TECNICO_ID ? [] : proj.semTecnico.filter(passa);

  const tecnicos = proj.tecnicos
    .filter((t) => !tecnicoId || t.tecnicoId === tecnicoId)
    .map((t) => ({ ...t, ordens: t.ordens.filter(passa) }))
    .filter((t) => t.ordens.length > 0 || (!q && filtro === "todos" && !tecnicoId));

  return {
    ...proj,
    semTecnico,
    tecnicos: tecnicos.filter((t) => t.ordens.length > 0),
  };
}

export function podeMutarProducaoV4(
  storeId: string | null | undefined,
  osId: string | null | undefined,
): { ok: true } | { ok: false; motivo: string } {
  if (!(storeId ?? "").trim()) return { ok: false, motivo: "Loja ativa não definida." };
  if (!(osId ?? "").trim()) return { ok: false, motivo: "OS não informada." };
  return { ok: true };
}

/** Confirma no cliente a mesma autoridade da máquina antes de chamar a action. */
export function podeAvancarStatusBancadaV4(
  os: OrdemServico | null | undefined,
  to: OperacaoStatusV3,
): { ok: true } | { ok: false; motivo: string } {
  if (!os) return { ok: false, motivo: "OS não encontrada." };
  if (!isDestinoRapidoBancadaV4(to)) {
    return { ok: false, motivo: "Esta transição não é uma ação rápida da Bancada." };
  }
  const veredito = podeTransicionarV3(statusV3FromOS(os), to);
  if (!veredito.ok) return { ok: false, motivo: veredito.motivo ?? "Transição não permitida." };
  return { ok: true };
}

export { PRIORIDADE_META_V3 };
