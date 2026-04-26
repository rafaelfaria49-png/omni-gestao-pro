"use client"

import { 
  Home, 
  LayoutDashboard,
  ShoppingCart, 
  FileText, 
  ClipboardList, 
  Bot,
  Sparkles,
  Package, 
  Wallet, 
  Users, 
  BarChart3, 
  Settings,
  Store,
  Zap,
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
  Calculator,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { APP_DISPLAY_NAME } from "@/lib/app-brand"
import { useEffect, useState } from "react"
import { useConfigEmpresa } from "@/lib/config-empresa"
import { useLojaAtiva } from "@/lib/loja-ativa"
import { useStoreSettings } from "@/lib/store-settings-provider"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"
import {
  nomeFantasiaOuFallbackUnidadePorOrdem,
} from "@/lib/store-display-name"
import { usePerfilLoja } from "@/lib/perfil-loja-provider"
import type { UserRole } from "@/types"
import { useStudioTheme } from "@/components/theme/ThemeProvider"
import { useStaffAccess } from "@/components/auth/AccessGate"

const ROLE_CACHE_KEY = "assistec-admin-role-cache-v1"

type SubMenuItem = { 
  label: string
  href: string
  page?: string
  /** Se definido, navega para esta URL (ex.: área isolada). */
  externalPath?: string
}

type MenuItem = {
  icon: React.ElementType
  label: string
  href: string
  page?: string
  externalPath?: string
  submenu?: SubMenuItem[]
}

const menuItems: MenuItem[] = [
  { icon: Sparkles, label: "IA Mestre", href: "#", externalPath: "/dashboard/ia-mestre" },
  { icon: Bot, label: "Marketing IA", href: "#", externalPath: "/dashboard/marketing" },
  { icon: LayoutDashboard, label: "Painel inicial", href: "#", page: "dashboard-omni", externalPath: "/dashboard" },
  { icon: FileText, label: "Orçamentos", href: "#", page: "orcamentos" },
  {
    icon: ShoppingCart,
    label: "Vendas",
    href: "#",
    submenu: [
      { label: "PDV / Caixa", href: "#", page: "vendas", externalPath: "/dashboard/vendas" },
      { label: "Histórico de Vendas", href: "#", page: "vendas-arquivo" },
      { label: "Controle de Consumo (mesas)", href: "#", page: "controle-consumo" },
      { label: "Trocas e devolução", href: "#", page: "trocas" },
    ],
  },
  {
    icon: ClipboardList,
    label: "Ordens de Serviço",
    href: "#",
    submenu: [
      { label: "Painel integrado", href: "#", page: "os", externalPath: "/dashboard/os" },
    ],
  },
  { 
    icon: Package, 
    label: "Estoque", 
    href: "#",
    submenu: [
      { label: "Produtos", href: "#", page: "produtos" },
      { label: "Serviços", href: "#", page: "servicos" },
      { label: "Planejamento de Compras", href: "#", page: "planejamento-compras" },
    ]
  },
  { 
    icon: Wallet, 
    label: "Financeiro", 
    href: "#",
    submenu: [
      { label: "Carteiras", href: "#", page: "carteiras" },
      { label: "Fluxo de Caixa", href: "#", page: "fluxo-caixa" },
      { label: "Contas a Pagar", href: "#", page: "contas-pagar" },
      { label: "Contas a Receber", href: "#", page: "contas-receber" },
      { label: "Relatórios Financeiros", href: "#", page: "relatorios-financeiros" },
      { label: "Área do Contador", href: "#", externalPath: "/contador" },
    ]
  },
  { 
    icon: Users, 
    label: "Clientes", 
    href: "#",
    submenu: [
      { label: "Gestão de Clientes", href: "#", page: "clientes-gestao", externalPath: "/dashboard/clientes" },
      { label: "Cadastro de Clientes", href: "#", page: "clientes" },
      { label: "Consulta de Crédito", href: "#", page: "credito" },
    ]
  },
  {
    icon: BarChart3,
    label: "Relatórios",
    href: "#",
    submenu: [
      { label: "Relatórios gerenciais", href: "#", page: "relatorios" },
      { label: "Dashboard 360", href: "#", page: "dashboard-360" },
    ],
  },
  {
    icon: Store,
    label: "Gestão da Rede",
    href: "#",
    submenu: [{ label: "Gestão de Unidades", href: "#", page: "config-multilojas" }],
  },
  { 
    icon: Settings, 
    label: "Configurações", 
    href: "#",
    submenu: [
      { label: "Dados da Empresa", href: "#", page: "config-empresa" },
      { label: "Ajustes", href: "#", page: "config-ajustes" },
      { label: "Financeiro (cartões)", href: "#", page: "config-pdv" },
      { label: "Marca/Logo", href: "#", page: "config-marca" },
      { label: "Certificado Digital", href: "#", page: "config-certificado" },
      { label: "Termos de Garantia", href: "#", page: "config-garantia" },
      { label: "Backup", href: "#", page: "config-backup" },
      { label: "Conexão WhatsApp", href: "#", page: "whatsapp" },
      { label: "Meu Plano", href: "#", page: "plano" },
      { label: "Suporte", href: "#", page: "suporte" },
    ]
  },
]

interface SidebarProps {
  onNavigate?: (page: string) => void
  currentPage?: string
  collapsed?: boolean
  onToggleCollapse?: () => void
}

export function Sidebar({ onNavigate, currentPage = "dashboard", collapsed = false, onToggleCollapse }: SidebarProps) {
  const staffRole = useStaffAccess()
  const { mode } = useStudioTheme()
  const classic = mode === "classic"
  const { config } = useConfigEmpresa()
  const { lojas, lojaAtivaId, setLojaAtivaId, cadastroBasicoIncompleto } = useLojaAtiva()
  const { pdvParams } = useStoreSettings()
  const { perfilLoja } = usePerfilLoja()
  const [caixaPerms, setCaixaPerms] = useState<{ permitirFinanceiro: boolean; permitirEstoque: boolean; permitirMarketingIA: boolean }>({
    permitirFinanceiro: false,
    permitirEstoque: false,
    permitirMarketingIA: false,
  })
  const [role, setRole] = useState<UserRole>(() => {
    try {
      const raw = String(localStorage.getItem(ROLE_CACHE_KEY) || "").trim()
      return raw === "ADMIN" ? "ADMIN" : "CAIXA"
    } catch {
      return "CAIXA"
    }
  })
  // UX: iniciar recolhido e deixar o usuário abrir o que quiser.
  const [openMenus, setOpenMenus] = useState<string[]>([])
  const isBronze = config.assinatura.plano === "bronze"
  const hideOsMenus = perfilLoja === "variedades" || perfilLoja === "supermercado"

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const r = await fetch("/api/auth/admin", { method: "GET", credentials: "include", cache: "no-store" })
        const j = (await r.json().catch(() => null)) as { authenticated?: boolean }
        // Importante: se a API falhar (503/transiente), NÃO derrubar ADMIN para CAIXA.
        if (!r.ok || !j) return
        if (cancelled) return
        const next: UserRole = j.authenticated === true ? "ADMIN" : "CAIXA"
        setRole(next)
        try {
          localStorage.setItem(ROLE_CACHE_KEY, next)
        } catch {
          /* ignore */
        }
      } catch {
        // Falha de rede/servidor: manter o último role conhecido (evita “fim de sessão” falso-positivo).
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (role !== "CAIXA") return
    const id = String(lojaAtivaId || "").trim()
    if (!id) return
    let cancelled = false
    void (async () => {
      try {
        const r = await fetch(`/api/stores/${encodeURIComponent(id)}/settings`, { credentials: "include", cache: "no-store" })
        const j = (await r.json().catch(() => null)) as { settings?: any } | null
        if (!r.ok || !j?.settings) return
        const pc = j.settings?.printerConfig && typeof j.settings.printerConfig === "object" ? j.settings.printerConfig : {}
        const p = (pc as any)?.permissionsCaixa
        const next = {
          permitirFinanceiro: p?.permitirFinanceiro === true,
          permitirEstoque: p?.permitirEstoque === true,
          permitirMarketingIA: p?.permitirMarketingIA === true,
        }
        if (!cancelled) setCaixaPerms(next)
      } catch {
        // fallback: mantém tudo bloqueado
      }
    })()
    return () => {
      cancelled = true
    }
  }, [lojaAtivaId, role])

  const visibleItems = menuItems
    .filter((item) => {
      if (staffRole === "VENDEDOR" && (item.label === "Financeiro" || item.label === "Configurações")) return false
      if (role !== "CAIXA") return true
      if (item.label === "Painel inicial") return true
      if (item.label === "Vendas") return true
      if (item.label === "Financeiro") return caixaPerms.permitirFinanceiro === true
      if (item.label === "Estoque") return caixaPerms.permitirEstoque === true
      if (item.label === "Marketing IA") return caixaPerms.permitirMarketingIA === true
      return false
    })
    .map((item) => {
    if (!item.submenu) return item
    if (hideOsMenus && item.label === "Ordens de Serviço") {
      return { ...item, submenu: [] }
    }
    if (item.label === "Clientes") {
      return {
        ...item,
        submenu: item.submenu.filter((s) => (isBronze ? s.page !== "credito" : true)),
      }
    }
    if (item.label === "Configurações") {
      return {
        ...item,
        submenu: item.submenu.filter((s) => (isBronze ? s.page !== "config-multilojas" : true)),
      }
    }
    if (item.label === "Gestão da Rede") {
      return {
        ...item,
        submenu: item.submenu.filter((s) => (isBronze ? s.page !== "config-multilojas" : true)),
      }
    }
    if (item.label === "Vendas") {
      return {
        ...item,
        submenu: item.submenu?.filter(
          (s) => (s.page === "controle-consumo" ? pdvParams.moduloControleConsumo === true : true)
        ),
      }
    }
    return item
  })
  .filter((it) => !(hideOsMenus && it.label === "Ordens de Serviço"))

  const toggleSubmenu = (label: string) => {
    setOpenMenus(prev => 
      prev.includes(label) 
        ? prev.filter(item => item !== label)
        : [...prev, label]
    )
  }

  const handleNavigation = (page?: string, externalPath?: string) => {
    if (externalPath) {
      window.location.href = externalPath
      return
    }
    if (page && onNavigate) {
      onNavigate(page)
    }
  }

  const isActive = (page?: string) => page === currentPage

  return (
    <aside
      className={cn(
        "hidden lg:flex flex-col border-r backdrop-blur-xl transition-all duration-300 ease-out",
        classic
          ? "border-slate-200 bg-slate-50"
          : "border-white/10 bg-[#000000]",
        collapsed ? "w-20" : "w-64"
      )}
    >
      <div
        className={cn(
          "flex items-center border-b transition-colors duration-300",
          classic ? "border-slate-200" : "border-white/10",
          collapsed ? "justify-center p-3" : "justify-between p-4"
        )}
      >
        <div className={cn("flex items-center gap-3", collapsed && "justify-center")}>
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary">
            <Zap className="w-5 h-5 text-primary-foreground" />
          </div>
          {!collapsed && (
            <div>
              <h1
                className={cn(
                  "text-lg font-bold transition-colors duration-300",
                  classic ? "text-slate-900" : "text-sidebar-foreground"
                )}
              >
                {APP_DISPLAY_NAME}
              </h1>
              <p
                className={cn(
                  "text-xs transition-colors duration-300",
                  classic ? "text-slate-600" : "text-white/55"
                )}
              >
                ERP · gestão empresarial
              </p>
            </div>
          )}
        </div>
        {!collapsed && (
          <button
            onClick={onToggleCollapse}
            className={cn(
              "p-2 rounded-md transition-colors duration-300",
              classic ? "text-slate-800 hover:bg-slate-100" : "hover:bg-sidebar-accent text-sidebar-foreground"
            )}
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        )}
        {collapsed && (
          <button
            onClick={onToggleCollapse}
            className={cn(
              "absolute top-4 right-2 p-1 rounded-md transition-colors duration-300",
              classic ? "text-slate-800 hover:bg-slate-100" : "hover:bg-sidebar-accent text-sidebar-foreground"
            )}
          >
            <PanelLeftOpen className="w-4 h-4" />
          </button>
        )}
      </div>

      {!collapsed && lojas.length >= 2 && (
        <div
          className={cn(
            "px-4 pb-3 border-b transition-colors duration-300",
            classic ? "border-slate-200" : "border-white/10"
          )}
        >
          <p
            className={cn(
              "text-xs mb-1.5 transition-colors duration-300",
              classic ? "text-slate-600" : "text-white/55"
            )}
          >
            Unidade ativa
          </p>
          <Select
            value={lojaAtivaId ?? lojas[0]?.id ?? ""}
            onValueChange={(v) => setLojaAtivaId(v)}
          >
            <SelectTrigger
              className={cn(
                "w-full h-9 transition-colors duration-300",
                classic
                  ? "border-slate-200 bg-white text-slate-900"
                  : "bg-sidebar-accent/30 border-sidebar-border"
              )}
            >
              {(() => {
                const id = (lojaAtivaId ?? lojas[0]?.id ?? "").trim()
                const linha = lojas.find((x) => x.id === id)
                const idx = linha ? lojas.findIndex((x) => x.id === linha.id) : null
                const nome = linha ? nomeFantasiaOuFallbackUnidadePorOrdem(linha.id, linha.nomeFantasia, idx) : "Unidade"
                return (
                  <div className="flex items-center gap-2 min-w-0 flex-1 text-left">
                    <span
                      className={cn(
                        "truncate text-sm font-medium transition-colors duration-300",
                        classic ? "text-slate-900" : "text-sidebar-foreground"
                      )}
                    >
                      {nome}
                    </span>
                  </div>
                )
              })()}
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
      )}
      
      <nav className="flex-1 p-4 overflow-y-auto min-h-0">
        <ul className="space-y-1">
          {visibleItems.map((item) => (
            <li key={item.label}>
              {item.submenu ? (
                <div>
                  <button
                    onClick={() => toggleSubmenu(item.label)}
                    className={cn(
                      "flex items-center justify-between w-full px-4 py-3 rounded-lg text-sm font-medium transition-colors duration-300",
                      classic
                        ? "border border-slate-200 bg-slate-50 text-slate-800 hover:bg-slate-100"
                        : "border border-white/10 bg-white/5 text-white/85 hover:bg-white/10"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <item.icon className="w-5 h-5" />
                      {!collapsed && item.label}
                    </div>
                    {!collapsed && <ChevronDown 
                      className={cn(
                        "w-4 h-4 transition-transform duration-200",
                        openMenus.includes(item.label) && "rotate-180"
                      )} 
                    />}
                  </button>
                  <ul className={cn(
                    "overflow-hidden transition-all duration-200",
                    openMenus.includes(item.label) ? "max-h-[min(28rem,75vh)] mt-1" : "max-h-0"
                  )}>
                    {item.submenu.map((subitem) => (
                      <li key={subitem.label}>
                        <button
                          onClick={() => handleNavigation(subitem.page, subitem.externalPath)}
                          className={cn(
                            "flex items-center gap-3 w-full text-left px-4 py-2 pl-12 rounded-lg text-sm transition-colors duration-300",
                            collapsed && "hidden",
                            isActive(subitem.page)
                              ? classic
                                ? "bg-slate-900 text-white font-semibold"
                                : "bg-white/10 text-white font-semibold"
                              : classic
                                ? "bg-white text-slate-700 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"
                                : "bg-white/5 text-white/75 hover:bg-white/10 hover:text-white disabled:opacity-50"
                          )}
                        >
                          {subitem.externalPath ? (
                            <>
                              <Calculator className="w-4 h-4 shrink-0 opacity-70" />
                              {subitem.label}
                            </>
                          ) : (
                            subitem.label
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <button
                  onClick={() => handleNavigation(item.page, item.externalPath)}
                  className={cn(
                    "flex items-center gap-3 w-full px-4 py-3 rounded-lg text-sm font-medium transition-colors duration-300",
                    collapsed && "justify-center",
                    isActive(item.page)
                      ? classic
                        ? "bg-slate-900 text-white"
                        : "bg-white/10 text-white"
                      : classic
                        ? "border border-slate-200 bg-white text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                        : "border border-white/10 bg-white/5 text-white/80 hover:bg-white/10 disabled:opacity-50"
                  )}
                >
                  <item.icon className="w-5 h-5" />
                  {!collapsed && item.label}
                </button>
              )}
            </li>
          ))}
        </ul>
      </nav>
      
      <div
        className={cn(
          "p-4 border-t transition-colors duration-300",
          classic ? "border-slate-200" : "border-sidebar-border"
        )}
      >
        <div
          className={cn(
            "flex items-center gap-3 px-4 py-3 rounded-lg transition-colors duration-300",
            classic ? "bg-slate-50" : "bg-secondary/50",
            collapsed && "justify-center px-2"
          )}
        >
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-sm font-bold">
            A
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p
                className={cn(
                  "text-sm font-medium truncate transition-colors duration-300",
                  classic ? "text-slate-900" : "text-sidebar-foreground"
                )}
              >
                Admin
              </p>
              <p
                className={cn(
                  "text-xs truncate transition-colors duration-300",
                  classic ? "text-slate-600" : "text-white/55"
                )}
              >
                admin@seudominio.com
              </p>
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
