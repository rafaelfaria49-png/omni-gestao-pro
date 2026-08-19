/**
 * GET /api/contador/notificacoes?c=AAAA-MM
 *
 * SOMENTE LEITURA: avalia e lista avisos atuais. Consulta histórico/dedupe.
 * Zero INSERT/UPDATE.
 */
import { NextResponse } from "next/server"
import { requireContadorScope } from "@/lib/contador/scope"
import { listarAlertas } from "@/lib/contador/notificacoes/service"
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

export async function GET(req: Request) {
  const url = new URL(req.url)
  if (temChaveProibida(url.searchParams)) return respostaChaveProibida()

  const escopo = await requireContadorScope()
  if (!escopo.ok) return respostaFalhaEscopo(escopo)

  try {
    const comp = competenciaOuErro(url.searchParams.get("c") ?? "")
    const resultado = await listarAlertas(
      { storeId: escopo.storeId, userId: escopo.userId },
      comp,
      criarRepoNotificacoes(),
    )
    return NextResponse.json(
      { ok: true, competencia: resultado.competencia, avisos: resultado.avisos, fontePacote: resultado.fontePacote },
      { headers: CABECALHO_PRIVADO },
    )
  } catch (e) {
    return respostaErroNotificacao(e)
  }
}
