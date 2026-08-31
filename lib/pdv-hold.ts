"use client"

import { useEffect, useState } from "react"

/**
 * Venda em espera — persistência local por loja + terminal.
 * Não toca em estoque, financeiro nem caixa.
 */

import type { AccessorySelectionV1 } from "@/lib/acessorios/types"

const HOLDS_KEY_PREFIX = "@omnigestao:pdv-holds:"
const HOLDS_CHANGED_EVENT = "omnigestao:pdv-holds-changed"

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
  /** Complementos e resumo operacional de linhas legadas do PDV Clássico. */
  complementos?: string[]
  lineDetail?: string
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
  /** Snapshot da seleção de acessório (modelo/cor) da linha. Opcional/aditivo. */
  accessorySelection?: AccessorySelectionV1
  /** Chave determinística produto+modelo+cor para agrupar linhas iguais. */
  cartLineKey?: string
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

function dispatchHoldsChanged(storeId: string, terminalId: string): void {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return
  window.dispatchEvent(new CustomEvent(HOLDS_CHANGED_EVENT, {
    detail: { storeId, terminalId },
  }))
}

export function getHeldSales(
  storeId: string,
  terminalId: string,
  pdvType?: HeldSale["pdvType"],
): HeldSale[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(holdsKey(storeId, terminalId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const sales = parsed as HeldSale[]
    return pdvType ? sales.filter((sale) => sale.pdvType === pdvType) : sales
  } catch {
    return []
  }
}

/**
 * Lê o mesmo contrato local usado pelos três PDVs e re-renderiza após alterações
 * na aba atual ou em outra aba. O filtro por tipo impede reconstrução incompatível.
 */
export function useHeldSales(
  storeId: string,
  terminalId: string,
  pdvType?: HeldSale["pdvType"],
): HeldSale[] {
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ storeId?: string; terminalId?: string }>).detail
      if (detail?.storeId === storeId && detail?.terminalId === terminalId) {
        setRevision((value) => value + 1)
      }
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key === holdsKey(storeId, terminalId)) setRevision((value) => value + 1)
    }
    window.addEventListener(HOLDS_CHANGED_EVENT, onChanged)
    window.addEventListener("storage", onStorage)
    return () => {
      window.removeEventListener(HOLDS_CHANGED_EVENT, onChanged)
      window.removeEventListener("storage", onStorage)
    }
  }, [storeId, terminalId])

  // `revision` é lida para que a atualização local/distribuída provoque novo render.
  void revision
  return getHeldSales(storeId, terminalId, pdvType)
}

export function saveHeldSale(storeId: string, terminalId: string, sale: HeldSale): void {
  if (typeof window === "undefined") return
  try {
    const existing = getHeldSales(storeId, terminalId).filter((s) => s.id !== sale.id)
    localStorage.setItem(holdsKey(storeId, terminalId), JSON.stringify([...existing, sale]))
    dispatchHoldsChanged(storeId, terminalId)
  } catch {
    /* ignore quota errors */
  }
}

export function removeHeldSale(storeId: string, terminalId: string, id: string): void {
  if (typeof window === "undefined") return
  try {
    const updated = getHeldSales(storeId, terminalId).filter((s) => s.id !== id)
    localStorage.setItem(holdsKey(storeId, terminalId), JSON.stringify(updated))
    dispatchHoldsChanged(storeId, terminalId)
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
  const labels = new Set(existing.map((sale) => sale.label))
  let n = existing.length + 1
  while (labels.has(`Venda ${n}`)) n += 1
  return `Venda ${n}`
}
