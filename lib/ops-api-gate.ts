import { NextResponse } from "next/server"
import { storeIdFromAssistecRequestForRead, storeIdFromAssistecRequestForWrite } from "@/lib/store-id-from-request"
import { getVerifiedSubscriptionFromCookies } from "@/lib/api-auth"
import { isVencimentoExpired } from "@/lib/subscription-seal"
import { getTrustedTimeMs } from "@/lib/trusted-time"

export async function requireOpsSubscription() {
  const sub = await getVerifiedSubscriptionFromCookies()
  if (!sub.ok) {
    return { ok: false as const, res: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) }
  }
  const now = await getTrustedTimeMs()
  if (isVencimentoExpired(now, sub.vencimento) || sub.status !== "ativa") {
    return { ok: false as const, res: NextResponse.json({ error: "Assinatura inválida" }, { status: 403 }) }
  }
  return { ok: true as const, sub }
}

/** Header `x-assistec-loja-id`, query `storeId`/`lojaId` ou cookie `assistec-active-store` (último recurso: unidade legada). */
export function opsLojaIdFromRequest(req: Request): string {
  return storeIdFromAssistecRequestForRead(req)
}

/** Mutações financeiras/ops: só header ou query (sem cookie sozinho). */
export function opsLojaIdFromRequestForWrite(req: Request): string | null {
  return storeIdFromAssistecRequestForWrite(req)
}
