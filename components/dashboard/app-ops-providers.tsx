"use client"

import { type ReactNode } from "react"
import { CaixaProvider } from "@/components/dashboard/caixa/caixa-provider"
import { ConfigEmpresaProvider } from "@/lib/config-empresa"
import { PerfilLojaProvider } from "@/lib/perfil-loja-provider"
import { LojaAtivaProvider, useLojaAtiva } from "@/lib/loja-ativa"
import { OperationsProvider } from "@/lib/operations-store"
import { FinanceiroProvider } from "@/lib/financeiro-store"

function OperationsWithStorageKey({ children }: { children: ReactNode }) {
  const { opsStorageKey } = useLojaAtiva()
  return (
    <OperationsProvider key={opsStorageKey} storageKey={opsStorageKey}>
      {children}
    </OperationsProvider>
  )
}

/** Config + multiloja + operações (estoque/vendas/OS) por unidade + caixa. */
export function AppOpsProviders({ children }: { children: ReactNode }) {
  return (
    <ConfigEmpresaProvider>
      <PerfilLojaProvider>
      <LojaAtivaProvider>
        <FinanceiroProvider>
          <OperationsWithStorageKey>
            <CaixaProvider>{children}</CaixaProvider>
          </OperationsWithStorageKey>
        </FinanceiroProvider>
      </LojaAtivaProvider>
      </PerfilLojaProvider>
    </ConfigEmpresaProvider>
  )
}
