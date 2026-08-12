"use client";

import Link from "next/link";
import { useMemo, useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";
import { Bell, Search, Plus, ShoppingCart, Wrench, UserPlus, Package, PanelLeftOpen, LayoutDashboard, MessageSquare, Users, Banknote, Settings, BarChart3 } from "lucide-react";
import { ThemeSwitcher } from "@/components/ia-mestre/ThemeSwitcher";
import { LegibilityToggle } from "@/components/theme/LegibilityToggle";
import { MobileNavSheet } from "@/components/painel-inicial/MobileNavSheet";
import { useUserCredits } from "@/hooks/useUserCredits";
import { useSidebarCollapsed } from "@/hooks/use-sidebar-collapsed";
import type { EnterprisePermissions } from "@/lib/auth/enterprise-permissions";
import { getEnterprisePermissions } from "@/lib/auth/enterprise-permissions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
} from "@/components/ui/command";

type NovoItem = {
  label: string;
  href: string;
  icon: typeof ShoppingCart;
  kbd: string;
  visible?: (p: EnterprisePermissions) => boolean;
};

const novoItems: NovoItem[] = [
  {
    label: "Nova Venda",
    href: "/dashboard/vendas",
    icon: ShoppingCart,
    kbd: "N V",
    visible: (p) => p.hubs.vendas,
  },
  {
    label: "Nova OS",
    href: "/dashboard/operacoes-v3",
    icon: Wrench,
    kbd: "N O",
    visible: (p) => p.hubs.operacoes,
  },
  {
    label: "Novo Cliente",
    href: "/dashboard/cadastros-v2",
    icon: UserPlus,
    kbd: "N C",
    visible: (p) => p.hubs.cadastros,
  },
  {
    label: "Novo Produto",
    href: "/dashboard/cadastros-v2",
    icon: Package,
    kbd: "N P",
    visible: (p) => p.hubs.cadastros,
  },
];

