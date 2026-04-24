import { cookies } from "next/headers"
import {
  SUBSCRIPTION_COOKIE_NAME,
  verifySubscriptionCookieValue,
} from "@/lib/subscription-seal"

const SUBSCRIPTION_SECRET =
  process.env.ASSISTEC_SUBSCRIPTION_SECRET || "assistec-dev-secret-change-in-production"

const ADMIN_COOKIE = "assistec_admin_session"

export async function getVerifiedSubscriptionFromCookies(): Promise<
  | { ok: true; vencimento: string; plano: string; status: string }
  | { ok: false }
> {
  const jar = await cookies()
  const v = jar.get(SUBSCRIPTION_COOKIE_NAME)?.value
  const r = await verifySubscriptionCookieValue(v, SUBSCRIPTION_SECRET)
  if (!r.ok) return { ok: false }
  return { ok: true, vencimento: r.vencimento, plano: r.plano, status: r.status }
}

export async function isAdminSession(): Promise<boolean> {
  const jar = await cookies()
  return !!(jar.get(ADMIN_COOKIE)?.value || "").trim()
}
