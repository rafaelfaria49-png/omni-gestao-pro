import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import {
  SUBSCRIPTION_COOKIE_NAME,
  isVencimentoExpired,
  verifySubscriptionCookieValue,
} from "@/lib/subscription-seal"
import { getTrustedTimeMs } from "@/lib/trusted-time"

function getSecret(): string {
  return process.env.ASSISTEC_SUBSCRIPTION_SECRET || "assistec-dev-secret-change-in-production"
}

export async function GET() {
  const serverTimeMs = await getTrustedTimeMs()
  const cookieStore = await cookies()
  const cookie = cookieStore.get(SUBSCRIPTION_COOKIE_NAME)?.value
  const verified = await verifySubscriptionCookieValue(cookie, getSecret())
  if (!verified.ok) {
    const pendingSeal = verified.reason === "missing_cookie"
    return NextResponse.json({
      valid: pendingSeal ? null : false,
      pendingSeal,
      expired: !pendingSeal,
      reason: verified.reason,
      serverTime: new Date(serverTimeMs).toISOString(),
      source: pendingSeal ? "awaiting_seal" : "cookie_invalid",
    })
  }
  const expired = isVencimentoExpired(serverTimeMs, verified.vencimento)
  const inactive = verified.status !== "ativa"
  const valid = !expired && !inactive
  return NextResponse.json({
    valid,
    expired: expired || inactive,
    serverTime: new Date(serverTimeMs).toISOString(),
    vencimento: verified.vencimento,
    plano: verified.plano,
    status: verified.status,
    source: "server_trust",
  })
}
