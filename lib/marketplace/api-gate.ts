import { NextResponse } from "next/server"
import { getVerifiedSubscriptionFromCookies } from "@/lib/api-auth"
import { requireEnterpriseWith } from "@/lib/auth/guard-enterprise"
import { isVencimentoExpired } from "@/lib/subscription-seal"
import { getTrustedTimeMs } from "@/lib/trusted-time"
import { storeIdFromAssistecRequestForWrite } from "@/lib/store-id-from-request"

export const MARKETPLACE_FORBIDDEN_MESSAGE = "Sem permissão para o Marketplace."

/**
 * Sessão ativa + unidade explícita (header ou query) + membership + hubs.marketplace.
 * Sem fallback de cookie/loja legada. Sem bypass de desenvolvimento.
 */
export async function requireMarketplaceApi(req: Request) {
  const sub = await getVerifiedSubscriptionFromCookies()
  if (!sub.ok) {
    return { ok: false as const, response: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) }
  }
  const now = await getTrustedTimeMs()
  if (isVencimentoExpired(now, sub.vencimento) || sub.status !== "ativa") {
    return { ok: false as const, response: NextResponse.json({ error: "Assinatura inválida" }, { status: 403 }) }
  }
  const storeId = storeIdFromAssistecRequestForWrite(req)
  if (!storeId) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Unidade obrigatória: envie o header x-assistec-loja-id ou query storeId / lojaId." },
        { status: 400 }
      ),
    }
  }
  const enterprise = await requireEnterpriseWith(
    storeId,
    (p) => p.hubs.marketplace,
    MARKETPLACE_FORBIDDEN_MESSAGE,
  )
  if (!enterprise.ok) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: enterprise.error }, { status: enterprise.status }),
    }
  }
  return { ok: true as const, storeId }
}
