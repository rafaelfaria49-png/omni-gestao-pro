import { NextResponse } from "next/server"
import { withPrismaSafe } from "@/lib/prisma"
import { getVerifiedSubscriptionFromCookies } from "@/lib/api-auth"
import { isVencimentoExpired } from "@/lib/subscription-seal"
import { getTrustedTimeMs } from "@/lib/trusted-time"
import { storeIdFromAssistecRequestForRead } from "@/lib/store-id-from-request"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

async function requireSubscription() {
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

export async function GET(req: Request) {
  const gate = await requireSubscription()
  if (!gate.ok) return gate.res
  const lojaId = storeIdFromAssistecRequestForRead(req)

  const rows = await withPrismaSafe(
    (db) =>
      db.categoriaProduto.findMany({
        where: { lojaId },
        orderBy: [{ nome: "asc" }],
        select: { slug: true, nome: true },
      }),
    []
  )

  return NextResponse.json({
    ok: true,
    items: rows,
  })
}
