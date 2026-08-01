/**
 * POST /api/contador-externo/acessos/[id]/revogar — revogação do vínculo
 * (GOAL 014, §B/§13). Terminal: a loja some do escopo do contador na próxima
 * request; a reconcessão REATIVA a mesma linha via novo convite. Evento
 * `acesso_revogado` na mesma transação. Escopo duplo: outra loja → 404 genérico.
 */
import { revogarVinculo } from "@/lib/contador/auth-externa/acessos"
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
    const acesso = await revogarVinculo(resolverRepoAuthExterna(), {
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
