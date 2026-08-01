/**
 * Contador HUB · Identidade externa — helpers HTTP das rotas (GOAL 014).
 *
 * Espelha `documentos/http.ts`, mas devolve `{ status, body }` puro (sem
 * `next/server`) para o módulo de domínio continuar testável em ambiente node —
 * a conversão para `NextResponse` fica na camada de rota.
 *
 * Mensagens ao cliente são sempre SEGURAS e anti-enumeração: login e aceite usam
 * texto único e genérico; motivos técnicos são rótulos curtos, nunca vazam e-mail,
 * token, cookie, sid ou stack. Inclui a lista PRÓPRIA de chaves proibidas do
 * módulo externo (§9 — a loja nunca vem do cliente).
 */
import { AcessoEstadoInvalidoError, AcessoNaoEncontradoError } from "./acessos"
import { ConviteAceiteFalhaError, ConviteNaoEncontradoError } from "./convites"
import type { FalhaEscopoExterno } from "./escopo-externo"
import { SessaoExternaIndisponivelError } from "./sessao"
import { ValidacaoExternaError } from "./tipos"
import { UsuarioNaoEncontradoError } from "./usuarios"

export type RespostaHttp = Readonly<{ status: number; body: Record<string, unknown> }>

function resposta(status: number, body: Record<string, unknown>): RespostaHttp {
  return Object.freeze({ status, body })
}

/* ───────────────────────────── escopo externo ───────────────────────────── */

export const MOTIVO_STATUS_EXTERNO: Record<FalhaEscopoExterno["motivo"], number> = {
  nao_autenticado: 401,
  sessao_invalida: 401,
  acesso_negado: 403,
  indisponivel: 503,
}

export const MOTIVO_MSG_EXTERNO: Record<FalhaEscopoExterno["motivo"], string> = {
  nao_autenticado: "Sessão não encontrada. Faça login no portal do contador.",
  sessao_invalida: "Sua sessão expirou ou foi encerrada. Faça login novamente.",
  acesso_negado: "Este conteúdo não está disponível para a sua conta.",
  indisponivel: "Portal do contador indisponível no momento. Tente novamente em instantes.",
}

/** Resposta padrão de falha de escopo externo. */
export function respostaFalhaEscopoExterno(escopo: FalhaEscopoExterno): RespostaHttp {
  return resposta(MOTIVO_STATUS_EXTERNO[escopo.motivo], {
    ok: false,
    motivo: escopo.motivo,
    mensagem: MOTIVO_MSG_EXTERNO[escopo.motivo],
  })
}

/* ───────────────────────────── login / aceite (anti-enumeração) ───────────────────────────── */

/** Falha de login: mensagem ÚNICA para usuário inexistente, senha errada e conta suspensa (R-2). */
export function respostaLoginInvalido(): RespostaHttp {
  return resposta(401, { ok: false, mensagem: "E-mail ou senha incorretos." })
}

/** Rate limit (R-3): 429 com `retryAfterSeconds` (a rota ecoa em `Retry-After`). */
export function respostaRateLimitExterno(retryAfterSeconds: number): RespostaHttp {
  return resposta(429, {
    ok: false,
    mensagem: "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
    retryAfterSeconds,
  })
}

/* ───────────────────────────── chaves proibidas (§9) ───────────────────────────── */

/**
 * Chaves que NUNCA podem influenciar autorização ou escopo no namespace externo.
 * A loja sai do vínculo/convite no servidor; papel sai da linha; o usuário sai da
 * sessão. Lista PRÓPRIA do módulo externo (inclui `usuarioId`, além da do fechamento).
 */
export const CHAVES_PROIBIDAS_EXTERNO = [
  "storeId",
  "lojaId",
  "papel",
  "role",
  "userId",
  "atorId",
  "autorId",
  "usuarioId",
] as const

export function temChaveProibidaExterna(fonte: Record<string, unknown> | URLSearchParams): boolean {
  if (fonte instanceof URLSearchParams) {
    return CHAVES_PROIBIDAS_EXTERNO.some((k) => fonte.has(k))
  }
  return CHAVES_PROIBIDAS_EXTERNO.some((k) => Object.prototype.hasOwnProperty.call(fonte, k))
}

export function respostaChaveProibidaExterna(): RespostaHttp {
  return resposta(400, {
    ok: false,
    mensagem: "O endpoint não aceita loja, usuário ou papel por id.",
  })
}

/** Corpo JSON tolerante: body inválido vira objeto vazio (a validação é do serviço). */
export async function lerCorpoJsonExterno(req: Request): Promise<Record<string, unknown>> {
  try {
    return ((await req.json()) as Record<string, unknown>) ?? {}
  } catch {
    return {}
  }
}

export const CABECALHO_PRIVADO_EXTERNO = { "Cache-Control": "private, no-store, max-age=0" } as const

/* ───────────────────────────── erros de domínio → HTTP ───────────────────────────── */

/** Traduz um erro de domínio do módulo para `{ status, body }` seguro. */
export function respostaErroAuthExterna(e: unknown): RespostaHttp {
  if (e instanceof ValidacaoExternaError) {
    return resposta(422, { ok: false, campo: e.campo, mensagem: e.message })
  }
  if (e instanceof SessaoExternaIndisponivelError) {
    // Falha de configuração do servidor (R-9) — 503, nunca 500 mudo nem fallback.
    return resposta(503, {
      ok: false,
      mensagem: "Portal do contador indisponível no momento. Tente novamente em instantes.",
    })
  }
  if (e instanceof ConviteAceiteFalhaError) {
    // Anti-enumeração: o `motivo` técnico NÃO sai na resposta — texto único.
    return resposta(400, { ok: false, mensagem: e.message })
  }
  if (e instanceof ConviteNaoEncontradoError) {
    return resposta(404, { ok: false, mensagem: e.message })
  }
  if (e instanceof AcessoNaoEncontradoError || e instanceof UsuarioNaoEncontradoError) {
    return resposta(404, { ok: false, mensagem: e.message })
  }
  if (e instanceof AcessoEstadoInvalidoError) {
    return resposta(409, { ok: false, mensagem: e.message })
  }
  return resposta(500, {
    ok: false,
    mensagem: "Não foi possível concluir a operação agora. Tente novamente em instantes.",
  })
}
