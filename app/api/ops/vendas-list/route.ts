import { NextResponse } from "next/server"
import { prisma, prismaEnsureConnected } from "@/lib/prisma"
import { requireOpsSubscription, opsLojaIdFromRequest } from "@/lib/ops-api-gate"
import type { PaymentBreakdownFull, SaleLineRecord, SaleRecord } from "@/lib/operations-sale-types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

const zeroPb: PaymentBreakdownFull = {
  dinheiro: 0,
  pix: 0,
  cartaoDebito: 0,
  cartaoCredito: 0,
  carne: 0,
  aPrazo: 0,
  creditoVale: 0,
}

function saleFromDbRow(r: {
  pedidoId: string
  total: number
  at: Date
  clienteNome: string | null
  payload: unknown
  itens: Array<{
    inventoryId: string | null
    nome: string
    quantidade: number
    precoUnitario: number
    lineTotal: number
  }>
}): SaleRecord {
  const p = r.payload
  if (p && typeof p === "object") {
    const o = p as Partial<SaleRecord>
    if (typeof o.id === "string" && o.id === r.pedidoId && Array.isArray(o.lines)) {
      return o as SaleRecord
    }
  }

  const lines: SaleLineRecord[] = r.itens.map((it) => ({
    inventoryId: it.inventoryId ?? "",
    name: it.nome,
    quantity: it.quantidade,
    unitPrice: it.precoUnitario,
    lineTotal: it.lineTotal,
    qtyReturned: 0,
  }))

  return {
    id: r.pedidoId,
    at: r.at.toISOString(),
    lines,
    total: r.total,
    customerName: r.clienteNome ?? undefined,
    paymentBreakdown: zeroPb,
  }
}

export async function GET(req: Request) {
  const gate = await requireOpsSubscription()
  if (!gate.ok) {
    const dev = process.env.NODE_ENV === "development"
    if (!dev) return gate.res
  }

  const lojaId = opsLojaIdFromRequest(req)

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
