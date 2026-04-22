"use client"

import { 
  Home, 
  LayoutDashboard,
  ShoppingCart, 
  FileText, 
  ClipboardList, 
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
import { useState } from "react"
import { useConfigEmpresa } from "@/lib/config-empresa"
import { useLojaAtiva } from "@/lib/loja-ativa"
import { useStoreSettings } from "@/lib/store-settings-provider"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"
import {
  nomeFantasiaOuFallbackUnidadePorOrdem,
} from "@/lib/store-display-name"
import { usePerfilLoja } from "@/lib/perfil-loja-provider"

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
  { icon: LayoutDashboard, label: "Painel inicial", href: "#", page: "dashboard-omni", externalPath: "/dashboard" },
  { icon: Home, label: "Início", href: "#", page: "dashboard" },
  { icon: FileText, label: "Orçamentos", href: "#", page: "orcamentos" },
  {
    icon: ShoppingCart,
    label: "Vendas",
    href: "#",
    submenu: [
      { label: "PDV / Caixa", href: "#", page: "vendas" },
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
      { label: "Gestão de OS", href: "#", page: "os-gestao", externalPath: "/dashboard/os" },
      { label: "Painel integrado", href: "#", page: "os" },
    ],
  },
  { 
    icon: Package, 
    label: "Estoque", 
    href: "#",
    submenu: [
      { label: "Gestão de Estoque", href: "#", page: "estoque-gestao", externalPath: "/dashboard/estoque" },
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
      { label: "Logs do Sistema", href: "#", page: "logs-sistema" },
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
  const { config } = useConfigEmpresa()
  const { lojas, lojaAtivaId, setLojaAtivaId, cadastroBasicoIncompleto } = useLojaAtiva()
  const { pdvParams } = useStoreSettings()
  const { perfilLoja } = usePerfilLoja()
  const [openMenus, setOpenMenus] = useState<string[]>([
    "Configurações",
    "Gestão da Rede",
    "Vendas",
    "Clientes",
    "Estoque",
    "Ordens de Serviço",
    "Relatórios",
  ])
  const isBronze = config.assinatura.plano === "bronze"
  const hideOsMenus = perfilLoja === "variedades" || perfilLoja === "supermercado"

  const visibleItems = menuItems.map((item) => {
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
  }).filter((it) => !(hideOsMenus && it.label === "Ordens de Serviço"))

  const toggleSubmenu = (label: string) => {
    setOpenMenus(prev => 
      prev.includes(label) 
        ? prev.filter(item => item !== label)
        : [...prev, label]
    )
  }

  const handleNavigation = (page?: string, externalPath?: string) => {
    if (page && cadastroBasicoIncompleto) {
      const blocked = new Set([
        "vendas",
        "carteiras",
        "fluxo-caixa",
        "contas-pagar",
        "contas-receber",
        "relatorios-financeiros",
      ])
      if (blocked.has(page)) return
    }
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
    <aside className={cn("hidden lg:flex flex-col bg-sidebar border-r border-sidebar-border transition-all", collapsed ? "w-20" : "w-64")}>
      <div className={cn("flex items-center border-b border-sidebar-border", collapsed ? "justify-center p-3" : "justify-between p-4")}>
        <div className={cn("flex items-center gap-3", collapsed && "justify-center")}>
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary">
            <Zap className="w-5 h-5 text-primary-foreground" />
          </div>
          {!collapsed && (
            <div>
              <h1 className="text-lg font-bold text-sidebar-foreground">{APP_DISPLAY_NAME}</h1>
              <p className="text-xs text-black/70">ERP · gestão empresarial</p>
            </div>
          )}
        </div>
        {!collapsed && (
          <button onClick={onToggleCollapse} className="p-2 rounded-md hover:bg-sidebar-accent text-sidebar-foreground">
            <PanelLeftClose className="w-4 h-4" />
          </button>
        )}
        {collapsed && (
          <button onClick={onToggleCollapse} className="absolute top-4 right-2 p-1 rounded-md hover:bg-sidebar-accent text-sidebar-foreground">
            <PanelLeftOpen className="w-4 h-4" />
          </button>
        )}
      </div>

      {!collapsed && lojas.length >= 2 && (
        <div className="px-4 pb-3 border-b border-sidebar-border">
          <p className="text-xs text-black/70 mb-1.5">Unidade ativa</p>
          <Select
            value={lojaAtivaId ?? lojas[0]?.id ?? ""}
            onValueChange={(v) => setLojaAtivaId(v)}
          >
            <SelectTrigger className="w-full h-9 bg-sidebar-accent/30 border-sidebar-border">
              {(() => {
                const id = (lojaAtivaId ?? lojas[0]?.id ?? "").trim()
                const linha = lojas.find((x) => x.id === id)
                const idx = linha ? lojas.findIndex((x) => x.id === linha.id) : null
                const nome = linha ? nomeFantasiaOuFallbackUnidadePorOrdem(linha.id, linha.nomeFantasia, idx) : "Unidade"
                return (
                  <div className="flex items-center gap-2 min-w-0 flex-1 text-left">
                    <span className="truncate text-sm font-medium text-sidebar-foreground">{nome}</span>
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
                      "flex items-center justify-between w-full px-4 py-3 rounded-lg text-sm font-medium transition-colors",
                      "bg-white text-black border border-border hover:bg-black hover:text-white"
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
                          disabled={
                            cadastroBasicoIncompleto &&
                            !!subitem.page &&
                            [
                              "vendas",
                              "carteiras",
                              "fluxo-caixa",
                              "contas-pagar",
                              "contas-receber",
                              "relatorios-financeiros",
                            ].includes(subitem.page)
                          }
                          className={cn(
                            "flex items-center gap-3 w-full text-left px-4 py-2 pl-12 rounded-lg text-sm transition-colors",
                            collapsed && "hidden",
                            isActive(subitem.page)
                              ? "bg-black text-white font-semibold"
                              : "bg-white text-black hover:bg-black hover:text-white disabled:opacity-50 disabled:hover:bg-white disabled:hover:text-black"
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
                  disabled={
                    cadastroBasicoIncompleto &&
                    !!item.page &&
                    ["vendas", "carteiras", "fluxo-caixa", "contas-pagar", "contas-receber", "relatorios-financeiros"].includes(
                      item.page
                    )
                  }
                  className={cn(
                    "flex items-center gap-3 w-full px-4 py-3 rounded-lg text-sm font-medium transition-colors",
                    collapsed && "justify-center",
                    isActive(item.page)
                      ? "bg-black text-white"
                      : "bg-white text-black border border-border hover:bg-black hover:text-white disabled:opacity-50 disabled:hover:bg-white disabled:hover:text-black"
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
      
      <div className="p-4 border-t border-sidebar-border">
        <div className={cn("flex items-center gap-3 px-4 py-3 rounded-lg bg-secondary/50", collapsed && "justify-center px-2")}>
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-sm font-bold">
            A
          </div>
          {!collapsed && <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-sidebar-foreground truncate">Admin</p>
            <p className="text-xs text-black/70 truncate">admin@seudominio.com</p>
          </div>}
        </div>
      </div>
    </aside>
  )
}
