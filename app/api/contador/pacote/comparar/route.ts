/**
 * Contador HUB · comparação entre duas versões do pacote (GOAL 012).
 *
 * GET /api/contador/pacote/comparar?c=AAAA-MM&de=1&para=2
 *
 * SOMENTE LEITURA e sem IO de storage: o diff sai dos `ContadorPacoteItem` já
 * persistidos (caminho + bytes + sha256). Nenhum ZIP é baixado ou descompactado.
 */
import { NextResponse } from "next/server"
import { requireContadorScope } from "@/lib/contador/scope"
import { respostaFalhaEscopo } from "@/lib/contador/documentos/http"
import { competenciaOuErro } from "@/lib/contador/comentarios/service"
import { respostaErroFechamento } from "@/lib/contador/fechamento/http"
import { criarRepoFechamento } from "@/lib/contador/fechamento/repo-prisma"
import { CABECALHO_PRIVADO, respostaChaveProibida, temChaveProibida } from "@/lib/contador/fechamento/rotas"
import { compararVersoes, versaoOuErro } from "@/lib/contador/pacote/versoes"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET(req: Request) {
  const url = new URL(req.url)
  if (temChaveProibida(url.searchParams)) return respostaChaveProibida()

  const escopo = await requireContadorScope()
  if (!escopo.ok) return respostaFalhaEscopo(escopo)

  try {
    const comp = competenciaOuErro(url.searchParams.get("c") ?? "")
    const de = versaoOuErro(url.searchParams.get("de"))
    const para = versaoOuErro(url.searchParams.get("para"))
    const diff = await compararVersoes(
      { storeId: escopo.storeId, userId: escopo.userId },
      comp,
      de,
      para,
      { repo: criarRepoFechamento() },
    )
    return NextResponse.json({ ok: true, ...diff }, { headers: CABECALHO_PRIVADO })
  } catch (e) {
    return respostaErroFechamento(e)
  }
}
