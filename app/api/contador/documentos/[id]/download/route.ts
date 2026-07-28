/**
 * POST /api/contador/documentos/[id]/download
 *
 * Autoriza o download de um documento da loja ativa: valida sessão + `hubs.contador` +
 * posse + existência do objeto, gera URL assinada de curta duração (<= 300s, attachment)
 * e registra `documento_download_autorizado`. A URL assinada NUNCA é persistida.
 * O evento é honesto — autoriza, não afirma que o arquivo foi baixado.
 *
 * GOAL CONTADOR-HUB-DOCUMENTOS-REAL-010B · Etapa 8.
 */
import { NextResponse } from "next/server"
import { requireContadorScope } from "@/lib/contador/scope"
import { autorizarDownload } from "@/lib/contador/documentos/service"
import { criarRepoPrisma } from "@/lib/contador/documentos/repo-prisma"
import { storageR2 } from "@/lib/contador/documentos/storage-r2"
import { logEvento, respostaErro, respostaFalhaEscopo } from "@/lib/contador/documentos/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const escopo = await requireContadorScope()
  if (!escopo.ok) return respostaFalhaEscopo(escopo)

  const { id } = await ctx.params
  try {
    const { signedUrl, expiresInSec } = await autorizarDownload(
      { storeId: escopo.storeId, userId: escopo.userId },
      id,
      { storage: storageR2, repo: criarRepoPrisma() },
    )
    logEvento("contador_documento_download", {
      storeId: escopo.storeId,
      userId: escopo.userId,
      documentoId: id,
      expiresInSec,
    })
    return NextResponse.json(
      { ok: true, url: signedUrl, expiresInSec },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    )
  } catch (e) {
    return respostaErro(e)
  }
}
