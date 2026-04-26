"use client"

import { Sparkles, Link2, RefreshCw } from "lucide-react"
import { GlassCard } from "@/components/studio/ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ThemeToggle } from "@/components/theme/ThemeToggle"
import { useStudioTheme } from "@/components/theme/ThemeProvider"
import { cn } from "@/lib/utils"

export type StudioPalette = { a: string; b: string; c: string }

type BrandHeaderProps = {
  palette: StudioPalette
  onPaletteChange: (p: StudioPalette) => void
  onSync?: () => void
}

function ColorDot({
  value,
  onChange,
}: {
  value: string
  onChange: (hex: string) => void
}) {
  return (
    <label className="relative inline-flex h-3 w-3 cursor-pointer items-center justify-center">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        aria-label="Alterar cor da paleta"
      />
      <span
        className="pointer-events-none h-2.5 w-2.5 rounded-full ring-1 ring-slate-300 dark:ring-white/20"
        style={{ backgroundColor: value }}
      />
    </label>
  )
}

export function BrandHeader({ palette, onPaletteChange, onSync }: BrandHeaderProps) {
  const { mode } = useStudioTheme()
  const classic = mode === "classic"

  return (
    <GlassCard className="rounded-3xl px-5 py-4 shadow-sm dark:shadow-none md:px-5 md:py-4">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className={cn(
                "relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl shadow-sm transition-colors duration-300",
                classic
                  ? "border border-slate-200 bg-gradient-to-br from-fuchsia-500/90 via-violet-500 to-cyan-500"
                  : "border border-white/10 bg-gradient-to-br from-fuchsia-600/80 via-violet-600 to-cyan-500 shadow-[0_0_24px_rgba(217,70,239,0.35)]"
              )}
            >
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0 leading-tight">
              <p
                className={cn(
                  "text-[10px] font-semibold uppercase tracking-[0.22em] transition-colors duration-300",
                  classic ? "text-slate-600" : "text-white/55"
                )}
              >
                {classic ? "Aurora Studio" : "BLACK EDITION"}
              </p>
              <h1
                className={cn(
                  "text-lg font-semibold tracking-tight transition-colors duration-300 dark:font-black dark:text-white",
                  classic ? "text-slate-900" : "text-white"
                )}
              >
                Estúdio de Marketing{" "}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-fuchsia-600 to-cyan-600 dark:from-fuchsia-300 dark:to-cyan-200">
                  IA
                </span>
              </h1>
            </div>
          </div>

          <nav
            className={cn(
              "hidden items-center gap-6 text-xs font-medium transition-colors duration-300 md:flex",
              classic ? "text-slate-600" : "text-white/60"
            )}
          >
            <a className="transition-colors duration-300 hover:text-slate-900 dark:hover:text-white" href="#">
              Criação
            </a>
            <a className="transition-colors duration-300 hover:text-slate-900 dark:hover:text-white" href="#">
              Calendário
            </a>
            <a className="transition-colors duration-300 hover:text-slate-900 dark:hover:text-white" href="#">
              Performance
            </a>
          </nav>

          <div className="flex items-center gap-3">
            <ThemeToggle />
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-slate-200/80 pt-4 transition-colors duration-300 dark:border-white/10 dark:pt-4 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Link2
              className={cn(
                "pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 transition-colors duration-300",
                classic ? "text-slate-400" : "text-white/35"
              )}
            />
            <Input
              defaultValue="https://instagram.com/aurora.store"
              className={cn(
                "h-10 w-full rounded-xl border pl-10 text-sm backdrop-blur-xl transition-colors duration-300 focus-visible:ring-0 focus-visible:ring-offset-0",
                classic
                  ? "border-slate-200 bg-white text-slate-800 placeholder:text-slate-400"
                  : "border-white/10 bg-white/5 text-white/80 placeholder:text-white/30"
              )}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3 lg:shrink-0">
            <Button
              type="button"
              variant="outline"
              className={cn(
                "h-10 rounded-xl transition-colors duration-300",
                classic
                  ? "border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                  : "border-white/10 bg-white/5 text-white/80 hover:bg-white/10"
              )}
              onClick={() => onSync?.()}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Sincronizar
            </Button>
            <div className="flex items-center gap-3 border-l border-slate-200/80 pl-3 dark:border-white/10">
              <div
                className={cn(
                  "h-9 w-9 shrink-0 rounded-full border transition-colors duration-300",
                  classic ? "border-slate-200" : "border-white/10"
                )}
                style={{
                  background: `linear-gradient(135deg, ${palette.a}55, ${palette.b}33, ${palette.c}22)`,
                }}
              />
              <div className="min-w-0">
                <p
                  className={cn(
                    "truncate text-xs font-semibold transition-colors duration-300 dark:font-black dark:text-white",
                    classic ? "text-slate-900" : "text-white"
                  )}
                >
                  Aurora Store
                </p>
                <div className="flex items-center gap-1.5">
                  <ColorDot value={palette.a} onChange={(a) => onPaletteChange({ ...palette, a })} />
                  <ColorDot value={palette.b} onChange={(b) => onPaletteChange({ ...palette, b })} />
                  <ColorDot value={palette.c} onChange={(c) => onPaletteChange({ ...palette, c })} />
                  <span
                    className={cn(
                      "ml-1 hidden text-[10px] font-semibold tracking-wide transition-colors duration-300 sm:inline",
                      classic ? "text-slate-500" : "text-white/40"
                    )}
                  >
                    PALETA
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </GlassCard>
  )
}
