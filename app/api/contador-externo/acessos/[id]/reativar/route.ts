/**
 * POST /api/contador-externo/acessos/[id]/reativar — reversão da suspensão do
 * vínculo (GOAL 014, §B/§13). Não desfaz revogação (revogação é terminal — a
 * reconcessão acontece via novo convite). Evento `acesso_reativado` na mesma
 * transação. Escopo duplo: vínculo de outra loja → 404 genérico.
 */
import { reativarVinculo } from "@/lib/contador/auth-externa/acessos"
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
    const acesso = await reativarVinculo(resolverRepoAuthExterna(), {
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
