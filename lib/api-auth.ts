import { cookies } from "next/headers"
import { auth } from "@/auth"
import { getSessionEntitlement } from "@/lib/auth/session-entitlement"
import {
  ADMIN_AUTHORIZATION_COOKIE,
  resolvePinAuthorizationSecret,
  verifyPinAuthorizationToken,
} from "@/lib/auth/pin-authorization"

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

/**
 * Consome a autorização temporária de supervisor (GOAL PLAT-AUTH-PIN-CONTAINMENT-001A).
 *
 * Antes bastava o cookie existir — qualquer valor servia, e o cookie emitido a um
 * utilizador valia para qualquer outro. Agora verifica assinatura, expiração e o
 * vínculo com o `userId` da sessão NextAuth corrente.
 *
 * `storeId` NÃO é conferido aqui de propósito: o único consumidor
 * (`GET /api/audit/logs`) lê a trilha global, que não é escopada por unidade. Quem é
 * escopado por unidade deve chamar `verifyPinAuthorizationToken` passando `storeId`.
 */
export async function isAdminSession(): Promise<boolean> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return false

  const jar = await cookies()
  const result = await verifyPinAuthorizationToken(
    jar.get(ADMIN_AUTHORIZATION_COOKIE)?.value,
    resolvePinAuthorizationSecret(),
    { userId },
  )
  return result.ok
}
