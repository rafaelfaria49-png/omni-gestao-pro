/**
 * Contador HUB · Identidade externa — escopo nominal da sessão externa (GOAL 014).
 *
 * Variante EXTERNA de `scope-core.ts`: tipo nominal com `unique symbol` próprio,
 * produzido exclusivamente por este gate — nenhum outro código consegue forjar um
 * `ContadorScopeExterno` (o brand não é exportável nem serializável).
 *
 * A sessão identifica a PESSOA; a loja é parâmetro de rota validado A CADA REQUEST
 * contra `ContadorAcesso` ATIVO (§D — G-1/G-3). Vínculo suspenso/revogado bloqueia
 * aquela loja na request seguinte e mantém as demais intactas. Fail-closed sempre:
 * qualquer motivo de falha devolve `FalhaEscopoExterno`, nunca exceção.
 */
import type { AuthExternaRepo } from "./repo-prisma"
import {
  validarSessaoExterna,
  type EnvSessaoExterna,
  type UsuarioSessao,
  type CookieSessaoExternaOptions,
} from "./sessao"
import type { PapelExterno } from "./tipos"

declare const CONTADOR_SCOPE_EXTERNO_VALIDADO: unique symbol

/** Identidade externa autenticada, SEM loja (rotas /auth/sessao e /lojas). */
export type ContadorIdentidadeExterna = Readonly<{
  ok: true
  usuario: UsuarioSessao
  sessaoId: string
  /** Rotação devida (mesmo sid, novo iat/exp) — a rota deve regravar o cookie. */
  rotacao: CookieSessaoExternaOptions | null
  [CONTADOR_SCOPE_EXTERNO_VALIDADO]: true
}>

/** Escopo de UMA loja: identidade + vínculo ATIVO conferido nesta request. */
export type ContadorScopeExterno = Readonly<{
  ok: true
  usuario: UsuarioSessao
  sessaoId: string
  storeId: string
  papel: PapelExterno
  rotacao: CookieSessaoExternaOptions | null
  [CONTADOR_SCOPE_EXTERNO_VALIDADO]: true
}>

export type FalhaEscopoExterno = Readonly<{
  ok: false
  motivo: "nao_autenticado" | "sessao_invalida" | "acesso_negado" | "indisponivel"
}>

export type EscopoExterno = ContadorScopeExterno | FalhaEscopoExterno
export type IdentidadeExterna = ContadorIdentidadeExterna | FalhaEscopoExterno

export type ResolverEscopoArgs = Readonly<{
  token: string | null | undefined
  env?: EnvSessaoExterna
  agora?: Date
}>

function mapearFalhaSessao(motivo: string): FalhaEscopoExterno["motivo"] {
  if (motivo === "indisponivel") return "indisponivel"
  if (motivo === "cookie_ausente") return "nao_autenticado"
  return "sessao_invalida"
}

/**
 * Resolve a identidade externa da request (sem loja). Única porta de entrada do
 * cookie externo para as rotas — qualquer desvio vira falha genérica tipada.
 */
export async function resolverIdentidadeExterna(
  repo: AuthExternaRepo,
  args: ResolverEscopoArgs,
): Promise<IdentidadeExterna> {
  const sessao = await validarSessaoExterna(repo, args.token, { env: args.env, agora: args.agora })
  if (!sessao.ok) return Object.freeze({ ok: false as const, motivo: mapearFalhaSessao(sessao.motivo) })
  return Object.freeze({
    ok: true,
    usuario: sessao.usuario,
    sessaoId: sessao.sessao.id,
    rotacao: sessao.rotacao,
  }) as ContadorIdentidadeExterna
}

/**
 * Resolve o escopo de UMA loja: identidade válida + `ContadorAcesso` ATIVO da loja,
 * conferido nesta request (fail-closed). `storeId` vem da ROTA (path segment
 * validado), nunca de body/query — esses são recusados antes (http.ts).
 */
export async function resolverEscopoExterno(
  repo: AuthExternaRepo,
  args: ResolverEscopoArgs & Readonly<{ storeId: string }>,
): Promise<EscopoExterno> {
  const sessao = await validarSessaoExterna(repo, args.token, { env: args.env, agora: args.agora })
  if (!sessao.ok) return Object.freeze({ ok: false as const, motivo: mapearFalhaSessao(sessao.motivo) })

  const acesso = await repo.buscarAcesso(sessao.usuario.id, args.storeId)
  if (!acesso || acesso.status !== "ATIVO") {
    return Object.freeze({ ok: false as const, motivo: "acesso_negado" as const })
  }

  return Object.freeze({
    ok: true,
    usuario: sessao.usuario,
    sessaoId: sessao.sessao.id,
    storeId: acesso.storeId,
    papel: acesso.papel,
    rotacao: sessao.rotacao,
  }) as ContadorScopeExterno
}
