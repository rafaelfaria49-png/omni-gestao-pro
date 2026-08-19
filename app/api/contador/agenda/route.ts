/**
 * GET /api/contador/agenda?c=AAAA-MM
 *
 * Agenda da competência: obrigações + guias com flags derivadas (vencido/vencendo).
 * Não cria competência. Sem cálculo fiscal.
 */
import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { requireContadorScope } from "@/lib/contador/scope"
import { respostaFalhaEscopo } from "@/lib/contador/documentos/http"
import { resolverCapacidadesContador } from "@/lib/contador/status/permissoes"
import { criarRepoAgenda, listarAgenda } from "@/lib/contador/agenda"
import {
  CACHE_PRIVADO,
  RESPOSTA_CHAVE_PROIBIDA,
  respostaErroAgenda,
  temChaveProibida,
} from "@/lib/contador/agenda/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET(req: Request) {
  const url = new URL(req.url)
  if (temChaveProibida(url.searchParams)) return RESPOSTA_CHAVE_PROIBIDA

  const escopo = await requireContadorScope()
  if (!escopo.ok) return respostaFalhaEscopo(escopo)

  const capacidades = resolverCapacidadesContador(await auth())
  try {
    const agenda = await listarAgenda(
      { storeId: escopo.storeId, userId: escopo.userId },
      url.searchParams.get("c"),
      capacidades,
      { repo: criarRepoAgenda() },
    )
    return NextResponse.json({ ok: true, ...agenda }, { headers: CACHE_PRIVADO })
  } catch (e) {
    return respostaErroAgenda(e)
  }
}
