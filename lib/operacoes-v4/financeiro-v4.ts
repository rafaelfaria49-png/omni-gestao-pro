// ============================================================================
// Operações V4 — view-model financeiro da OS (GOAL OPS-V4-RECEBIMENTO-TRANSVERSAL-005)
// ----------------------------------------------------------------------------
// Módulo PURO. Traduz a projeção server-side (leitores V3 + Conta a Receber)
// para a UX transversal da V4. Não calcula saldo próprio, não cria título e
// não inventa forma/intenção — só projeta o contrato já existente.
// ============================================================================

import {
  FORMAS_RECEBIMENTO_V3,
  type FormaRecebimentoV3,
} from "@/lib/operacoes-v3/payment-model";
import type { FinancialProjectionOSV4, FinancialStatusV4 } from "./financial-projection";

export type SituacaoFinanceiraOSV4 =
  | "carregando"
  | "indisponivel"
  | "inconsistente"
  | "sem_cobranca"
  | "previa"
  | "a_receber"
  | "parcial"
  | "quitado"
  | "a_prazo"
  | "cancelada"
  | "estornada"
  | "revisar";

export interface RecebimentoHistoricoV4 {
  id: string;
  occurredAt: string | null;
  valor: number | null;
  forma: string | null;
  operador: string | null;
  intencao: string | null;
  status: string;
  estornado: boolean;
}

export interface FormaDisponivelV4 {
  value: FormaRecebimentoV3;
  label: string;
}

export interface ResumoFinanceiroOSV4 {
  situacao: SituacaoFinanceiraOSV4;
  situacaoLabel: string;
  total: number | null;
  recebido: number | null;
  saldo: number | null;
  cobrancaReal: boolean;
  sintetizada: boolean;
  formasDisponiveis: FormaDisponivelV4[];
  formasIndisponiveis: FormaDisponivelV4[];
  suportaSplit: true;
  suportaAPrazo: true;
  /** Espelha `projection.canReceive` — título já materializado + saldo. */
  podeReceber: boolean;
  /**
   * Saldo cobrável pelo contrato V3 (`receberOSV3` cria o título se ainda não
   * existir). Inclui CHARGE_NOT_CREATED com total positivo confiável.
   */
  podeReceberSaldo: boolean;
  podeEstornar: boolean;
  podeLancarPrazo: boolean;
  exigeCaixa: boolean;
  caixaAberto: boolean;
  recebimentos: RecebimentoHistoricoV4[];
  motivoBloqueio: string | null;
}

const SITUACAO_LABEL: Record<SituacaoFinanceiraOSV4, string> = {
  carregando: "Carregando",
  indisponivel: "Indisponível",
  inconsistente: "Inconsistente",
  sem_cobranca: "Sem cobrança",
  previa: "Prévia",
  a_receber: "A receber",
  parcial: "Parcial",
  quitado: "Quitado",
  a_prazo: "A prazo",
  cancelada: "Cancelada",
  estornada: "Estornada",
  revisar: "Revisar",
};

const FORMAS_SUPORTADAS: FormaDisponivelV4[] = FORMAS_RECEBIMENTO_V3
  .filter((forma) => forma.suportada)
  .map((forma) => ({ value: forma.value, label: forma.label }));

const FORMAS_INDISPONIVEIS: FormaDisponivelV4[] = FORMAS_RECEBIMENTO_V3
  .filter((forma) => !forma.suportada)
  .map((forma) => ({ value: forma.value, label: forma.label }));

const CAPACIDADE_CONTRATO = {
  formasDisponiveis: FORMAS_SUPORTADAS,
  formasIndisponiveis: FORMAS_INDISPONIVEIS,
  suportaSplit: true as const,
  suportaAPrazo: true as const,
};

