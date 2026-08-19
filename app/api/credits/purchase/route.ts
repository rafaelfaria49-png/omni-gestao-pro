import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireCreditsUserIdForApi } from "@/lib/credits/api-auth"
import { creditsLedgerUserCreateData } from "@/lib/credits/ledger-user"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

type PackageId = "credits_500" | "credits_1000" | "credits_2000"

const PACKAGES: Record<PackageId, { credits: number; amount: number }> = {
  credits_500: { credits: 500, amount: 2990 },
  credits_1000: { credits: 1000, amount: 4990 },
  credits_2000: { credits: 2000, amount: 8990 },
}

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      {
        error: "Compra mock desativada em produção.",
        message: "Integre um gateway de pagamento para liberar compras reais.",
      },
      { status: 403 }
    )
  }

  const authUser = await requireCreditsUserIdForApi()
  if (!authUser.ok) return authUser.response
  const userId = authUser.userId

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: "JSON inválido" }, { status: 400 })
  }

  const packageId = typeof (body as any)?.packageId === "string" ? String((body as any).packageId).trim() : ""
  if (packageId !== "credits_500" && packageId !== "credits_1000" && packageId !== "credits_2000") {
    return NextResponse.json({ success: false, error: "Pacote inválido" }, { status: 400 })
  }

  const pack = PACKAGES[packageId as PackageId]

  const result = await prisma.$transaction(async (tx) => {
    // Se o usuário ainda não existir (ambiente novo/mocks), cria um registro mínimo.
    const user = await tx.user.upsert({
      where: { id: userId },
      update: {},
      create: {
        ...creditsLedgerUserCreateData(userId),
        credits: 0,
      },
      select: { id: true, credits: true },
    })

    await tx.creditPurchase.create({
      data: {
        userId: user.id,
        package: packageId,
        credits: pack.credits,
        amount: pack.amount,
        status: "PAID",
      },
      select: { id: true },
    })

    const updated = await tx.user.update({
      where: { id: user.id },
      data: { credits: { increment: pack.credits } },
      select: { credits: true },
    })

    return { newBalance: updated.credits }
  })

  return NextResponse.json({
    success: true,
    creditsAdded: pack.credits,
    newBalance: result.newBalance,
  })
}

