"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Cabeçalho + corpo padrão de cada tela da V3 (kicker, título, subtítulo, badge, ações). */
export function SectionShellV3({
  titulo,
  subtitulo,
  kicker,
  badge,
  actions,
  children,
  className,
}: {
  titulo: string;
  subtitulo?: string;
  /** Rótulo hierárquico pequeno acima do título (padrão LAB-002). Opcional. */
  kicker?: string;
  badge?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2 sm:mb-4 sm:gap-3">
        <div className="min-w-0">
          {kicker ? (
            <p className="mb-0.5 text-[10.5px] font-extrabold uppercase tracking-[0.07em] text-[var(--ops-v3-muted)]">
              {kicker}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-[18px] font-bold tracking-tight text-[var(--ops-v3-ink)] sm:text-[21px]">{titulo}</h1>
            {badge}
          </div>
          {subtitulo ? <p className="mt-0.5 text-[12.5px] text-[var(--ops-v3-muted)] sm:text-sm">{subtitulo}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
      {children}
    </div>
  );
}
