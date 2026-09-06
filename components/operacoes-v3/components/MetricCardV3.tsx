"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type MetricTone = "neutral" | "primary" | "success" | "warning" | "danger" | "info";

const TONE_ACCENT: Record<MetricTone, string> = {
  neutral: "text-[var(--ops-v3-ink)]",
  primary: "text-[var(--ops-v3-primary)]",
  success: "text-[var(--ops-v3-success)]",
  warning: "text-[var(--ops-v3-warning)]",
  danger: "text-[var(--ops-v3-danger)]",
  info: "text-[var(--ops-v3-info)]",
};

export interface MetricCardV3Props {
  label: string;
  value?: ReactNode;
  /** "a-conectar" não exibe número — mostra pílula honesta. */
  estado?: "ok" | "a-conectar";
  hint?: string;
  icon?: ReactNode;
  tone?: MetricTone;
  className?: string;
}

export function MetricCardV3({
  label,
  value,
  estado = "ok",
  hint,
  icon,
  tone = "neutral",
  className,
}: MetricCardV3Props) {
  const aConectar = estado === "a-conectar";
  return (
    <div className={cn("v3-lift min-w-0 rounded-[10px] border border-[var(--ops-v3-line)] bg-[var(--ops-v3-surface)] p-3 shadow-sm transition-transform", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-[var(--ops-v3-muted)]">
          {label}
        </span>
        {icon ? <span className="shrink-0 text-[var(--ops-v3-subtle)]">{icon}</span> : null}
      </div>
      {aConectar ? (
        <div className="mt-1.5">
          <span className="inline-flex items-center rounded-md border border-dashed border-[var(--ops-v3-dashed)] bg-[var(--ops-v3-soft)] px-2 py-0.5 text-xs text-[var(--ops-v3-muted)]">
            a conectar
          </span>
        </div>
      ) : (
        <p className={cn("mt-1.5 truncate text-xl font-bold tabular-nums", TONE_ACCENT[tone])}>
          {value}
        </p>
      )}
      {hint ? <p className="mt-0.5 truncate text-[11px] text-[var(--ops-v3-muted)]">{hint}</p> : null}
    </div>
  );
}
