"use client";

import { cn } from "@/lib/utils";
import { formatBRL } from "../lib/format";
import type { PagamentoEstado } from "../lib/os-derive";

const CONFIG: Record<PagamentoEstado, { label: string; cls: string }> = {
  aberto: { label: "Em aberto", cls: "border-[var(--ops-v3-warning-bd)] bg-[var(--ops-v3-warning-bg)] text-[var(--ops-v3-warning-fg)]" },
  parcial: { label: "Parcial", cls: "border-[var(--ops-v3-info-bd)] bg-[var(--ops-v3-info-bg)] text-[var(--ops-v3-info-fg)]" },
  quitado: { label: "Quitado", cls: "border-[var(--ops-v3-success-bd)] bg-[var(--ops-v3-success-bg)] text-[var(--ops-v3-success-fg)]" },
  "sem-cobranca": { label: "Sem cobrança", cls: "border-[var(--ops-v3-input)] bg-[var(--ops-v3-muted-bg)] text-[var(--ops-v3-muted)]" },
  "a-conectar": {
    label: "Pagamento a conectar",
    cls: "border-dashed border-[var(--ops-v3-dashed)] bg-[var(--ops-v3-soft)] text-[var(--ops-v3-muted)]",
  },
};

/**
 * PaymentBadgeV3 — suporta os estados reais (aberto/parcial/quitado) para a fase
 * em que o Financeiro estiver acoplado. Nesta sprint, as telas só passam
 * `a-conectar` ou `sem-cobranca` (sem simular recebimento). Ver os-derive.pagamentoInfo.
 */
export function PaymentBadgeV3({
  estado,
  total,
  recebido,
  showValor = true,
  className,
}: {
  estado: PagamentoEstado;
  total?: number;
  recebido?: number;
  showValor?: boolean;
  className?: string;
}) {
  const cfg = CONFIG[estado];
  let valor: string | null = null;
  if (estado === "parcial" && typeof recebido === "number" && typeof total === "number") {
    valor = `${formatBRL(recebido)} de ${formatBRL(total)}`;
  } else if (showValor && typeof total === "number" && total > 0) {
    valor = formatBRL(total);
  }
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-px text-[11px] font-semibold",
        cfg.cls,
        className,
      )}
    >
      {cfg.label}
      {valor ? <span className="opacity-70">· {valor}</span> : null}
    </span>
  );
}
