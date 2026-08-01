/**
 * POST /api/contador-externo/convite/consultar — consulta PÚBLICA do estado do
 * convite (GOAL 014, ajuste G3: token NUNCA em path nem query).
 *
 * O token viaja SOMENTE no body (`{ token }`) de um POST — substitui o antigo
 * `GET /convite/[token]` (path) e qualquer `?token=` (query), que vazariam o
 * segredo em logs de acesso, proxies e histórico (R-1). A página estática
 * `/contador-externo/convite` lê o token do FRAGMENTO (`#token=`, nunca vai ao
 * servidor por navegação) e o envia aqui.
 *
 * Estados honestos (valido/expirado/revogado/utilizado; desconhecido → "invalido"
 * genérico, sem enumeração) e e-mail SEMPRE mascarado. Resposta com
 * `Cache-Control: private, no-store` E `Referrer-Policy: no-referrer`.
 */
import { consultarConvitePublico } from "@/lib/contador/auth-externa/convites"
import { lerCorpoJsonExterno, respostaChaveProibidaExterna, respostaErroAuthExterna } from "@/lib/contador/auth-externa/http"
import {
  jsonExterno,
  jsonOkExterno,
  resolverRepoAuthExterna,
  temChaveProibida,
} from "../../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

/** O token nunca aparece em URL — a resposta também não contribui para vazá-lo. */
const SEM_REFERRER = { "Referrer-Policy": "no-referrer" } as const

export async function POST(req: Request) {
  const url = new URL(req.url)
  if (temChaveProibida(url.searchParams)) {
    return jsonExterno(respostaChaveProibidaExterna(), SEM_REFERRER)
  }

  const body = await lerCorpoJsonExterno(req)
  if (temChaveProibida(body)) {
    return jsonExterno(respostaChaveProibidaExterna(), SEM_REFERRER)
  }

  const token = typeof body.token === "string" ? body.token : ""
  try {
    const consulta = await consultarConvitePublico(resolverRepoAuthExterna(), token)
    return jsonOkExterno({ ok: true, ...consulta }, 200, SEM_REFERRER)
  } catch (e) {
    return jsonExterno(respostaErroAuthExterna(e), SEM_REFERRER)
  }
}
