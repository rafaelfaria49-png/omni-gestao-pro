/**
 * GET/POST /api/contador/agenda/templates
 */
import { NextResponse } from "next/server"
import { requireContadorScope } from "@/lib/contador/scope"
import { respostaFalhaEscopo, logEvento } from "@/lib/contador/documentos/http"
import { criarRepoAgenda, criarTemplate, listarTemplates } from "@/lib/contador/agenda"
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
  try {
    const templates = await listarTemplates(
      { storeId: escopo.storeId, userId: escopo.userId },
      { repo: criarRepoAgenda() },
    )
    return NextResponse.json({ ok: true, templates }, { headers: CACHE_PRIVADO })
  } catch (e) {
    return respostaErroAgenda(e)
  }
}

export async function POST(req: Request) {
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
  try {
    const template = await criarTemplate(
      { storeId: escopo.storeId, userId: escopo.userId },
      {
        titulo: body.titulo,
        descricao: body.descricao,
        tipo: body.tipo,
        diaVencimento: body.diaVencimento,
        recorrencia: body.recorrencia,
      },
      { repo: criarRepoAgenda() },
    )
    logEvento("contador_agenda_template_criado", { storeId: escopo.storeId, userId: escopo.userId, id: template.id })
    return NextResponse.json({ ok: true, template }, { headers: CACHE_PRIVADO })
  } catch (e) {
    return respostaErroAgenda(e)
  }
}
