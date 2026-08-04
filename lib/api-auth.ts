import { cookies } from "next/headers"
import { getSessionEntitlement } from "@/lib/auth/session-entitlement"

const ADMIN_COOKIE = "assistec_admin_session"

/**
 * @deprecated Gate legado (GOAL 003D-lite). O nome é histórico: **já não lê o
 * cookie `assistec_sub_v1`**. Um selo isolado nunca concede acesso — a decisão
 * passou a ser `getSessionEntitlement()` (sessão NextAuth + utilizador ativo).
 *
 * Mantém a forma `{ ok, vencimento, plano, status }` só para não obrigar a migrar
 * de uma vez os ~15 chamadores (incluindo `lib/marketplace/api-gate.ts`, fora do
 * escopo deste GOAL). Novos consumidores devem usar `getSessionEntitlement()`.
 *
 * ⚠️ `status`/`vencimento` são o marcador de entitlement não verificado — ver
 * `ENTITLEMENT_NAO_VERIFICADO_VENCIMENTO`. Não são dados comerciais reais.
 */
export async function getVerifiedSubscriptionFromCookies(): Promise<
  | { ok: true; vencimento: string; plano: string; status: string }
  | { ok: false }
> {
  const entitlement = await getSessionEntitlement()
  if (!entitlement.ok) return { ok: false }
  return {
    ok: true,
    vencimento: entitlement.vencimento,
    plano: entitlement.plano,
    status: entitlement.status,
  }
}

export async function isAdminSession(): Promise<boolean> {
  const jar = await cookies()
  return !!(jar.get(ADMIN_COOKIE)?.value || "").trim()
}
