/**
 * Contador HUB · Documentos — helpers HTTP das rotas (GOAL 010).
 *
 * Centraliza o mapeamento escopo→status (mesmo contrato do pacote/008), a tradução
 * de erros de domínio para HTTP e o log estruturado sem segredos. Mensagens ao
 * cliente são sempre seguras — nunca vazam token, URL assinada, path ou stack.
 */
import { NextResponse } from "next/server"
import type { FalhaEscopoContador } from "@/lib/contador/scope-core"
import { StorageConfigError, StorageProviderError } from "./config"
import { StorageError } from "./storage-types"
import { UploadIntentInvalidoError, UploadIntentSegredoError } from "./intent"
import { DocumentoValidacaoError } from "./validacao"
import {
  CompetenciaFechadaError,
  DocumentoConflitoError,
  DocumentoNaoEncontradoError,
} from "./service"

export const MOTIVO_STATUS: Record<FalhaEscopoContador["motivo"], number> = {
  nao_autenticado: 401,
  loja_ausente: 400,
  sem_acesso_loja: 403,
  sem_permissao: 403,
}

export const MOTIVO_MSG: Record<FalhaEscopoContador["motivo"], string> = {
  nao_autenticado: "Sessão não encontrada. Faça login para acessar os documentos do contador.",
  loja_ausente: "Nenhuma loja ativa selecionada. Escolha uma unidade.",
  sem_acesso_loja: "Documentos indisponíveis para a unidade ativa.",
  sem_permissao: "Sua conta não tem permissão para acessar os documentos do Contador HUB.",
}

/** Resposta padrão de falha de escopo. */
export function respostaFalhaEscopo(escopo: FalhaEscopoContador): NextResponse {
  return NextResponse.json(
    { ok: false, motivo: escopo.motivo, mensagem: MOTIVO_MSG[escopo.motivo] },
    { status: MOTIVO_STATUS[escopo.motivo] },
  )
}

/** Traduz um erro de domínio/infra para `{ status, body }` seguro. */
export function respostaErro(e: unknown): NextResponse {
  if (e instanceof DocumentoValidacaoError) {
    return NextResponse.json({ ok: false, campo: e.campo, mensagem: e.message }, { status: 422 })
  }
  if (e instanceof CompetenciaFechadaError) {
    return NextResponse.json({ ok: false, mensagem: e.message }, { status: 409 })
  }
  if (e instanceof DocumentoConflitoError) {
    return NextResponse.json({ ok: false, mensagem: e.message }, { status: 409 })
  }
  if (e instanceof DocumentoNaoEncontradoError) {
    return NextResponse.json({ ok: false, mensagem: e.message }, { status: 404 })
  }
  // Autorização de upload ausente/adulterada/expirada: 403. `motivo` é um rótulo
  // curto e não-sensível (nunca ecoa o token nem o path pretendido).
  if (e instanceof UploadIntentInvalidoError) {
    return NextResponse.json({ ok: false, motivo: e.motivo, mensagem: e.message }, { status: 403 })
  }
  // Provider não declarado/indevido e segredo de assinatura ausente são falhas de
  // configuração do servidor — mesma classe do StorageConfigError, nunca 500 mudo.
  if (
    e instanceof StorageConfigError ||
    e instanceof StorageProviderError ||
    e instanceof UploadIntentSegredoError
  ) {
    return NextResponse.json(
      { ok: false, mensagem: "Armazenamento de documentos indisponível. Configuração externa pendente." },
      { status: 503 },
    )
  }
  if (e instanceof StorageError) {
    return NextResponse.json(
      { ok: false, mensagem: "Falha temporária no armazenamento. Tente novamente em instantes." },
      { status: 502 },
    )
  }
  return NextResponse.json(
    { ok: false, mensagem: "Não foi possível concluir a operação agora. Tente novamente em instantes." },
    { status: 500 },
  )
}

/** Log estruturado server-side — nunca inclui secret, token, URL assinada nem PII. */
export function logEvento(evento: string, campos: Record<string, unknown>): void {
  try {
    console.info(JSON.stringify({ evento, ...campos }))
  } catch {
    console.info(evento)
  }
}
