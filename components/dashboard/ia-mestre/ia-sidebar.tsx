"use client"

import { Sparkles, FolderOpen, Wand2, Image, BrainCircuit, Settings, Zap } from "lucide-react"
import { cn } from "@/lib/utils"
import { Progress } from "@/components/ui/progress"

const navItems = [
  { name: "Meus Projetos", icon: FolderOpen, href: "#", active: true },
  { name: "Templates Mágicos", icon: Wand2, href: "#" },
  { name: "Gerador de Imagens", icon: Image, href: "#" },
  { name: "Treinar IA", icon: BrainCircuit, href: "#" },
  { name: "Configurações", icon: Settings, href: "#" },
]

export function IaSidebar() {
  const creditsUsed = 2450
  const creditsTotal = 5000
  const creditsPercentage = (creditsUsed / creditsTotal) * 100

  return (
    <aside className="flex h-full w-64 flex-col border-r border-white/5 bg-black/40 backdrop-blur-xl">
      <div className="flex items-center gap-3 px-5 py-6">
        <div className="relative flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-blue-500 to-cyan-500 shadow-lg shadow-blue-500/25">
          <Sparkles className="h-6 w-6 text-white" />
        </div>
        <div className="flex flex-col">
          <span className="text-lg font-bold tracking-tight text-foreground">IA Mestre</span>
          <span className="text-xs text-muted-foreground">Enterprise</span>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3">
        {navItems.map((item) => (
          <a
            key={item.name}
            href={item.href}
            className={cn(
              "group flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium transition-all duration-200",
              item.active
                ? "border border-blue-500/25 bg-blue-500/10 text-cyan-100 shadow-sm shadow-blue-950/40"
                : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )}
          >
            <item.icon
              className={cn(
                "h-5 w-5 transition-colors",
                item.active ? "text-cyan-300" : "text-muted-foreground group-hover:text-foreground"
              )}
            />
            {item.name}
          </a>
        ))}
      </nav>

      <div className="mx-3 mb-4 rounded-2xl border border-border bg-card/60 p-4 backdrop-blur-sm">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/20">
              <Zap className="h-4 w-4 text-amber-500" />
            </div>
            <span className="text-sm font-semibold text-foreground">Créditos</span>
          </div>
        </div>
        <Progress value={creditsPercentage} className="mb-3 h-2 bg-muted [&>div]:bg-amber-500" />
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            <span className="font-bold text-foreground">{creditsUsed.toLocaleString("pt-BR")}</span>
            {" / "}
            {creditsTotal.toLocaleString("pt-BR")}
          </p>
          <span className="text-xs font-medium text-amber-500">{creditsPercentage.toFixed(0)}%</span>
        </div>
      </div>
    </aside>
  )
}

