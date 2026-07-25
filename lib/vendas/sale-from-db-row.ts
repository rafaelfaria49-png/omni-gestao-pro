/**
 * GOAL: PDV-PEDIDO-ID-COLISAO-MULTILOJA-FIX-001
 *
 * Reconstrói o `SaleRecord` do PDV a partir de uma linha de `Venda` do banco.
 * Extraído de `app/api/ops/vendas-list/route.ts` para poder ser testado sem subir
 * a rota (arquivos de rota do Next não podem exportar símbolos extras).
 *
 * REGRA: toda venda que vem do banco está, por definição, CONFIRMADA. O `payload`
 * legado pode conter marcadores locais de sincronização (`syncPending`/`syncBlockedCode`)
 * — 520 registros no banco os têm — e eles são descartados aqui na leitura. Não existe
 * modelo server-side de outbox no schema que justificaria exceção. Compatibilidade é
 * feita na leitura: nenhum registro histórico é reescrito.
 */
import type { PaymentBreakdownFull, SaleLineRecord, SaleRecord } from "@/lib/operations-sale-types"
import { stripClientSyncFlags } from "@/lib/vendas/sale-sync-flags"

const zeroPb: PaymentBreakdownFull = {
  dinheiro: 0,
  pix: 0,
  cartaoDebito: 0,
  cartaoCredito: 0,
  carne: 0,
  aPrazo: 0,
  creditoVale: 0,
}

export type VendaDbRow = {
  pedidoId: string
  total: number
  at: Date
  clienteNome: string | null
  status: string
  payload: unknown
  itens: Array<{
    inventoryId: string | null
    nome: string
    quantidade: number
    precoUnitario: number
    lineTotal: number
  }>
}

export function saleFromDbRow(r: VendaDbRow): SaleRecord {
  const dbStatus = r.status as SaleRecord["status"] | undefined
  const p = r.payload
  if (p && typeof p === "object") {
    const o = p as Partial<SaleRecord>
    if (typeof o.id === "string" && o.id === r.pedidoId && Array.isArray(o.lines)) {
      // Sempre sobrescreve status com o valor autoritativo do banco (o payload pode estar
      // desatualizado) e sempre remove os marcadores client-only do payload legado.
      return { ...stripClientSyncFlags(o as SaleRecord), status: dbStatus }
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
    status: dbStatus,
    customerName: r.clienteNome ?? undefined,
    paymentBreakdown: zeroPb,
  }
}
