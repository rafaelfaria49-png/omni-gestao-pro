"use client"

import { GestaoUnidadesSaas } from "@/components/dashboard/configuracoes/gestao-unidades-saas"
import { useStudioTheme } from "@/components/theme/ThemeProvider"
import { cn } from "@/lib/utils"

/**
 * Rota dedicada à gestão de unidades (paridade com a página `/?page=config-multilojas`).
 * A UI (cards, sem seletor em barra) está em `GestaoUnidadesSaas`.
 */
export default function DashboardUnidadesPage() {
  const { mode } = useStudioTheme()
  const isBlack = mode === "black"

  return (
    <div className="mx-auto w-full max-w-6xl p-4 lg:p-6">
      <div className="mb-6">
        <h1 className={cn("text-2xl font-bold", isBlack ? "text-white" : "text-foreground")}>Gestão da Rede</h1>
        <p className={cn("text-sm", isBlack ? "text-white/65" : "text-slate-600")}>
          Adicione e gerencie unidades (Loja 1, Loja 2...) e o perfil de cada uma
        </p>
      </div>
      <GestaoUnidadesSaas />
    </div>
  )
}
