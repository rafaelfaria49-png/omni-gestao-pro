import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { proxy, config as proxyConfig } from "./proxy"

const ADMIN_COOKIE = "assistec_admin_session"

export async function middleware(req: NextRequest) {
  const base = await proxy(req)
  // Se o proxy já decidiu redirecionar/bloquear, respeitar.
  if (base instanceof NextResponse && base.headers.get("location")) return base

  const { pathname } = req.nextUrl
  const isCaixa = req.cookies.get(ADMIN_COOKIE)?.value !== "1"
  if (
    isCaixa &&
    (pathname.includes("/configuracoes") || pathname.includes("/financeiro"))
  ) {
    const u = req.nextUrl.clone()
    u.pathname = "/"
    u.search = ""
    return NextResponse.redirect(u)
  }
  return base
}

export const config = proxyConfig

