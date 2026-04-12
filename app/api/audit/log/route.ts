import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getVerifiedSubscriptionFromCookies } from "@/lib/api-auth"
import { isVencimentoExpired } from "@/lib/subscription-seal"
import { getTrustedTimeMs } from "@/lib/trusted-time"

export const runtime = "nodejs"

const MAX_DETAIL = 4000

export async function POST(request: Request) {
  const sub = await getVerifiedSubscriptionFromCookies()
  if (!sub.ok) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }
  const now = await getTrustedTimeMs()
  if (isVencimentoExpired(now, sub.vencimento) || sub.status !== "ativa") {
    return NextResponse.json({ error: "Assinatura inválida" }, { status: 403 })
  }

  let body: { action?: string; userLabel?: string; detail?: string; metadata?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 })
  }

  const action = String(body.action ?? "").trim().slice(0, 120)
  const userLabel = String(body.userLabel ?? "").trim().slice(0, 500)
  const detail = String(body.detail ?? "").trim().slice(0, MAX_DETAIL)
  if (!action || !userLabel || !detail) {
    return NextResponse.json({ error: "action, userLabel e detail são obrigatórios" }, { status: 400 })
  }

  const metadata =
    body.metadata !== undefined ? JSON.stringify(body.metadata).slice(0, 8000) : null

  await prisma.logsAuditoria.create({
    data: {
      action,
      userLabel,
      detail,
      metadata,
      source: "dashboard",
    },
  })

  return NextResponse.json({ ok: true })
}
