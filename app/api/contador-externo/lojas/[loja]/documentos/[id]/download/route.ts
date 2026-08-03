/**
 * POST /api/contador-externo/lojas/[loja]/documentos/[id]/download — autoriza o
 * download de um documento (GOAL 015). A loja vem do PATH (nunca do body — body
 * é vazio/{}); o evento `documento_download_autorizado` (ator externo + IP/UA)
 * é gravado ANTES da URL; presigned ≤ 300s; storageRef nunca na resposta.
 */
import { autorizarDownloadPortal, repoDocumentosPortal, repoEventosPortal, storageDocumentosPortal } from "@/lib/contador/portal"
import { respostaErroPortal } from "@/lib/contador/portal/erros"
import { lerCorpoJsonExterno } from "@/lib/contador/auth-externa/http"
import { aplicarRotacaoExterna, jsonExterno, jsonOkExterno, temChaveProibida } from "../../../../../_shared"
import { contextoAtorPortal, guardPortalExterno, respostaChaveProibidaPortal } from "../../../../../_portal"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function POST(req: Request, ctx: { params: Promise<{ loja: string; id: string }> }) {
  const { loja, id } = await ctx.params
  const guard = await guardPortalExterno(req, loja)
  if (!guard.ok) return guard.resposta

  const body = await lerCorpoJsonExterno(req)
  if (temChaveProibida(body)) return respostaChaveProibidaPortal()

  try {
    const download = await autorizarDownloadPortal(
      guard.escopo,
      id,
      contextoAtorPortal(req, guard.escopo),
      {
        repo: repoDocumentosPortal(),
        storage: storageDocumentosPortal(),
        eventos: repoEventosPortal(),
      },
    )
    const res = jsonOkExterno({ ok: true, download })
    aplicarRotacaoExterna(res, guard.escopo.rotacao)
    return res
  } catch (e) {
    return jsonExterno(respostaErroPortal(e))
  }
}
