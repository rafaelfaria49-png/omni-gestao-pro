import { describe, expect, it } from "vitest"

import {
  classifySaleWriterCapability,
  extractConfirmedVenda,
  IDEMPOTENCY_KEY_REUSED,
  SALE_WRITER_V1_ACTIVE,
  shouldFallbackV2ToV1,
} from "./sale-client-sync"

describe("shouldFallbackV2ToV1", () => {
  it("só cai para V1 quando o servidor declara SALE_WRITER_V1_ACTIVE", () => {
    expect(shouldFallbackV2ToV1({ code: SALE_WRITER_V1_ACTIVE, httpStatus: 409 })).toBe(true)
  })

  it("capability unknown NÃO vira V1", () => {
    expect(shouldFallbackV2ToV1({ capability: "unknown" })).toBe(false)
  })

  it("erro de rede NÃO vira V1", () => {
    expect(shouldFallbackV2ToV1({ networkError: true, code: SALE_WRITER_V1_ACTIVE })).toBe(false)
  })

  it("erro de numeração NÃO vira V1", () => {
    expect(shouldFallbackV2ToV1({ code: "SALE_NUMBERING_NOT_CONFIGURED", httpStatus: 409 })).toBe(false)
    expect(shouldFallbackV2ToV1({ code: "SALE_SEQUENCE_EXHAUSTED", httpStatus: 409 })).toBe(false)
    expect(shouldFallbackV2ToV1({ code: "SALE_NUMBERING_INVARIANT_BROKEN", httpStatus: 409 })).toBe(false)
  })

  it("IDEMPOTENCY_KEY_REUSED NÃO vira V1", () => {
    expect(shouldFallbackV2ToV1({ code: IDEMPOTENCY_KEY_REUSED, httpStatus: 409 })).toBe(false)
  })
})

describe("classifySaleWriterCapability", () => {
  it("aceita apenas writer v1/v2 explícitos", () => {
    expect(classifySaleWriterCapability({ writer: "v2" })).toBe("v2")
    expect(classifySaleWriterCapability({ writer: "v1" })).toBe("v1")
    expect(classifySaleWriterCapability({ writer: "auto" })).toBe("unknown")
    expect(classifySaleWriterCapability(null)).toBe("unknown")
    expect(classifySaleWriterCapability({})).toBe("unknown")
  })
})

describe("extractConfirmedVenda", () => {
  it("exige pedidoId e id técnicos", () => {
    expect(extractConfirmedVenda({ venda: { id: "x" } })).toBeNull()
    expect(
      extractConfirmedVenda({
        venda: { id: "cuid_1", pedidoId: "VDA-RC02-2026-000001", clientSaleId: "cs_localattempt01" },
      }),
    ).toMatchObject({
      id: "cuid_1",
      pedidoId: "VDA-RC02-2026-000001",
      clientSaleId: "cs_localattempt01",
    })
  })
})
