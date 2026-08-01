/**
 * Layout do portal EXTERNO do contador (`/contador-externo`, GOAL 014).
 *
 * PRÓPRIO e isolado: NENHUM provider/serviço do ERP (sem `AppOpsProviders`,
 * operations-store, loja-ativa, sidebar ou qualquer import de
 * `components/dashboard/**` — contraste com `app/contador/layout.tsx`). O html
 * `lang="pt-BR"`, fontes e `globals.css` já vêm do root layout (como no portal
 * legado); aqui só entram metadados próprios e o contêiner visual mínimo.
 */
import type { Metadata } from "next"
import { APP_DISPLAY_NAME } from "@/lib/app-brand"

export const metadata: Metadata = {
  title: `Portal do Contador · ${APP_DISPLAY_NAME}`,
  description: "Área externa e restrita para contadores parceiros.",
  // Portal autenticado por convite: nunca indexável.
  robots: { index: false, follow: false },
}

export default function ContadorExternoLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-background text-foreground">{children}</div>
}
