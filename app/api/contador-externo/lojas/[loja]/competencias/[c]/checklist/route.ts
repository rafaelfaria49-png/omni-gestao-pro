/**
 * GET /api/contador-externo/lojas/[loja]/competencias/[c]/checklist — checklist
 * da competência para o portal externo read-only (GOAL 015). Projeção do resumo:
 * competência aberta → checklist vivo (`montarChecklistFechamento`); fechada →
 * checklist congelado do snapshot oficial. `[c]` inválido → 404.
 */
import { carregarResumoPortal, carregarDadosPortal, repoFechamentoPortal } from "@/lib/contador/portal"
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
    const resumo = await carregarResumoPortal(guard.escopo, comp, {
      repo: repoFechamentoPortal(),
      carregarDados: carregarDadosPortal(),
    })
    const res = jsonOkExterno({
      ok: true,
      competencia: resumo.competencia,
      fechada: resumo.fechada,
      selo: resumo.selo,
      origem: resumo.origem,
      // Vivo: ChecklistFechamento completo. Fechada: o recorte congelado do snapshot.
      checklist: resumo.checklist ?? resumo.snapshot?.checklist ?? null,
    })
    aplicarRotacaoExterna(res, guard.escopo.rotacao)
    return res
  } catch (e) {
    return jsonExterno(respostaErroPortal(e))
  }
}
