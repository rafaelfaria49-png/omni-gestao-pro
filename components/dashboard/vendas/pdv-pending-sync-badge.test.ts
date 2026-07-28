import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SaleRecord } from "@/lib/operations-sale-types"

const h = vi.hoisted(() => ({
  sales: [] as SaleRecord[],
  retrySyncSale: vi.fn(),
  toast: vi.fn(),
}))

vi.mock("@/lib/operations-store", () => ({
  useOperationsStore: () => ({
    sales: h.sales,
    devolucoes: [],
    pendingCaixaOperations: [],
    retrySyncSale: h.retrySyncSale,
  }),
}))
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: h.toast }),
}))

import { PdvPendingSyncBadge } from "./pdv-pending-sync-badge"

function pending(code?: string): SaleRecord {
  return {
    id: "VDA-2026-0999",
    at: "2026-07-28T14:00:00.000Z",
    lines: [],
    total: 10,
    paymentBreakdown: {
      dinheiro: 10,
      pix: 0,
      cartaoDebito: 0,
      cartaoCredito: 0,
      carne: 0,
      aPrazo: 0,
      creditoVale: 0,
    },
    syncPending: true,
    syncBlockedCode: code,
  }
}

beforeEach(() => {
  h.sales = []
  vi.clearAllMocks()
})

describe("PdvPendingSyncBadge — conflitos técnicos permanentes", () => {
  it.each([
    "PEDIDO_ID_DE_OUTRA_LOJA",
    "PEDIDO_ID_CONFLITO_MESMA_LOJA",
  ])("mostra quarentena e não oferece Reenviar para %s", (code) => {
    h.sales = [pending(code)]
    const html = renderToStaticMarkup(React.createElement(PdvPendingSyncBadge))
    expect(html).toContain("Conflito técnico de identificação")
    expect(html).toContain("recuperação administrada")
    expect(html).not.toContain(">Reenviar<")
  })

  it("mantém Reenviar para pendência comum", () => {
    h.sales = [pending("CAIXA_FECHADO")]
    const html = renderToStaticMarkup(React.createElement(PdvPendingSyncBadge))
    expect(html).toContain(">Reenviar<")
  })
})
