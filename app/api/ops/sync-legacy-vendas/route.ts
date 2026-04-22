import { NextResponse } from "next/server"
import { prisma, prismaEnsureConnected } from "@/lib/prisma"
import { requireOpsSubscription, opsLojaIdFromRequestForWrite } from "@/lib/ops-api-gate"
import { upsertVendaInTransaction, type SalePayload } from "@/lib/ops-upsert-venda"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

const MAX_SALES = 5000

export async function POST(req: Request) {
  const gate = await requireOpsSubscription()
  if (!gate.ok) return gate.res

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 })
  }

  const lojaId = opsLojaIdFromRequestForWrite(req)
  if (!lojaId) {
    return NextResponse.json(
      { error: "Unidade obrigatória: envie o header x-assistec-loja-id ou query storeId / lojaId." },
      { status: 400 }
    )
  }

  const b = body as { sales?: unknown }
  const sales = b.sales
  if (!Array.isArray(sales)) {
    return NextResponse.json({ error: "sales deve ser um array" }, { status: 400 })
  }

  const slice = sales.slice(0, MAX_SALES) as SalePayload[]

  try {
    await prismaEnsureConnected()

    let salesApplied = 0
    const saleErrors: string[] = []
    for (const sale of slice) {
      if (!sale || typeof sale !== "object") continue
      try {
        await prisma.$transaction(async (tx) => {
          await upsertVendaInTransaction(tx, lojaId, sale)
        })
        salesApplied += 1
      } catch (rowErr) {
        const m = rowErr instanceof Error ? rowErr.message : String(rowErr)
        if (saleErrors.length < 12) saleErrors.push(m)
        console.error("[ops/sync-legacy-vendas] falha em uma venda:", m)
      }
    }

    const vendasNoBancoParaLoja = await prisma.venda.count({ where: { storeId: lojaId } })

    return NextResponse.json({
      ok: true,
      lojaId,
      salesReceived: slice.length,
      salesApplied,
      vendasNoBancoParaLoja,
      ...(saleErrors.length ? { warnings: saleErrors } : {}),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[ops/sync-legacy-vendas]", msg)
    const dev = process.env.NODE_ENV === "development"
    return NextResponse.json(
      { error: "Falha ao sincronizar vendas legadas", ok: false, ...(dev ? { detail: msg } : {}) },
      { status: 503 }
    )
  }
}
