/**
 * GET /api/contador-externo/auth/sessao — estado da sessão externa (GOAL 014, §13).
 *
 * Identificação MÍNIMA: id técnico + nome da identidade e as lojas do escopo
 * (vínculos ATIVOS — único conteúdo autenticado do portal no 014; nenhum dado
 * contábil). Falha fechada: qualquer desvio → 401/403/503 genérico. Se a sessão
 * rotacionou na validação (>50% da vida), o cookie novo é regravado na resposta.
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
} from "../../_shared"

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
  const res = jsonOkExterno({
    ok: true,
    usuario: { id: identidade.usuario.id, nome: identidade.usuario.nome },
    lojas,
  })
  aplicarRotacaoExterna(res, identidade.rotacao)
  return res
}
