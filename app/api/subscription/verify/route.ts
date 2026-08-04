import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import {
  SUBSCRIPTION_COOKIE_NAME,
  isVencimentoExpired,
  verifySubscriptionCookieValue,
  getSubscriptionSecret,
  type VerifySubscriptionResult,
} from "@/lib/subscription-seal"
import { getTrustedTimeMs } from "@/lib/trusted-time"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Verificação do selo (PLAT-SEC-SEAL-003B).
 *
 * Responde APENAS sobre entitlement comercial. Não autentica usuário, não
 * autoriza loja e não é rota de login. Sem segredo configurado, ou com selo
 * ausente/adulterado/assinado por outro segredo, o resultado nunca é válido.
 */

/**
 * Único motivo exposto ao cliente: distingue "ainda não há selo" de "selo
 * recusado". Qualquer outra causa (assinatura inválida, formato quebrado,
 * segredo ausente no servidor) é colapsada — o cliente não recebe pistas sobre
 * a configuração do servidor nem sobre o porquê da recusa.
 */
function sanitizeReason(reason: string): string {
  return reason === "missing_cookie" ? "missing_cookie" : "invalid_seal"
}

export async function GET() {
  const serverTimeMs = await getTrustedTimeMs()
  const serverTime = new Date(serverTimeMs).toISOString()

  let verified: VerifySubscriptionResult
  try {
    const cookieStore = await cookies()
    const cookie = cookieStore.get(SUBSCRIPTION_COOKIE_NAME)?.value
    // Segredo ausente ⇒ `""` ⇒ `missing_server_secret`: nunca válido.
    verified = await verifySubscriptionCookieValue(cookie, getSubscriptionSecret())
  } catch {
    // Selo malformado não pode virar exceção não tratada nem stack trace.
    verified = { ok: false, reason: "invalid_seal" }
  }

  if (!verified.ok) {
    const pendingSeal = verified.reason === "missing_cookie"
    return NextResponse.json({
      valid: pendingSeal ? null : false,
      pendingSeal,
      expired: !pendingSeal,
      reason: sanitizeReason(verified.reason),
      serverTime,
      source: pendingSeal ? "awaiting_seal" : "cookie_invalid",
    })
  }

  const expired = isVencimentoExpired(serverTimeMs, verified.vencimento)
  const inactive = verified.status !== "ativa"
  const valid = !expired && !inactive
  return NextResponse.json({
    valid,
    expired: expired || inactive,
    serverTime,
    vencimento: verified.vencimento,
    plano: verified.plano,
    status: verified.status,
    source: "server_trust",
  })
}
