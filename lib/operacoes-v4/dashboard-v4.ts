// ============================================================================
// Operações V4 — Visão geral operacional (adapter puro).
// ----------------------------------------------------------------------------
// GOAL OPS-V4-DASHBOARD-HISTORICO-FINAL-017.
// Sem I/O. Agrega projeções já existentes (Fila, Bancada, SLA, pós-venda).
// Nada inventa KPI (sem tempo médio, conversão ou capacidade).
// ============================================================================

import type { OrdemServico } from "@/types/os";
import { statusMetaV3, statusV3FromOS, type OperacaoStatusV3 } from "@/lib/operacoes-v3/status-machine";
import { lerEntregaV3, lerRetornosV3 } from "@/lib/operacoes-v3/pos-venda-model";
import { buildFilaOperacionalV4, COLUNAS_FILA_V4 } from "@/lib/operacoes-v4/fila-v4";
import { buildProducaoBancadaV4 } from "@/lib/operacoes-v4/producao-v4";
import { buildSlaOperacionalV4 } from "@/lib/operacoes-v4/sla-v4";
import { buildGarantiasPortfolioV4 } from "@/lib/operacoes-v4/posvenda-v4";

export type DashboardDestinoV4 = "fila" | "bancada" | "sla" | "garantias" | "execucao" | "entrega" | "posvenda";

export interface DashboardOsRefV4 {
  osId: string;
  codigo: string;
  cliente: string;
  aparelho: string;
  statusLabel: string;
  extra: string;
  destino: DashboardDestinoV4;
}

export interface DashboardFilaBucketV4 {
  status: OperacaoStatusV3;
  label: string;
  count: number;
}

export interface DashboardResumoOperacionalV4 {
  total: number;
  ativas: number;
  atrasadas: number;
  emRisco: number;
  semTecnico: number;
  naBancada: number;
  emExecucao: number;
  aguardandoPeca: number;
  prontas: number;
  entreguesHoje: number;
  retornosAbertos: number;
  garantiasVencendo: number;
}

export interface DashboardOperacionalV4 {
  temDados: boolean;
  resumo: DashboardResumoOperacionalV4;
  fila: DashboardFilaBucketV4[];
  atrasadas: DashboardOsRefV4[];
  semTecnico: DashboardOsRefV4[];
  prontas: DashboardOsRefV4[];
  retornos: DashboardOsRefV4[];
  entreguesHoje: DashboardOsRefV4[];
}

function txt(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function mesmoDia(iso: string | undefined, now: Date): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

const ATENCAO_LIMITE = 6;

export function buildDashboardOperacionalV4(ordens: OrdemServico[], now: Date = new Date()): DashboardOperacionalV4 {
  const lista = ordens ?? [];
  const fila = buildFilaOperacionalV4(lista, now);
  const bancada = buildProducaoBancadaV4(lista, now);
  const sla = buildSlaOperacionalV4(lista, now);
  const garantias = buildGarantiasPortfolioV4(lista, { now, vencendoDias: 7 });

  const filaBuckets: DashboardFilaBucketV4[] = COLUNAS_FILA_V4.map((status) => {
    const col = fila.colunas.find((c) => c.status === status);
    return { status, label: statusMetaV3(status).label, count: col?.itens.length ?? 0 };
  });

  const atrasadas: DashboardOsRefV4[] = sla.atrasadas.slice(0, ATENCAO_LIMITE).map((r) => ({
    osId: r.osId,
    codigo: r.numero,
    cliente: r.cliente,
    aparelho: r.aparelho,
    statusLabel: r.statusLabel,
    extra: r.sla.texto,
    destino: "execucao",
  }));

  const semTecnico: DashboardOsRefV4[] = bancada.semTecnico.slice(0, ATENCAO_LIMITE).map((r) => ({
    osId: r.osId,
    codigo: r.numero,
    cliente: r.cliente,
    aparelho: r.aparelho,
    statusLabel: r.statusLabel,
    extra: r.localFisico || "Sem técnico",
    destino: "execucao",
  }));

  const prontas: DashboardOsRefV4[] = fila.lista
    .filter((r) => r.status === "pronta")
    .slice(0, ATENCAO_LIMITE)
    .map((r) => ({
      osId: r.osId,
      codigo: r.numero,
      cliente: r.cliente,
      aparelho: r.aparelho,
      statusLabel: r.statusLabel,
      extra: r.tecnicoNome ?? "Sem técnico",
      destino: "entrega" as const,
    }));

  const retornos: DashboardOsRefV4[] = [];
  for (const os of lista) {
    for (const ret of lerRetornosV3(os)) {
      if (ret.status !== "aberto") continue;
      retornos.push({
        osId: ret.osRetornoId || os.id,
        codigo: ret.osRetornoCodigo || os.codigo || "OS",
        cliente: txt(os.cliente?.nome) || "Cliente não informado",
        aparelho: [txt(os.equipamento?.marca), txt(os.equipamento?.modelo)].filter(Boolean).join(" "),
        statusLabel: "Retorno aberto",
        extra: ret.motivo || "Retorno em garantia",
        destino: "posvenda",
      });
      if (retornos.length >= ATENCAO_LIMITE) break;
    }
    if (retornos.length >= ATENCAO_LIMITE) break;
  }

  const entreguesHoje: DashboardOsRefV4[] = [];
  for (const os of lista) {
    if (statusV3FromOS(os) !== "entregue") continue;
    const entrega = lerEntregaV3(os);
    const quando = entrega.entregueEm || os.entregueEm;
    if (!mesmoDia(quando, now)) continue;
    entreguesHoje.push({
      osId: os.id,
      codigo: txt(os.codigo) || "OS",
      cliente: txt(os.cliente?.nome) || "Cliente não informado",
      aparelho: [txt(os.equipamento?.marca), txt(os.equipamento?.modelo)].filter(Boolean).join(" "),
      statusLabel: "Entregue",
      extra: entrega.recebidoPor ? `retirado por ${entrega.recebidoPor}` : "Entregue hoje",
      destino: "entrega",
    });
  }

  const naBancada = bancada.semTecnico.filter((r) => r.naBancada).length
    + bancada.tecnicos.reduce((acc, t) => acc + t.ordens.filter((r) => r.naBancada).length, 0);

  let retornosAbertos = 0;
  for (const os of lista) {
    retornosAbertos += lerRetornosV3(os).filter((r) => r.status === "aberto").length;
  }

  return {
    temDados: lista.length > 0,
    resumo: {
      total: lista.length,
      ativas: fila.resumo.ativas,
      atrasadas: sla.resumo.atrasadas,
      emRisco: sla.resumo.emRisco,
      semTecnico: bancada.resumo.semTecnico,
      naBancada,
      emExecucao: bancada.resumo.emExecucao,
      aguardandoPeca: bancada.resumo.aguardandoPeca,
      prontas: bancada.resumo.prontas,
      entreguesHoje: entreguesHoje.length,
      retornosAbertos,
      garantiasVencendo: garantias.vencendo,
    },
    fila: filaBuckets,
    atrasadas,
    semTecnico,
    prontas,
    retornos,
    entreguesHoje: entreguesHoje.slice(0, ATENCAO_LIMITE),
  };
}
