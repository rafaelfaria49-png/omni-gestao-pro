/**
 * Contador HUB · Identidade externa — helpers compartilhados das rotas
 * `/api/contador-externo/**` (GOAL 014).
 *
 * Vive aqui (e não em lib) porque só serve a este namespace de rotas; `route.ts`
 * do Next só pode exportar handlers + config. O que é de DOMÍNIO fica em
 * `lib/contador/auth-externa/**` — este arquivo é só cola HTTP.
 *
 * Injeção de repo para testes: `__setRepoAuthExternaParaTestes` segue o espírito
 * do fake in-memory de `lib/contador/auth-externa/fakes.ts` — os `route.test.ts`
 * sobem um `criarRepoAuthExterna(fakeDb)` sem `vi.mock("@/lib/prisma")` e sem
 * banco real; produção sempre cai no singleton (`criarRepoAuthExterna()`).
 */
import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { requireContadorScope, type ContadorScopeInterno } from "@/lib/contador/scope"
import { respostaFalhaEscopo } from "@/lib/contador/documentos/http"
import { resolverCapacidadesContador } from "@/lib/contador/status/permissoes"
import {
  CABECALHO_PRIVADO_EXTERNO,
  CHAVES_PROIBIDAS_EXTERNO,
  respostaChaveProibidaExterna,
  type RespostaHttp,
} from "@/lib/contador/auth-externa/http"
import { criarRepoAuthExterna, type AuthExternaRepo } from "@/lib/contador/auth-externa/repo-prisma"
import {
  extrairIpClienteExterno,
  hashIpExterno,
  resumirUserAgent,
  type CookieSessaoExternaOptions,
} from "@/lib/contador/auth-externa/sessao"
import { ValidacaoExternaError, type PapelExterno } from "@/lib/contador/auth-externa/tipos"

/* ───────────────────────────── repo injetável (testes) ───────────────────────────── */

let repoParaTestes: AuthExternaRepo | null = null

/** Uso exclusivo dos testes de rota — injeta o repo fake (ou null para restaurar). */
export function __setRepoAuthExternaParaTestes(repo: AuthExternaRepo | null): void {
  repoParaTestes = repo
}

/** Repo da request: o injetado nos testes, o singleton Prisma em produção. */
export function resolverRepoAuthExterna(): AuthExternaRepo {
  return repoParaTestes ?? criarRepoAuthExterna()
}

/* ───────────────────────────── respostas JSON ───────────────────────────── */

/** TODA resposta do namespace externo sai com `Cache-Control: private, no-store`. */
export function jsonExterno(
  resposta: RespostaHttp,
  headersExtras?: Record<string, string>,
): NextResponse {
  return NextResponse.json(resposta.body, {
    status: resposta.status,
    headers: { ...CABECALHO_PRIVADO_EXTERNO, ...headersExtras },
  })
}

export function jsonOkExterno(
  body: Record<string, unknown>,
  status = 200,
  headersExtras?: Record<string, string>,
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { ...CABECALHO_PRIVADO_EXTERNO, ...headersExtras },
  })
}

/* ───────────────────────────── chaves proibidas (§9) ───────────────────────────── */

/**
 * Rotas INTERNAS de convite aceitam `papel` como entrada legítima do admin (D-5:
 * `conferencia` só por escolha explícita) — a recusa de `papel` vale para o
 * caminho EXTERNO, onde papel sai da linha do convite.
 */
export const CHAVES_PROIBIDAS_INTERNO_CONVITE = CHAVES_PROIBIDAS_EXTERNO.filter(
  (k) => k !== "papel",
)

export function temChaveProibida(
  fonte: Record<string, unknown> | URLSearchParams,
  chaves: readonly string[] = CHAVES_PROIBIDAS_EXTERNO,
): boolean {
  if (fonte instanceof URLSearchParams) {
    return chaves.some((k) => fonte.has(k))
  }
  return chaves.some((k) => Object.prototype.hasOwnProperty.call(fonte, k))
}

export function respostaChaveProibida(): NextResponse {
  return jsonExterno(respostaChaveProibidaExterna())
}

/* ───────────────────────────── request helpers ───────────────────────────── */

export function ipDoRequest(req: Request): string {
  return extrairIpClienteExterno(req.headers)
}

export async function ipHashDoRequest(req: Request): Promise<string> {
  return hashIpExterno(ipDoRequest(req))
}

export function userAgentDoRequest(req: Request): string | null {
  return resumirUserAgent(req.headers.get("user-agent"))
}

/** Grava o cookie de sessão externa (ou o cookie limpo do logout) na resposta. */
export function aplicarCookieExterno(res: NextResponse, opcoes: CookieSessaoExternaOptions): void {
  res.cookies.set(opcoes.name, opcoes.value, {
    httpOnly: opcoes.httpOnly,
    secure: opcoes.secure,
    sameSite: opcoes.sameSite,
    path: opcoes.path,
    maxAge: opcoes.maxAge,
  })
}

/** Regrava o cookie quando a validação rotacionou a sessão (§D.1 — mesmo sid). */
export function aplicarRotacaoExterna(
  res: NextResponse,
  rotacao: CookieSessaoExternaOptions | null,
): void {
  if (rotacao) aplicarCookieExterno(res, rotacao)
}

/* ───────────────────────────── guard interno (admin ERP) ───────────────────────────── */

export type GuardAdminExterno =
  | Readonly<{ ok: true; escopo: ContadorScopeInterno; adminId: string }>
  | Readonly<{ ok: false; resposta: NextResponse }>

/**
 * Guarda das rotas INTERNAS do namespace: sessão NextAuth + loja ativa da sessão
 * INTERNA (`requireContadorScope`, cookie de loja interno) + capacidade elevada
 * `podeGerenciarAcessoExterno` (403 sem ela). A loja NUNCA vem do cliente.
 */
export async function guardAdminExterno(): Promise<GuardAdminExterno> {
  const escopo = await requireContadorScope()
  if (!escopo.ok) {
    const resposta = respostaFalhaEscopo(escopo)
    resposta.headers.set("Cache-Control", CABECALHO_PRIVADO_EXTERNO["Cache-Control"])
    return Object.freeze({ ok: false as const, resposta })
  }
  const capacidades = resolverCapacidadesContador(await auth())
  if (!capacidades.podeGerenciarAcessoExterno) {
    return Object.freeze({
      ok: false as const,
      resposta: jsonExterno({
        status: 403,
        body: {
          ok: false,
          mensagem: "Sua conta não tem permissão para gerenciar o acesso externo do contador.",
        },
      }),
    })
  }
  return Object.freeze({ ok: true as const, escopo, adminId: escopo.userId })
}

/** Papel do convite: default `leitura`; `conferencia` só por escolha explícita (D-5). */
export function validarPapelConvite(valor: unknown): PapelExterno {
  if (valor === undefined || valor === null || valor === "") return "LEITURA"
  const normalizado = String(valor).trim().toUpperCase()
  if (normalizado === "LEITURA" || normalizado === "CONFERENCIA") return normalizado
  throw new ValidacaoExternaError("papel", 'Papel inválido. Use "leitura" ou "conferencia".')
}
