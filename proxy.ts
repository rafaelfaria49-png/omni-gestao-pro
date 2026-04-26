import { NextResponse, type NextRequest } from "next/server"
import {
  SUBSCRIPTION_COOKIE_NAME,
  isVencimentoExpired,
  verifySubscriptionCookieValue,
} from "@/lib/subscription-seal"
import { getTrustedTimeMs } from "@/lib/trusted-time"
import { STAFF_ROLE_COOKIE, STAFF_SESSION_COOKIE } from "@/lib/staff-session"

const SUBSCRIPTION_SECRET =
  process.env.ASSISTEC_SUBSCRIPTION_SECRET || "assistec-dev-secret-change-in-production"

const ADMIN_COOKIE = "assistec_admin_session"
const CONTADOR_COOKIE = "assistec_contador_session"
const ALWAYS_BLOCKED_FOR_CAIXA_PREFIXES = [
  "/configuracoes",
  "/relatorios",
  "/ia-mestre",
  "/rede",
  "/clientes",
  "/dashboard/clientes",
  "/dashboard/ia-mestre",
]

const FINANCEIRO_PREFIXES = ["/financeiro"]
const ESTOQUE_PREFIXES = ["/estoque", "/dashboard/estoque"]
const MARKETING_PREFIXES = ["/dashboard/marketing"]

type CaixaPerms = { permitirFinanceiro: boolean; permitirEstoque: boolean; permitirMarketingIA: boolean }

async function getCaixaPerms(request: NextRequest): Promise<CaixaPerms | null> {
  try {
    // Descobre a unidade ativa. Se não tiver, aplica política mais restritiva (null).
    const storeId = String(request.cookies.get("assistec_active_store")?.value || "").trim()
    if (!storeId) return null
    const url = new URL(`/api/stores/${encodeURIComponent(storeId)}/settings`, request.nextUrl.origin)
    const r = await fetch(url, { cache: "no-store", headers: { cookie: request.headers.get("cookie") || "" } })
    const j = (await r.json().catch(() => null)) as { settings?: any } | null
    const pc = j?.settings?.printerConfig && typeof j.settings.printerConfig === "object" ? j.settings.printerConfig : null
    const p = pc ? (pc as any).permissionsCaixa : null
    return {
      permitirFinanceiro: p?.permitirFinanceiro === true,
      permitirEstoque: p?.permitirEstoque === true,
      permitirMarketingIA: p?.permitirMarketingIA === true,
    }
  } catch {
    return null
  }
}

/** Páginas que exigem assinatura ativa (alinha com carregamento crítico no cliente). */
const CRITICAL_PAGE_PARAMS = new Set([
  "vendas",
  "os",
  "fluxo-caixa",
  "contas-pagar",
  "contas-receber",
  "relatorios-financeiros",
  "dashboard-360",
])

function isPublicPath(pathname: string): boolean {
  if (pathname.startsWith("/_next")) return true
  if (pathname.startsWith("/api")) return true
  if (pathname === "/favicon.ico") return true
  if (pathname.startsWith("/icon")) return true
  if (pathname === "/apple-icon.png" || pathname === "/apple-touch-icon.png") return true
  if (pathname === "/manifest.webmanifest" || pathname === "/manifest.json") return true
  if (pathname === "/sw.js") return true
  if (pathname.startsWith("/workbox-") || pathname.startsWith("/worker-")) return true
  if (/\.(png|svg|ico|webp|jpg|jpeg|gif|webmanifest)$/i.test(pathname)) return true
  return false
}

function isPlanOrSupport(pathname: string): boolean {
  return (
    pathname === "/meu-plano" ||
    pathname.startsWith("/meu-plano/") ||
    pathname === "/suporte" ||
    pathname.startsWith("/suporte/")
  )
}

function isLoginAdminPath(pathname: string): boolean {
  return pathname === "/login-admin" || pathname.startsWith("/login-admin/")
}

function isLoginContadorPath(pathname: string): boolean {
  return pathname === "/login-contador" || pathname.startsWith("/login-contador/")
}

