"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "outline" | "ghost" | "subtle" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "border border-transparent bg-[var(--ops-v3-primary)] text-white shadow-[var(--ops-v3-shadow-primary-btn)] hover:bg-[var(--ops-v3-primary-hover)]",
  outline: "border border-[var(--ops-v3-input)] bg-[var(--ops-v3-surface)] text-[var(--ops-v3-body)] hover:bg-[var(--ops-v3-muted-bg)]",
  ghost: "border border-transparent bg-transparent text-[var(--ops-v3-muted)] hover:bg-[var(--ops-v3-muted-bg)] hover:text-[var(--ops-v3-ink)]",
  subtle: "border border-transparent bg-[var(--ops-v3-muted-bg-2)] text-[var(--ops-v3-body)] hover:bg-[var(--ops-v3-line)]",
  danger: "border border-[var(--ops-v3-danger-bd)] bg-[var(--ops-v3-danger-bg)] text-[var(--ops-v3-danger-fg)] hover:bg-[var(--ops-v3-danger-hover)]",
};

/** Botão self-contained da V3 (sem depender do kit shadcn global).
 *  Densidade LAB-002: 38px no desktop. Controles de conteúdo que precisam de
 *  ~44px no mobile recebem .v3-mtap explicitamente (nunca no header fixo). */
export function ButtonV3({
  variant = "outline",
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; children: ReactNode }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex min-h-[var(--ops-v3-btn-h)] items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100",
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Pílula informativa neutra (rótulo + valor). */
export function PillV3({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-[var(--ops-v3-line)] bg-[var(--ops-v3-muted-bg)] px-2.5 py-0.5 text-xs text-[var(--ops-v3-muted)]",
        className,
      )}
    >
      {children}
    </span>
  );
}
