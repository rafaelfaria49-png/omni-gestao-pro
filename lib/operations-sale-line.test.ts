import { describe, expect, it } from "vitest"
import { saleLineRecordFromFinalizeInput } from "@/lib/operations-sale-line"

describe("finalizeSaleTransaction — snapshot da linha", () => {
  it("preserva identidade completa do serviço sem classificá-lo como avulso", () => {
    const record = saleLineRecordFromFinalizeInput({
      inventoryId: "__servico__svc-1",
      quantity: 1,
      name: "Transferência de Dados",
      unitPrice: 80,
      itemType: "servico",
      serviceId: "svc-1",
      serviceCategory: "Software e Dados",
      warrantyDays: 0,
      serviceTerms: "",
      custoUnitario: 0,
    })
    expect(record).toMatchObject({
      itemType: "servico",
      serviceId: "svc-1",
      serviceCategory: "Software e Dados",
      warrantyDays: 0,
      unitPrice: 80,
      lineTotal: 80,
    })
    expect(record.isAvulso).not.toBe(true)
  })

  it("mantém item avulso explicitamente separado", () => {
    expect(saleLineRecordFromFinalizeInput({
      inventoryId: "__avulso__line-1",
      quantity: 2,
      name: "Cabo sem cadastro",
      unitPrice: 15,
      itemType: "avulso",
      isAvulso: true,
    })).toMatchObject({ itemType: "avulso", isAvulso: true, lineTotal: 30 })
  })

  it("recupera serviceId do identificador virtual em snapshots compatíveis", () => {
    expect(saleLineRecordFromFinalizeInput({
      inventoryId: "__servico__svc-legado",
      quantity: 1,
      unitPrice: 90,
    })).toMatchObject({ itemType: "servico", serviceId: "svc-legado" })
  })

  it("classifica produto normal e usa o snapshot atual do estoque", () => {
    expect(saleLineRecordFromFinalizeInput(
      { inventoryId: "prod-1", quantity: 1, itemType: "produto" },
      { name: "Cabo USB-C", price: 50 },
    )).toMatchObject({ itemType: "produto", name: "Cabo USB-C", unitPrice: 50 })
  })
})
