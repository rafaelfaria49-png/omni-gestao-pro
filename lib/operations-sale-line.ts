import type { SaleLineRecord } from "@/lib/operations-sale-types"
import { resolveSaleLineItemType, type SaleLineItemType } from "@/lib/sale-line-classification"
import { serviceIdFromVirtualInventoryId } from "@/lib/os-pdv-virtual-lines"

export type FinalizeSaleLineInput = {
  inventoryId: string
  quantity: number
  name?: string
  unitPrice?: number
  itemType?: SaleLineItemType
  isAvulso?: boolean
  custoUnitario?: number | null
  serviceId?: string
  serviceCategory?: string
  warrantyDays?: number
  serviceTerms?: string
}

export type SaleLineInventorySnapshot = { name: string; price: number }

/** Constrói o snapshot canônico que será enviado para `Venda.payload.lines[]`. */
export function saleLineRecordFromFinalizeInput(
  line: FinalizeSaleLineInput,
  product?: SaleLineInventorySnapshot,
): SaleLineRecord {
  const itemType = resolveSaleLineItemType(line)
  const unit = typeof line.unitPrice === "number" && Number.isFinite(line.unitPrice)
    ? line.unitPrice
    : product?.price ?? 0
  const custoUnitario =
    typeof line.custoUnitario === "number" && Number.isFinite(line.custoUnitario) && line.custoUnitario >= 0
      ? Math.round(line.custoUnitario * 100) / 100
      : undefined
  const fallbackName = itemType === "avulso"
    ? "Item avulso"
    : itemType === "servico"
      ? "Serviço"
      : itemType === "ordem_servico"
        ? "Serviço O.S."
        : product?.name ?? "Produto"

  return {
    inventoryId: line.inventoryId,
    name: (typeof line.name === "string" && line.name.trim()) || product?.name || fallbackName,
    quantity: line.quantity,
    unitPrice: unit,
    lineTotal: Math.round(unit * line.quantity * 100) / 100,
    qtyReturned: 0,
    itemType,
    ...(itemType === "avulso" ? { isAvulso: true } : {}),
    ...(custoUnitario !== undefined ? { custoUnitario } : {}),
    ...(itemType === "servico"
      ? {
          serviceId: line.serviceId ?? serviceIdFromVirtualInventoryId(line.inventoryId) ?? undefined,
          serviceCategory: line.serviceCategory,
          warrantyDays: Math.max(0, Math.trunc(line.warrantyDays ?? 0)),
          serviceTerms: line.serviceTerms ?? "",
        }
      : {}),
  }
}
