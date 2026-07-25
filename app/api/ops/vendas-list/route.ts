import { NextResponse } from "next/server"
import { prisma, prismaEnsureConnected } from "@/lib/prisma"
import { requireOpsSubscription, opsLojaIdFromRequest } from "@/lib/ops-api-gate"
// `saleFromDbRow` vive em `@/lib/vendas/sale-from-db-row` (helper puro e testável) — ele
// também remove os marcadores client-only (`syncPending`/`syncBlockedCode`) de payloads
// legados, para que venda vinda do banco nunca volte classificada como pendente.
import { saleFromDbRow } from "@/lib/vendas/sale-from-db-row"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET(req: Request) {
  const gate = await requireOpsSubscription()
  if (!gate.ok) {
    const dev = process.env.NODE_ENV === "development"
    if (!dev) return gate.res
  }

  const lojaId = opsLojaIdFromRequest(req)
  if (!lojaId) return NextResponse.json({ error: "storeId obrigatório" }, { status: 400 })

  try {
    await prismaEnsureConnected()
    const rows = await prisma.venda.findMany({
      where: { storeId: lojaId },
      include: { itens: true },
      orderBy: { at: "asc" },
    })

    const sales = rows.map((r) =>
      saleFromDbRow({
        pedidoId: r.pedidoId,
        total: r.total,
        at: r.at,
        clienteNome: r.clienteNome,
        status: r.status,
        payload: r.payload,
        itens: r.itens,
      })
    )

    return NextResponse.json({
      sales,
      _lojaIdRecebido: lojaId,
      _gateBypassedInDev: !gate.ok && process.env.NODE_ENV === "development",
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[ops/vendas-list]", msg)
    const dev = process.env.NODE_ENV === "development"
    return NextResponse.json(
      { error: "Falha ao listar vendas", sales: [], ...(dev ? { detail: msg } : {}) },
      { status: 503 }
    )
  }
}
