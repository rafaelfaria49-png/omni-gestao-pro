/**
 * POST /api/contador/agenda/obrigacoes/instanciar
 *
 * «Gerar deste mês»: somente templates `mensal` ativos. `nenhuma` não entra.
 * Idempotente em (templateId, competenciaId). Nunca roda por cron/boot.
 */
import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { requireContadorScope } from "@/lib/contador/scope"
import { respostaFalhaEscopo, logEvento } from "@/lib/contador/documentos/http"
import { resolverCapacidadesContador } from "@/lib/contador/status/permissoes"
import { criarRepoAgenda, instanciarLoteMensal } from "@/lib/contador/agenda"
import {
  CACHE_PRIVADO,
  RESPOSTA_CHAVE_PROIBIDA,
  respostaErroAgenda,
  temChaveProibida,
} from "@/lib/contador/agenda/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

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
    const r = await instanciarLoteMensal(
      { storeId: escopo.storeId, userId: escopo.userId },
      body.competencia,
      capacidades,
      { repo: criarRepoAgenda() },
    )
    logEvento("contador_agenda_instanciar_lote", {
      storeId: escopo.storeId,
      userId: escopo.userId,
      criadas: r.criadas,
      existentes: r.existentes,
    })
    return NextResponse.json({ ok: true, ...r }, { headers: CACHE_PRIVADO })
  } catch (e) {
    return respostaErroAgenda(e)
  }
}
