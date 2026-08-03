/**
 * POST /api/contador-externo/lojas/[loja]/documentos/[id]/conferir — marca um
 * documento ENVIADO como CONFERIDO (GOAL 015). ÚNICA transição do portal e só
 * para o papel CONFERENCIA (LEITURA → 403 de domínio). Body vazio/{} — a loja
 * vem do PATH, nunca do body.
 */
import { marcarDocumentoConferidoPortal, repoStatusPortal } from "@/lib/contador/portal"
import { respostaErroPortal } from "@/lib/contador/portal/erros"
import { lerCorpoJsonExterno } from "@/lib/contador/auth-externa/http"
import { aplicarRotacaoExterna, jsonExterno, jsonOkExterno, temChaveProibida } from "../../../../../_shared"
import { guardPortalExterno, respostaChaveProibidaPortal } from "../../../../../_portal"

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
    const conferencia = await marcarDocumentoConferidoPortal(
      guard.escopo,
      { documentoId: id },
      { repo: repoStatusPortal() },
    )
    const res = jsonOkExterno({ ok: true, conferencia })
    aplicarRotacaoExterna(res, guard.escopo.rotacao)
    return res
  } catch (e) {
    return jsonExterno(respostaErroPortal(e))
  }
}
