/**
 * Contador HUB · alteração operacional após o fechamento (GOAL 012).
 *
 * GET  /api/contador/fechamento/divergencia?c=AAAA-MM → avalia (SOMENTE LEITURA)
 * POST /api/contador/fechamento/divergencia           → persiste o evento (idempotente)
 *
 * A separação é deliberada: a UI mostra o alerta a cada render sem que isso grave
 * nada. O evento `alteracao_pos_fechamento` só nasce por ação explícita do operador,
 * e o dedupe por (competenciaId, versao, diffHash) garante no máximo um evento por
 * divergência — repetir o POST com o mesmo diff não cria um segundo registro.
 */
import { NextResponse } from "next/server"
import { requireContadorScope } from "@/lib/contador/scope"
import { formatCompetencia } from "@/lib/contador/competencia"
import { logEvento, respostaFalhaEscopo } from "@/lib/contador/documentos/http"
import { competenciaOuErro } from "@/lib/contador/comentarios/service"
import { construirDadosContador } from "@/lib/contador/readers"
import { AVISO_DIVERGENCIA } from "@/lib/contador/fechamento/divergencia"
import { respostaErroFechamento } from "@/lib/contador/fechamento/http"
import { criarRepoFechamento } from "@/lib/contador/fechamento/repo-prisma"
import {
  CABECALHO_PRIVADO,
  lerCorpoJson,
  respostaChaveProibida,
  temChaveProibida,
} from "@/lib/contador/fechamento/rotas"
import {
  avaliarDivergencia,
  extrairTotais,
  registrarDivergencia,
  type CompetenciaFechamentoRow,
} from "@/lib/contador/fechamento/service"
import type { ContadorScopeInterno } from "@/lib/contador/scope-core"
import type { Competencia } from "@/lib/contador/competencia"
import type { Divergencia } from "@/lib/contador/fechamento/divergencia"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

/** Carrega competência + dados vivos e compara. Não escreve nada. */
async function avaliar(
  escopo: ContadorScopeInterno,
  comp: Competencia,
): Promise<{ competencia: CompetenciaFechamentoRow | null; divergencia: Divergencia | null }> {
  const repo = criarRepoFechamento()
  const competencia = await repo.acharCompetencia(escopo.storeId, comp)
  if (!competencia) return { competencia: null, divergencia: null }

  // Só vale comparar competência fechada — sem snapshot não há linha de base.
  if (competencia.status !== "FECHADA") return { competencia, divergencia: null }

  const dados = await construirDadosContador(escopo, comp)
  return { competencia, divergencia: avaliarDivergencia(competencia, extrairTotais(dados)) }
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  if (temChaveProibida(url.searchParams)) return respostaChaveProibida()

  const escopo = await requireContadorScope()
  if (!escopo.ok) return respostaFalhaEscopo(escopo)

  try {
    const comp = competenciaOuErro(url.searchParams.get("c") ?? "")
    const { competencia, divergencia } = await avaliar(escopo, comp)
    return NextResponse.json(
      {
        ok: true,
        aplicavel: Boolean(competencia && competencia.status === "FECHADA"),
        versao: competencia?.versao ?? null,
        divergente: divergencia?.divergente ?? false,
        diffHash: divergencia?.diffHash ?? null,
        itens: divergencia?.itens ?? [],
        aviso: divergencia?.divergente ? AVISO_DIVERGENCIA : null,
      },
      { headers: CABECALHO_PRIVADO },
    )
  } catch (e) {
    return respostaErroFechamento(e)
  }
}

export async function POST(req: Request) {
  const url = new URL(req.url)
  if (temChaveProibida(url.searchParams)) return respostaChaveProibida()

  const escopo = await requireContadorScope()
  if (!escopo.ok) return respostaFalhaEscopo(escopo)

  const body = await lerCorpoJson(req)
  if (temChaveProibida(body)) return respostaChaveProibida()

  try {
    const comp = competenciaOuErro(body.competencia)
    const { competencia, divergencia } = await avaliar(escopo, comp)

    if (!competencia || !divergencia || !divergencia.divergente) {
      return NextResponse.json({ ok: true, registrado: false, divergente: false })
    }

    const { criado } = await registrarDivergencia(
      { storeId: escopo.storeId, userId: escopo.userId },
      comp,
      competencia,
      divergencia,
      { repo: criarRepoFechamento() },
    )
    if (criado) {
      logEvento("contador_alteracao_pos_fechamento", {
        storeId: escopo.storeId,
        userId: escopo.userId,
        // Era `body.competencia` — valor CRU do cliente indo direto para o log
        // estruturado. Agora vai a forma canônica já validada (GOAL 012E · P3).
        competencia: formatCompetencia(comp),
        versao: competencia.versao,
        diffHash: divergencia.diffHash,
      })
    }
    return NextResponse.json({
      ok: true,
      registrado: criado,
      divergente: true,
      diffHash: divergencia.diffHash,
    })
  } catch (e) {
    return respostaErroFechamento(e)
  }
}
