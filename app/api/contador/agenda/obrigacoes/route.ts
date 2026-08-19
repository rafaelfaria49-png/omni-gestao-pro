/**
 * GET/POST /api/contador/agenda/obrigacoes
 *
 * GET lista via agenda (use GET /api/contador/agenda). POST cria manual ou
 * instancia um template explícito (incluindo `nenhuma`).
 */
import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { requireContadorScope } from "@/lib/contador/scope"
import { respostaFalhaEscopo, logEvento } from "@/lib/contador/documentos/http"
import { resolverCapacidadesContador } from "@/lib/contador/status/permissoes"
import { criarObrigacao, criarRepoAgenda, listarAgenda } from "@/lib/contador/agenda"
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
    return NextResponse.json({ ok: true, obrigacoes: agenda.obrigacoes, competencia: agenda.competencia }, { headers: CACHE_PRIVADO })
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
  const capacidades = resolverCapacidadesContador(await auth())
  try {
    const obrigacao = await criarObrigacao(
      { storeId: escopo.storeId, userId: escopo.userId },
      {
        competencia: body.competencia,
        titulo: body.titulo,
        descricao: body.descricao,
        tipo: body.tipo,
        vencimento: body.vencimento,
        templateId: body.templateId,
      },
      capacidades,
      { repo: criarRepoAgenda() },
    )
    logEvento("contador_agenda_obrigacao_criada", {
      storeId: escopo.storeId,
      userId: escopo.userId,
      id: obrigacao.id,
    })
    return NextResponse.json({ ok: true, obrigacao }, { headers: CACHE_PRIVADO })
  } catch (e) {
    return respostaErroAgenda(e)
  }
}
