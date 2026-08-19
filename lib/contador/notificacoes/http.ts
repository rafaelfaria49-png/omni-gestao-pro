/**
 * Contador HUB · HTTP dos avisos (GOAL 017).
 */
import { NextResponse } from "next/server"
import { parseCompetencia, type Competencia } from "@/lib/contador/competencia"
import type { FalhaEscopoContador } from "@/lib/contador/scope-core"
import { AlertaNaoEncontradoError, CompetenciaNotificacaoInvalidaError } from "./service"

export const CHAVES_PROIBIDAS_NOTIFICACOES = [
  "storeId",
  "lojaId",
  "papel",
  "role",
  "userId",
  "atorId",
  "autorId",
  "competenciaId",
  "regra",
  "alvo",
  "janela",
] as const

export function temChaveProibida(fonte: Record<string, unknown> | URLSearchParams): boolean {
  if (fonte instanceof URLSearchParams) {
    return CHAVES_PROIBIDAS_NOTIFICACOES.some((k) => fonte.has(k))
  }
  return CHAVES_PROIBIDAS_NOTIFICACOES.some((k) => Object.prototype.hasOwnProperty.call(fonte, k))
}

export function respostaChaveProibida(): NextResponse {
  return NextResponse.json(
    { ok: false, mensagem: "O endpoint não aceita loja, usuário, papel, competência por id nem metadados de alerta." },
    { status: 400 },
  )
}

export const MOTIVO_STATUS: Record<FalhaEscopoContador["motivo"], number> = {
  nao_autenticado: 401,
  loja_ausente: 400,
  sem_acesso_loja: 403,
  sem_permissao: 403,
}

export const MOTIVO_MSG: Record<FalhaEscopoContador["motivo"], string> = {
  nao_autenticado: "Sessão não encontrada. Faça login para ver os avisos do contador.",
  loja_ausente: "Nenhuma loja ativa selecionada. Escolha uma unidade.",
  sem_acesso_loja: "Avisos indisponíveis para a unidade ativa.",
  sem_permissao: "Sua conta não tem permissão para acessar o Contador HUB.",
}

export function respostaFalhaEscopo(escopo: FalhaEscopoContador): NextResponse {
  return NextResponse.json(
    { ok: false, motivo: escopo.motivo, mensagem: MOTIVO_MSG[escopo.motivo] },
    { status: MOTIVO_STATUS[escopo.motivo] },
  )
}

export function competenciaOuErro(valor: unknown): Competencia {
  const c = parseCompetencia(valor)
  if (!c) throw new CompetenciaNotificacaoInvalidaError()
  return c
}

export function respostaErroNotificacao(e: unknown): NextResponse {
  if (e instanceof CompetenciaNotificacaoInvalidaError) {
    return NextResponse.json({ ok: false, mensagem: e.message }, { status: 400 })
  }
  if (e instanceof AlertaNaoEncontradoError) {
    return NextResponse.json({ ok: false, mensagem: e.message }, { status: 404 })
  }
  return NextResponse.json(
    { ok: false, mensagem: "Não foi possível concluir a operação agora. Tente novamente em instantes." },
    { status: 500 },
  )
}

export const CABECALHO_PRIVADO = { "Cache-Control": "private, no-store, max-age=0" } as const

export async function lerCorpoJson(req: Request): Promise<Record<string, unknown>> {
  try {
    return ((await req.json()) as Record<string, unknown>) ?? {}
  } catch {
    return {}
  }
}
