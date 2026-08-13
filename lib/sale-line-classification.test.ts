import { describe, expect, it } from "vitest"
import { isAvulsoSaleLine, isVirtualSaleLine, servicoInventoryId } from "@/lib/os-pdv-virtual-lines"
import { resolveSaleLineItemType } from "@/lib/sale-line-classification"

describe("classificação explícita de linhas de venda", () => {
  it("serviço real é virtual, mas não é item avulso", () => {
    const inventoryId = servicoInventoryId("svc-1")
    expect(isVirtualSaleLine(inventoryId)).toBe(true)
    expect(isAvulsoSaleLine(inventoryId)).toBe(false)
    expect(resolveSaleLineItemType({ inventoryId })).toBe("servico")
  })

  it("prefixo legado __avulso__svc continua sendo serviço", () => {
    const inventoryId = "__avulso__svc-svc-1"
    expect(isVirtualSaleLine(inventoryId)).toBe(true)
    expect(isAvulsoSaleLine(inventoryId)).toBe(false)
    expect(resolveSaleLineItemType({ inventoryId, isAvulso: true })).toBe("servico")
  })

  it("item avulso real preserva seu comportamento", () => {
    expect(resolveSaleLineItemType({ inventoryId: "__avulso__line-1", isAvulso: true })).toBe("avulso")
  })

  it("classificação explícita vence inferência textual", () => {
    expect(resolveSaleLineItemType({ inventoryId: "produto-1", itemType: "servico" })).toBe("servico")
  })
})
