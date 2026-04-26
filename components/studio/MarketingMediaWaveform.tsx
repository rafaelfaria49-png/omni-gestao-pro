"use client"

import { useEffect, useMemo, useState } from "react"
import { cn } from "@/lib/utils"

const BARS = 28

type Props = {
  classic: boolean
  isPlaying: boolean
  className?: string
}

export function MarketingMediaWaveform({ classic, isPlaying, className }: Props) {
  const [heights, setHeights] = useState<number[]>(() => Array.from({ length: BARS }, () => 18))

  useEffect(() => {
    if (!isPlaying) {
      setHeights(Array.from({ length: BARS }, () => 12 + Math.random() * 8))
      return
    }
    const id = window.setInterval(() => {
      setHeights(Array.from({ length: BARS }, () => 16 + Math.random() * 52))
    }, 90)
    return () => window.clearInterval(id)
  }, [isPlaying])

  const barClass = useMemo(
    () =>
      classic
        ? "bg-gradient-to-t from-slate-400 to-slate-600"
        : "bg-gradient-to-t from-fuchsia-500 via-cyan-400 to-violet-400 shadow-[0_0_12px_rgba(217,70,239,0.45)]",
    [classic]
  )

  return (
    <div
      className={cn(
        "flex h-14 w-full items-end justify-center gap-[3px] rounded-xl border px-2 py-2",
        classic ? "border-slate-200 bg-slate-50" : "border-white/10 bg-black/40",
        className
      )}
      aria-hidden
    >
      {heights.map((h, i) => (
        <div
          key={i}
          className={cn("w-[5px] min-w-[3px] rounded-full transition-[height] duration-100", barClass)}
          style={{ height: `${h}%` }}
        />
      ))}
    </div>
  )
}
