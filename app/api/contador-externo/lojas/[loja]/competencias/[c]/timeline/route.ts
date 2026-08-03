/**
 * GET /api/contador-externo/lojas/[loja]/competencias/[c]/timeline — timeline
 * compartilhada da competência (GOAL 015). Comentários internos cortados na
 * consulta; ator interno pseudonimizado. `[c]` inválido → 404.
 */
import { carregarTimelinePortal, repoTimelinePortal } from "@/lib/contador/portal"
import { respostaErroPortal } from "@/lib/contador/portal/erros"
import { aplicarRotacaoExterna, jsonExterno, jsonOkExterno } from "../../../../../_shared"
import { competenciaDoPath, guardPortalExterno, respostaNaoEncontradoPortal } from "../../../../../_portal"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET(req: Request, ctx: { params: Promise<{ loja: string; c: string }> }) {
  const { loja, c } = await ctx.params
  const guard = await guardPortalExterno(req, loja)
  if (!guard.ok) return guard.resposta
  const comp = competenciaDoPath(c)
  if (!comp) return respostaNaoEncontradoPortal()
  try {
    const resultado = await carregarTimelinePortal(
      guard.escopo,
      { competencia: c },
      { repo: repoTimelinePortal() },
    )
    const res = jsonOkExterno({ ok: true, ...resultado })
    aplicarRotacaoExterna(res, guard.escopo.rotacao)
    return res
  } catch (e) {
    return jsonExterno(respostaErroPortal(e))
  }
}
