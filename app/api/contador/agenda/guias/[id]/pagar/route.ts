/**
 * POST /api/contador/agenda/guias/:id/pagar
 *
 * One-way: pagaEm. Exige `podeConferir`. Comprovante opcional (aviso comprovanteAusente).
 */
import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { requireContadorScope } from "@/lib/contador/scope"
import { respostaFalhaEscopo, logEvento } from "@/lib/contador/documentos/http"
import { resolverCapacidadesContador } from "@/lib/contador/status/permissoes"
import { criarRepoAgenda, pagarGuia } from "@/lib/contador/agenda"
import {
  CACHE_PRIVADO,
  RESPOSTA_CHAVE_PROIBIDA,
  respostaErroAgenda,
  temChaveProibida,
} from "@/lib/contador/agenda/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: Ctx) {
  const url = new URL(req.url)
  if (temChaveProibida(url.searchParams)) return RESPOSTA_CHAVE_PROIBIDA
  const escopo = await requireContadorScope()
  if (!escopo.ok) return respostaFalhaEscopo(escopo)
  let body: Record<string, unknown> = {}
  try {
    body = ((await req.json()) as Record<string, unknown>) ?? {}
  } catch {
    body = {}
  }
  if (temChaveProibida(body)) return RESPOSTA_CHAVE_PROIBIDA
  const { id } = await ctx.params
  const capacidades = resolverCapacidadesContador(await auth())
  try {
    const guia = await pagarGuia(
      { storeId: escopo.storeId, userId: escopo.userId },
      id,
      body,
      capacidades,
      { repo: criarRepoAgenda() },
    )
    logEvento("contador_agenda_guia_paga", { storeId: escopo.storeId, userId: escopo.userId, id })
    return NextResponse.json(
      { ok: true, guia, avisos: guia.comprovanteAusente ? ["comprovanteAusente"] : [] },
      { headers: CACHE_PRIVADO },
    )
  } catch (e) {
    return respostaErroAgenda(e)
  }
}
