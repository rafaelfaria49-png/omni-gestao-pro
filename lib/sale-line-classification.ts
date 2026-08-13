import {
  isAvulsoSaleLine,
  isOsVirtualSaleLine,
  isServicoSaleLine,
} from "@/lib/os-pdv-virtual-lines"

/** Classificação canônica persistida em `Venda.payload.lines[]`. */
export type SaleLineItemType = "produto" | "servico" | "avulso" | "ordem_servico"

export type SaleLineClassificationInput = {
  inventoryId?: string | null
  itemType?: SaleLineItemType | null
  isAvulso?: boolean
}
/** Compatibilidade de leitura para linhas antigas sem `itemType`. */
export function resolveSaleLineItemType(input: SaleLineClassificationInput): SaleLineItemType {
  if (
    input.itemType === "produto" ||
    input.itemType === "servico" ||
    input.itemType === "avulso" ||
    input.itemType === "ordem_servico"
  ) {
    return input.itemType
  }
  if (isServicoSaleLine(input.inventoryId)) return "servico"
  if (isOsVirtualSaleLine(input.inventoryId)) return "ordem_servico"
  if (input.isAvulso === true || isAvulsoSaleLine(input.inventoryId)) return "avulso"
  return "produto"
}

export function isStockControlledSaleLine(input: SaleLineClassificationInput): boolean {
  return resolveSaleLineItemType(input) === "produto"
}
