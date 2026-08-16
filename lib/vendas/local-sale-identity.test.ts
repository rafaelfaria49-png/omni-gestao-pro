import { describe, expect, it } from "vitest"

import {
  assertGeneratedClientSaleId,
  buildProvisionalSaleRef,
  classifyLocalSaleSync,
  displaySaleNumber,
  generateClientSaleId,
  isProvisionalSaleRef,
  saleLocalKey,
} from "./local-sale-identity"

describe("local-sale-identity", () => {
  it("gera clientSaleId opaco válido e estável na forma cs_", () => {
    const id = generateClientSaleId()
    expect(id.startsWith("cs_")).toBe(true)
    expect(id).toBe(assertGeneratedClientSaleId(id))
    expect(id).not.toMatch(/^VDA-/i)
    expect(id).not.toMatch(/^PEND-/i)
  })

  it("rejeita clientSaleId com forma de número comercial", () => {
    expect(() => assertGeneratedClientSaleId("VDA-RC02-2026-000001")).toThrow()
    expect(() => assertGeneratedClientSaleId("PEND-cs_abc")).toThrow()
  })

  it("referência provisória nunca casa com ^VDA-", () => {
    const clientSaleId = "cs_localattempt01"
    const ref = buildProvisionalSaleRef(clientSaleId)
    expect(ref.startsWith("PEND-")).toBe(true)
    expect(isProvisionalSaleRef(ref)).toBe(true)
    expect(ref).not.toMatch(/^VDA-/)
    expect(isProvisionalSaleRef("VDA-RC02-2026-000001")).toBe(false)
    expect(isProvisionalSaleRef("VDA-2026-0615")).toBe(false)
  })

  it("saleLocalKey prefere clientSaleId", () => {
    expect(saleLocalKey({ id: "PEND-cs_localattempt01", clientSaleId: "cs_localattempt01" })).toBe(
      "cs_localattempt01",
    )
    expect(saleLocalKey({ id: "VDA-2026-0001" })).toBe("VDA-2026-0001")
  })

  it("classifica pending / quarentena / confirmada", () => {
    expect(classifyLocalSaleSync({ syncPending: true })).toBe("LOCAL_PENDING")
    expect(
      classifyLocalSaleSync({
        syncPending: true,
        syncBlockedCode: "PEDIDO_ID_CONFLITO_MESMA_LOJA",
      }),
    ).toBe("LOCAL_QUARANTINED")
    expect(classifyLocalSaleSync({})).toBe("REMOTE_CONFIRMED")
  })

  it("displaySaleNumber não apresenta PEND como VDA", () => {
    expect(displaySaleNumber("PEND-cs_localattempt01")).toBe("PENDENTE — AGUARDANDO NÚMERO")
    expect(displaySaleNumber("VDA-RC02-2026-000001", true)).toBe("PENDENTE — AGUARDANDO NÚMERO")
    expect(displaySaleNumber("VDA-RC02-2026-000001")).toBe("VDA-RC02-2026-000001")
  })
})
