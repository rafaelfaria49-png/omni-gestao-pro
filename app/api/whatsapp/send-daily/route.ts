import { NextResponse } from "next/server"
import { getVerifiedSubscriptionFromCookies } from "@/lib/api-auth"
import { isVencimentoExpired } from "@/lib/subscription-seal"
import { getTrustedTimeMs } from "@/lib/trusted-time"
import { sendDailyClosingToPhone } from "@/lib/whatsapp-daily-server"
import { APP_DISPLAY_NAME } from "@/lib/app-brand"

export const runtime = "nodejs"

/**
 * Envia o fechamento diário via API Evolution para o número informado.
 * Usado pelo painel (credenciais) ou por automações internas.
 */
export async function POST(request: Request) {
  const sub = await getVerifiedSubscriptionFromCookies()
  if (!sub.ok) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }
  const now = await getTrustedTimeMs()
  if (isVencimentoExpired(now, sub.vencimento) || sub.status !== "ativa") {
    return NextResponse.json({ error: "Assinatura inválida" }, { status: 403 })
  }

  let body: { phone?: string; empresaNome?: string }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 })
  }

  const phone =
    typeof body.phone === "string" && body.phone.replace(/\D/g, "").length >= 10
      ? body.phone
      : process.env.ASSISTEC_WHATSAPP_DONO ?? ""

  if (!phone) {
    return NextResponse.json({ error: "Informe phone no corpo ou ASSISTEC_WHATSAPP_DONO" }, { status: 400 })
  }

  const empresaNome = (body.empresaNome ?? APP_DISPLAY_NAME).trim() || APP_DISPLAY_NAME
  const r = await sendDailyClosingToPhone({ phoneDigits: phone, empresaNome })

  if (!r.ok) {
    return NextResponse.json({ ok: false, error: r.error }, { status: 502 })
  }
  return NextResponse.json({ ok: true })
}
