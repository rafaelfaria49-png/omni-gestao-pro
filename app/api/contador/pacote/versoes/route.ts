/**
 * Contador HUB · versões persistidas do pacote oficial (GOAL 012).
 *
 * GET /api/contador/pacote/versoes?c=AAAA-MM → lista imutável de versões
 *
 * SOMENTE LEITURA. O DTO nunca expõe `storageRef` nem URL — baixar exige o endpoint
 * de download, que autoriza e audita cada acesso.
 */
import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { requireContadorScope } from "@/lib/contador/scope"
import { respostaFalhaEscopo } from "@/lib/contador/documentos/http"
import { competenciaOuErro } from "@/lib/contador/comentarios/service"
import { resolverCapacidadesContador } from "@/lib/contador/status/permissoes"
import { respostaErroFechamento } from "@/lib/contador/fechamento/http"
import { criarRepoFechamento } from "@/lib/contador/fechamento/repo-prisma"
import { CABECALHO_PRIVADO, respostaChaveProibida, temChaveProibida } from "@/lib/contador/fechamento/rotas"
import { carregarEstadoFechamento } from "@/lib/contador/fechamento/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET(req: Request) {
  const url = new URL(req.url)
  if (temChaveProibida(url.searchParams)) return respostaChaveProibida()

  const escopo = await requireContadorScope()
  if (!escopo.ok) return respostaFalhaEscopo(escopo)

  const capacidades = resolverCapacidadesContador(await auth())

  try {
    const comp = competenciaOuErro(url.searchParams.get("c") ?? "")
    const estado = await carregarEstadoFechamento(
      { storeId: escopo.storeId, userId: escopo.userId },
      capacidades,
      comp,
      { repo: criarRepoFechamento() },
    )
    return NextResponse.json(
      {
        ok: true,
        competencia: estado.competencia,
        status: estado.status,
        versao: estado.versao,
        pacotes: estado.pacotes,
      },
      { headers: CABECALHO_PRIVADO },
    )
  } catch (e) {
    return respostaErroFechamento(e)
  }
}
