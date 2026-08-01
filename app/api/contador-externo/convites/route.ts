/**
 * /api/contador-externo/convites — gestão INTERNA de convites (GOAL 014, §13).
 *
 * POST cria (admin ERP autenticado + `podeGerenciarAcessoExterno`; loja = loja
 * ativa da sessão INTERNA, nunca do cliente) e retorna URL+token UMA única vez —
 * o token NUNCA é persistido nem logado, e a listagem NUNCA expõe `tokenHash`.
 * GET lista os convites da loja ativa (pendentes/expirados/usados/revogados).
 */
import { criarConvite, listarConvites } from "@/lib/contador/auth-externa/convites"
import { lerCorpoJsonExterno, respostaErroAuthExterna } from "@/lib/contador/auth-externa/http"
import {
  CHAVES_PROIBIDAS_INTERNO_CONVITE,
  guardAdminExterno,
  ipHashDoRequest,
  jsonExterno,
  jsonOkExterno,
  respostaChaveProibida,
  resolverRepoAuthExterna,
  temChaveProibida,
  validarPapelConvite,
} from "../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function POST(req: Request) {
  const url = new URL(req.url)
  if (temChaveProibida(url.searchParams, CHAVES_PROIBIDAS_INTERNO_CONVITE)) {
    return respostaChaveProibida()
  }

  const guard = await guardAdminExterno()
  if (!guard.ok) return guard.resposta

  const body = await lerCorpoJsonExterno(req)
  // `papel` é entrada legítima do admin aqui (D-5); as demais chaves de escopo não.
  if (temChaveProibida(body, CHAVES_PROIBIDAS_INTERNO_CONVITE)) return respostaChaveProibida()

  try {
    const papel = validarPapelConvite(body.papel)
    const criado = await criarConvite(resolverRepoAuthExterna(), {
      email: typeof body.email === "string" ? body.email : "",
      storeId: guard.escopo.storeId,
      papel,
      criadoPorId: guard.adminId,
      ipHash: await ipHashDoRequest(req),
    })
    // URL+token retornados UMA única vez; o envio é por link copiável (sem SMTP — §0.3).
    // Ajuste G3: o token viaja no FRAGMENTO (`#token=`) — nunca em path nem query,
    // para não vazar em logs de acesso, proxies, histórico ou Referer (R-1).
    const link = `${url.origin}/contador-externo/convite#token=${criado.token}`
    return jsonOkExterno({ ok: true, convite: criado.convite, token: criado.token, url: link }, 201)
  } catch (e) {
    return jsonExterno(respostaErroAuthExterna(e))
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  if (temChaveProibida(url.searchParams)) return respostaChaveProibida()

  const guard = await guardAdminExterno()
  if (!guard.ok) return guard.resposta

  try {
    const convites = await listarConvites(resolverRepoAuthExterna(), guard.escopo.storeId)
    return jsonOkExterno({ ok: true, convites })
  } catch (e) {
    return jsonExterno(respostaErroAuthExterna(e))
  }
}
