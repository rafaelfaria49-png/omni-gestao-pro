/**
 * POST /api/contador-externo/convites/[id]/revogar — revogação administrativa do
 * convite (GOAL 014, §13). Escopo duplo (id + loja ativa INTERNA): convite de
 * outra loja recebe 404 genérico — cross-store nem é tocado.
 */
import { revogarConvite } from "@/lib/contador/auth-externa/convites"
import { respostaErroAuthExterna } from "@/lib/contador/auth-externa/http"
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
    await revogarConvite(resolverRepoAuthExterna(), {
      conviteId: id,
      storeId: guard.escopo.storeId,
      adminId: guard.adminId,
      ipHash: await ipHashDoRequest(req),
    })
    return jsonOkExterno({ ok: true })
  } catch (e) {
    return jsonExterno(respostaErroAuthExterna(e))
  }
}
