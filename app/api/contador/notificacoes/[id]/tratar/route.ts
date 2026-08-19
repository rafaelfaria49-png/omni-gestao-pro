/**
 * POST /api/contador/notificacoes/[id]/tratar
 *
 * Reavalia o alerta no servidor (loja + competência) e garante a trilha
 * `alerta_emitido` → `alerta_tratado` na mesma transação.
 * Não exige POST /avaliar prévio. Idempotente. Não confia em metadata do cliente.
 */
import { NextResponse } from "next/server"
import { requireContadorScope } from "@/lib/contador/scope"
import { tratarAlerta } from "@/lib/contador/notificacoes/service"
import { criarRepoNotificacoes } from "@/lib/contador/notificacoes/repo-prisma"
import {
  CABECALHO_PRIVADO,
  competenciaOuErro,
  lerCorpoJson,
  respostaChaveProibida,
  respostaErroNotificacao,
  respostaFalhaEscopo,
  temChaveProibida,
} from "@/lib/contador/notificacoes/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: Ctx) {
  const url = new URL(req.url)
  const body = await lerCorpoJson(req)
  if (temChaveProibida(url.searchParams) || temChaveProibida(body)) return respostaChaveProibida()

  const escopo = await requireContadorScope()
  if (!escopo.ok) return respostaFalhaEscopo(escopo)

  try {
    const { id } = await ctx.params
    const codigo = url.searchParams.get("c") ?? body.c ?? ""
    const comp = competenciaOuErro(codigo)
    const resultado = await tratarAlerta(
      { storeId: escopo.storeId, userId: escopo.userId },
      comp,
      id,
      criarRepoNotificacoes(),
    )
    return NextResponse.json(
      { ok: true, id: resultado.id, tratado: true },
      { headers: CABECALHO_PRIVADO },
    )
  } catch (e) {
    return respostaErroNotificacao(e)
  }
}
