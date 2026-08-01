/**
 * Portal externo — sessão expirada (GOAL 014, §13).
 *
 * Destino do redirect quando a validação no servidor encontra a sessão expirada
 * (payload `exp` ou `expiraEm` da linha). Tela estática: nenhuma leitura de
 * cookie/banco aqui — quem decide é a página protegida.
 */
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function SessaoExpiradaPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md border-border">
        <CardHeader>
          <CardTitle>Sua sessão expirou</CardTitle>
          <CardDescription>
            Por segurança, as sessões do portal expiram automaticamente após algumas horas.
            Entre novamente com seu e-mail e senha para continuar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <Link href="/contador-externo/login">Voltar para o login</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
