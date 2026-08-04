import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/require-admin"
import { getSubscriptionSecret } from "@/lib/api-auth"
import {
  SUBSCRIPTION_COOKIE_NAME,
  createSubscriptionCookieValue,
} from "@/lib/subscription-seal"
import { getTrustedTimeMs } from "@/lib/trusted-time"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Emissão do selo de assinatura (PLAT-SEC-SEAL-003B).
 *
 * O corpo da requisição é IGNORADO por completo — não é lido, não é parseado.
 * Plano, status e vencimento vêm exclusivamente do registro server-side da
 * assinatura (`AdminUser`, alimentado pelo webhook Stripe). O navegador não
 * escolhe o próprio plano nem a própria validade.
 *
 * O selo é entitlement comercial; NUNCA prova identidade. Quem autoriza a
 * emissão é `requireAdmin()` (sessão NextAuth + papel ADMIN/SUPER_ADMIN), o
 * mecanismo canônico já usado pelas demais rotas administrativas.
 */

/** Status Stripe que representam assinatura corrente. */
const STRIPE_STATUS_ATIVO = new Set(["active", "trialing"])

/** `Date` → `YYYY-MM-DD` em UTC (formato do payload do selo). */
function toYmdUtc(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export async function POST() {
  // 1. Autorização canônica: sem sessão ⇒ 401; papel inadequado (CAIXA, VENDEDOR,
  //    TECNICO, GERENTE, OPERADOR) ⇒ 403. Nenhuma dessas respostas emite cookie.
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res

  // 2. Sem segredo configurado não se emite selo algum (fail-closed, sanitizado).
  const secret = getSubscriptionSecret()
  if (!secret) {
    return NextResponse.json({ error: "subscription_seal_unavailable" }, { status: 503 })
  }

  // 3. Fonte da verdade: registro da assinatura do próprio emissor autenticado.
  const assinatura = await prisma.adminUser.findUnique({
    where: { id: gate.admin.id },
    select: { planName: true, subscriptionStatus: true, currentPeriodEnd: true },
  })

  const status = String(assinatura?.subscriptionStatus ?? "").trim().toLowerCase()
  const plano = String(assinatura?.planName ?? "").trim().toLowerCase()
  const periodoFim = assinatura?.currentPeriodEnd ?? null
  const periodoFimMs = periodoFim ? periodoFim.getTime() : Number.NaN

  if (
    !STRIPE_STATUS_ATIVO.has(status) ||
    !plano ||
    !periodoFim ||
    !Number.isFinite(periodoFimMs) ||
    periodoFimMs <= (await getTrustedTimeMs())
  ) {
    // Assinatura inexistente, cancelada, vencida ou incompleta: nada é emitido.
    // Não se inventa plano, status nem validade.
    return NextResponse.json({ error: "subscription_not_active" }, { status: 403 })
  }

  const value = await createSubscriptionCookieValue(
    toYmdUtc(periodoFim),
    plano,
    "ativa",
    secret,
  )

  const res = NextResponse.json({ ok: true })
  res.cookies.set({
    name: SUBSCRIPTION_COOKIE_NAME,
    value,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    // Expira junto com o período pago real — o dia do payload (`YYYY-MM-DD`) é
    // avaliado como fim-do-dia local na verificação, então o cookie morrer no
    // instante exato de `currentPeriodEnd` é o limite mais conservador dos dois.
    expires: periodoFim,
  })
  return res
}
