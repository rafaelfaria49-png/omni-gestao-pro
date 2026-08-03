/**
 * Portal externo read-only — competências de uma loja vinculada (GOAL 015, fase 3).
 *
 * Server component: a `[loja]` do path é validada contra o vínculo ATIVO a cada
 * render (`escopoDaPaginaPortal`); loja não vinculada → 404, sem nunca confirmar
 * que ela existe. Leitura direta do domínio read-only — nenhum provider do ERP.
 */
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { listarCompetenciasPortal, repoFechamentoPortal } from "@/lib/contador/portal"
import { PortalIndisponivel } from "@/components/contador-externo/portal-indisponivel"
import { escopoDaPaginaPortal } from "../../_portal-pagina"

export const dynamic = "force-dynamic"
export const revalidate = 0

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
]

export default async function LojaPortalPage({ params }: { params: Promise<{ loja: string }> }) {
  const { loja } = await params
  const escopo = await escopoDaPaginaPortal(loja)
  if (!escopo) return <PortalIndisponivel />

  const competencias = await listarCompetenciasPortal(escopo, { repo: repoFechamentoPortal() })

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 p-4 py-10">
      <header className="flex flex-col gap-1">
        <Link href="/contador-externo" className="text-sm text-muted-foreground hover:underline">
          ← Empresas vinculadas
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">Competências</h1>
        <p className="text-sm text-muted-foreground">
          Últimos 13 meses. Uma competência fechada tem versão oficial; as demais seguem em
          andamento e podem mudar.
        </p>
      </header>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-base">Selecione a competência</CardTitle>
          <CardDescription>
            Abra uma competência para ver documentos, pacotes, andamento e comentários.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border">
            {competencias.map((c) => (
              <li key={c.codigo} className="min-w-0">
                <Link
                  href={`/contador-externo/lojas/${encodeURIComponent(loja)}/competencias/${c.codigo}`}
                  className="flex items-center justify-between gap-4 py-3 hover:underline"
                >
                  <span className="min-w-0 text-sm font-medium">
                    {MESES[c.mes - 1]} de {c.ano}
                  </span>
                  {c.selo ? (
                    <Badge variant="secondary">{c.selo}</Badge>
                  ) : (
                    <Badge variant="outline">em andamento</Badge>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
