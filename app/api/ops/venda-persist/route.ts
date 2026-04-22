import { NextResponse } from "next/server"
import { prisma, prismaEnsureConnected } from "@/lib/prisma"
import { requireOpsSubscription, opsLojaIdFromRequestForWrite } from "@/lib/ops-api-gate"
import { upsertVendaInTransaction, type SalePayload } from "@/lib/ops-upsert-venda"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function POST(req: Request) {
  const gate = await requireOpsSubscription()
  if (!gate.ok) return gate.res

  const lojaId = opsLojaIdFromRequestForWrite(req)
  if (!lojaId) {
    return NextResponse.json(
      { error: "Unidade obrigatória: envie o header x-assistec-loja-id ou query storeId / lojaId." },
      { status: 400 }
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 })
  }

  const sale = (body as { sale?: SalePayload }).sale
  if (!sale || typeof sale !== "object") {
    return NextResponse.json({ error: "sale obrigatório" }, { status: 400 })
  }

  const pedidoId = typeof sale.id === "string" && sale.id.trim() ? sale.id.trim() : ""
  if (!pedidoId) {
    return NextResponse.json({ error: "sale.id inválido" }, { status: 400 })
  }

  try {
    await prismaEnsureConnected()
    await prisma.$transaction(async (tx) => {
      await upsertVendaInTransaction(tx, lojaId, sale)
    })

    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[ops/venda-persist]", msg)
    const dev = process.env.NODE_ENV === "development"
    return NextResponse.json(
      { error: "Falha ao salvar venda no servidor", ...(dev ? { detail: msg } : {}) },
      { status: 503 }
    )
  }
}
