"use client"

import {
  Home,
  LayoutDashboard,
  ShoppingCart,
  ClipboardList,
  Bot,
  Package,
  Wallet,
  Menu,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useStaffAccess } from "@/components/auth/AccessGate"
import { useMemo, useState } from "react"
import { useConfigEmpresa } from "@/lib/config-empresa"
import { APP_DISPLAY_NAME } from "@/lib/app-brand"
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useLojaAtiva } from "@/lib/loja-ativa"
import { useStoreSettings } from "@/lib/store-settings-provider"
import { 
  FileText, 
  Users, 
  BarChart3, 
  Settings,
  Zap,
  ChevronRight
} from "lucide-react"

type MobileMoreItem = {
  icon: LucideIcon
  label: string
  page?: string
  href?: string
  isMore?: boolean
}

type MobileFullSub = { label: string; page?: string; externalPath?: string }

type MobileFullItem = {
  icon: LucideIcon
  label: string
  page?: string
  /** Navegação direta (ex.: URL absoluta), raro no menu principal */
  externalPath?: string
  sub?: MobileFullSub[]
}

const mobileMenuItems: MobileMoreItem[] = [
  { icon: LayoutDashboard, label: "Painel", href: "/dashboard" },
  { icon: ShoppingCart, label: "PDV", page: "vendas", href: "/dashboard/vendas" },
  { icon: ClipboardList, label: "OS", page: "os" },
  { icon: Package, label: "Estoque", page: "produtos" },
  { icon: Menu, label: "Mais", href: "#", isMore: true },
]

const fullMenuItems: MobileFullItem[] = [
  { icon: Bot, label: "🤖 IA Mestre", externalPath: "/dashboard/ia-mestre" },
  { icon: LayoutDashboard, label: "Painel inicial", externalPath: "/dashboard" },
  { icon: ShoppingCart, label: "Vendas (Caixa/PDV)", page: "vendas", externalPath: "/dashboard/vendas" },
  { icon: ShoppingCart, label: "Histórico de Vendas", page: "vendas-arquivo" },
  { icon: ShoppingCart, label: "Trocas e devolução", page: "trocas" },
  { icon: FileText, label: "Orçamentos", page: "orcamentos" },
  {
    icon: ClipboardList,
    label: "Ordens de Serviço",
    page: "os",
    sub: [
      { label: "Painel integrado", page: "os", externalPath: "/dashboard/os" },
    ],
  },
  {
    icon: Package,
    label: "Estoque",
    page: "produtos",
    sub: [
      { label: "Produtos", page: "produtos" },
      { label: "Serviços", page: "servicos" },
      { label: "Planejamento de Compras", page: "planejamento-compras" },
    ],
  },
  { icon: Wallet, label: "Financeiro", page: "fluxo-caixa", sub: [{ label: "Carteiras", page: "carteiras" }, { label: "Fluxo de Caixa", page: "fluxo-caixa" }, { label: "Contas a Pagar", page: "contas-pagar" }, { label: "Contas a Receber", page: "contas-receber" }, { label: "Relatórios Financeiros", page: "relatorios-financeiros" }, { label: "Área do Contador", externalPath: "/contador" }] },
  {
    icon: Users,
    label: "Clientes",
    page: "clientes",
    sub: [
      { label: "Gestão de Clientes", page: "clientes-gestao", externalPath: "/dashboard/clientes" },
      { label: "Cadastro de Clientes", page: "clientes" },
      { label: "Consulta de Crédito", page: "credito" },
    ],
  },
  {
    icon: BarChart3,
    label: "Relatórios",
    page: "relatorios",
    sub: [
      { label: "Relatórios gerenciais", page: "relatorios" },
      { label: "Dashboard 360", page: "dashboard-360" },
    ],
  },
  {
    icon: Settings,
    label: "Gestão da Rede",
    page: "config-multilojas",
    sub: [{ label: "Gestão de Unidades", page: "config-multilojas" }],
  },
  { icon: Settings, label: "Configurações", page: "config-empresa", sub: [{ label: "Dados da Empresa", page: "config-empresa" }, { label: "Ajustes", page: "config-ajustes" }, { label: "Financeiro (cartões)", page: "config-pdv" }, { label: "Marca/Logo", page: "config-marca" }, { label: "Certificado Digital", page: "config-certificado" }, { label: "Termos de Garantia", page: "config-garantia" }, { label: "Backup", page: "config-backup" }, { label: "Meu Plano", page: "plano" }, { label: "Suporte", page: "suporte" }] },
]

interface MobileNavProps {
  onNavigate?: (page: string) => void
  currentPage?: string
}

