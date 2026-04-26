"use client"

import { VendasPDV } from "@/components/dashboard/vendas/vendas-pdv"
import { useLojaAtiva } from "@/lib/loja-ativa"
import { useStudioTheme } from "@/components/theme/ThemeProvider"
import { cn } from "@/lib/utils"

/** PDV dedicado: layout Classic vs Services e Classic vs Supermercado vêm de Configurações + `StoreSettings`. */
export default function DashboardVendasPage() {
  const { mode } = useStudioTheme()
  const classic = mode === "classic"

  return (
    <div
      className={cn(
        "flex min-h-[min(100dvh,100vh)] min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden transition-colors duration-300",
        classic ? "bg-slate-50" : "bg-[#000000]"
      )}
    >
      <VendasPDV />
    </div>
  )
}
