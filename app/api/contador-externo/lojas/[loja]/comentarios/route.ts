/**
 * POST /api/contador-externo/lojas/[loja]/comentarios — comentário do contador
 * na competência (GOAL 015). Body `{ competencia, texto }` (+ `documentoId`
 * opcional); visibilidade é SEMPRE `compartilhada` no servidor — o campo nem
 * existe na entrada do domínio. Permitido aos dois papéis (matriz §7.2);
 * competência FECHADA → 409; texto > 4000 → 422.
 */
import { comentarPortal, repoComentariosPortal } from "@/lib/contador/portal"
import { respostaErroPortal } from "@/lib/contador/portal/erros"
import { lerCorpoJsonExterno } from "@/lib/contador/auth-externa/http"
import { aplicarRotacaoExterna, jsonExterno, jsonOkExterno, temChaveProibida } from "../../../_shared"
import { guardPortalExterno, respostaChaveProibidaPortal } from "../../../_portal"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function POST(req: Request, ctx: { params: Promise<{ loja: string }> }) {
  const { loja } = await ctx.params
  const guard = await guardPortalExterno(req, loja)
  if (!guard.ok) return guard.resposta

  const body = await lerCorpoJsonExterno(req)
  if (temChaveProibida(body)) return respostaChaveProibidaPortal()

  try {
    const comentario = await comentarPortal(
      guard.escopo,
      {
        competencia: body.competencia,
        texto: body.texto,
        ...(body.documentoId !== undefined ? { documentoId: body.documentoId } : {}),
      },
      { repo: repoComentariosPortal() },
    )
    const res = jsonOkExterno({ ok: true, comentario }, 201)
    aplicarRotacaoExterna(res, guard.escopo.rotacao)
    return res
  } catch (e) {
    return jsonExterno(respostaErroPortal(e))
  }
}
