import type { Prisma } from "@/generated/prisma"

export type SalePayload = {
  id?: string
  at?: string
  total?: number
  customerName?: string
  lines?: Array<{
    inventoryId?: string
    name?: string
    quantity?: number
    unitPrice?: number
    lineTotal?: number
    qtyReturned?: number
  }>
}

function asJsonPayload(sale: SalePayload): Prisma.InputJsonValue {
  return sale as unknown as Prisma.InputJsonValue
}

/** Upsert de uma venda PDV + itens (usado por `/api/ops/venda-persist` e sync legado). */
export async function upsertVendaInTransaction(
  tx: Prisma.TransactionClient,
  lojaId: string,
  sale: SalePayload
): Promise<void> {
  const pedidoId = typeof sale.id === "string" && sale.id.trim() ? sale.id.trim() : ""
  if (!pedidoId) throw new Error("sale.id inválido")

  const total = typeof sale.total === "number" && Number.isFinite(sale.total) ? sale.total : 0
  let at: Date
  try {
    at = sale.at ? new Date(sale.at) : new Date()
    if (Number.isNaN(at.getTime())) at = new Date()
  } catch {
    at = new Date()
  }

  const clienteNome =
    typeof sale.customerName === "string" && sale.customerName.trim() ? sale.customerName.trim() : null

  const lines = Array.isArray(sale.lines) ? sale.lines : []

  const v = await tx.venda.upsert({
    where: { pedidoId },
    create: {
      storeId: lojaId,
      pedidoId,
      payload: asJsonPayload(sale),
      total,
      at,
      clienteNome,
    },
    update: {
      storeId: lojaId,
      payload: asJsonPayload(sale),
      total,
      at,
      clienteNome,
    },
  })

  await tx.itemVenda.deleteMany({ where: { vendaId: v.id } })

  for (const line of lines) {
    const inventoryId = typeof line.inventoryId === "string" ? line.inventoryId : null
    const nome = typeof line.name === "string" ? line.name : ""
    const qRaw = typeof line.quantity === "number" && Number.isFinite(line.quantity) ? line.quantity : 0
    const quantidade = Math.max(0, Math.min(2_000_000_000, Math.round(qRaw)))
    const precoUnitario =
      typeof line.unitPrice === "number" && Number.isFinite(line.unitPrice) ? line.unitPrice : 0
    const lineTotal =
      typeof line.lineTotal === "number" && Number.isFinite(line.lineTotal)
        ? line.lineTotal
        : Math.round(precoUnitario * quantidade * 100) / 100

    await tx.itemVenda.create({
      data: {
        vendaId: v.id,
        inventoryId,
        nome,
        quantidade,
        precoUnitario,
        lineTotal,
      },
    })
  }
}
