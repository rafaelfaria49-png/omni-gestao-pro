import { CadastroClientes } from "@/components/dashboard/clientes/cadastro-clientes"
import { AppOpsProviders } from "@/components/dashboard/app-ops-providers"

/**
 * Rota dedicada `/clientes`. Usa os mesmos providers do dashboard para `lojaAtivaId` bater com multiloja.
 * Dados: `prisma.cliente` → tabela `clientes_importados`; coluna `lojaId` costuma ser `loja-1` nos imports (`lib/clientes-loja-resolve.ts`).
 */
export default function ClientesPage() {
  return (
    <AppOpsProviders>
      <div className="min-h-screen bg-background p-4 lg:p-6 max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Cadastro de Clientes</h1>
          <p className="text-muted-foreground">Gerencie seus clientes e aparelhos recorrentes</p>
        </div>
        <CadastroClientes />
      </div>
    </AppOpsProviders>
  )
}
