"use client"

import { CalendarDays, CheckCircle2, Clock, Plus, CalendarClock, MessageCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { GlassCard } from "@/components/studio/ui"
import { cn } from "@/lib/utils"
import { useStudioTheme } from "@/components/theme/ThemeProvider"
import type { EditorialCalendarItem } from "@/lib/marketing-editorial-map"

const DAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"]

type Props = {
  items: EditorialCalendarItem[]
  loading?: boolean
  /** Preferência: texto dinâmico (ex.: aba ativa do Pack). Se ausente, usa `captionForWhatsApp`. */
  getWhatsAppText?: () => string
  captionForWhatsApp?: string
  onSchedule?: () => void | Promise<void>
  onWhatsApp?: () => void
}

export function EditorialCalendar({
  items,
  loading,
  getWhatsAppText,
  captionForWhatsApp,
  onSchedule,
  onWhatsApp,
}: Props) {
  const { mode } = useStudioTheme()
  const classic = mode === "classic"

  const openWhatsAppWithCaption = () => {
    const text = (getWhatsAppText ? getWhatsAppText() : captionForWhatsApp || "").trim()
    if (!text) {
      onWhatsApp?.()
      return
    }
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`
    window.open(url, "_blank", "noopener,noreferrer")
  }

  return (
    <GlassCard className="rounded-3xl p-5 md:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <CalendarDays className={cn("h-5 w-5", classic ? "text-emerald-600" : "text-emerald-300")} />
            <h2
              className={cn(
                "text-sm font-semibold tracking-tight transition-colors duration-300 dark:font-black dark:text-white",
                classic ? "text-slate-900" : "text-white"
              )}
            >
              Calendário editorial
            </h2>
          </div>
          <p
            className={cn(
              "mt-1 text-xs transition-colors duration-300",
              classic ? "text-slate-600" : "text-white/45"
            )}
          >
            Postagens geradas ou agendadas pela IA Mestre nesta unidade.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className={cn(
              "h-10 transition-colors duration-300",
              classic
                ? "border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                : "border-white/10 bg-black/50 text-white/80 hover:bg-white/10"
            )}
            onClick={() => void onSchedule?.()}
            disabled={!!loading}
          >
            <CalendarClock className={cn("mr-2 h-4 w-4", classic ? "text-emerald-600" : "text-emerald-300")} />
            Agendar
          </Button>
          <Button
            type="button"
            className="h-10 bg-emerald-600 font-semibold text-white hover:bg-emerald-500 dark:font-black dark:text-zinc-950"
            onClick={openWhatsAppWithCaption}
            disabled={!!loading}
          >
            <MessageCircle className="mr-2 h-4 w-4" />
            Enviar para WhatsApp
          </Button>
          <Button
            type="button"
            variant="outline"
            className={cn(
              "h-10 transition-colors duration-300",
              classic
                ? "border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                : "border-white/10 bg-black/50 text-white/70 hover:bg-white/5"
            )}
            disabled
            title="Em breve"
          >
            <Plus className="mr-2 h-4 w-4" />
            Novo
          </Button>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-7 gap-2">
        {DAYS.map((d) => (
          <div
            key={d}
            className={cn(
              "rounded-xl border px-2 py-2 text-center text-xs font-bold backdrop-blur-xl transition-colors duration-300",
              classic
                ? "border-slate-200 bg-slate-50 text-slate-700"
                : "border-white/10 bg-black/35 text-white/70"
            )}
          >
            {d}
          </div>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
        {loading ? (
          <p
            className={cn(
              "col-span-full py-6 text-center text-sm",
              classic ? "text-slate-600" : "text-white/50"
            )}
          >
            Carregando postagens…
          </p>
        ) : items.length === 0 ? (
          <p
            className={cn(
              "col-span-full py-6 text-center text-sm",
              classic ? "text-slate-600" : "text-white/50"
            )}
          >
            Nenhuma legenda salva ainda. Gere uma legenda com a IA para ela aparecer aqui.
          </p>
        ) : (
          items.map((m) => (
            <div
              key={m.id}
              className={cn(
                "rounded-2xl border p-4 backdrop-blur-xl transition-colors duration-300",
                classic ? "border-slate-200 bg-white text-slate-900" : "border-white/10 bg-black/35"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p
                    className={cn(
                      "text-xs font-semibold transition-colors duration-300 dark:font-black dark:text-white",
                      classic ? "text-slate-900" : "text-white"
                    )}
                  >
                    {m.title}
                  </p>
                  <p
                    className={cn(
                      "mt-1 text-[11px] transition-colors duration-300",
                      classic ? "text-slate-600" : "text-white/45"
                    )}
                  >
                    {m.day} • {m.time}
                  </p>
                </div>
                <div
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold",
                    m.status === "agendado"
                      ? classic
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                        : "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
                      : classic
                        ? "border-slate-200 bg-slate-50 text-slate-600"
                        : "border-white/10 bg-black/50 text-white/55"
                  )}
                >
                  {m.status === "agendado" ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : (
                    <Clock className="h-3.5 w-3.5" />
                  )}
                  {m.status === "agendado" ? "Agendado" : "Gerado"}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </GlassCard>
  )
}
