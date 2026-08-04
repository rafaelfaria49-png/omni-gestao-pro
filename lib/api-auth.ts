import { cookies } from "next/headers"
import {
  SUBSCRIPTION_COOKIE_NAME,
  verifySubscriptionCookieValue,
} from "@/lib/subscription-seal"

const ADMIN_COOKIE = "assistec_admin_session"

/**
 * Segredo do selo de assinatura (PLAT-SEC-SEAL-003B).
 *
 * Sem fallback: variável ausente/vazia devolve `""`, e `verifySubscriptionCookieValue`
 * responde `missing_server_secret` — ou seja, nenhum selo é aceito e nenhum selo é
 * emitido. Falha fechada, por desenho.
 *
 * Lido a cada chamada (nunca em escopo de módulo) para que o valor não fique
 * congelado no import — o que impediria testar o caminho de segredo ausente.
 */
export function getSubscriptionSecret(): string {
  return process.env.ASSISTEC_SUBSCRIPTION_SECRET?.trim() ?? ""
}

export async function getVerifiedSubscriptionFromCookies(): Promise<
  | { ok: true; vencimento: string; plano: string; status: string }
  | { ok: false }
> {
  const jar = await cookies()
  const v = jar.get(SUBSCRIPTION_COOKIE_NAME)?.value
  const r = await verifySubscriptionCookieValue(v, getSubscriptionSecret())
  if (!r.ok) return { ok: false }
  return { ok: true, vencimento: r.vencimento, plano: r.plano, status: r.status }
}

export async function isAdminSession(): Promise<boolean> {
  const jar = await cookies()
  return !!(jar.get(ADMIN_COOKIE)?.value || "").trim()
}