export function Topbar() {
  const { credits, loading, error } = useUserCredits();
  const { data: session, status } = useSession();
  const { collapsed: sidebarCollapsed, setCollapsed: setSidebarCollapsed } = useSidebarCollapsed();
  const router = useRouter();
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const pathname = usePathname();
  const isPDV = useMemo(() => {
    return pathname?.includes("/vendas") || pathname?.includes("/pdv-next");
  }, [pathname]);

  const breadcrumbLabel = useMemo(() => {
    if (!pathname) return "Painel";
    if (pathname.includes("/whatsapp")) return "WhatsApp HUB";
    if (pathname.includes("/operacoes")) return "Central de Operações";
    if (pathname.includes("/cadastros")) return "Cadastros HUB";
    if (pathname.includes("/financeiro")) return "Financeiro HUB";
    if (pathname.includes("/vendas") || pathname.includes("/pdv-next")) return "Vendas & Caixa";
    if (pathname.includes("/configuracoes")) return "Configurações";
    if (pathname.includes("/relatorios")) return "Relatórios";
    if (pathname.includes("/ia-mestre")) return "IA Mestre";
    if (pathname.includes("/marketplace")) return "Marketplace";
    return "Painel";
  }, [pathname]);

  const perms = useMemo(() => {
    if (status !== "authenticated" || !session?.user?.role) return null;
    return getEnterprisePermissions(session.user.role);
  }, [status, session?.user?.role]);

  const novoFiltered = useMemo(() => {
    if (!perms) return novoItems;
    return novoItems.filter((i) => (i.visible ? i.visible(perms) : true));
  }, [perms]);

  const creditsValue = typeof credits === "number" ? credits : null;
  const showLow = !loading && !error && creditsValue !== null && creditsValue <= 100;
  const showNone = !loading && !error && creditsValue !== null && creditsValue <= 0;

  const creditsLabel = loading
    ? "Créditos…"
    : error
      ? "Comprar créditos"
      : showNone
        ? "Sem créditos"
      : `Créditos: ${new Intl.NumberFormat("pt-BR").format(credits ?? 0)}`;

  const initials = useMemo(() => {
    const name = session?.user?.name?.trim() || session?.user?.email?.trim() || "";
    if (!name) return "OG";
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase().slice(0, 2);
    return name.slice(0, 2).toUpperCase();
  }, [session?.user?.name, session?.user?.email]);

  const displayName = session?.user?.name?.trim() || session?.user?.email?.split("@")[0] || "Usuário";
  const displayEmail = session?.user?.email || "";

  return (
    <header className="h-14 shrink-0 border-b border-border bg-background/80 backdrop-blur-xl sticky top-0 z-30">
      <div className="h-full flex items-center gap-2 px-4 sm:px-6">
        <MobileNavSheet />
        {sidebarCollapsed ? (
          <button
            type="button"
            onClick={() => setSidebarCollapsed(false)}
            aria-label="Mostrar menu lateral"
            title="Mostrar menu"
            className="hidden lg:inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-panel hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
          >
            <PanelLeftOpen className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        ) : null}
        <nav className="hidden md:flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
          <span className="hover:text-foreground cursor-pointer">Matriz</span>
          <span className="text-border">/</span>
          <span className="text-foreground font-medium">{breadcrumbLabel}</span>
        </nav>

        <div className="flex-1" />

        <div className="hidden sm:block w-72" onClick={() => setSearchOpen(true)}>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground transition-colors group-focus-within:text-foreground" />
            <input
              type="text"
              readOnly
              placeholder="Pesquisar OS, vendas ou produtos..."
              title="Pesquisa rápida (Alt+K) — Command Menu"
              className="w-full h-8 pl-8 pr-12 rounded-md bg-panel border border-border text-[12.5px] cursor-pointer placeholder:text-muted-foreground outline-none hover:bg-muted/40 hover:border-border-hover transition-all focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
            />
            <kbd className="absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[9px] px-1.5 py-0.5 rounded border border-border bg-background text-muted-foreground select-none pointer-events-none">
              ⌘K
            </kbd>
          </div>
        </div>

        <ThemeSwitcher compact />

        <LegibilityToggle />

        {!isPDV ? (
          <Link
            href="/dashboard/creditos"
            className={[
              "hidden sm:inline-flex h-8 items-center gap-2 rounded-full border px-3 text-[12px] font-medium transition-colors",
              showNone
                ? "border-destructive/25 bg-destructive/10 text-destructive hover:bg-destructive/15"
                : showLow
                  ? "border-warning/30 bg-warning/10 text-foreground hover:bg-warning/15"
                  : "border-border bg-surface/60 text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            ].join(" ")}
            aria-label={`${creditsLabel}. Abrir consulta e compra de créditos`}
            title="Consultar saldo e comprar créditos"
          >
            <span>{creditsLabel}</span>
            {showNone || showLow ? (
              <span className="border-l border-current/20 pl-2 text-[11px] font-semibold">Comprar</span>
            ) : null}
          </Link>
        ) : null}

        <button className="relative h-8 w-8 rounded-md border border-border bg-panel hover:bg-muted/60 transition-colors grid place-items-center">
          <Bell className="h-3.5 w-3.5" strokeWidth={1.75} />
          <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-destructive ring-2 ring-background" />
        </button>

        {novoFiltered.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger className="hidden sm:inline-flex h-8 px-3 items-center gap-1.5 rounded-md bg-foreground text-background text-[12.5px] font-medium hover:opacity-90 transition-opacity">
              <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
              Novo
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                Criar novo
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {novoFiltered.map((item) => {
                const Icon = item.icon;
                return (
                  <DropdownMenuItem key={item.href} asChild className="gap-2 cursor-pointer text-[12.5px]">
                    <Link href={item.href} className="flex w-full items-center gap-2">
                      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="flex-1">{item.label}</span>
                      <kbd className="pointer-events-none font-mono text-[9.5px] text-muted-foreground">{item.kbd}</kbd>
                    </Link>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}

        <div className="flex items-center gap-2 pl-2 ml-1 border-l border-border">
          <Avatar className="h-7 w-7">
            <AvatarFallback className="bg-muted text-foreground text-[11px] font-semibold">{initials}</AvatarFallback>
          </Avatar>
          <div className="hidden lg:block leading-tight min-w-0">
            <div className="text-[12px] font-medium truncate">{displayName}</div>
            <div className="text-[10.5px] text-muted-foreground truncate">{displayEmail || "—"}</div>
          </div>
        </div>
      </div>

      <CommandDialog open={searchOpen} onOpenChange={setSearchOpen} title="Buscar Rota ou Ação" description="Digite um comando de navegação para executar rápido.">
        <CommandInput placeholder="Digite para buscar rotas, cadastros e atalhos..." />
        <CommandList>
          <CommandEmpty>Nenhum comando encontrado.</CommandEmpty>
          <CommandGroup heading="Ações Rápidas">
            <CommandItem
              onSelect={() => {
                setSearchOpen(false);
                router.push("/dashboard/vendas");
              }}
              className="cursor-pointer"
            >
              <ShoppingCart className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>Nova Venda</span>
              <CommandShortcut>N V</CommandShortcut>
            </CommandItem>
            <CommandItem
              onSelect={() => {
                setSearchOpen(false);
                router.push("/dashboard/operacoes-v3");
              }}
              className="cursor-pointer"
            >
              <Wrench className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>Nova Ordem de Serviço (OS)</span>
              <CommandShortcut>N O</CommandShortcut>
            </CommandItem>
            <CommandItem
              onSelect={() => {
                setSearchOpen(false);
                router.push("/dashboard/cadastros-v2");
              }}
              className="cursor-pointer"
            >
              <UserPlus className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>Novo Cliente</span>
              <CommandShortcut>N C</CommandShortcut>
            </CommandItem>
            <CommandItem
              onSelect={() => {
                setSearchOpen(false);
                router.push("/dashboard/cadastros-v2");
              }}
              className="cursor-pointer"
            >
              <Package className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>Novo Produto</span>
              <CommandShortcut>N P</CommandShortcut>
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Navegação Geral">
            <CommandItem
              onSelect={() => {
                setSearchOpen(false);
                router.push("/dashboard");
              }}
              className="cursor-pointer"
            >
              <LayoutDashboard className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>Ir para Painel Geral</span>
            </CommandItem>
            <CommandItem
              onSelect={() => {
                setSearchOpen(false);
                router.push("/dashboard/vendas-hub");
              }}
              className="cursor-pointer"
            >
              <ShoppingCart className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>Ir para Vendas HUB</span>
            </CommandItem>
            <CommandItem
              onSelect={() => {
                setSearchOpen(false);
                router.push("/dashboard/whatsapp");
              }}
              className="cursor-pointer"
            >
              <MessageSquare className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>Ir para WhatsApp HUB</span>
            </CommandItem>
            <CommandItem
              onSelect={() => {
                setSearchOpen(false);
                router.push("/dashboard/operacoes-v3");
              }}
              className="cursor-pointer"
            >
              <Wrench className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>Ir para Central de Operações</span>
            </CommandItem>
            <CommandItem
              onSelect={() => {
                setSearchOpen(false);
                router.push("/dashboard/cadastros-v2");
              }}
              className="cursor-pointer"
            >
              <Users className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>Ir para Cadastros HUB</span>
            </CommandItem>
            <CommandItem
              onSelect={() => {
                setSearchOpen(false);
                router.push("/dashboard/financeiro-v2");
              }}
              className="cursor-pointer"
            >
              <Banknote className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>Ir para Financeiro HUB</span>
            </CommandItem>
            <CommandItem
              onSelect={() => {
                setSearchOpen(false);
                router.push("/dashboard/configuracoes-v2");
              }}
              className="cursor-pointer"
            >
              <Settings className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>Ir para Configurações</span>
            </CommandItem>
            <CommandItem
              onSelect={() => {
                setSearchOpen(false);
                router.push("/dashboard/relatorios");
              }}
              className="cursor-pointer"
            >
              <BarChart3 className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>Ir para Relatórios</span>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </header>
  );
}
