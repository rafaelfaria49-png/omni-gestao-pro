/**
 * Contador HUB · download de uma versão persistida do pacote (GOAL 012).
 *
 * POST /api/contador/pacote/download  { competencia, versao }
 *
 * É POST porque AUDITA: registra `pacote_baixado` na trilha append-only. O verbo
 * segue o precedente do download de documento (GOAL 010) — autoriza o acesso e devolve
 * uma URL assinada de curta duração, que nunca é persistida.
 */
import { NextResponse } from "next/server"
import { requireContadorScope } from "@/lib/contador/scope"
import { logEvento, respostaFalhaEscopo } from "@/lib/contador/documentos/http"
import { competenciaOuErro } from "@/lib/contador/comentarios/service"
import { respostaErroFechamento } from "@/lib/contador/fechamento/http"
import { criarRepoFechamento } from "@/lib/contador/fechamento/repo-prisma"
import { criarPortasFechamento } from "@/lib/contador/fechamento/portas"
import { lerCorpoJson, respostaChaveProibida, temChaveProibida } from "@/lib/contador/fechamento/rotas"
import { autorizarDownloadPacote, versaoOuErro } from "@/lib/contador/pacote/versoes"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function POST(req: Request) {
  const url = new URL(req.url)
  if (temChaveProibida(url.searchParams)) return respostaChaveProibida()

  const escopo = await requireContadorScope()
  if (!escopo.ok) return respostaFalhaEscopo(escopo)

  const body = await lerCorpoJson(req)
  if (temChaveProibida(body)) return respostaChaveProibida()

  try {
    const comp = competenciaOuErro(body.competencia)
    const versao = versaoOuErro(body.versao)
    const { storage } = criarPortasFechamento()
    const dto = await autorizarDownloadPacote(
      { storeId: escopo.storeId, userId: escopo.userId },
      comp,
      versao,
      { repo: criarRepoFechamento(), storage },
    )
    logEvento("contador_pacote_download", {
      storeId: escopo.storeId,
      userId: escopo.userId,
      competencia: dto.nomeArquivo,
      versao: dto.versao,
      expiresInSec: dto.expiresInSec,
    })
    return NextResponse.json(
      {
        ok: true,
        versao: dto.versao,
        manifestoHash: dto.manifestoHash,
        bytes: dto.bytes,
        nomeArquivo: dto.nomeArquivo,
        url: dto.url,
        expiresInSec: dto.expiresInSec,
      },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    )
  } catch (e) {
    return respostaErroFechamento(e)
  }
}
