import { NextResponse } from "next/server"

const CORS_ALLOW_HEADERS =
  "Content-Type, Authorization, x-api-key, x-webhook-token, X-Requested-With"

/**
 * Origens permitidas para APIs (CORS). Inclua o domínio da Vercel e o custom domain.
 * Ex.: https://app.vercel.app,https://assistec.com.br
 * Se vazio, ecoa Origin quando coincide com NEXT_PUBLIC_APP_URL ou VERCEL_URL.
 */
function allowedOrigins(): string[] {
  const extra = process.env.ASSISTEC_API_CORS_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? []
  const app = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "")
  const vercel = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null
  return [...new Set([...extra, app, vercel].filter((x): x is string => Boolean(x)))]
}

export function resolveCorsOrigin(request: Request): string | null {
  const origin = request.headers.get("origin")
  if (!origin) return null
  const allowed = allowedOrigins()
  if (allowed.length === 0) return null
  if (allowed.includes(origin)) return origin
  return null
}

export function corsHeaders(request: Request): Record<string, string> {
  const o = resolveCorsOrigin(request)
  const base: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS,
    "Access-Control-Max-Age": "86400",
  }
  if (o) {
    base["Access-Control-Allow-Origin"] = o
    base["Vary"] = "Origin"
  }
  return base
}

export function withCors(request: Request, res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(corsHeaders(request))) {
    res.headers.set(k, v)
  }
  return res
}
