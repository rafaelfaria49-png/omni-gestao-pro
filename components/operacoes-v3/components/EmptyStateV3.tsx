"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function EmptyStateV3({
  icon,
  titulo,
  descricao,
  acao,
  className,
}: {
  icon?: ReactNode;
  titulo: string;
  descricao?: string;
  acao?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-[10px] border border-dashed border-[var(--ops-v3-dashed)] bg-[var(--ops-v3-soft)] px-6 py-10 text-center",
        className,
      )}
    >
      {icon ? <div className="mb-3 text-[var(--ops-v3-subtle)]">{icon}</div> : null}
      <p className="text-sm font-medium text-[var(--ops-v3-body)]">{titulo}</p>
      {descricao ? <p className="mt-1 max-w-md text-sm text-[var(--ops-v3-muted)]">{descricao}</p> : null}
      {acao ? <div className="mt-4">{acao}</div> : null}
    </div>
  );
}
