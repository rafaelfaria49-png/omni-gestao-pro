/**
 * Portal externo read-only — tela honesta de indisponibilidade (GOAL 015).
 *
 * Mesma linguagem do GOAL 014: quando o segredo de sessão não está configurado
 * no servidor, o portal fica INERTE — não faz fallback, não inventa dado e não
 * quebra. Componente puro de apresentação; nenhum provider do ERP.
 */
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export function PortalIndisponivel() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md border-border">
        <CardHeader>
          <CardTitle>Portal do Contador</CardTitle>
          <CardDescription>
            O portal está temporariamente indisponível. Tente novamente em instantes; se o
            problema persistir, fale com a empresa que emitiu o seu convite.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  )
}
