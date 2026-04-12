import { Suspense } from "react"
import { ConfigEmpresaProvider } from "@/lib/config-empresa"
import { MinhaAssinatura } from "@/components/dashboard/assinatura/minha-assinatura"

export default function MeuPlanoPage() {
  return (
    <ConfigEmpresaProvider>
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-muted-foreground">Carregando…</div>}>
        <div className="min-h-screen bg-background p-4 lg:p-8">
          <MinhaAssinatura />
        </div>
      </Suspense>
    </ConfigEmpresaProvider>
  )
}
