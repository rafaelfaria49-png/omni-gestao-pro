"use client"

import { usePathname, useRouter } from "next/navigation"
import { useState } from "react"
import { AppOpsProviders } from "@/components/dashboard/app-ops-providers"
import { Header } from "@/components/dashboard/header"
import { MobileNav } from "@/components/dashboard/mobile-nav"
import { Sidebar } from "@/components/dashboard/sidebar"
import { FirstAccessWizard } from "@/components/onboarding/first-access-wizard"

/**
 * Shell compartilhado das rotas `/dashboard/*` (mesma navegação do painel principal em `/`).
 */
export default function DashboardSegmentLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  const currentPage =
    pathname === "/dashboard" || pathname === "/dashboard/"
      ? "dashboard-omni"
      : pathname?.startsWith("/dashboard/clientes")
        ? "clientes-gestao"
        : pathname?.startsWith("/dashboard/estoque")
          ? "estoque-gestao"
          : pathname?.startsWith("/dashboard/os")
            ? "os-gestao"
            : "dashboard"

  const goToPage = (page: string) => {
    if (page === "dashboard") {
      router.replace("/")
      return
    }
    router.replace(`/?page=${encodeURIComponent(page)}`)
  }

  return (
    <AppOpsProviders>
      <div className="flex min-h-screen bg-background">
        <FirstAccessWizard />
        <Sidebar
          onNavigate={goToPage}
          currentPage={currentPage}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((p) => !p)}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <Header />
          <main className="flex-1 overflow-auto pb-24 lg:pb-0">{children}</main>
        </div>
        <MobileNav onNavigate={goToPage} currentPage={currentPage} />
      </div>
    </AppOpsProviders>
  )
}
