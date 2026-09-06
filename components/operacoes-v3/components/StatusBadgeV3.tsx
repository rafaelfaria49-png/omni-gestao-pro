"use client";

import { cn } from "@/lib/utils";
import { statusMetaV3 } from "@/lib/operacoes-v3/status-machine";
import { TONE_BADGE_CLASS } from "../data/status-flow";

/**
 * Badge de status da OS — fonte única: a máquina de status da V3
 * (`statusMetaV3`). Renderiza os 10 status oficiais (inclui "Recebida").
 * Passe o status V3 EFETIVO (via `statusV3FromOS(os)`), não o `payload.status` cru.
 */
export function StatusBadgeV3({
  status,
  className,
}: {
  status: string | null | undefined;
  className?: string;
}) {
  const meta = statusMetaV3(status);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-px text-[11px] font-semibold",
        TONE_BADGE_CLASS[meta.tone],
        className,
      )}
    >
      <span className="h-1 w-1 rounded-full bg-current" aria-hidden />
      {meta.label}
    </span>
  );
}
