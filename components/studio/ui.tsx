"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

export function GlassCard({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-slate-200/90 bg-white/95 shadow-sm backdrop-blur-xl transition-colors duration-300",
        "dark:border-white/10 dark:bg-black/40 dark:shadow-[0_0_0_1px_rgba(255,255,255,0.03)_inset]",
        className
      )}
      {...props}
    />
  )
}
