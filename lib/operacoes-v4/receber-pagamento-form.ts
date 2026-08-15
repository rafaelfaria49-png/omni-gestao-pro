// ============================================================================
// Operações V4 — formulário de recebimento (GOAL OPS-V4-RECEBIMENTO-TRANSVERSAL-005)
// ----------------------------------------------------------------------------
// Módulo PURO. Monta o input canônico de `receberOSV3` e valida o rascunho da
// UX (intenção + split) com os mesmos helpers da V3. Sem motor novo.
// ============================================================================

import type { ReceberOSInputV3 } from "@/lib/operacoes-v3/pdv-servico-actions";
import {
  INTENCOES_RECEBIMENTO_V3,
  money,
  somaSplitV3,
  validarSplitV3,
  type FormaRecebimentoV3,
  type RecebimentoIntencaoV3,
  type SplitLinhaV3,
} from "@/lib/operacoes-v3/payment-model";

export type IntencaoRecebimentoV4 = RecebimentoIntencaoV3 | "quitacao";

export const INTENCOES_RECEBIMENTO_V4: { value: IntencaoRecebimentoV4; label: string }[] = [
  { value: "quitacao", label: "Quitar saldo" },
  ...INTENCOES_RECEBIMENTO_V3,
];

export interface LinhaDraftRecebimentoV4 {
  forma: FormaRecebimentoV3;
  valorStr: string;
}

export function parseValorRecebimentoV4(raw: string): number {
  const n = parseFloat((raw ?? "").replace(",", "."));
  return Number.isFinite(n) ? money(n) : 0;
}

export function valorSugeridoRecebimentoV4(intencao: IntencaoRecebimentoV4, saldo: number): number {
  const s = money(saldo);
  if (!(s > 0)) return 0;
  if (intencao === "quitacao") return s;
  return 0;
}

export function linhasValidasRecebimentoV4(linhas: LinhaDraftRecebimentoV4[]): SplitLinhaV3[] {
  return linhas
    .map((linha) => ({ forma: linha.forma, valor: parseValorRecebimentoV4(linha.valorStr) }))
    .filter((linha) => linha.valor > 0);
}

export function rascunhoRecebimentoValidoV4(input: {
  linhas: LinhaDraftRecebimentoV4[];
  saldo: number;
  intencao: IntencaoRecebimentoV4;
}): { ok: boolean; motivo?: string; totalInformado: number; restante: number } {
  const algumaLinhaInvalida = input.linhas.some((linha) => !(parseValorRecebimentoV4(linha.valorStr) > 0));
  const linhas = linhasValidasRecebimentoV4(input.linhas);
  const totalInformado = somaSplitV3(linhas);
  const restante = money(Math.max(0, money(input.saldo) - totalInformado));
  if (algumaLinhaInvalida) {
    return { ok: false, motivo: "Informe um valor maior que zero em todas as formas adicionadas.", totalInformado, restante };
  }
  const veredito = validarSplitV3(linhas, input.saldo);
  if (!veredito.ok) return { ok: false, motivo: veredito.motivo, totalInformado, restante };
  if (input.intencao === "quitacao" && restante > 0.009) {
    return { ok: false, motivo: "Para quitar, o informado precisa cobrir o saldo.", totalInformado, restante };
  }
  return { ok: true, totalInformado, restante };
}

/** Mesma regra de `lancarOSAPrazoV3`: vencimento obrigatório e parseável. */
export function vencimentoAPrazoValidoV4(vencimento: string): boolean {
  const value = (vencimento ?? "").trim();
  return value.length > 0 && !Number.isNaN(new Date(value).getTime());
}

/** Converte o rascunho no input canônico de `receberOSV3`. Quitação é rótulo UX — o motor deriva. */
export function buildReceberOSInputV4(input: {
  linhas: SplitLinhaV3[];
  sessaoId: string;
  intencao: IntencaoRecebimentoV4;
  observacao?: string;
}): ReceberOSInputV3 {
  return {
    linhas: input.linhas,
    sessaoId: input.sessaoId.trim(),
    intencao: input.intencao === "quitacao" ? undefined : input.intencao,
    observacao: input.observacao?.trim() || undefined,
  };
}
