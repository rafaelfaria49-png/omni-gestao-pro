/**
 * POST /api/contador/agenda/guias
 *
 * Guia 100% informada: titulo, valorCentavos ≥ 0, vencimento AAAA-MM-DD.
 * Sem cálculo fiscal. PDF/comprovante = documentos 010 da mesma competência.
 */
import { NextResponse } from "next/server"
import { requireContadorScope } from "@/lib/contador/scope"
import { respostaFalhaEscopo, logEvento } from "@/lib/contador/documentos/http"
import { criarGuia, criarRepoAgenda } from "@/lib/contador/agenda"
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
  try {
    const guia = await criarGuia(
      { storeId: escopo.storeId, userId: escopo.userId },
      {
        competencia: body.competencia,
        titulo: body.titulo,
        valorCentavos: body.valorCentavos,
        vencimento: body.vencimento,
        origem: body.origem,
        obrigacaoId: body.obrigacaoId,
        pdfDocumentoId: body.pdfDocumentoId,
        comprovanteDocumentoId: body.comprovanteDocumentoId,
      },
      { repo: criarRepoAgenda() },
    )
    logEvento("contador_agenda_guia_informada", { storeId: escopo.storeId, userId: escopo.userId, id: guia.id })
    return NextResponse.json({ ok: true, guia, avisos: guia.pdfAusente ? ["pdfAusente"] : [] }, { headers: CACHE_PRIVADO })
  } catch (e) {
    return respostaErroAgenda(e)
  }
}
