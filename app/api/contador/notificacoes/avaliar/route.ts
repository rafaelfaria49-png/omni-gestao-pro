/**
 * POST /api/contador/notificacoes/avaliar
 *
 * Ação explícita: reavalia fontes e persiste somente novos `alerta_emitido`.
 * Dedupe forte (lock da competência). Não envia mensagem.
 */
import { NextResponse } from "next/server"
import { requireContadorScope } from "@/lib/contador/scope"
import { avaliarEPersistir } from "@/lib/contador/notificacoes/service"
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

export async function POST(req: Request) {
  const url = new URL(req.url)
  const body = await lerCorpoJson(req)
  if (temChaveProibida(url.searchParams) || temChaveProibida(body)) return respostaChaveProibida()

  const escopo = await requireContadorScope()
  if (!escopo.ok) return respostaFalhaEscopo(escopo)

  try {
    const codigo = url.searchParams.get("c") ?? body.c ?? ""
    const comp = competenciaOuErro(codigo)
    const resultado = await avaliarEPersistir(
      { storeId: escopo.storeId, userId: escopo.userId },
      comp,
      criarRepoNotificacoes(),
    )
    return NextResponse.json(
      {
        ok: true,
        competencia: resultado.competencia,
        avisos: resultado.avisos,
        emitidos: resultado.emitidos,
      },
      { headers: CABECALHO_PRIVADO },
    )
  } catch (e) {
    return respostaErroNotificacao(e)
  }
}
