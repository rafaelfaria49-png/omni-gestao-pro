/**
 * GET /api/contador-externo/acessos — vínculos contador↔loja da loja ativa
 * INTERNA (GOAL 014, §13). Todos os estados (a UI mostra o ciclo de vida),
 * enriquecidos com a identificação do usuário externo (visão admin — o e-mail
 * já foi informado pelo próprio admin na criação do convite).
 */
import { listarVinculosDaLoja } from "@/lib/contador/auth-externa/acessos"
import { respostaErroAuthExterna } from "@/lib/contador/auth-externa/http"
import {
  guardAdminExterno,
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

  const guard = await guardAdminExterno()
  if (!guard.ok) return guard.resposta

  try {
    const repo = resolverRepoAuthExterna()
    const vinculos = await listarVinculosDaLoja(repo, guard.escopo.storeId)
    const acessos = await Promise.all(
      vinculos.map(async (vinculo) => {
        const usuario = await repo.buscarUsuarioPorId(vinculo.usuarioId)
        return {
          ...vinculo,
          usuario: usuario
            ? { id: usuario.id, email: usuario.email, nome: usuario.nome, status: usuario.status }
            : null,
        }
      }),
    )
    return jsonOkExterno({ ok: true, acessos })
  } catch (e) {
    return jsonExterno(respostaErroAuthExterna(e))
  }
}
