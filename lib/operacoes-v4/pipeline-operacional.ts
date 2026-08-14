// ============================================================================
// Operações V4 — pipeline operacional da OS (GOAL OPS-V4-PIPELINE-ENTRADA-NAV-SIMPLIFY-002).
// ----------------------------------------------------------------------------
// Módulo PURO (sem I/O, sem React). A pipeline principal representa só o ciclo
// técnico da assistência: Entrada → Diagnóstico → Execução → Entrega → Pós-venda.
// Orçamento, Financeiro e Histórico continuam existindo como destinos
// transversais — não ocupam posição nesta trilha.
// ============================================================================

import type { V4Stage, V4Status } from "@/components/operacoes-v4-preview/types";

export const PIPELINE_OPERACIONAL_IDS_V4 = [
  "entrada",
  "diagnostico",
  "execucao",
  "entrega",
  "posvenda",
] as const;

export type PipelineOperacionalIdV4 = (typeof PIPELINE_OPERACIONAL_IDS_V4)[number];

export type PipelineNodeVisualV4 = "done" | "current" | "pending" | "alert";

export interface PipelineNodeStateV4 {
  done: boolean;
  current: boolean;
  pending: boolean;
  alert: boolean;
  visual: PipelineNodeVisualV4;
  alertReason?: string;
}

const PIPELINE_LABEL: Record<PipelineOperacionalIdV4, string> = {
  entrada: "Entrada",
  diagnostico: "Diagnóstico",
  execucao: "Execução",
  entrega: "Entrega",
  posvenda: "Pós-venda",
};

export function isPipelineOperacionalIdV4(id: string): id is PipelineOperacionalIdV4 {
  return (PIPELINE_OPERACIONAL_IDS_V4 as readonly string[]).includes(id);
}

export function labelPipelineOperacionalV4(id: PipelineOperacionalIdV4): string {
  return PIPELINE_LABEL[id];
}

/**
 * Destino operacional (ou transversal) ao abrir uma OS pelo status real.
 * `orcamento`/`financeiro`/`historico` continuam válidos como superfície, mas
 * não são etapas da pipeline.
 */
export function destinoOperacionalPorStatusV4(status: V4Status | undefined): V4Stage {
  switch (status) {
    case "aberta":
      return "entrada";
    case "diagnostico":
    case "aguardando_aprovacao":
      return "diagnostico";
    case "aprovado":
    case "em_execucao":
    case "aguardando_peca":
      return "execucao";
    case "pronta":
    case "entregue":
      return "entrega";
    case "cancelada":
    case "desconhecido":
    default:
      return "historico";
  }
}

function visualOf(state: Omit<PipelineNodeStateV4, "visual">): PipelineNodeVisualV4 {
  if (state.alert) return "alert";
  if (state.current) return "current";
  if (state.done) return "done";
  return "pending";
}

function node(
  partial: Omit<PipelineNodeStateV4, "visual">,
): PipelineNodeStateV4 {
  return { ...partial, visual: visualOf(partial) };
}

const IDLE = node({ done: false, current: false, pending: true, alert: false });

/**
 * Estado visual de um nó da pipeline a partir do status real da OS.
 * Status desconhecido/cancelada: nenhum nó atual ou concluído.
 */
export function estadoNoPipelineOperacionalV4(
  id: PipelineOperacionalIdV4,
  status: V4Status,
  opts: { canDeliver?: boolean | null; hasOpenCharge?: boolean } = {},
): PipelineNodeStateV4 {
  if (status === "desconhecido" || status === "cancelada") return IDLE;

  switch (id) {
    case "entrada":
      return node({
        done: status !== "aberta",
        current: status === "aberta",
        pending: false,
        alert: false,
      });
    case "diagnostico":
      return node({
        done: status !== "aberta" && status !== "diagnostico",
        current: status === "diagnostico",
        pending: status === "aberta",
        alert: false,
      });
    case "execucao": {
      const current = status === "aprovado" || status === "aguardando_peca" || status === "em_execucao";
      return node({
        done: status === "pronta" || status === "entregue",
        current,
        pending: !current && status !== "pronta" && status !== "entregue",
        alert: status === "aguardando_peca",
        alertReason: status === "aguardando_peca" ? "Aguardando peça" : undefined,
      });
    }
    case "entrega": {
      const blocked = status === "pronta" && opts.canDeliver === false && opts.hasOpenCharge === true;
      return node({
        done: status === "entregue",
        current: status === "pronta",
        pending: status !== "pronta" && status !== "entregue",
        alert: blocked,
        alertReason: blocked ? "Entrega bloqueada pelo financeiro" : undefined,
      });
    }
    case "posvenda":
      return node({
        done: false,
        current: status === "entregue",
        pending: status !== "entregue",
        alert: false,
      });
  }
}
