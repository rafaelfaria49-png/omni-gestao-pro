"use client"

import { Heart, MessageCircle, Send, Bookmark } from "lucide-react"
import { cn } from "@/lib/utils"
import { useStudioTheme } from "@/components/theme/ThemeProvider"

export type StudioPalette = { a: string; b: string; c: string }

type Props = {
  brand: string
  product?: string
  caption: string
  palette?: StudioPalette
}

export function PhonePreview({ brand, product, caption, palette }: Props) {
  const { mode } = useStudioTheme()
  const classic = mode === "classic"
  const p = palette ?? { a: "#d946ef", b: "#22d3ee", c: "#34d399" }
  const heroBg = `linear-gradient(135deg, ${p.a} 0%, ${p.b} 48%, ${p.c} 100%)`
  const productLine = (product || "Produto").trim()

  return (
    <div className="relative mx-auto w-full max-w-[300px] transition-colors duration-300">
      {!classic && (
        <div
          className="pointer-events-none absolute inset-0 -z-10 translate-y-6 rounded-[3rem] opacity-30 blur-3xl"
          style={{ background: `linear-gradient(135deg, ${p.a}, ${p.b})` }}
        />
      )}

      {/* Moldura: Midnight (Black) · Starlight gelo (Classic) — segue o Tema Mestre */}
      <div
        className={cn(
          "relative rounded-[2.6rem] p-2 shadow-lg transition-all duration-300",
          classic
            ? "border border-[#d2d2d7] bg-gradient-to-br from-[#fefefe] via-[#f5f5f7] to-[#e8e8ed] shadow-[0_28px_90px_rgba(15,23,42,0.1)]"
            : "border border-[#1c1c1e] bg-[#000000] shadow-[0_40px_120px_rgba(0,0,0,0.85)]"
        )}
      >
        <div
          className={cn(
            "relative overflow-hidden rounded-[2.1rem] transition-colors duration-300",
            classic ? "bg-[#fafafa]" : "bg-[#000000]"
          )}
        >
          {!classic && (
            <div className="absolute left-1/2 top-2 z-20 h-5 w-24 -translate-x-1/2 rounded-full bg-[#000000]" />
          )}
          {classic && (
            <div className="absolute left-1/2 top-2 z-20 h-5 w-24 -translate-x-1/2 rounded-full bg-[#d1d1d6]" />
          )}

          <div
            className={cn(
              "flex flex-col gap-3 px-3 pb-4 pt-9 transition-colors duration-300",
              classic ? "text-slate-900" : "text-white"
            )}
          >
            <div
              className={cn(
                "flex items-center justify-between text-[10px] font-semibold transition-colors duration-300",
                classic ? "text-slate-800" : "text-white"
              )}
            >
              <span>9:41</span>
              <span className={classic ? "text-slate-500" : "opacity-70"}>Aurora · Reels</span>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div
                  className="h-7 w-7 rounded-full"
                  style={{ background: `linear-gradient(135deg, ${p.a}, ${p.b})` }}
                />
                <div className="leading-tight">
                  <p className="text-[11px] font-semibold">{brand.replace(/^@/, "")}</p>
                  <p
                    className={cn(
                      "text-[9px] transition-colors duration-300",
                      classic ? "text-slate-600" : "text-white/55"
                    )}
                  >
                    Patrocinado
                  </p>
                </div>
              </div>
            </div>

            <div className="relative aspect-[4/5] overflow-hidden rounded-2xl">
              <div className="absolute inset-0" style={{ background: heroBg }} />
              <div
                className={cn(
                  "absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,oklch(1_0_0/0.35),transparent_60%)]",
                  classic && "opacity-90"
                )}
              />
              <div
                className={cn(
                  "absolute inset-x-0 bottom-0 flex flex-col gap-1 p-3 transition-colors duration-300",
                  classic ? "text-white" : "text-white"
                )}
              >
                <span className="w-fit rounded-full bg-black/25 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider backdrop-blur dark:bg-background/20">
                  Coleção Aurora
                </span>
                <p className="text-sm font-semibold leading-tight drop-shadow">{productLine}</p>
              </div>
            </div>

            <div className="flex items-center justify-between transition-colors duration-300">
              <div className="flex items-center gap-3">
                <Heart className="h-5 w-5" style={{ color: p.a }} />
                <MessageCircle className="h-5 w-5" style={{ color: p.b }} />
                <Send className="h-5 w-5" style={{ color: p.c }} />
              </div>
              <Bookmark className={cn("h-5 w-5", classic ? "text-slate-500" : "text-white/55")} />
            </div>

            <p className={cn("text-[10px] font-semibold", classic ? "text-slate-700" : "text-white/90")}>
              2.847 curtidas
            </p>

            <p className={cn("text-[11px] leading-snug", classic ? "text-slate-800" : "text-white/90")}>
              <span className="font-semibold">{brand.replace(/^@/, "")}</span>{" "}
              <span className={classic ? "text-slate-700" : "text-white/80"}>
                {caption.trim() ? caption : "\u00a0"}
              </span>
            </p>
          </div>
        </div>
      </div>

      <p
        className={cn(
          "mt-3 text-center text-[10px] uppercase tracking-[0.22em] transition-colors duration-300",
          classic ? "text-slate-500" : "text-white/45"
        )}
      >
        {classic ? "Preview · Starlight" : "Preview · Midnight"} · Instagram Feed
      </p>
    </div>
  )
}
