/**
 * POST /api/contador/agenda/obrigacoes/:id/status
 *
 * Reutiliza a matriz 011 (`resolverTransicao`). Não sobrecarrega /api/contador/status.
 * conferir/resolver exigem `podeConferir`.
 */
import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { requireContadorScope } from "@/lib/contador/scope"
import { respostaFalhaEscopo, logEvento } from "@/lib/contador/documentos/http"
import { resolverCapacidadesContador } from "@/lib/contador/status/permissoes"
import { alterarStatusObrigacao, criarRepoAgenda } from "@/lib/contador/agenda"
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
    const obrigacao = await alterarStatusObrigacao(
      { storeId: escopo.storeId, userId: escopo.userId },
      { obrigacaoId: id, para: body.para, motivo: body.motivo },
      capacidades,
      { repo: criarRepoAgenda() },
    )
    logEvento("contador_agenda_obrigacao_status", {
      storeId: escopo.storeId,
      userId: escopo.userId,
      id,
      statusNovo: obrigacao.status,
    })
    return NextResponse.json({ ok: true, obrigacao }, { headers: CACHE_PRIVADO })
  } catch (e) {
    return respostaErroAgenda(e)
  }
}
