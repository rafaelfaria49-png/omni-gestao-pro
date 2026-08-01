/**
 * POST /api/contador-externo/acessos/[id]/suspender — suspensão do vínculo
 * (GOAL 014, §B/§13). Reversível; vale na PRÓXIMA request daquele contador naquela
 * loja (checagem por request), demais lojas intactas. Evento `acesso_suspenso` na
 * mesma transação. Escopo duplo: vínculo de outra loja → 404 genérico.
 */
import { suspenderVinculo } from "@/lib/contador/auth-externa/acessos"
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
    const acesso = await suspenderVinculo(resolverRepoAuthExterna(), {
      acessoId: id,
      storeId: guard.escopo.storeId,
      adminId: guard.adminId,
      ipHash: await ipHashDoRequest(req),
    })
    return jsonOkExterno({ ok: true, acesso })
  } catch (e) {
    return jsonExterno(respostaErroAuthExterna(e))
  }
}
