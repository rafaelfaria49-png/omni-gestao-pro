/**
 * Contador HUB · HTTP da agenda (GOAL 016).
 *
 * Recusa storeId/lojaId/papel/userId/atorId do cliente. Cache-Control private, no-store.
 */
import { NextResponse } from "next/server"
import { respostaErroContador } from "@/lib/contador/status/http"
import {
  AgendaValidacaoError,
  DocumentoAgendaInvalidoError,
  GuiaNaoEncontradaError,
  GuiaPagaError,
  ObrigacaoNaoEncontradaError,
  TemplateInativoError,
  TemplateNaoEncontradoError,
} from "./erros"

export const CHAVES_PROIBIDAS = ["storeId", "lojaId", "papel", "role", "userId", "atorId"] as const

export const CACHE_PRIVADO = { "Cache-Control": "private, no-store, max-age=0" } as const

export function temChaveProibida(fonte: Record<string, unknown> | URLSearchParams): boolean {
  if (fonte instanceof URLSearchParams) return CHAVES_PROIBIDAS.some((k) => fonte.has(k))
  return CHAVES_PROIBIDAS.some((k) => Object.prototype.hasOwnProperty.call(fonte, k))
}

export const RESPOSTA_CHAVE_PROIBIDA = NextResponse.json(
  { ok: false, mensagem: "O endpoint não aceita loja, usuário ou papel informados pelo cliente." },
  { status: 400 },
)

export function respostaErroAgenda(e: unknown): NextResponse {
  if (e instanceof AgendaValidacaoError) {
    return NextResponse.json({ ok: false, code: e.code, campo: e.campo, mensagem: e.message }, { status: 422 })
  }
  if (e instanceof DocumentoAgendaInvalidoError) {
    const msg = e.message
    const status = msg.includes("mesma competência") ? 422 : 404
    return NextResponse.json({ ok: false, code: e.code, mensagem: msg }, { status })
  }
  if (
    e instanceof TemplateNaoEncontradoError ||
    e instanceof ObrigacaoNaoEncontradaError ||
    e instanceof GuiaNaoEncontradaError
  ) {
    return NextResponse.json({ ok: false, code: e.code, mensagem: e.message }, { status: 404 })
  }
  if (e instanceof TemplateInativoError || e instanceof GuiaPagaError) {
    return NextResponse.json({ ok: false, code: e.code, mensagem: e.message }, { status: 409 })
  }
  return respostaErroContador(e)
}
