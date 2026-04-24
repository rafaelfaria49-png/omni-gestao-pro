"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

/** Painel lateral do terminal PDV: vidro forte sobre fundo preto. */
export function PdvPainelLateralTerminal({
  className,
  children,
}: React.PropsWithChildren<{ className?: string }>) {
  return (
    <div
      className={cn(
        "flex min-h-0 w-full flex-col overflow-hidden border-t border-border bg-muted/25 backdrop-blur-md lg:border-l lg:border-t-0",
        "dark:border-white/5 dark:bg-black/40 dark:backdrop-blur-3xl",
        className
      )}
    >
      {children}
    </div>
  )
}

/** Visor do total com brilho intenso na cor primária (token --primary). */
export function PdvVisorTotal({
  label = "TOTAL",
  valorFormatado,
  className,
}: {
  label?: string
  valorFormatado: string
  className?: string
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-center dark:bg-black/50 dark:backdrop-blur-md",
        className
      )}
    >
      <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
      <p
        className="mt-1 text-3xl font-black tabular-nums tracking-tight text-primary"
        style={{
          textShadow:
            "0 0 14px color-mix(in oklch, var(--primary) 90%, transparent), 0 0 32px color-mix(in oklch, var(--primary) 60%, transparent), 0 0 56px color-mix(in oklch, var(--primary) 40%, transparent)",
        }}
      >
        {valorFormatado}
      </p>
    </div>
  )
}
