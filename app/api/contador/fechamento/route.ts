/**
 * Contador HUB · fechamento da competência (GOAL 012).
 *
 * GET  /api/contador/fechamento?c=AAAA-MM  → estado do fechamento + versões de pacote
 * POST /api/contador/fechamento            → fecha a competência (gera snapshot + pacote)
 *
 * Contrato de segurança:
 *  - loja, usuário e papel resolvidos NO SERVIDOR (`requireContadorScope` + `auth`);
 *    `storeId`/`lojaId`/`papel`/`userId` no corpo ou na query são recusados com 400;
 *  - fechar exige papel financeiro ou administrador (403);
 *  - confirmação textual obrigatória (422) e pendências revalidadas no servidor (422);
 *  - snapshot + pacote + itens + evento nascem numa única transação.
 */
import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { requireContadorScope } from "@/lib/contador/scope"
import { logEvento, respostaFalhaEscopo } from "@/lib/contador/documentos/http"
import { competenciaOuErro } from "@/lib/contador/comentarios/service"
import { resolverCapacidadesContador } from "@/lib/contador/status/permissoes"
import { respostaErroFechamento } from "@/lib/contador/fechamento/http"
import { criarRepoFechamento } from "@/lib/contador/fechamento/repo-prisma"
import { criarPortasFechamento } from "@/lib/contador/fechamento/portas"
import {
  CABECALHO_PRIVADO,
  lerCorpoJson,
  respostaChaveProibida,
  temChaveProibida,
} from "@/lib/contador/fechamento/rotas"
import { carregarEstadoFechamento, fecharCompetencia } from "@/lib/contador/fechamento/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET(req: Request) {
  const url = new URL(req.url)
  if (temChaveProibida(url.searchParams)) return respostaChaveProibida()

  const escopo = await requireContadorScope()
  if (!escopo.ok) return respostaFalhaEscopo(escopo)

  const capacidades = resolverCapacidadesContador(await auth())

  try {
    const comp = competenciaOuErro(url.searchParams.get("c") ?? "")
    const estado = await carregarEstadoFechamento(
      { storeId: escopo.storeId, userId: escopo.userId },
      capacidades,
      comp,
      { repo: criarRepoFechamento() },
    )
    return NextResponse.json({ ok: true, ...estado }, { headers: CABECALHO_PRIVADO })
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

  const capacidades = resolverCapacidadesContador(await auth())

  try {
    const comp = competenciaOuErro(body.competencia)
    const resultado = await fecharCompetencia(
      escopo,
      capacidades,
      comp,
      { confirmacao: body.confirmacao, pendenciasAssumidas: body.pendenciasAssumidas },
      { repo: criarRepoFechamento(), ...criarPortasFechamento() },
    )
    logEvento("contador_competencia_fechada", {
      storeId: escopo.storeId,
      userId: escopo.userId,
      competencia: resultado.competencia,
      versao: resultado.versao,
      snapshotHash: resultado.snapshotHash,
    })
    return NextResponse.json({ ok: true, ...resultado }, { status: 201 })
  } catch (e) {
    return respostaErroFechamento(e)
  }
}
