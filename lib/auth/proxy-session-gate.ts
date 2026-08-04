import { CRITICAL_LEGACY_PAGES } from "@/lib/navigation/legacy-routes"

/**
 * Classificação de rotas do proxy (GOAL 003D-lite) — pura, Edge-safe e testável.
 *
 * Substitui o selo `assistec_sub_v1` como condição de entrada. A partir daqui a
 * porta de entrada é UMA só: existe sessão NextAuth válida?
 *
 * ⚠️ CONTENÇÃO TEMPORÁRIA: a verificação comercial (assinatura) NÃO acontece
 * mais no proxy — ver `lib/auth/session-entitlement.ts` para o porquê. Todos os
 * utilizadores autenticados entram da mesma forma, de propósito: com regras
 * diferentes para ADMIN e funcionário, o funcionário contornaria uma assinatura
 * bloqueada que barra o ADMIN.
 */

/** Estáticos, assets, APIs (que se autoprotegem) e rotas de autenticação. */
export function isPublicPath(pathname: string): boolean {
  if (pathname.startsWith("/_next")) return true
  // `/api/**` inclui os callbacks NextAuth (`/api/auth/*`) e o logout: cada rota
  // de API aplica o seu próprio guard server-side.
  if (pathname.startsWith("/api")) return true
  if (pathname === "/favicon.ico") return true
  if (pathname.startsWith("/icon")) return true
  if (pathname === "/apple-icon.png" || pathname === "/apple-touch-icon.png") return true
  if (pathname === "/manifest.webmanifest" || pathname === "/manifest.json") return true
  if (pathname === "/sw.js") return true
  if (pathname.startsWith("/workbox-") || pathname.startsWith("/worker-")) return true
  if (/\.(png|svg|ico|webp|jpg|jpeg|gif|webmanifest)$/i.test(pathname)) return true
  if (pathname === "/login" || pathname.startsWith("/login/")) return true
  return false
}

/** Regularização comercial e suporte — acessíveis sem entitlement resolvido. */
export function isPlanOrSupport(pathname: string): boolean {
  return (
    pathname === "/meu-plano" ||
    pathname.startsWith("/meu-plano/") ||
    pathname === "/suporte" ||
    pathname.startsWith("/suporte/")
  )
}

export function isLoginAdminPath(pathname: string): boolean {
  return pathname === "/login-admin" || pathname.startsWith("/login-admin/")
}

export function isLoginContadorPath(pathname: string): boolean {
  return pathname === "/login-contador" || pathname.startsWith("/login-contador/")
}

/** Portal do cliente final (login CPF / pagamentos) — sem sessão do ERP. */
export function isClientePortalPath(pathname: string): boolean {
  return pathname === "/portal" || pathname.startsWith("/portal/")
}

/** Rotas alcançáveis sem sessão: públicas, regularização e portas de login. */
export function isOpenPath(pathname: string): boolean {
  return (
    isPublicPath(pathname) ||
    isClientePortalPath(pathname) ||
    isPlanOrSupport(pathname) ||
    isLoginAdminPath(pathname) ||
    isLoginContadorPath(pathname)
  )
}

export type ProxyEntryDecision =
  | { kind: "allow" }
  | { kind: "redirect-login"; callbackUrl: string }

/**
 * Decide a entrada de uma rota que já passou pelas exceções do proxy
 * (assets, `/api`, portal, regularização, logins e segmento do contador externo).
 *
 * `/` é a landing comercial: pública. A exceção é `/?page=<legado>` apontando
 * para uma página crítica do ERP — aí exige-se sessão, senão seria um caminho
 * lateral para dentro do produto.
 */
export function resolveProxyEntry(args: {
  pathname: string
  pageParam: string | null
  hasSession: boolean
}): ProxyEntryDecision {
  const { pathname, pageParam, hasSession } = args

  if (isOpenPath(pathname)) return { kind: "allow" }

  if (pathname === "/") {
    if (!hasSession && pageParam && CRITICAL_LEGACY_PAGES.has(pageParam)) {
      return { kind: "redirect-login", callbackUrl: `/?page=${encodeURIComponent(pageParam)}` }
    }
    return { kind: "allow" }
  }

  if (!hasSession) return { kind: "redirect-login", callbackUrl: pathname }

  return { kind: "allow" }
}