/** Portal do cliente final (login CPF / pagamentos) — sem cookie de assinatura da loja. */
function isClientePortalPath(pathname: string): boolean {
  return pathname === "/portal" || pathname.startsWith("/portal/")
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (isPublicPath(pathname)) {
    return NextResponse.next()
  }

  if (
    isClientePortalPath(pathname) ||
    isPlanOrSupport(pathname) ||
    isLoginAdminPath(pathname) ||
    isLoginContadorPath(pathname)
  ) {
    return NextResponse.next()
  }

  const cookie = request.cookies.get(SUBSCRIPTION_COOKIE_NAME)?.value
  const verified = await verifySubscriptionCookieValue(cookie, SUBSCRIPTION_SECRET)
  const now = await getTrustedTimeMs()

  const redirectPlano = () => {
    const u = request.nextUrl.clone()
    u.pathname = "/meu-plano"
    u.search = ""
    return NextResponse.redirect(u)
  }

  if (!verified.ok) {
    if (pathname === "/") {
      const pageParam = request.nextUrl.searchParams.get("page")
      if (pageParam && CRITICAL_PAGE_PARAMS.has(pageParam)) {
        return redirectPlano()
      }
      return NextResponse.next()
    }
    return redirectPlano()
  }

  const expired = isVencimentoExpired(now, verified.vencimento)
  const inactive = verified.status !== "ativa"
  if (expired || inactive) {
    return redirectPlano()
  }

  if (pathname === "/logs-sistema" || pathname.startsWith("/logs-sistema/")) {
    const admin = String(request.cookies.get(ADMIN_COOKIE)?.value || "").trim()
    if (!admin) {
      const u = request.nextUrl.clone()
      u.pathname = "/"
      u.search = ""
      return NextResponse.redirect(u)
    }
  }

  if (pathname === "/contador" || pathname.startsWith("/contador/")) {
    const contador = request.cookies.get(CONTADOR_COOKIE)?.value
    if (contador !== "1") {
      const u = request.nextUrl.clone()
      u.pathname = "/login-contador"
      u.searchParams.set("next", pathname)
      return NextResponse.redirect(u)
    }
  }

  // Bloqueio por role: CAIXA / Vendedor não acessam áreas administrativas; Gerente (sessão staff) segue liberado aqui.
  const adminPresent = !!String(request.cookies.get(ADMIN_COOKIE)?.value || "").trim()
  const staffSession = !!String(request.cookies.get(STAFF_SESSION_COOKIE)?.value || "").trim()
  const staffRole = String(request.cookies.get(STAFF_ROLE_COOKIE)?.value || "").trim().toUpperCase()
  const isGerente = staffSession && staffRole === "GERENTE"
  const isCaixa = !adminPresent && !isGerente
  if (isCaixa) {
    // Sempre bloqueado (admin-only)
    if (ALWAYS_BLOCKED_FOR_CAIXA_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
      const u = request.nextUrl.clone()
      u.pathname = "/"
      u.search = "?page=vendas"
      return NextResponse.redirect(u)
    }

    // Permissões dinâmicas (por unidade)
    const perms = await getCaixaPerms(request)
    const allowFinanceiro = perms?.permitirFinanceiro === true
    const allowEstoque = perms?.permitirEstoque === true
    const allowMarketing = perms?.permitirMarketingIA === true

    if (!allowFinanceiro && FINANCEIRO_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
      const u = request.nextUrl.clone()
      u.pathname = "/"
      u.search = "?page=vendas"
      return NextResponse.redirect(u)
    }
    if (!allowEstoque && ESTOQUE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
      const u = request.nextUrl.clone()
      u.pathname = "/"
      u.search = "?page=vendas"
      return NextResponse.redirect(u)
    }
    if (!allowMarketing && MARKETING_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
      const u = request.nextUrl.clone()
      u.pathname = "/"
      u.search = "?page=vendas"
      return NextResponse.redirect(u)
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
}
