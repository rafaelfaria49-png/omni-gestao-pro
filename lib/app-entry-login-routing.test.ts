/**
 * APP-ENTRY-LOGIN-ROUTING-001 — contrato de entrada do aplicativo.
 *
 * Separa três entradas que estavam misturadas:
 *   - "/"          → landing COMERCIAL (pública, continua existindo e não redireciona)
 *   - "/login"     → entrada OPERACIONAL canônica (PWA instalado, logout, sessão expirada)
 *   - "/dashboard" → painel — o "Home" de quem já está dentro do sistema
 *
 * O manifesto é testado de verdade (import do módulo — `app/manifest.ts` só depende de
 * `lib/app-brand`, que é puro). Já os logouts vivem em componentes React e os redirects
 * vivem no `proxy.ts`, cujo import graph carrega NextAuth/Prisma; esses são cobertos por
 * asserção estática sobre o fonte — mesmo padrão de `lib/proxy-cookie-mismatch.test.ts`.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import manifest from "../app/manifest"
import { isPublicPath, resolveProxyEntry } from "@/lib/auth/proxy-session-gate"

/** Rota canônica de entrada operacional do sistema. */
const LOGIN_ROUTE = "/login"
/** Landing comercial — pública, jamais destino de fluxo de autenticação. */
const LANDING_ROUTE = "/"

const read = (relPath: string): string => readFileSync(resolve(__dirname, "..", relPath), "utf8")

describe("PWA instalado — manifesto", () => {
  it("start_url é o login canônico", () => {
    expect(manifest().start_url).toBe(LOGIN_ROUTE)
  })

  it("app instalado NÃO abre na landing comercial", () => {
    expect(manifest().start_url).not.toBe(LANDING_ROUTE)
  })

  it("scope cobre a app inteira e o id da instalação não muda", () => {
    // Mudar `id` criaria uma instalação nova para quem já tem o app; `scope` menor que "/"
    // deixaria a landing (e o painel) fora do app instalado.
    expect(manifest().scope).toBe("/")
    expect(manifest().id).toBe("/")
  })
})

describe("logout normal", () => {
  it("signOutAction devolve ao login canônico, não à landing", () => {
    const src = read("app/actions/auth.ts")
    expect(src).toContain('signOut({ redirectTo: "/login" })')
    expect(src).not.toMatch(/redirectTo:\s*"\/"/)
  })

  it("logout da seção Segurança devolve ao login canônico", () => {
    const src = read("components/configuracoes-v3/features/settings/sections/SegurancaSection.tsx")
    expect(src).toContain('callbackUrl: "/login"')
    expect(src).not.toMatch(/callbackUrl:\s*"\/"/)
  })
})

describe("logout do Portal do Contador", () => {
  const src = () => read("components/dashboard/contador/area-contador-pro.tsx")

  it("NÃO devolve à landing comercial", () => {
    expect(src()).not.toMatch(/router\.(push|replace)\("\/"\)/)
  })

  it("devolve ao login canônico", () => {
    expect(src()).toContain('router.replace("/login")')
  })
})

describe("proxy — sessão expirada e rota privada sem sessão", () => {
  const src = () => read("proxy.ts")

  it("/dashboard sem sessão (inclui sessão expirada) vai ao login canônico", () => {
    expect(src()).toContain('const loginUrl = new URL("/login", req.url)')
  })

  it("nenhum redirect do proxy usa a landing como fallback de autenticação", () => {
    // `u.pathname = "/"` era o fallback de /logs-sistema sem sessão de admin.
    // Os demais destinos ("/meu-plano", "/login", "/login-contador") não casam com este padrão.
    expect(src()).not.toMatch(/u\.pathname = "\/"/)
  })

  it("rota privada /logs-sistema sem sessão vai ao login canônico", () => {
    const logsBlock = src().slice(src().indexOf('pathname === "/logs-sistema"'))
    expect(logsBlock).toContain('u.pathname = "/login"')
  })

  it("/contador sem sessão vai ao login do contador — nunca à landing", () => {
    expect(src()).toContain('u.pathname = "/login-contador"')
  })

  it("o login canônico é público no proxy (sem isso, haveria loop de redirect)", () => {
    // GOAL 003D-lite: a classificação de rotas saiu de `proxy.ts` para o módulo
    // puro `lib/auth/proxy-session-gate.ts`. Como esse módulo NÃO arrasta
    // NextAuth/Prisma, o invariante passou a ser verificado por comportamento —
    // mais forte que a asserção estática que existia aqui.
    expect(isPublicPath("/login")).toBe(true)
    expect(resolveProxyEntry({ pathname: "/login", pageParam: null, hasSession: false })).toEqual({
      kind: "allow",
    })
  })
})

describe("landing comercial — continua pública", () => {
  it("a rota / segue renderizando a landing (não foi removida)", () => {
    const page = read("app/page.tsx")
    expect(page).toContain("landing-page")
    expect(page).toContain("@/components/landing/lovable/Hero")
    expect(page).toContain("@/components/landing/lovable/Pricing")
  })

  it("o proxy deixa / passar — a landing NÃO é redirecionada para o login", () => {
    // Ver nota acima: invariante agora verificado por comportamento no módulo puro.
    expect(resolveProxyEntry({ pathname: "/", pageParam: null, hasSession: false })).toEqual({
      kind: "allow",
    })
  })

  it("a landing segue pública mesmo com um `?page=` desconhecido", () => {
    expect(
      resolveProxyEntry({ pathname: "/", pageParam: "promo-qualquer", hasSession: false }),
    ).toEqual({ kind: "allow" })
  })
})

describe("Home operacional — links internos não caem na landing", () => {
  it('"Painel principal" do contador aponta ao painel', () => {
    const src = read("components/dashboard/contador/area-contador-pro.tsx")
    expect(src).toContain('<Link href="/dashboard">')
    expect(src).not.toContain('<Link href="/">')
  })

  it('"Voltar ao sistema" dos logs aponta ao painel e o "Sair" ao login canônico', () => {
    const src = read("app/logs-sistema/page.tsx")
    expect(src).toContain('<Link href="/dashboard">')
    expect(src).not.toContain('<Link href="/">')
    expect(src).toContain('window.location.href = "/login"')
  })

  it("rota legada /login-admin canonicaliza para o login, não para a landing", () => {
    const src = read("app/login-admin/page.tsx")
    expect(src).toContain('router.replace("/login")')
    expect(src).not.toContain('router.replace("/")')
  })

  it("a orientação de entrada da equipe no /login-contador aponta ao login", () => {
    const src = read("app/login-contador/page.tsx")
    expect(src).toContain('<Link href="/login" className="underline underline-offset-4">')
  })
})
