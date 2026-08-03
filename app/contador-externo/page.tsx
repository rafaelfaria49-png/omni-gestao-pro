/**
 * Portal externo do contador — página inicial AUTOPROTEGIDA (GOAL 014, §13).
 *
 * Validação no servidor a cada navegação (fail-closed):
 *  - sessão válida → lista de lojas vinculadas (único conteúdo autenticado do
 *    014 — NENHUM dado contábil; isso é GOAL 015);
 *  - ausente/adulterada/revogada → redirect `/contador-externo/login`;
 *  - expirada → redirect `/contador-externo/sessao-expirada`;
 *  - sem `CONTADOR_EXTERNO_SESSION_SECRET` → tela honesta de indisponibilidade
 *    (R-9 — o portal é inerte, nunca quebra nem faz fallback).
 */
import Link from "next/link"
import { redirect } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { portalExternoV2Habilitado } from "@/lib/contador/portal/flag"
import { lojasDoEscopoComNome, validarSessaoDaPagina } from "./_sessao"
import { LogoutButton } from "./logout-button"

export const dynamic = "force-dynamic"

const PAPEL_ROTULO: Record<string, string> = {
  LEITURA: "Leitura",
  CONFERENCIA: "Conferência",
}

function TelaIndisponivel() {
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

export default async function ContadorExternoPage() {
  const sessao = await validarSessaoDaPagina()
  if (!sessao.ok) {
    if (sessao.motivo === "indisponivel") return <TelaIndisponivel />
    if (sessao.motivo === "expirado" || sessao.motivo === "sessao_expirada") {
      redirect("/contador-externo/sessao-expirada")
    }
    redirect("/contador-externo/login")
  }

  const lojas = await lojasDoEscopoComNome(sessao.usuario.id)
  // GOAL 015: com a flag OFF a lista continua exatamente como no 014 (sem link);
  // as páginas de dados respondem 404, então nada aqui pode apontar para elas.
  const portalV2 = portalExternoV2Habilitado()

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 p-4 py-10">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Portal do Contador</h1>
          <p className="text-sm text-muted-foreground">Olá, {sessao.usuario.nome}.</p>
        </div>
        <LogoutButton />
      </header>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-base">Empresas vinculadas</CardTitle>
          <CardDescription>
            Estas são as empresas que autorizaram o seu acesso. Em breve você verá aqui os
            documentos e as competências de cada uma.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {lojas.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma empresa vinculada no momento. Se você recebeu um convite, abra o link
              enviado pela empresa para concluir o cadastro.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {lojas.map((loja) => (
                <li key={loja.storeId} className="flex items-center justify-between gap-4 py-3">
                  {portalV2 ? (
                    <Link
                      href={`/contador-externo/lojas/${encodeURIComponent(loja.storeId)}`}
                      className="min-w-0 truncate text-sm font-medium hover:underline"
                    >
                      {loja.nome}
                    </Link>
                  ) : (
                    <span className="min-w-0 truncate text-sm font-medium">{loja.nome}</span>
                  )}
                  <Badge variant="secondary">{PAPEL_ROTULO[loja.papel] ?? loja.papel}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Sua sessão expira automaticamente após algumas horas e pode ser encerrada a qualquer
        momento pela empresa ou por você, no botão Sair.
      </p>
    </div>
  )
}
