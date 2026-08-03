/**
 * Contador HUB · Portal externo read-only — cola HTTP das rotas de dados
 * `/api/contador-externo/lojas/[loja]/**` (GOAL 015, fase 2).
 *
 * Mesmo papel do `_shared.ts` para o GOAL 014: só cola HTTP deste namespace; o
 * DOMÍNIO vive em `lib/contador/portal/**` (fase 1).
 *
 * Cadeia obrigatória de TODA rota de dados do portal:
 *   flag ON → chaves proibidas (query; body é lido pela rota POST) → escopo
 *   externo ([loja] do PATH validado contra ContadorAcesso ATIVO a cada request)
 *   → serviço do portal → jsonOkExterno + aplicarRotacaoExterna.
 *
 * Flag OFF → 404 genérico ANTES de qualquer trabalho: a rota "não existe", sem
 * confirmar sessão, loja ou recurso. A loja NUNCA vem de body/query — essas
 * chaves são recusadas antes do escopo (CHAVES_PROIBIDAS_EXTERNO, §9).
 */
import type { NextResponse } from "next/server"
import {
  resolverEscopoExterno,
  type ContadorScopeExterno,
} from "@/lib/contador/auth-externa/escopo-externo"
import { respostaFalhaEscopoExterno } from "@/lib/contador/auth-externa/http"
import { extrairTokenSessaoExterna } from "@/lib/contador/auth-externa/sessao"
import { parseCompetencia, type Competencia } from "@/lib/contador/competencia"
import type { ContextoAtorPortal } from "@/lib/contador/portal/eventos"
import { portalExternoV2Habilitado } from "@/lib/contador/portal/flag"
import {
  ipDoRequest,
  jsonExterno,
  resolverRepoAuthExterna,
  temChaveProibida,
  userAgentDoRequest,
} from "./_shared"

/** 404 genérico da flag OFF (e de recurso inexistente no path) — anti-enumeração. */
export function respostaNaoEncontradoPortal(): NextResponse {
  return jsonExterno({ status: 404, body: { ok: false, mensagem: "Recurso não encontrado." } })
}

/** 422 de validação de BODY do portal (mesmo shape do respostaErroPortal). */
export function respostaValidacaoPortal(campo: string, mensagem: string): NextResponse {
  return jsonExterno({ status: 422, body: { ok: false, campo, mensagem } })
}

export type GuardPortal =
  | Readonly<{ ok: true; escopo: ContadorScopeExterno }>
  | Readonly<{ ok: false; resposta: NextResponse }>

/**
 * Guarda de TODA rota de dados do portal: flag → query proibida → escopo externo
 * da [loja] do path. O body (nas POST) é conferido pela rota logo em seguida,
 * ainda ANTES de qualquer trabalho de domínio.
 */
export async function guardPortalExterno(req: Request, loja: string): Promise<GuardPortal> {
  if (!portalExternoV2Habilitado()) {
    return Object.freeze({ ok: false as const, resposta: respostaNaoEncontradoPortal() })
  }
  const url = new URL(req.url)
  if (temChaveProibida(url.searchParams)) {
    return Object.freeze({ ok: false as const, resposta: respostaChaveProibidaPortal() })
  }
  const escopo = await resolverEscopoExterno(resolverRepoAuthExterna(), {
    token: extrairTokenSessaoExterna(req.headers.get("cookie")),
    storeId: loja,
  })
  if (!escopo.ok) {
    return Object.freeze({ ok: false as const, resposta: jsonExterno(respostaFalhaEscopoExterno(escopo)) })
  }
  return Object.freeze({ ok: true as const, escopo })
}

export function respostaChaveProibidaPortal(): NextResponse {
  return jsonExterno({
    status: 400,
    body: { ok: false, mensagem: "O endpoint não aceita loja, usuário ou papel por id." },
  })
}

/**
 * Contexto de auditoria do evento: o IP CRU sai do request e é minimizado no
 * domínio (`resolverAtorPortal` → `hashIpExterno`); o UA já sai resumido do
 * helper. Nada aqui loga ou persiste valor bruto.
 */
export function contextoAtorPortal(req: Request, escopo: ContadorScopeExterno): ContextoAtorPortal {
  return Object.freeze({
    escopo,
    ip: ipDoRequest(req),
    userAgent: userAgentDoRequest(req),
  })
}

/** `[c]` do path: AAAA-MM estrito; inválido → null (a rota responde 404). */
export function competenciaDoPath(c: string): Competencia | null {
  return parseCompetencia(c)
}

/** Body `{ competencia }`: AAAA-MM estrito; inválido → null (a rota responde 422). */
export function competenciaDoBody(valor: unknown): Competencia | null {
  return parseCompetencia(valor)
}

/** Body `{ versao }`: inteiro ≥ 1; inválido → null (a rota responde 422). */
export function versaoDoBody(valor: unknown): number | null {
  const n = typeof valor === "number" ? valor : Number(typeof valor === "string" ? valor.trim() : NaN)
  return Number.isInteger(n) && n >= 1 ? n : null
}
