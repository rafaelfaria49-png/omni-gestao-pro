/**
 * PATCH /api/contador/agenda/guias/:id — só se ainda não paga.
 */
import { NextResponse } from "next/server"
import { requireContadorScope } from "@/lib/contador/scope"
import { respostaFalhaEscopo, logEvento } from "@/lib/contador/documentos/http"
import { atualizarGuia, criarRepoAgenda } from "@/lib/contador/agenda"
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

export async function PATCH(req: Request, ctx: Ctx) {
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
  try {
    const guia = await atualizarGuia(
      { storeId: escopo.storeId, userId: escopo.userId },
      id,
      body,
      { repo: criarRepoAgenda() },
    )
    logEvento("contador_agenda_guia_atualizada", { storeId: escopo.storeId, userId: escopo.userId, id })
    return NextResponse.json({ ok: true, guia }, { headers: CACHE_PRIVADO })
  } catch (e) {
    return respostaErroAgenda(e)
  }
}
