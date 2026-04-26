"use client"

import { Battery, Camera, Smartphone, Volume2, Wifi } from "lucide-react"
import { useStudioTheme } from "@/components/theme/ThemeProvider"
import { cn } from "@/lib/utils"
import {
  type EntradaComponentId,
  type EntradaEstado,
  ENTRADA_COMPONENT_IDS,
  ENTRADA_LABELS,
  cycleEntradaEstado,
  mergeEntradaRapida,
} from "@/lib/os-entrada-checklist"

const ICONS: Record<EntradaComponentId, typeof Smartphone> = {
  tela: Smartphone,
  bateria: Battery,
  wifi: Wifi,
  camera: Camera,
  som: Volume2,
}

type Props = {
  value: Partial<Record<EntradaComponentId, EntradaEstado>> | undefined
  onChange: (next: Record<EntradaComponentId, EntradaEstado>) => void
  disabled?: boolean
}

export function OsEntradaRapidaGrid({ value, onChange, disabled }: Props) {
  const { mode } = useStudioTheme()
  const isBlack = mode === "black"
  const merged = mergeEntradaRapida(value)

  const chip = (estado: EntradaEstado) => {
    if (isBlack) {
      if (estado === "ok")
        return "border-emerald-400/50 bg-emerald-500/10 text-emerald-300 shadow-[0_0_18px_rgba(52,211,153,0.35)]"
      if (estado === "defeito")
        return "border-rose-400/50 bg-rose-500/10 text-rose-300 shadow-[0_0_18px_rgba(251,113,133,0.35)]"
      return "border-white/15 bg-black/60 text-white/50 shadow-[0_0_12px_rgba(148,163,184,0.12)]"
    }
    if (estado === "ok") return "border-emerald-200 bg-emerald-50 text-emerald-800"
    if (estado === "defeito") return "border-rose-200 bg-rose-50 text-rose-800"
    return "border-slate-200 bg-slate-100 text-slate-500"
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className={cn("text-sm font-semibold", isBlack ? "text-white" : "text-foreground")}>
          Checklist de entrada rápido
        </h3>
        <p className={cn("mt-0.5 text-xs", isBlack ? "text-white/50" : "text-muted-foreground")}>
          Toque em cada ícone para alternar: não testado → OK → defeito. Aparece resumido no PDV ao gerar venda da
          O.S.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {ENTRADA_COMPONENT_IDS.map((id) => {
          const estado = merged[id]
          const Icon = ICONS[id]
          return (
            <button
              key={id}
              type="button"
              disabled={disabled}
              onClick={() => {
                const next = { ...merged, [id]: cycleEntradaEstado(estado) }
                onChange(next)
              }}
              className={cn(
                "flex flex-col items-center justify-center gap-2 rounded-2xl border-2 p-3 transition-all duration-200",
                chip(estado),
                disabled ? "pointer-events-none opacity-50" : "cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
              )}
            >
              <Icon
                className={cn(
                  "h-7 w-7",
                  estado === "nao_testado" && isBlack && "opacity-80",
                  estado === "nao_testado" && !isBlack && "opacity-70"
                )}
                strokeWidth={isBlack ? 2.2 : 2}
              />
              <span className="text-center text-[11px] font-semibold leading-tight">{ENTRADA_LABELS[id]}</span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide",
                  estado === "ok"
                    ? isBlack
                      ? "bg-emerald-500/20 text-emerald-200"
                      : "bg-emerald-200/80 text-emerald-900"
                    : estado === "defeito"
                      ? isBlack
                        ? "bg-rose-500/20 text-rose-200"
                        : "bg-rose-200/80 text-rose-900"
                      : isBlack
                        ? "bg-white/10 text-white/55"
                        : "bg-slate-200/80 text-slate-600"
                )}
              >
                {estado === "ok" ? "OK" : estado === "defeito" ? "Defeito" : "—"}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
