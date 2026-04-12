import type { DevolucaoRecord, InventoryItem, SaleRecord } from "@/lib/operations-store"

export const PURCHASE_WINDOW_DAYS = 30
export const PURCHASE_COVERAGE_ALERT_DAYS = 7

export type PurchasePlanningRow = {
  inventoryId: string
  name: string
  category: string
  stock: number
  cost: number
  /** Quantidade líquida vendida no período (vendas − devoluções no período). */
  qtyNet30d: number
  /** Média diária = qtyNet30d / 30 */
  avgDaily: number
  /** Dias de estoque ao ritmo atual; null se não há ritmo de venda. */
  coverageDays: number | null
  suggestPurchase: boolean
  /** Texto curto para tooltip / PDF. */
  motivo: string
}

function inWindow(iso: string, start: Date, end: Date): boolean {
  const t = new Date(iso).getTime()
  return t >= start.getTime() && t <= end.getTime()
}

/** Quantidade líquida movimentada no período por SKU (vendas − devoluções na janela). */
export function netQtySoldInWindow(
  inventoryId: string,
  sales: SaleRecord[],
  devolucoes: DevolucaoRecord[],
  windowStart: Date,
  windowEnd: Date
): number {
  let out = 0
  for (const s of sales) {
    if (!inWindow(s.at, windowStart, windowEnd)) continue
    for (const ln of s.lines) {
      if (ln.inventoryId !== inventoryId) continue
      out += ln.quantity
    }
  }
  for (const d of devolucoes) {
    if (!inWindow(d.at, windowStart, windowEnd)) continue
    for (const ln of d.lines) {
      if (ln.inventoryId !== inventoryId) continue
      out -= ln.quantity
    }
  }
  return Math.max(0, out)
}

export function computePurchasePlanning(
  inventory: InventoryItem[],
  sales: SaleRecord[],
  devolucoes: DevolucaoRecord[],
  now: Date = new Date(),
  windowDays: number = PURCHASE_WINDOW_DAYS,
  alertBelowDays: number = PURCHASE_COVERAGE_ALERT_DAYS
): PurchasePlanningRow[] {
  const windowEnd = new Date(now)
  const windowStart = new Date(now)
  windowStart.setDate(windowStart.getDate() - windowDays)
  windowStart.setHours(0, 0, 0, 0)
  windowEnd.setHours(23, 59, 59, 999)

  const rows: PurchasePlanningRow[] = []

  for (const item of inventory) {
    const qtyNet30d = netQtySoldInWindow(item.id, sales, devolucoes, windowStart, windowEnd)
    const avgDaily = qtyNet30d / windowDays
    let coverageDays: number | null = null
    if (avgDaily > 0.0001) {
      coverageDays = item.stock / avgDaily
    }

    let suggestPurchase = false
    let motivo = ""

    if (item.stock <= 0) {
      suggestPurchase = true
      motivo = "Estoque zerado ou negativo."
    } else if (avgDaily > 0.0001 && coverageDays !== null && coverageDays < alertBelowDays) {
      suggestPurchase = true
      motivo = `Cobertura estimada ${coverageDays.toFixed(1)} dias (abaixo de ${alertBelowDays} dias).`
    } else if (avgDaily > 0.0001 && coverageDays !== null) {
      motivo = `Cobertura estimada ${coverageDays.toFixed(1)} dias.`
    } else {
      motivo = "Sem vendas líquidas no período; ritmo não estimável."
    }

    rows.push({
      inventoryId: item.id,
      name: item.name,
      category: item.category || "Sem categoria",
      stock: item.stock,
      cost: item.cost,
      qtyNet30d,
      avgDaily,
      coverageDays,
      suggestPurchase,
      motivo,
    })
  }

  rows.sort((a, b) => {
    if (a.suggestPurchase !== b.suggestPurchase) return a.suggestPurchase ? -1 : 1
    const ca = a.coverageDays ?? 9999
    const cb = b.coverageDays ?? 9999
    return ca - cb
  })

  return rows
}

/** Quantidade sugerida para cobrir `targetDays` de venda (piso 0). */
export function suggestedOrderQty(row: PurchasePlanningRow, targetDays: number = PURCHASE_COVERAGE_ALERT_DAYS): number {
  if (row.avgDaily <= 0) return 0
  const need = Math.ceil(row.avgDaily * targetDays - row.stock)
  return Math.max(0, need)
}
