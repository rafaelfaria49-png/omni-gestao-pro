/**
 * GOAL: PDV-PEDIDO-ID-COLISAO-MULTILOJA-FIX-001
 *
 * Toda venda que vem do banco está CONFIRMADA. O `payload` legado pode carregar os
 * marcadores client-only (`syncPending`/`syncBlockedCode`) — 520 registros no banco os
 * têm (20 loja-1 + 500 loja-2) — e o reader precisa ignorá-los, senão a venda volta do
 * servidor já classificada como pendente em qualquer navegador que ainda não a tenha
 * localmente (pendência fantasma). Compatibilidade é feita na LEITURA: nenhum registro
 * histórico é reescrito.
 */
import { describe, expect, it } from "vitest"
import { saleFromDbRow, type VendaDbRow } from "./sale-from-db-row"
import { stripClientSyncFlags } from "./sale-sync-flags"

function row(over: Partial<VendaDbRow> = {}): VendaDbRow {
  return {
    pedidoId: "VDA-2026-0046",
    total: 169.99,
    at: new Date("2026-06-14T14:30:00.000Z"),
    clienteNome: null,
    status: "concluida",
    payload: null,
    itens: [
      { inventoryId: "p1", nome: "Brinquedo", quantidade: 1, precoUnitario: 169.99, lineTotal: 169.99 },
    ],
    ...over,
  }
}

/** Payload legado real: exatamente as chaves observadas no banco hoje. */
function payloadLegado(extra: Record<string, unknown> = {}) {
  return {
    id: "VDA-2026-0046",
    at: "2026-06-14T14:30:00.000Z",
    total: 169.99,
    status: "concluida",
    cashierId: "op-1",
    sessaoId: "sess-1",
    terminalId: "term-1",
    discountReais: 0,
    discountPercent: 0,
    paymentBreakdown: { dinheiro: 169.99 },
    lines: [{ inventoryId: "p1", name: "Brinquedo", quantity: 1, unitPrice: 169.99, lineTotal: 169.99 }],
    syncPending: true,
    ...extra,
  }
}

describe("saleFromDbRow — saneamento de marcadores client-only", () => {
  it("8. payload legado com syncPending: true é devolvido como CONFIRMADO", () => {
    const sale = saleFromDbRow(row({ payload: payloadLegado() }))
    expect(sale.syncPending).toBeUndefined()
    expect(Object.keys(sale)).not.toContain("syncPending")
  })

  it("8b. payload legado com syncBlockedCode também é limpo", () => {
    const sale = saleFromDbRow(
      row({ payload: payloadLegado({ syncBlockedCode: "CAIXA_ORIGINAL_FECHADO" }) }),
    )
    expect(sale.syncBlockedCode).toBeUndefined()
    expect(sale.syncPending).toBeUndefined()
  })

  it("preserva todos os campos legítimos do payload", () => {
    const sale = saleFromDbRow(row({ payload: payloadLegado() }))
    expect(sale.id).toBe("VDA-2026-0046")
    expect(sale.total).toBe(169.99)
    expect(sale.sessaoId).toBe("sess-1")
    expect(sale.terminalId).toBe("term-1")
    expect(sale.cashierId).toBe("op-1")
    expect(sale.lines).toHaveLength(1)
    expect(sale.paymentBreakdown.dinheiro).toBe(169.99)
  })

  it("mantém o status do BANCO como autoritativo, mesmo com payload divergente", () => {
    const sale = saleFromDbRow(
      row({ status: "cancelada", payload: payloadLegado({ status: "concluida" }) }),
    )
    expect(sale.status).toBe("cancelada")
  })

  it("fallback (payload ausente/incompatível) monta a venda pelos itens, sem marcadores", () => {
    const sale = saleFromDbRow(row({ payload: null }))
    expect(sale.id).toBe("VDA-2026-0046")
    expect(sale.lines).toHaveLength(1)
    expect(sale.syncPending).toBeUndefined()
    // payload de OUTRO pedidoId não é aceito (guarda pré-existente preservada)
    const outro = saleFromDbRow(row({ payload: payloadLegado({ id: "VDA-2026-9999" }) }))
    expect(outro.lines[0]!.name).toBe("Brinquedo")
    expect(outro.paymentBreakdown.dinheiro).toBe(0)
  })
})

describe("stripClientSyncFlags", () => {
  it("remove apenas os marcadores locais e não muta o original", () => {
    const original = { id: "VDA-1", total: 10, syncPending: true, syncBlockedCode: "X" }
    const limpo = stripClientSyncFlags(original)
    expect(limpo).toEqual({ id: "VDA-1", total: 10 })
    expect(original.syncPending).toBe(true)
    expect(original.syncBlockedCode).toBe("X")
  })

  it("é no-op quando não há marcadores", () => {
    expect(stripClientSyncFlags({ id: "VDA-1", total: 10 })).toEqual({ id: "VDA-1", total: 10 })
  })
})
