"use client"

import { Zap, Bell, User } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/theme-toggle"
import { useConfigEmpresa, configPadrao } from "@/lib/config-empresa"
import { useLojaAtiva } from "@/lib/loja-ativa"
import { APP_DISPLAY_NAME } from "@/lib/app-brand"
import { LEGACY_PRIMARY_STORE_ID } from "@/lib/store-defaults"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"
import {
  nomeFantasiaOuFallbackUnidadePorOrdem,
} from "@/lib/store-display-name"

export function Header() {
  const { config } = useConfigEmpresa()
  const { empresaDocumentos, lojas, lojaAtivaId, setLojaAtivaId } = useLojaAtiva()

  const logoUrl = empresaDocumentos.identidadeVisual.logoUrl || config.empresa.identidadeVisual.logoUrl

  const lojaIdAtual = (lojaAtivaId || lojas[0]?.id || LEGACY_PRIMARY_STORE_ID).trim()
  const lojaLinha = lojas.find((l) => l.id === lojaIdAtual)
  const lojaIndexAtual = lojaLinha ? lojas.findIndex((l) => l.id === lojaLinha.id) : null
  /** Regra única: "Loja X - Nome" (nunca perfil como nome). PDV e demais telas usam o mesmo cabeçalho. */
  const tituloMarca =
    lojas.length > 0
      ? nomeFantasiaOuFallbackUnidadePorOrdem(lojaIdAtual, lojaLinha?.nomeFantasia ?? "", lojaIndexAtual)
      : (empresaDocumentos.nomeFantasia || "").trim() || configPadrao.empresa.nomeFantasia

  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
      <div className="flex items-center gap-3 min-w-0">
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={`Logo ${tituloMarca}`}
            className="w-10 h-10 shrink-0 rounded-lg object-contain bg-card border border-border p-1"
          />
        ) : (
          <div className="flex shrink-0 items-center justify-center w-10 h-10 rounded-lg bg-primary">
            <Zap className="w-5 h-5 text-primary-foreground" />
          </div>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-foreground tracking-tight truncate">{tituloMarca}</h1>
          </div>
          <p className="text-xs text-muted-foreground">{APP_DISPLAY_NAME} · ERP</p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {lojas.length >= 2 ? (
          <div className="hidden md:block">
            <Select value={lojaAtivaId ?? lojas[0]?.id ?? LEGACY_PRIMARY_STORE_ID} onValueChange={(v) => setLojaAtivaId(v)}>
              <SelectTrigger className="h-9 w-[min(18rem,calc(100vw-12rem))] max-w-[280px] bg-background border-border">
                <div className="flex items-center gap-2 min-w-0 flex-1 text-left">
                  <span className="truncate font-medium">
                    {nomeFantasiaOuFallbackUnidadePorOrdem(lojaIdAtual, lojaLinha?.nomeFantasia ?? "", lojaIndexAtual)}
                  </span>
                </div>
              </SelectTrigger>
              <SelectContent>
                {lojas.map((l) => {
                  const idx = lojas.findIndex((x) => x.id === l.id)
                  const nome = nomeFantasiaOuFallbackUnidadePorOrdem(l.id, l.nomeFantasia, idx)
                  return (
                    <SelectItem key={l.id} value={l.id} textValue={nome}>
                      <span className="truncate font-medium">{nome}</span>
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>
        ) : null}
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
