"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

type TabelaItensProps = {
  className?: string
  children: React.ReactNode
}

/** Lista do carrinho PDV: linhas transparentes, só divisórias discretas (v0). */
export function PdvTabelaItens({ className, children }: TabelaItensProps) {
  return <div className={cn("divide-y divide-white/5 bg-transparent", className)}>{children}</div>
}

export function PdvTabelaItemLinha({
  className,
  children,
}: React.PropsWithChildren<{ className?: string }>) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 border-0 bg-transparent px-2 py-3 first:pt-2 last:pb-2",
        className
      )}
    >
      {children}
    </div>
  )
}
