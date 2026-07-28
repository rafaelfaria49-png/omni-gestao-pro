/**
 * Contador HUB · reabertura de competência fechada (GOAL 012).
 *
 * POST /api/contador/fechamento/reabrir  { competencia, confirmacao, motivo }
 *
 * Reabrir é transição AUDITADA, nunca um desfazer: incrementa a versão, preserva
 * pacote/snapshot/eventos anteriores e exige motivo — gravado como comentário interno
 * imutável dentro da MESMA transação, com o evento guardando só ponteiro e tamanho.
 */
import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { requireContadorScope } from "@/lib/contador/scope"
import { logEvento, respostaFalhaEscopo } from "@/lib/contador/documentos/http"
import { competenciaOuErro } from "@/lib/contador/comentarios/service"
import { resolverCapacidadesContador } from "@/lib/contador/status/permissoes"
import { respostaErroFechamento } from "@/lib/contador/fechamento/http"
import { criarRepoFechamento } from "@/lib/contador/fechamento/repo-prisma"
import { lerCorpoJson, respostaChaveProibida, temChaveProibida } from "@/lib/contador/fechamento/rotas"
import { reabrirCompetencia } from "@/lib/contador/fechamento/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function POST(req: Request) {
  const url = new URL(req.url)
  if (temChaveProibida(url.searchParams)) return respostaChaveProibida()

  const escopo = await requireContadorScope()
  if (!escopo.ok) return respostaFalhaEscopo(escopo)

  const body = await lerCorpoJson(req)
  if (temChaveProibida(body)) return respostaChaveProibida()

  const capacidades = resolverCapacidadesContador(await auth())

  try {
    const comp = competenciaOuErro(body.competencia)
    const resultado = await reabrirCompetencia(
      { storeId: escopo.storeId, userId: escopo.userId },
      capacidades,
      comp,
      { confirmacao: body.confirmacao, motivo: body.motivo },
      { repo: criarRepoFechamento() },
    )
    logEvento("contador_competencia_reaberta", {
      storeId: escopo.storeId,
      userId: escopo.userId,
      competencia: resultado.competencia,
      versaoAnterior: resultado.versaoAnterior,
      versao: resultado.versao,
    })
    return NextResponse.json({ ok: true, ...resultado })
  } catch (e) {
    return respostaErroFechamento(e)
  }
}
