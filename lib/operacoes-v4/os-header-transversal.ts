// ============================================================================
// Operações V4 — chips transversais do header da OS
// (GOAL OPS-V4-PIPELINE-ENTRADA-NAV-SIMPLIFY-002).
// ----------------------------------------------------------------------------
// Módulo PURO. Orçamento, Financeiro e Histórico saem da pipeline e passam a
// viver no header. Este arquivo só monta o texto/estado — a UI reusa os
// estágios reais já existentes ao clicar.
// ============================================================================

import {
  labelTicketFinanceiroV4,
  situacaoFinanceiraOSV4,
  type SituacaoFinanceiraOSV4,
} from "./financeiro-v4";

export type HeaderChipToneV4 = "neutro" | "info" | "warn" | "success" | "danger";
export type HeaderChipDestinoV4 = "orcamento" | "financeiro" | "historico";

export interface ComercialHeaderV4 {
  eyebrow: "Comercial";
  label: string;
  tone: HeaderChipToneV4;
  destino: "orcamento";
  hasBudget: boolean;
}

export interface FinanceiroHeaderV4 {
  eyebrow: "Financeiro";
  label: string;
  cta: string | null;
  tone: HeaderChipToneV4;
  /** Sem preço autorizado → orçamento. Qualquer cobrança/consulta → financeiro. */
  destino: "orcamento" | "financeiro";
}

export interface HistoricoHeaderV4 {
  eyebrow: "Histórico";
  label: "Histórico";
  countLabel: string | null;
  destino: "historico";
}

export type OrcamentoStatusHeaderV4 =
  | "rascunho"
  | "enviado"
  | "aprovado"
  | "recusado"
  | "expirado"
  | string
  | null
  | undefined;

function formatBRL(n: number): string {
  return (
    "R$ " +
    (Math.round(n * 100) / 100).toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function money(n: number | null | undefined): string | null {
  return typeof n === "number" && Number.isFinite(n) ? formatBRL(n) : null;
}

/**
 * Situação comercial compacta. Prévia sintetizada não conta como orçamento real.
 */
export function montarComercialHeaderV4(input: {
  estado: "ausente" | "vazio" | "previa" | "persistido";
  status?: OrcamentoStatusHeaderV4;
  total?: number | null;
}): ComercialHeaderV4 {
  const status = typeof input.status === "string" ? input.status : "";
  const valor = money(input.total);
  const real = input.estado === "persistido" || input.estado === "vazio";

  if (!real) {
    return {
      eyebrow: "Comercial",
      label: "Cobrança não definida",
      tone: "neutro",
      destino: "orcamento",
      hasBudget: false,
    };
  }

  if (status === "aprovado") {
    return {
      eyebrow: "Comercial",
      label: valor ? `${valor} · Aprovado` : "Aprovado",
      tone: "success",
      destino: "orcamento",
      hasBudget: true,
    };
  }
  if (status === "recusado") {
    return {
      eyebrow: "Comercial",
      label: "Orçamento recusado",
      tone: "danger",
      destino: "orcamento",
      hasBudget: true,
    };
  }
  if (status === "enviado") {
    return {
      eyebrow: "Comercial",
      label: valor ? `Orçamento · Enviado · ${valor}` : "Orçamento · Enviado",
      tone: "info",
      destino: "orcamento",
      hasBudget: true,
    };
  }
  if (status === "expirado") {
    return {
      eyebrow: "Comercial",
      label: "Orçamento expirado",
      tone: "warn",
      destino: "orcamento",
      hasBudget: true,
    };
  }
  return {
    eyebrow: "Comercial",
    label: "Orçamento · Rascunho",
    tone: "neutro",
    destino: "orcamento",
    hasBudget: true,
  };
}

export type FinancialStatusHeaderV4 =
  | "UNKNOWN"
  | "NO_PRICE"
  | "PRICE_DEFINED"
  | "CHARGE_NOT_CREATED"
  | "OPEN"
  | "PARTIAL"
  | "PAID"
  | "AUTHORIZED_CREDIT"
  | "AUTHORIZED_NO_CHARGE"
  | "INCONSISTENT"
  | "CANCELLED"
  | "REVERSED";

/**
 * Situação financeira compacta — mesmo view-model do FinanceiroStage.
 * Caixa fechado / leitura indisponível NÃO vira "Sem cobrança".
 */
export function montarFinanceiroHeaderV4(input: {
  loading?: boolean;
  error?: string | null;
  financialStatus?: FinancialStatusHeaderV4 | null;
  expectedTotal?: number | null;
  receivedTotal?: number | null;
  balance?: number | null;
}): FinanceiroHeaderV4 {
  if (input.loading) {
    return {
      eyebrow: "Financeiro",
      label: "Carregando financeiro…",
      cta: null,
      tone: "neutro",
      destino: "financeiro",
    };
  }

  if (input.error) {
    return {
      eyebrow: "Financeiro",
      label: "Financeiro indisponível",
      cta: "Financeiro",
      tone: "danger",
      destino: "financeiro",
    };
  }

  const status = input.financialStatus;
  const situacao: SituacaoFinanceiraOSV4 = status ? situacaoFinanceiraOSV4(status) : "revisar";
  const label = labelTicketFinanceiroV4({
    situacao,
    total: input.expectedTotal ?? null,
    saldo: input.balance ?? input.expectedTotal ?? null,
  });

  if (!status || status === "NO_PRICE" || status === "AUTHORIZED_NO_CHARGE") {
    return { eyebrow: "Financeiro", label, cta: "Definir cobrança", tone: "neutro", destino: "orcamento" };
  }
  if (status === "PRICE_DEFINED") {
    return { eyebrow: "Financeiro", label, cta: "Definir cobrança", tone: "neutro", destino: "orcamento" };
  }
  if (status === "UNKNOWN") {
    return { eyebrow: "Financeiro", label, cta: "Financeiro", tone: "danger", destino: "financeiro" };
  }
  if (status === "INCONSISTENT") {
    return { eyebrow: "Financeiro", label, cta: "Financeiro", tone: "danger", destino: "financeiro" };
  }
  if (status === "PAID") {
    return { eyebrow: "Financeiro", label, cta: null, tone: "success", destino: "financeiro" };
  }
  if (status === "PARTIAL") {
    return { eyebrow: "Financeiro", label, cta: "Financeiro", tone: "warn", destino: "financeiro" };
  }
  if (status === "OPEN" || status === "CHARGE_NOT_CREATED") {
    return { eyebrow: "Financeiro", label, cta: "Financeiro", tone: "warn", destino: "financeiro" };
  }
  if (status === "AUTHORIZED_CREDIT") {
    return { eyebrow: "Financeiro", label, cta: "Financeiro", tone: "info", destino: "financeiro" };
  }
  if (status === "CANCELLED" || status === "REVERSED") {
    return { eyebrow: "Financeiro", label, cta: "Financeiro", tone: "danger", destino: "financeiro" };
  }
  return { eyebrow: "Financeiro", label, cta: "Financeiro", tone: "warn", destino: "financeiro" };
}

export function montarHistoricoHeaderV4(eventCount: number): HistoricoHeaderV4 {
  const n = Number.isFinite(eventCount) ? Math.max(0, Math.floor(eventCount)) : 0;
  return {
    eyebrow: "Histórico",
    label: "Histórico",
    countLabel: n > 0 ? `${n} ${n === 1 ? "evento" : "eventos"}` : null,
    destino: "historico",
  };
}

export type HeaderChipDestinoClickV4 = HeaderChipDestinoV4;
