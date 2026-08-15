// ============================================================================
// Operações V4 — política compartilhada de transições rápidas de produção.
// ----------------------------------------------------------------------------
// GOAL OPS-V4-BANCADA-COMMERCIAL-TRANSITION-GUARD-003B.
// Sem I/O, sem React, sem Prisma. Sem segundo grafo.
//
// Autoridade de transição: máquina V3 (`podeTransicionarV3` / `proximasTransicoesV3`).
// Este módulo só recorta o que Fila e Bancada podem mutar direto via
// `aplicarTransicaoStatusV3` (chão de oficina).
//
// Fora da mutation rápida (exigem fluxo próprio):
//   enviar orçamento · aprovar orçamento · recebimento · entrega · cancelamento.
// ============================================================================

import {
  podeTransicionarV3,
  proximasTransicoesV3,
  type OperacaoStatusV3,
} from "@/lib/operacoes-v3/status-machine";

/**
 * Destinos cujo write é só status+timeline.
 * Confirmado no grafo V3: aberta→diagnostico; aprovado→peca|execução;
 * peca→execução; execução→pronta.
 */
export const DESTINOS_RAPIDOS_PRODUCAO_V4: readonly OperacaoStatusV3[] = [
  "diagnostico",
  "aguardando_peca",
  "em_execucao",
  "pronta",
];

/** Pares que a máquina permite, mas o contrato comercial é outro write-path. */
export const TRANSICOES_COMERCIAIS_PROTEGIDAS_V4: readonly (readonly [
  OperacaoStatusV3,
  OperacaoStatusV3,
])[] = [
  ["diagnostico", "aguardando_aprovacao"],
  ["aguardando_aprovacao", "aprovado"],
];

const DESTINO_RAPIDO = new Set<OperacaoStatusV3>(DESTINOS_RAPIDOS_PRODUCAO_V4);

export type CtaComercialKindV4 = "enviar_orcamento" | "registrar_aprovacao";

export interface CtaComercialProducaoV4 {
  kind: CtaComercialKindV4;
  label: string;
}

export function isDestinoRapidoProducaoV4(to: unknown): to is OperacaoStatusV3 {
  return typeof to === "string" && DESTINO_RAPIDO.has(to as OperacaoStatusV3);
}

export function isTransicaoComercialProtegidaV4(from: unknown, to: unknown): boolean {
  return TRANSICOES_COMERCIAIS_PROTEGIDAS_V4.some(([a, b]) => a === from && b === to);
}

export function hintCockpitComercialV4(from: unknown): string | null {
  if (from === "diagnostico") return "Abra a OS para enviar o orçamento";
  if (from === "aguardando_aprovacao") return "Abra a OS para aprovar o orçamento";
  return null;
}

/** CTA de chão: abre o cockpit. Nunca muta status comercial. */
export function ctaComercialProducaoV4(from: unknown): CtaComercialProducaoV4 | null {
  if (from === "diagnostico") {
    return { kind: "enviar_orcamento", label: "Abrir OS para criar/enviar orçamento" };
  }
  if (from === "aguardando_aprovacao") {
    return { kind: "registrar_aprovacao", label: "Registrar aprovação na OS" };
  }
  return null;
}

/**
 * Destinos rápidos: `proximasTransicoesV3` ∩ recorte de produção
 * − cancelar/receber/entregar − pares comerciais (enviar/aprovar orçamento).
 */
export function vereditoTransicaoRapidaProducaoV4(
  from: unknown,
  to: unknown,
): { ok: true } | { ok: false; motivo: string } {
  if (to === "cancelada") {
    return { ok: false, motivo: "Cancelamento não é ação rápida de produção. Use o cockpit da OS." };
  }
  if (to === "recebida" || to === "entregue") {
    return { ok: false, motivo: "Recebimento e entrega ficam no cockpit da OS." };
  }
  if (isTransicaoComercialProtegidaV4(from, to)) {
    return {
      ok: false,
      motivo: hintCockpitComercialV4(from) ?? "Esta decisão comercial fica no cockpit da OS.",
    };
  }
  if (!isDestinoRapidoProducaoV4(to)) {
    return { ok: false, motivo: "Esta transição não é uma ação rápida de produção." };
  }
  const veredito = podeTransicionarV3(from, to);
  if (!veredito.ok) return { ok: false, motivo: veredito.motivo ?? "Transição não permitida." };
  return { ok: true };
}

export function destinosRapidosProducaoV4(from: unknown): OperacaoStatusV3[] {
  return proximasTransicoesV3(from).filter((to) => vereditoTransicaoRapidaProducaoV4(from, to).ok);
}