function money(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

export function formatBRLFinanceiroV4(value: number | null | undefined): string | null {
  const parsed = money(value);
  if (parsed == null) return null;
  return (
    "R$ " +
    parsed.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

export function situacaoFinanceiraOSV4(status: FinancialStatusV4 | null | undefined): SituacaoFinanceiraOSV4 {
  switch (status) {
    case "NO_PRICE":
    case "AUTHORIZED_NO_CHARGE":
      return "sem_cobranca";
    case "PRICE_DEFINED":
      return "previa";
    case "OPEN":
    case "CHARGE_NOT_CREATED":
      return "a_receber";
    case "PARTIAL":
      return "parcial";
    case "PAID":
      return "quitado";
    case "AUTHORIZED_CREDIT":
      return "a_prazo";
    case "CANCELLED":
      return "cancelada";
    case "REVERSED":
      return "estornada";
    case "INCONSISTENT":
      return "inconsistente";
    case "UNKNOWN":
      return "indisponivel";
    default:
      return "revisar";
  }
}

function historicoDeEventos(projection: FinancialProjectionOSV4 | null): RecebimentoHistoricoV4[] {
  if (!projection) return [];
  return projection.financialEvents.flatMap((event) => {
    const type = event.type.toLowerCase();
    const estornado = type.includes("estorno");
    const isReceipt =
      type === "pagamento" ||
      type === "liquidacao" ||
      type === "estorno_pagamento" ||
      type.includes("cobranca") ||
      type.includes("pagamento") ||
      type.includes("liquidac");
    if (!isReceipt && event.source !== "RECEIVABLE") return [];
    return [{
      id: event.eventId,
      occurredAt: event.occurredAt,
      valor: event.amount,
      forma: event.paymentMethod,
      operador: event.actor,
      intencao: event.description || null,
      status: estornado ? "Estornado" : event.description || event.type,
      estornado,
    }];
  });
}

export function montarResumoFinanceiroOSV4(input: {
  loading?: boolean;
  error?: string | null;
  projection: FinancialProjectionOSV4 | null;
  caixaAberto: boolean;
}): ResumoFinanceiroOSV4 {
  if (input.loading) {
    return {
      situacao: "carregando",
      situacaoLabel: SITUACAO_LABEL.carregando,
      total: null,
      recebido: null,
      saldo: null,
      cobrancaReal: false,
      sintetizada: false,
      ...CAPACIDADE_CONTRATO,
      podeReceber: false,
      podeReceberSaldo: false,
      podeEstornar: false,
      podeLancarPrazo: false,
      exigeCaixa: true,
      caixaAberto: input.caixaAberto,
      recebimentos: [],
      motivoBloqueio: null,
    };
  }

  if (input.error || !input.projection || input.projection.financialStatus === "UNKNOWN") {
    return {
      situacao: "indisponivel",
      situacaoLabel: SITUACAO_LABEL.indisponivel,
      total: input.projection?.expectedTotal ?? null,
      recebido: input.projection?.receivedTotal ?? null,
      saldo: input.projection?.balance ?? null,
      cobrancaReal: false,
      sintetizada: false,
      ...CAPACIDADE_CONTRATO,
      podeReceber: false,
      podeReceberSaldo: false,
      podeEstornar: false,
      podeLancarPrazo: false,
      exigeCaixa: true,
      caixaAberto: input.caixaAberto,
      recebimentos: historicoDeEventos(input.projection),
      motivoBloqueio: input.error ?? input.projection?.consistencyIssues[0] ?? "Não foi possível determinar a situação financeira desta OS.",
    };
  }

  const projection = input.projection;
  const situacao = situacaoFinanceiraOSV4(projection.financialStatus);
  const total = money(projection.expectedTotal);
  const recebido = money(projection.receivedTotal) ?? (situacao === "a_receber" && !projection.receivableFound ? 0 : null);
  const saldo = money(projection.balance) ?? (
    situacao === "a_receber" && !projection.receivableFound && total != null && total > 0 ? total : null
  );
  const cobrancaReal =
    projection.receivableFound ||
    situacao === "a_receber" ||
    situacao === "parcial" ||
    situacao === "quitado" ||
    situacao === "a_prazo";
  const sintetizada = situacao === "previa";
  const podeReceberSaldo =
    (projection.canReceive ||
      (projection.financialStatus === "CHARGE_NOT_CREATED" &&
        (total ?? 0) > 0 &&
        projection.consistencyStatus !== "INCONSISTENT")) &&
    (saldo ?? 0) > 0;
  const podeLancarPrazo =
    podeReceberSaldo &&
    situacao !== "quitado" &&
    situacao !== "a_prazo" &&
    situacao !== "previa" &&
    situacao !== "sem_cobranca";

  return {
    situacao,
    situacaoLabel: SITUACAO_LABEL[situacao],
    total,
    recebido,
    saldo,
    cobrancaReal: cobrancaReal && !sintetizada,
    sintetizada,
    ...CAPACIDADE_CONTRATO,
    podeReceber: projection.canReceive === true,
    podeReceberSaldo,
    podeEstornar: (projection.receivedTotal ?? 0) > 0,
    podeLancarPrazo,
    exigeCaixa: true,
    caixaAberto: input.caixaAberto,
    recebimentos: historicoDeEventos(projection),
    motivoBloqueio: projection.consistencyIssues[0] ?? null,
  };
}

export function labelTicketFinanceiroV4(resumo: Pick<ResumoFinanceiroOSV4, "situacao" | "total" | "saldo">): string {
  const saldo = formatBRLFinanceiroV4(resumo.saldo);
  const total = formatBRLFinanceiroV4(resumo.total);
  if (resumo.situacao === "carregando") return "Carregando financeiro…";
  if (resumo.situacao === "indisponivel") return "Financeiro indisponível";
  if (resumo.situacao === "inconsistente") return "Financeiro inconsistente";
  if (resumo.situacao === "sem_cobranca") return "Sem cobrança";
  if (resumo.situacao === "previa") return "Prévia sem cobrança";
  if (resumo.situacao === "quitado") return "Quitado";
  if (resumo.situacao === "parcial") return saldo ? `Parcial  ${saldo} pendente` : "Parcial";
  if (resumo.situacao === "a_receber") return saldo ? `${saldo} a receber` : total ? `${total} a receber` : "A receber";
  if (resumo.situacao === "a_prazo") return saldo ? `A prazo ${saldo}` : "Autorizado a prazo";
  if (resumo.situacao === "cancelada") return "Cobrança cancelada";
  if (resumo.situacao === "estornada") return "Pagamento estornado";
  return total ? `Preço ${total}` : "Revisar cobrança";
}
