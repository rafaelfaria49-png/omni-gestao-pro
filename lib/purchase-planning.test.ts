import { describe, expect, it } from "vitest"
import {
  computePurchasePlanning,
  netQtySoldInWindow,
  PURCHASE_COVERAGE_ALERT_DAYS,
  PURCHASE_WINDOW_DAYS,
} from "./purchase-planning"
import type { DevolucaoRecord, InventoryItem, SaleRecord } from "./operations-store"

const baseInv: InventoryItem[] = [
  { id: "a", name: "Item A", stock: 10, cost: 1, price: 2, category: "Cat" },
]

function sale(at: string, lines: SaleRecord["lines"]): SaleRecord {
  return {
    id: "VDA-2026-0001",
    at,
    lines,
    total: 100,
    paymentBreakdown: { dinheiro: 100, pix: 0, cartaoDebito: 0, cartaoCredito: 0, carne: 0, aPrazo: 0, creditoVale: 0 },
  }
}

describe("netQtySoldInWindow", () => {
  it("soma vendas e subtrai devoluções no período", () => {
    const start = new Date("2026-01-01T00:00:00.000Z")
    const end = new Date("2026-01-31T23:59:59.999Z")
    const sales: SaleRecord[] = [
      sale("2026-01-15T12:00:00.000Z", [
        { inventoryId: "a", name: "Item A", quantity: 10, unitPrice: 1, lineTotal: 10 },
      ]),
    ]
    const dev: DevolucaoRecord[] = [
      {
        id: "DEV-2026-0001",
        at: "2026-01-20T12:00:00.000Z",
        saleId: "VDA-2026-0001",
        customerCpf: "123",
        customerName: "X",
        lines: [{ inventoryId: "a", name: "Item A", quantity: 3, valor: 3 }],
        mode: "somente_estoque",
        creditIssued: 0,
      },
    ]
    expect(netQtySoldInWindow("a", sales, dev, start, end)).toBe(7)
  })
})

describe("computePurchasePlanning", () => {
  it("marca sugestão quando cobertura < 7 dias", () => {
    const inv: InventoryItem[] = [{ id: "a", name: "Item A", stock: 6, cost: 1, price: 2, category: "Cat" }]
    /** 30 un em 30 dias => 1/dia => 6 dias de estoque */
    const sales: SaleRecord[] = [
      sale("2026-04-05T12:00:00.000Z", [
        { inventoryId: "a", name: "Item A", quantity: 30, unitPrice: 1, lineTotal: 30 },
      ]),
    ]
    const now = new Date("2026-04-10T12:00:00.000Z")
    const rows = computePurchasePlanning(inv, sales, [], now, PURCHASE_WINDOW_DAYS, PURCHASE_COVERAGE_ALERT_DAYS)
    const r = rows.find((x) => x.inventoryId === "a")!
    expect(r.suggestPurchase).toBe(true)
    expect(r.coverageDays).toBeCloseTo(6, 5)
  })

  it("não marca sugestão quando ritmo zero e estoque positivo", () => {
    const inv: InventoryItem[] = [{ id: "a", name: "Item A", stock: 5, cost: 1, price: 2, category: "Cat" }]
    const rows = computePurchasePlanning(inv, [], [], new Date("2026-04-10T12:00:00.000Z"))
    const r = rows[0]
    expect(r.suggestPurchase).toBe(false)
  })
})
