/**
 * Normaliza itens vindos de `/api/ops/inventory` quando o JSON reflete colunas
 * do Postgres/Supabase com nomes variados (camelCase, snake_case, inglês).
 * **Não inverte** custo e venda — só lê as chaves na ordem de prioridade.
 */

function toNumberPtBrLike(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw
  const s = String(raw ?? "").trim()
  if (!s) return 0
  // aceita "5,20" e também "5.200,10"
  const norm = s.replace(/\./g, "").replace(",", ".")
  const n = parseFloat(norm)
  return Number.isFinite(n) ? n : 0
}

export type InventoryApiRow = Record<string, unknown>

/** Preço de **venda** (unitário). */
export function pickSalePrice(raw: InventoryApiRow): number {
  // Literal: venda vem do campo `price` (ou equivalentes de venda), sem inverter.
  return (
    toNumberPtBrLike(raw.price) ||
    toNumberPtBrLike(raw.salePrice) ||
    toNumberPtBrLike(raw.sale_price) ||
    toNumberPtBrLike(raw.precoVenda) ||
    toNumberPtBrLike(raw.preco_venda) ||
    toNumberPtBrLike(raw.sellPrice) ||
    toNumberPtBrLike(raw.unitPrice) ||
    toNumberPtBrLike(raw.unit_price)
  )
}

/** Preço de **custo** (unitário). */
export function pickCostPrice(raw: InventoryApiRow): number {
  // Literal: custo vem do campo `cost` (ou equivalentes), sem inverter.
  return (
    toNumberPtBrLike(raw.cost) ||
    toNumberPtBrLike(raw.price_cost) ||
    toNumberPtBrLike(raw.priceCost) ||
    toNumberPtBrLike(raw.costPrice) ||
    toNumberPtBrLike(raw.custo) ||
    toNumberPtBrLike(raw.precoCusto) ||
    toNumberPtBrLike(raw.preco_custo) ||
    toNumberPtBrLike(raw.cost_price)
  )
}
