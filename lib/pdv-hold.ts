"use client"

/**
 * Venda em espera — persistência local por loja + terminal.
 * Não toca em estoque, financeiro nem caixa.
 */

const HOLDS_KEY_PREFIX = "@omnigestao:pdv-holds:"

export type HeldCartItem = {
  lineId: string
  inventoryId: string
  name: string
  price: number
  quantity: number
  itemType?: "produto" | "servico" | "avulso" | "ordem_servico"
  isAvulso?: boolean
  serviceId?: string
  serviceCategory?: string
  warrantyDays?: number
  serviceTerms?: string
  atributosLabel?: string
  vendaPorPeso?: boolean
  custoUnitario?: number | null
  /** Código de barras/SKU informado no Item Avulso (fila "Produtos a cadastrar"). */
  codigoAvulso?: string | null
  /** Desconto percentual por linha (Venda Completa Enterprise). Opcional/aditivo. */
  discountPct?: number
  /** Metadados por item da Venda Completa: IMEI, nº de série, garantia, observação. */
  detail?: {
    imei?: string
    serial?: string
    garantiaDias?: number
    observacao?: string
  }
}

export type HeldSaleCustomer = {
  id: string
  name: string
  cpf?: string
  phone?: string
}

export type HeldSale = {
  id: string
  label: string
  savedAt: string
  items: HeldCartItem[]
  customer?: HeldSaleCustomer | null
  discountReais?: number
  discountPercent?: number
  pdvType: "classic" | "supermercado" | "assistencia" | "black" | "venda-completa"
}

function holdsKey(storeId: string, terminalId: string): string {
  return `${HOLDS_KEY_PREFIX}${storeId}:${terminalId}`
}

export function getHeldSales(storeId: string, terminalId: string): HeldSale[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(holdsKey(storeId, terminalId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as HeldSale[]) : []
  } catch {
    return []
  }
}

export function saveHeldSale(storeId: string, terminalId: string, sale: HeldSale): void {
  if (typeof window === "undefined") return
  try {
    const existing = getHeldSales(storeId, terminalId).filter((s) => s.id !== sale.id)
    localStorage.setItem(holdsKey(storeId, terminalId), JSON.stringify([...existing, sale]))
  } catch {
    /* ignore quota errors */
  }
}

export function removeHeldSale(storeId: string, terminalId: string, id: string): void {
  if (typeof window === "undefined") return
  try {
    const updated = getHeldSales(storeId, terminalId).filter((s) => s.id !== id)
    localStorage.setItem(holdsKey(storeId, terminalId), JSON.stringify(updated))
  } catch {
    /* ignore */
  }
}

export function newHoldId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID()
    }
  } catch {
    /* ignore */
  }
  return `hold-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function nextHoldLabel(existing: HeldSale[]): string {
  const n = existing.length + 1
  return `Venda ${n}`
}
