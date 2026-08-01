/**
 * POST /api/contador-externo/auth/login — login do portal externo (GOAL 014, §13).
 *
 * Anti-enumeração (R-2): resposta única e genérica para usuário inexistente,
 * senha errada e conta suspensa; `bcrypt.compare` roda em toda tentativa (no
 * domínio). Rate limit por e-mail+IP (R-3): 6ª tentativa → 429 + `Retry-After`.
 * Sem `CONTADOR_EXTERNO_SESSION_SECRET` → 503 fail-closed (R-9), nunca fallback.
 */
import { logEventoExterno } from "@/lib/contador/auth-externa/eventos"
import {
  lerCorpoJsonExterno,
  respostaErroAuthExterna,
  respostaLoginInvalido,
  respostaRateLimitExterno,
} from "@/lib/contador/auth-externa/http"
import {
  checkRateLimitExterno,
  montarChaveRateLimitExterno,
  registerFalhaExterna,
  registerSucessoExterno,
} from "@/lib/contador/auth-externa/rate-limit"
import { autenticarECriarSessao } from "@/lib/contador/auth-externa/sessao"
import {
  aplicarCookieExterno,
  ipDoRequest,
  ipHashDoRequest,
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

  const body = await lerCorpoJsonExterno(req)
  if (temChaveProibida(body)) return respostaChaveProibida()

  const email = typeof body.email === "string" ? body.email : ""
  const senha = typeof body.senha === "string" ? body.senha : ""
  const ip = ipDoRequest(req)
  const ipHash = await ipHashDoRequest(req)

  const chave = montarChaveRateLimitExterno(email, ip)
  const limite = checkRateLimitExterno(chave)
  if (limite.limited) {
    logEventoExterno("rate_limit_externo", { ipHash })
    return jsonExterno(respostaRateLimitExterno(limite.retryAfterSeconds), {
      "Retry-After": String(limite.retryAfterSeconds),
    })
  }

  try {
    const login = await autenticarECriarSessao(resolverRepoAuthExterna(), {
      email,
      senha,
      ip,
      userAgent: req.headers.get("user-agent"),
    })
    if (!login.ok) {
      registerFalhaExterna(chave)
      return jsonExterno(respostaLoginInvalido())
    }
    registerSucessoExterno(chave)
    const res = jsonOkExterno({
      ok: true,
      usuario: { id: login.usuario.id, nome: login.usuario.nome },
    })
    aplicarCookieExterno(res, login.cookie)
    return res
  } catch (e) {
    return jsonExterno(respostaErroAuthExterna(e))
  }
}