export function MobileNav({ onNavigate, currentPage = "dashboard" }: MobileNavProps) {
  const [isOpen, setIsOpen] = useState(false)
  const staffRole = useStaffAccess()
  const { config } = useConfigEmpresa()
  const { cadastroBasicoIncompleto } = useLojaAtiva()
  const { pdvParams } = useStoreSettings()
  const isBronze = config.assinatura.plano === "bronze"
  const fullMenuItemsResolved = useMemo(() => {
    let items = [...fullMenuItems]
    if (staffRole === "VENDEDOR") {
      items = items.filter((i) => i.label !== "Financeiro" && i.label !== "Configurações")
    }
    if (pdvParams.moduloControleConsumo) {
      const idx = items.findIndex((i) => i.page === "trocas")
      if (idx >= 0) {
        items.splice(idx + 1, 0, {
          icon: UtensilsCrossed,
          label: "Controle de Consumo",
          page: "controle-consumo",
        })
      }
    }
    items = items.map((item) => {
      if (item.label === "Clientes" && item.sub) {
        return {
          ...item,
          sub: item.sub.filter((s) => !(isBronze && "page" in s && s.page === "credito")),
        }
      }
      if (item.label === "Configurações" && item.sub) {
        return {
          ...item,
          sub: item.sub.filter((s) => !("page" in s && s.page === "config-multilojas")),
        }
      }
      if (item.label === "Gestão da Rede" && item.sub) {
        return {
          ...item,
          sub: item.sub.filter((s) => !(isBronze && "page" in s && s.page === "config-multilojas")),
        }
      }
      return item
    })
    return items
  }, [pdvParams.moduloControleConsumo, config.assinatura.plano, isBronze, staffRole])

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-card border-t border-border z-50">
      <ul className="flex items-center justify-around">
        {mobileMenuItems.map((item) => (
          <li key={item.label}>
            {item.isMore ? (
              <Sheet open={isOpen} onOpenChange={setIsOpen}>
                <SheetTrigger asChild>
                  <button
                    className={cn(
                      "flex flex-col items-center gap-1 px-4 py-3 text-xs font-medium transition-colors",
                      "text-black hover:bg-black hover:text-white rounded-md"
                    )}
                  >
                    <item.icon className="w-5 h-5" />
                    <span>{item.label}</span>
                  </button>
                </SheetTrigger>
                <SheetContent side="bottom" className="h-[80vh] rounded-t-2xl">
                  <SheetHeader className="pb-4 border-b border-border">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary">
                        <Zap className="w-5 h-5 text-primary-foreground" />
                      </div>
                      <SheetTitle className="text-lg font-bold">{APP_DISPLAY_NAME}</SheetTitle>
                    </div>
                  </SheetHeader>
                  <div className="py-4 overflow-y-auto max-h-[calc(80vh-100px)]">
                    <ul className="space-y-1">
                      {fullMenuItemsResolved.map((menuItem) => (
                        <li key={menuItem.label}>
                          <button
                            onClick={() => {
                              if ("externalPath" in menuItem && menuItem.externalPath) {
                                window.location.href = menuItem.externalPath
                              } else if (menuItem.page && onNavigate) {
                                onNavigate(menuItem.page)
                              }
                              setIsOpen(false)
                            }}
                            className="flex items-center justify-between px-4 py-3 rounded-lg text-sm font-semibold bg-white text-black border border-border hover:bg-black hover:text-white transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <menuItem.icon className="w-5 h-5" />
                              {menuItem.label}
                            </div>
                            {menuItem.sub && <ChevronRight className="w-4 h-4 text-black/70" />}
                          </button>
                          {menuItem.sub && (
                            <ul className="ml-12 space-y-1 mt-1">
                              {menuItem.sub.map((subItem) => (
                                <li key={subItem.label}>
                                  <button
                                    onClick={() => {
                                      if ("externalPath" in subItem && subItem.externalPath) {
                                        window.location.href = subItem.externalPath
                                      } else if (subItem.page && onNavigate) {
                                        onNavigate(subItem.page)
                                      }
                                      setIsOpen(false)
                                    }}
                                    className="block px-4 py-2 text-sm font-medium text-black hover:bg-black hover:text-white rounded-md transition-colors"
                                  >
                                    {subItem.label}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                </SheetContent>
              </Sheet>
            ) : (
              <button
                onClick={() => {
                  if (item.href) {
                    window.location.href = item.href
                    return
                  }
                  if (item.page && onNavigate) onNavigate(item.page)
                }}
                className={cn(
                  "flex flex-col items-center gap-1 px-4 py-3 text-xs font-medium transition-colors",
                  currentPage === item.page
                    ? "bg-black text-white rounded-md"
                    : "text-black hover:bg-black hover:text-white rounded-md"
                )}
              >
                <item.icon className="w-5 h-5" />
                <span>{item.label}</span>
              </button>
            )}
          </li>
        ))}
      </ul>
    </nav>
  )
}
