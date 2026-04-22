import { NextResponse } from "next/server"
import { prisma, prismaEnsureConnected } from "@/lib/prisma"
import { getVerifiedSubscriptionFromCookies } from "@/lib/api-auth"
import { isVencimentoExpired } from "@/lib/subscription-seal"
import { getTrustedTimeMs } from "@/lib/trusted-time"
import { storeIdFromAssistecRequestForWrite } from "@/lib/store-id-from-request"

export const runtime = "nodejs"

/** Sincroniza o resumo do dia (PDV) para o servidor usar no webhook / fechamento automático. */
export async function POST(request: Request) {
  const sub = await getVerifiedSubscriptionFromCookies()
  if (!sub.ok) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }
  const now = await getTrustedTimeMs()
  if (isVencimentoExpired(now, sub.vencimento) || sub.status !== "ativa") {
    return NextResponse.json({ error: "Assinatura inválida" }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 })
  }

  const storeId = storeIdFromAssistecRequestForWrite(request)
  if (!storeId) {
    return NextResponse.json(
      { error: "Unidade obrigatória: envie o header x-assistec-loja-id ou query storeId / lojaId." },
      { status: 400 }
    )
  }

  const ledger = body as {
    date?: string
    vendasDinheiro?: number
    vendasPix?: number
    vendasCartao?: number
    totalVendas?: number
    osAbertas?: number
  }

  const date = typeof ledger.date === "string" ? ledger.date.slice(0, 10) : ""
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date inválido" }, { status: 400 })
  }

  try {
    await prismaEnsureConnected()
    await prisma.ledgerSnapshot.upsert({
      where: { storeId_date: { storeId, date } },
      create: { storeId, date, payload: JSON.stringify(ledger) },
      update: { payload: JSON.stringify(ledger) },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[sync-ledger] Prisma upsert failed:", msg)
    const dev = process.env.NODE_ENV === "development"
    return NextResponse.json(
      {
        ok: false,
        error: "Falha ao sincronizar resumo no servidor",
        ...(dev ? { detail: msg } : {}),
      },
      { status: 503 }
    )
  }

  return NextResponse.json({ ok: true })
}
