"use client"

import { Zap, Bell, User } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/theme-toggle"
import { useConfigEmpresa, configPadrao } from "@/lib/config-empresa"
import { useLojaAtiva } from "@/lib/loja-ativa"
import { APP_DISPLAY_NAME } from "@/lib/app-brand"

export function Header() {
  const { config } = useConfigEmpresa()
  const { empresaDocumentos } = useLojaAtiva()
  const nomeEmpresa = (empresaDocumentos.nomeFantasia || "").trim() || configPadrao.empresa.nomeFantasia
  const logoUrl = empresaDocumentos.identidadeVisual.logoUrl || config.empresa.identidadeVisual.logoUrl

  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
      <div className="flex items-center gap-3">
        {logoUrl ? (
          <img src={logoUrl} alt={`Logo ${nomeEmpresa}`} className="w-10 h-10 rounded-lg object-contain bg-card border border-border p-1" />
        ) : (
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary">
            <Zap className="w-5 h-5 text-primary-foreground" />
          </div>
        )}
        <div>
          <h1 className="text-xl font-bold text-foreground tracking-tight">{nomeEmpresa}</h1>
          <p className="text-xs text-muted-foreground">{APP_DISPLAY_NAME} · ERP</p>
        </div>
      </div>
      
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="w-5 h-5" />
          <span className="absolute top-1 right-1 w-2 h-2 bg-primary rounded-full" />
        </Button>
        <Button variant="ghost" size="icon">
          <User className="w-5 h-5" />
        </Button>
      </div>
    </header>
  )
}
