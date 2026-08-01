/**
 * GET /api/contador-externo/lojas — lojas do escopo do contador (GOAL 014, §13).
 *
 * SOMENTE vínculos `ContadorAcesso` ATIVOS (suspenso/revogado some da lista) —
 * prova de identidade/escopo. NENHUM dado contábil: competências, documentos,
 * pacotes e dashboard são GOAL 015 e não existem neste namespace.
 */
import { listarLojasDoEscopo } from "@/lib/contador/auth-externa/acessos"
import { resolverIdentidadeExterna } from "@/lib/contador/auth-externa/escopo-externo"
import { respostaFalhaEscopoExterno } from "@/lib/contador/auth-externa/http"
import { extrairTokenSessaoExterna } from "@/lib/contador/auth-externa/sessao"
import {
  aplicarRotacaoExterna,
  jsonExterno,
  jsonOkExterno,
  respostaChaveProibida,
  resolverRepoAuthExterna,
  temChaveProibida,
} from "../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET(req: Request) {
  const url = new URL(req.url)
  if (temChaveProibida(url.searchParams)) return respostaChaveProibida()

  const repo = resolverRepoAuthExterna()
  const identidade = await resolverIdentidadeExterna(repo, {
    token: extrairTokenSessaoExterna(req.headers.get("cookie")),
  })
  if (!identidade.ok) return jsonExterno(respostaFalhaEscopoExterno(identidade))

  const lojas = await listarLojasDoEscopo(repo, identidade.usuario.id)
  const res = jsonOkExterno({ ok: true, lojas })
  aplicarRotacaoExterna(res, identidade.rotacao)
  return res
}
