import { NextResponse } from "next/server"
import {
  SUBSCRIPTION_COOKIE_NAME,
  createSubscriptionCookieValue,
} from "@/lib/subscription-seal"

function getSecret(): string {
  return process.env.ASSISTEC_SUBSCRIPTION_SECRET || "assistec-dev-secret-change-in-production"
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      vencimento?: string
      plano?: string
      status?: string
    }
    const vencimento = String(body.vencimento || "").trim()
    const plano = String(body.plano || "bronze").trim()
    const status = String(body.status || "ativa").trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(vencimento)) {
      return NextResponse.json({ error: "invalid_vencimento" }, { status: 400 })
    }
    const value = await createSubscriptionCookieValue(vencimento, plano, status, getSecret())
    const res = NextResponse.json({ ok: true })
    res.cookies.set({
      name: SUBSCRIPTION_COOKIE_NAME,
      value,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 400,
    })
    return res
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 })
  }
}
