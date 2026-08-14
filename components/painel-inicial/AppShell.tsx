"use client";

import type { ReactNode } from "react";
import { Suspense } from "react";
import { cn } from "@/lib/utils";
import { DashboardAccessAlerts } from "@/components/enterprise/DashboardAccessAlerts";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { WorkspaceFocusProvider, useWorkspaceFocus } from "./workspace-focus-context";

export function AppShell({
  children,
  noPadding,
  topNotice,
}: {
  children: ReactNode;
  noPadding?: boolean;
  /**
   * Faixa horizontal opcional renderizada logo ABAIXO da Topbar global e ACIMA
   * do conteúdo (`<main>`). Fica no fluxo (não é overlay): empurra o conteúdo
   * para baixo, sem cobrir carrinho, pagamento, workspace nem a sidebar.
   * Usada pelo aviso de atualização (PWA). Quando vazio/null não ocupa espaço.
   */
  topNotice?: ReactNode;
}) {
  return (
    <WorkspaceFocusProvider>
      <AppShellFrame noPadding={noPadding} topNotice={topNotice}>
        {children}
      </AppShellFrame>
    </WorkspaceFocusProvider>
  );
}

function AppShellFrame({
  children,
  noPadding,
  topNotice,
}: {
  children: ReactNode;
  noPadding?: boolean;
  topNotice?: ReactNode;
}) {
  const { focusMode } = useWorkspaceFocus();

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <Sidebar focusMode={focusMode} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Topbar focusMode={focusMode} />
        {topNotice}
        <main
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
            !noPadding && "px-4 sm:px-6 lg:px-8 py-[clamp(12px,2vh,24px)]",
          )}
        >
          <Suspense fallback={null}>
            <DashboardAccessAlerts />
          </Suspense>
          {children}
        </main>
      </div>
    </div>
  );
}
