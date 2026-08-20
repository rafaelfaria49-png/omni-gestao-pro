import { NextResponse } from "next/server"
import NextAuth from "next-auth"
import type { Session } from "next-auth"
import { authConfig } from "./auth.config"
import { ASSISTEC_ACTIVE_STORE_COOKIE } from "@/lib/store-defaults"
import { enterpriseDashboardRedirect, enterpriseStoreCookieRedirect } from "@/lib/auth/proxy-enterprise-dashboard"
import {
  buildLegacyPageRedirectUrl,
  resolveLegacyPageRedirect,
} from "@/lib/navigation/legacy-routes"
import {
  CONTADOR_COOKIE,
  resolveLegacyPortalEnabled,
  verifyContadorSessionToken,
} from "@/lib/contador/auth/legacy-session"
import { isSegmentoContadorExterno } from "@/lib/contador/auth-externa/proxy-publico"
import { isRotaLegadaContador, PORTAL_V2_LOGIN } from "@/lib/contador/legado/rota-legada"
import { isPublicPath, resolveProxyEntry } from "@/lib/auth/proxy-session-gate"

const { auth } = NextAuth(authConfig)

const ADMIN_COOKIE = "assistec_admin_session"

/**
 * GOAL 003D-lite — a entrada passou a depender de SESSÃO, não do selo.
 *
 * O cookie `assistec_sub_v1` deixou de participar de qualquer decisão deste
 * ficheiro: ele nunca provou identidade e, sendo forjável por quem tivesse o
 * segredo, servia de porta lateral. A classificação de rotas vive em
 * `lib/auth/proxy-session-gate.ts` (pura e testada).
 *
 * ⚠️ CONTENÇÃO TEMPORÁRIA: a verificação comercial (assinatura ativa) NÃO é
 * feita aqui — o schema atual não permite resolver a assinatura da empresa de um
 * funcionário sem heurística. Ver `lib/auth/session-entitlement.ts`.
 */
export const proxy = auth(async (req) => {
  const { pathname } = req.nextUrl
  const session = req.auth

  if (isPublicPath(pathname)) {
    return NextResponse.next()
  }

  // GOAL 014 (ajuste G3 #4): o segmento do portal externo do contador NÃO é ERP —
  // não exige sessão do ERP. Público SOMENTE nas 3 rotas exatas de
  // `CONTADOR_EXTERNO_ROTAS_PUBLICAS` (classificação pura em
  // `lib/contador/auth-externa/proxy-publico.ts`); todo o restante do segmento se
  // autoprotege no servidor, falhando fechado (páginas server-validam a sessão
  // externa; APIs respondem 401/403). O gate de sessão externa no proxy é GOAL 015.
  // `Referrer-Policy: no-referrer`: o token de convite trafega no fragmento
  // (`#token=`) e nunca pode vazar via Referer (R-1).
  if (isSegmentoContadorExterno(pathname)) {
    const res = NextResponse.next()
    res.headers.set("Referrer-Policy", "no-referrer")
    return res
  }

  // GOAL 019 (gate G4): portal legado ENCERRADO por redirect para o portal v2.
  //
  // Precisa vir ANTES de `resolveProxyEntry`, porque `/login-contador` é rota aberta
  // (`isLoginContadorPath`) e seria liberada antes de chegar ao trecho do legado lá
  // embaixo. `isSegmentoContadorExterno` já retornou acima, então `/contador-externo`
  // nunca alcança esta linha — e `isRotaLegadaContador` recusa esse segmento de novo,
  // para o redirect não depender da ordem dos blocos.
  //
  // Com o kill-switch na posição padrão (off) NENHUMA sessão legada é consultada: o
  // cookie `assistec_contador_session` deixa de abrir qualquer porta. Reabrir o
  // legado é ato deliberado (`CONTADOR_LEGACY_PORTAL=on`) e devolve exatamente o
  // comportamento anterior, incluindo o gate de sessão original.
  if (isRotaLegadaContador(pathname)) {
    if (!resolveLegacyPortalEnabled()) {
      const u = req.nextUrl.clone()
      u.pathname = PORTAL_V2_LOGIN
      u.search = ""
      return NextResponse.redirect(u)
    }
  }

  const pageParam = req.nextUrl.searchParams.get("page")
  const entry = resolveProxyEntry({ pathname, pageParam, hasSession: !!session })
  if (entry.kind === "redirect-login") {
    const loginUrl = new URL("/login", req.url)
    loginUrl.searchParams.set("callbackUrl", entry.callbackUrl)
    return NextResponse.redirect(loginUrl)
  }

  // Daqui para baixo: rota aberta a todos, ou rota privada com sessão válida.

  // Atalhos legados `/?page=…` só resolvem para quem já está autenticado; para
  // anónimo, `/` permanece a landing comercial.
  if (session && pathname === "/" && pageParam) {
    const target = resolveLegacyPageRedirect(pageParam)
    if (target) {
      const dest = buildLegacyPageRedirectUrl(pageParam, req.nextUrl.searchParams)
      const u = req.nextUrl.clone()
      const destUrl = new URL(dest, req.url)
      u.pathname = destUrl.pathname
      u.search = destUrl.search
      return NextResponse.redirect(u)
    }
  }

  if (pathname.startsWith("/dashboard") && session?.user) {
    const sess = session as unknown as Session
    const denied = enterpriseDashboardRedirect(req.nextUrl.origin, pathname, sess)
    if (denied) return NextResponse.redirect(denied)
    const storeCookie = req.cookies.get(ASSISTEC_ACTIVE_STORE_COOKIE)?.value
    const storeDeny = enterpriseStoreCookieRedirect(req.nextUrl.origin, sess, storeCookie)
    if (storeDeny) return NextResponse.redirect(storeDeny)
  }

  if (pathname === "/logs-sistema" || pathname.startsWith("/logs-sistema/")) {
    const admin = String(req.cookies.get(ADMIN_COOKIE)?.value || "").trim()
    if (!admin) {
      // Rota privada sem sessão vai ao login canônico — nunca à landing comercial.
      // Sem `callbackUrl`: o login NextAuth não emite `assistec_admin_session` (só o
      // PIN de supervisor emite), então voltar para cá após o login reabriria este
      // mesmo redirect em loop.
      const u = req.nextUrl.clone()
      u.pathname = "/login"
      u.search = ""
      return NextResponse.redirect(u)
    }
  }

  // GOAL 019: só é alcançável com `CONTADOR_LEGACY_PORTAL=on` — com o kill-switch na
  // posição padrão o bloco G4 acima já redirecionou para o portal v2. Preservado
  // INTACTO de propósito: é o comportamento exato para onde o rollback do G4 volta.
  if (pathname === "/contador" || pathname.startsWith("/contador/")) {
    const redirectToLogin = () => {
      const u = req.nextUrl.clone()
      u.pathname = "/login-contador"
      u.searchParams.set("next", pathname)
      return NextResponse.redirect(u)
    }
    if (!resolveLegacyPortalEnabled()) return redirectToLogin()
    const secret = process.env.CONTADOR_SESSION_SECRET?.trim()
    if (!secret) return redirectToLogin()
    const token = req.cookies.get(CONTADOR_COOKIE)?.value
    const result = await verifyContadorSessionToken(token, secret)
    if (!result.ok) return redirectToLogin()
  }

  return NextResponse.next()
})

export { proxy as default }

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
}
