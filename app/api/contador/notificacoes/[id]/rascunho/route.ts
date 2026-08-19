/**
 * GET /api/contador/notificacoes/[id]/rascunho?c=AAAA-MM
 *
 * Gera rascunho pt-BR somente para alerta atualmente ativo.
 * Tratado/suprimido → 404. Nunca envia. Não há rota de envio externo.
 */
import { NextResponse } from "next/server"
import { requireContadorScope } from "@/lib/contador/scope"
import { rascunhoAlerta } from "@/lib/contador/notificacoes/service"
import { criarRepoNotificacoes } from "@/lib/contador/notificacoes/repo-prisma"
import {
  CABECALHO_PRIVADO,
  competenciaOuErro,
  respostaChaveProibida,
  respostaErroNotificacao,
  respostaFalhaEscopo,
  temChaveProibida,
} from "@/lib/contador/notificacoes/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: Ctx) {
  const url = new URL(req.url)
  if (temChaveProibida(url.searchParams)) return respostaChaveProibida()

  const escopo = await requireContadorScope()
  if (!escopo.ok) return respostaFalhaEscopo(escopo)

  try {
    const { id } = await ctx.params
    const comp = competenciaOuErro(url.searchParams.get("c") ?? "")
    const rascunho = await rascunhoAlerta(
      { storeId: escopo.storeId, userId: escopo.userId },
      comp,
      id,
      criarRepoNotificacoes(),
    )
    return NextResponse.json({ ok: true, rascunho }, { headers: CABECALHO_PRIVADO })
  } catch (e) {
    return respostaErroNotificacao(e)
  }
}
