/**
 * POST /api/contador-externo/usuarios/[id]/reativar — reativação da identidade
 * externa (GOAL 014, §A/§13). Igualmente auditada (R-7): evento
 * `usuario_reativado` com o storeId de origem. Não reabre sessões — o contador
 * precisa fazer login de novo.
 */
import { respostaErroAuthExterna } from "@/lib/contador/auth-externa/http"
import { reativarIdentidade } from "@/lib/contador/auth-externa/usuarios"
import {
  guardAdminExterno,
  ipHashDoRequest,
  jsonExterno,
  jsonOkExterno,
  respostaChaveProibida,
  resolverRepoAuthExterna,
  temChaveProibida,
} from "../../../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const url = new URL(req.url)
  if (temChaveProibida(url.searchParams)) return respostaChaveProibida()

  const guard = await guardAdminExterno()
  if (!guard.ok) return guard.resposta

  const { id } = await ctx.params
  try {
    const usuario = await reativarIdentidade(resolverRepoAuthExterna(), {
      usuarioId: id,
      adminId: guard.adminId,
      storeIdOrigem: guard.escopo.storeId,
      ipHash: await ipHashDoRequest(req),
    })
    return jsonOkExterno({
      ok: true,
      usuario: { id: usuario.id, status: usuario.status, tokenVersion: usuario.tokenVersion },
    })
  } catch (e) {
    return jsonExterno(respostaErroAuthExterna(e))
  }
}
