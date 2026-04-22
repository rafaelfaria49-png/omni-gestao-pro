import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma, prismaEnsureConnected } from "@/lib/prisma"
import { getVerifiedSubscriptionFromCookies } from "@/lib/api-auth"
import { isVencimentoExpired } from "@/lib/subscription-seal"
import { getTrustedTimeMs } from "@/lib/trusted-time"
import { storeIdFromAssistecRequestForWrite } from "@/lib/store-id-from-request"

export const runtime = "nodejs"

const bodySchema = z.object({
  lojaId: z.string().min(1).max(120),
  tituloId: z.union([z.string(), z.number()]),
  pagamentoId: z.string().min(1).max(200),
  valorEstorno: z.number().finite().positive().max(1e12),
})

/**
 * Auditoria de estorno de parcela / linha de recebimento (dados persistidos no cliente — localStorage).
 */
export async function POST(request: Request) {
  const sub = await getVerifiedSubscriptionFromCookies()
  if (!sub.ok) {
    return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 })
  }
  const now = await getTrustedTimeMs()
  if (isVencimentoExpired(now, sub.vencimento) || sub.status !== "ativa") {
    return NextResponse.json({ ok: false, error: "Assinatura inválida" }, { status: 403 })
  }

  let json: unknown
  try {
    json = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Dados inválidos", issues: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const { lojaId, tituloId, pagamentoId, valorEstorno } = parsed.data

  const storeId = storeIdFromAssistecRequestForWrite(request)
  if (!storeId) {
    return NextResponse.json(
      { ok: false, error: "Unidade obrigatória: envie o header x-assistec-loja-id ou query storeId / lojaId." },
      { status: 400 }
    )
  }
  if (lojaId !== storeId) {
    return NextResponse.json(
      { ok: false, error: "Unidade inconsistente: o corpo e o header devem referir a mesma loja." },
      { status: 400 }
    )
  }

  try {
    await prismaEnsureConnected()
    await prisma.logsAuditoria.create({
      data: {
        action: "estorno_parcela_conta_receber",
        userLabel: "dashboard",
        detail: `Estorno de parcela/linha — loja ${lojaId}, título ${String(tituloId)}, pagamento ${pagamentoId}, valor R$ ${valorEstorno.toFixed(2)}`,
        metadata: JSON.stringify({
          lojaId,
          tituloId,
          pagamentoId,
          valorEstorno,
          at: new Date().toISOString(),
        }).slice(0, 8000),
        source: "api",
      },
    })
  } catch (e) {
    console.error("[estorno-parcela-conta-receber]", e)
    return NextResponse.json(
      { ok: false, error: "Não foi possível registrar o estorno no servidor. Tente novamente." },
      { status: 500 }
    )
  }

  return NextResponse.json({
    ok: true,
    lojaId,
    tituloId,
    pagamentoId,
    valorEstorno,
  })
}
