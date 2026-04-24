"use client"

import { Zap, Bell, User, Settings, CreditCard, LogOut } from "lucide-react"
import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/theme-toggle"
import { useConfigEmpresa, configPadrao } from "@/lib/config-empresa"
import { useLojaAtiva } from "@/lib/loja-ativa"
import { APP_DISPLAY_NAME } from "@/lib/app-brand"
import { LEGACY_PRIMARY_STORE_ID } from "@/lib/store-defaults"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"
import { formatLojaPublicLabel } from "@/lib/store-display-name"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

export function Header() {
  const { config } = useConfigEmpresa()
  const { empresaDocumentos, lojas, lojaAtivaId, setLojaAtivaId, storesRefreshNonce } = useLojaAtiva()
  const [storesRemote, setStoresRemote] = useState<Array<{ id: string; name: string; cnpj: string }>>([])

  const logoUrl = empresaDocumentos.identidadeVisual.logoUrl || config.empresa.identidadeVisual.logoUrl

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const r = await fetch("/api/stores", { credentials: "include", cache: "no-store" })
        const j = (await r.json().catch(() => null)) as
          | { stores?: Array<{ id?: string; name?: string; cnpj?: string }> }
          | null
        const list = Array.isArray(j?.stores) ? j!.stores : []
        const mapped = list.map((s) => ({
          id: String(s.id || "").trim() || LEGACY_PRIMARY_STORE_ID,
          name: String(s.name || "").trim(),
          cnpj: String(s.cnpj || "").trim(),
        }))
        if (!cancelled) setStoresRemote(mapped)
      } catch {
        if (!cancelled) setStoresRemote([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [storesRefreshNonce])

  const effectiveStores = storesRemote.length ? storesRemote : lojas.map((l) => ({ id: l.id, name: l.nomeFantasia, cnpj: l.cnpj }))
  const lojaIdAtual = (lojaAtivaId || effectiveStores[0]?.id || LEGACY_PRIMARY_STORE_ID).trim()
  const lojaLinha = effectiveStores.find((l) => l.id === lojaIdAtual)

  const labelStore = (s: { id: string; name: string; cnpj: string }, index: number) => {
    const n = (s.name || "").trim()
    const c = (s.cnpj || "").trim()
    const base = /^loja-(\d+)$/i.test(s.id) ? formatLojaPublicLabel(s.id) : `Loja ${index + 1}`
    if (n) return `${base} - ${n}`
    if (c) return `${base} - ${c}`
    return base
  }

  const tituloMarca = useMemo(() => {
    if (effectiveStores.length === 0) {
      return (empresaDocumentos.nomeFantasia || "").trim() || configPadrao.empresa.nomeFantasia
    }
    const idx = Math.max(0, effectiveStores.findIndex((s) => s.id === lojaIdAtual))
    return lojaLinha ? labelStore(lojaLinha, idx) : labelStore({ id: lojaIdAtual, name: "", cnpj: "" }, idx)
  }, [effectiveStores, empresaDocumentos.nomeFantasia, lojaIdAtual, lojaLinha])

  const perfilSubtitulo =
    (empresaDocumentos.nomeFantasia || config.empresa.nomeFantasia || "").trim() || tituloMarca

  const handleSair = async () => {
    try {
      await fetch("/api/auth/admin", { method: "DELETE", credentials: "include" })
    } catch {
      /* segue para login mesmo se a sessão já tiver expirado */
    }
    window.location.href = "/login-admin"
  }

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
        {effectiveStores.length >= 2 ? (
          <div className="hidden md:block">
            <Select
              value={lojaAtivaId ?? effectiveStores[0]?.id ?? LEGACY_PRIMARY_STORE_ID}
              onValueChange={(v) => {
                if (v === "__new_store__") {
                  window.location.href = "/?page=config-multilojas"
                  return
                }
                setLojaAtivaId(v)
              }}
            >
              <SelectTrigger className="h-9 w-[min(18rem,calc(100vw-12rem))] max-w-[280px] bg-background border-border">
                <div className="flex items-center gap-2 min-w-0 flex-1 text-left">
                  <span className="truncate font-medium">
                    {(() => {
                      const idx = Math.max(0, effectiveStores.findIndex((s) => s.id === lojaIdAtual))
                      const s = lojaLinha ?? { id: lojaIdAtual, name: "", cnpj: "" }
                      return labelStore(s, idx)
                    })()}
                  </span>
                </div>
              </SelectTrigger>
              <SelectContent>
                {effectiveStores.map((l, idx) => {
                  const nome = labelStore(l, idx)
                  return (
                    <SelectItem key={l.id} value={l.id} textValue={nome}>
                      <span className="truncate font-medium">{nome}</span>
                    </SelectItem>
                  )
                })}
                <SelectItem value="__new_store__" textValue="Cadastrar nova loja">
                  <span className="font-semibold text-primary">+ Cadastrar Nova Loja</span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <ThemeToggle />
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="relative" type="button" aria-label="Notificações">
              <Bell className="w-5 h-5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-0" align="end">
            <div className="border-b border-border px-3 py-2">
              <p className="text-sm font-semibold text-foreground">Notificações</p>
            </div>
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              Você não tem novas notificações no momento.
            </div>
          </PopoverContent>
        </Popover>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" type="button" aria-label="Menu do perfil">
              <User className="w-5 h-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="end">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold text-foreground">Administrador</span>
                <span className="text-xs text-muted-foreground truncate" title={perfilSubtitulo}>
                  {perfilSubtitulo}
                </span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/?page=config-empresa" className="cursor-pointer">
                <Settings className="mr-2 h-4 w-4" />
                Configurações
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/meu-plano" className="cursor-pointer">
                <CreditCard className="mr-2 h-4 w-4" />
                Meu Plano
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="cursor-pointer text-destructive focus:text-destructive"
              onSelect={(e) => {
                e.preventDefault()
                void handleSair()
              }}
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sair do Sistema
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
