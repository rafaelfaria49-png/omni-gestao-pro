/**
 * POST /api/contador-externo/auth/logout — encerra a sessão externa (GOAL 014).
 *
 * Revoga a linha `ContadorSessaoExterna` (idempotente — até sessão expirada é
 * revogada) e limpa o cookie. Cookie ausente/adulterado também limpa, sem revelar
 * nada. Funciona mesmo sem o segredo de sessão (limpar cookie não exige HMAC).
 */
import { respostaErroAuthExterna } from "@/lib/contador/auth-externa/http"
import { extrairTokenSessaoExterna, logoutSessaoExterna } from "@/lib/contador/auth-externa/sessao"
import {
  aplicarCookieExterno,
  ipDoRequest,
  jsonExterno,
  jsonOkExterno,
  respostaChaveProibida,
  resolverRepoAuthExterna,
  temChaveProibida,
} from "../../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function POST(req: Request) {
  const url = new URL(req.url)
  if (temChaveProibida(url.searchParams)) return respostaChaveProibida()

  try {
    const token = extrairTokenSessaoExterna(req.headers.get("cookie"))
    const logout = await logoutSessaoExterna(resolverRepoAuthExterna(), token, { ip: ipDoRequest(req) })
    const res = jsonOkExterno({ ok: true })
    aplicarCookieExterno(res, logout.cookieLimpo)
    return res
  } catch (e) {
    return jsonExterno(respostaErroAuthExterna(e))
  }
}
