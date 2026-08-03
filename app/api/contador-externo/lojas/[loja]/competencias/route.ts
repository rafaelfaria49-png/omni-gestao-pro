/**
 * GET /api/contador-externo/lojas/[loja]/competencias — janela de competências
 * do portal externo read-only (GOAL 015). Atual + 12 anteriores, com selo
 * `oficial vN` nas fechadas. A loja vem do PATH e é validada contra o vínculo
 * ATIVO a cada request; flag OFF → 404.
 */
import { listarCompetenciasPortal, repoFechamentoPortal } from "@/lib/contador/portal"
import { respostaErroPortal } from "@/lib/contador/portal/erros"
import { aplicarRotacaoExterna, jsonExterno, jsonOkExterno } from "../../../_shared"
import { guardPortalExterno } from "../../../_portal"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET(req: Request, ctx: { params: Promise<{ loja: string }> }) {
  const { loja } = await ctx.params
  const guard = await guardPortalExterno(req, loja)
  if (!guard.ok) return guard.resposta
  try {
    const competencias = await listarCompetenciasPortal(guard.escopo, {
      repo: repoFechamentoPortal(),
    })
    const res = jsonOkExterno({ ok: true, competencias })
    aplicarRotacaoExterna(res, guard.escopo.rotacao)
    return res
  } catch (e) {
    return jsonExterno(respostaErroPortal(e))
  }
}
