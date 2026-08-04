import { describe, expect, it } from "vitest"

import {
  allocatesPedidoIdOnServer,
  buildSaleIdentityKey,
  classifyClientSuppliedPedidoId,
  classifySalePedidoIdShape,
  classifySaleWriteIntent,
  CLIENT_SALE_ID_MAX_LENGTH,
  CLIENT_SALE_ID_MIN_LENGTH,
  isProvisionalSalePedidoId,
  isReplayDecision,
  isSaleWriterFlow,
  isServerAllocatedSalePedidoId,
  isValidClientSaleId,
  looksLikeSaleNumber,
  normalizeClientSaleId,
  parseClientSaleId,
  requiresClientSaleId,
  SALE_WRITER_FLOW,
  saleIdentityKeysMatch,
  type SaleIdentityKey,
} from "./sale-identity-contracts"

const UUID = "0f8a2f1e-5f7a-4a1c-9a1e-2b6d3c4e5f60"
const ULID = "01JQK8Z3M4N5P6Q7R8S9T0V1W2"

describe("clientSaleId — identidade técnica", () => {
  it("aceita UUID e ULID e preserva o valor exato", () => {
    for (const value of [UUID, ULID, "sale-01JQK8Z3M4N5P6", "A1_b2-C3d4E5"]) {
      const parsed = parseClientSaleId(value)
      expect(parsed, value).toEqual({ ok: true, clientSaleId: value })
    }
  })

  it("é estável: normalizar o mesmo valor N vezes devolve sempre o mesmo resultado", () => {
    const primeira = normalizeClientSaleId(UUID)
    for (let tentativa = 0; tentativa < 5; tentativa += 1) {
      expect(normalizeClientSaleId(`  ${UUID}  `)).toBe(primeira)
    }
    expect(primeira).toBe(UUID)
  })

  it("não faz case-fold — o caixa faz parte da chave gravada", () => {
    const maiusculo = UUID.toUpperCase()
    expect(normalizeClientSaleId(maiusculo)).toBe(maiusculo)
    expect(normalizeClientSaleId(maiusculo)).not.toBe(UUID)
  })

  it("recusa ausente, vazio, espaços e tipo errado", () => {
    expect(parseClientSaleId(undefined)).toEqual({ ok: false, reason: "MISSING" })
    expect(parseClientSaleId(null)).toEqual({ ok: false, reason: "MISSING" })
    expect(parseClientSaleId("")).toEqual({ ok: false, reason: "EMPTY" })
    expect(parseClientSaleId("   ")).toEqual({ ok: false, reason: "EMPTY" })
    expect(parseClientSaleId("\n\t")).toEqual({ ok: false, reason: "EMPTY" })
    for (const value of [42, true, {}, [], Symbol("x")]) {
      expect(parseClientSaleId(value)).toEqual({ ok: false, reason: "NOT_A_STRING" })
    }
  })

  it("recusa curto demais e longo demais na faixa da coluna VARCHAR(128)", () => {
    expect(parseClientSaleId("a".repeat(CLIENT_SALE_ID_MIN_LENGTH - 1))).toEqual({
      ok: false,
      reason: "TOO_SHORT",
    })
    expect(isValidClientSaleId("a".repeat(CLIENT_SALE_ID_MIN_LENGTH))).toBe(true)
    expect(isValidClientSaleId("a".repeat(CLIENT_SALE_ID_MAX_LENGTH))).toBe(true)
    expect(parseClientSaleId("a".repeat(CLIENT_SALE_ID_MAX_LENGTH + 1))).toEqual({
      ok: false,
      reason: "TOO_LONG",
    })
  })

  it("recusa malformados: espaço interno, acento, barra, aspas e controle", () => {
    for (const value of [
      "sale id 12345",
      "vendá-12345678",
      "sale/12345678",
      'sale"12345678',
      "sale\n12345678",
      "sale\u000012345",
      "-leading-hyphen",
      "_leading-underscore",
    ]) {
      expect(parseClientSaleId(value), value).toEqual({
        ok: false,
        reason: "INVALID_CHARACTERS",
      })
    }
  })

  it("recusa pedidoId como clientSaleId implícito — nenhum formato comercial passa", () => {
    for (const value of [
      "VDA-2026-0001",
      "VDA-2026-000123",
      "VDA-RC01-2026-000001",
      "VND-2026-00001",
      "vda-2026-0001",
      "  VDA-2026-0001  ",
    ]) {
      expect(parseClientSaleId(value), value).toEqual({
        ok: false,
        reason: "LOOKS_LIKE_SALE_NUMBER",
      })
      expect(normalizeClientSaleId(value), value).toBeNull()
      expect(looksLikeSaleNumber(value), value).toBe(true)
    }
  })

  it("não confunde token opaco com número comercial", () => {
    expect(looksLikeSaleNumber(UUID)).toBe(false)
    expect(looksLikeSaleNumber("VDAX-2026-0001")).toBe(false)
    expect(looksLikeSaleNumber(null)).toBe(false)
  })
})

describe("pedidoId — número comercial", () => {
  it("classifica as três formas em uso e o desconhecido", () => {
    expect(classifySalePedidoIdShape("VDA-RC01-2026-000001")).toBe("SERVER_ALLOCATED")
    expect(classifySalePedidoIdShape("VDA-2026-0001")).toBe("LEGACY_CLIENT_PROVISIONAL")
    expect(classifySalePedidoIdShape("VND-2026-00001")).toBe("LEGACY_OS")
    expect(classifySalePedidoIdShape(UUID)).toBe("UNKNOWN")
    expect(classifySalePedidoIdShape(null)).toBe("UNKNOWN")
  })

  it("o formato antigo do PDV nunca é confundido com o formato server-side", () => {
    expect(isProvisionalSalePedidoId("VDA-2026-0001")).toBe(true)
    expect(isServerAllocatedSalePedidoId("VDA-2026-0001")).toBe(false)
    expect(isServerAllocatedSalePedidoId("VDA-RC01-2026-000001")).toBe(true)
    expect(isProvisionalSalePedidoId("VDA-RC01-2026-000001")).toBe(false)
  })

  it("v2 nunca aceita pedidoId do cliente, nem quando bem-formado", () => {
    for (const value of ["VDA-RC01-2026-000001", "VDA-2026-0001", "", undefined]) {
      expect(classifyClientSuppliedPedidoId(SALE_WRITER_FLOW.V2, value)).toEqual({
        accepted: false,
        reason: "SERVER_ALLOCATES_IN_V2",
      })
    }
  })

  it("v1 continua aceitando o número do cliente, exceto vazio", () => {
    expect(classifyClientSuppliedPedidoId(SALE_WRITER_FLOW.V1, " VDA-2026-0001 ")).toEqual({
      accepted: true,
      pedidoId: "VDA-2026-0001",
    })
    expect(classifyClientSuppliedPedidoId(SALE_WRITER_FLOW.V1, "  ")).toEqual({
      accepted: false,
      reason: "EMPTY",
    })
  })
})

describe("fluxo v1 vs v2 — representação pura", () => {
  it("só v2 exige clientSaleId e só v2 aloca número no servidor", () => {
    expect(requiresClientSaleId(SALE_WRITER_FLOW.V1)).toBe(false)
    expect(requiresClientSaleId(SALE_WRITER_FLOW.V2)).toBe(true)
    expect(allocatesPedidoIdOnServer(SALE_WRITER_FLOW.V1)).toBe(false)
    expect(allocatesPedidoIdOnServer(SALE_WRITER_FLOW.V2)).toBe(true)
  })

  it("reconhece apenas os dois fluxos declarados", () => {
    expect(isSaleWriterFlow("v1")).toBe(true)
    expect(isSaleWriterFlow("v2")).toBe(true)
    expect(isSaleWriterFlow("v3")).toBe(false)
    expect(isSaleWriterFlow(undefined)).toBe(false)
  })
})

describe("chave de identidade (storeId, clientSaleId)", () => {
  it("exige storeId explícito — sem fallback para loja-1", () => {
    expect(buildSaleIdentityKey({ storeId: "", clientSaleId: UUID })).toEqual({
      ok: false,
      reason: "STORE_ID_MISSING",
    })
    expect(buildSaleIdentityKey({ storeId: "   ", clientSaleId: UUID })).toEqual({
      ok: false,
      reason: "STORE_ID_MISSING",
    })
    expect(buildSaleIdentityKey({ storeId: undefined, clientSaleId: UUID })).toEqual({
      ok: false,
      reason: "STORE_ID_MISSING",
    })
  })

  it("propaga a razão da recusa do clientSaleId", () => {
    expect(buildSaleIdentityKey({ storeId: "loja-1", clientSaleId: "VDA-2026-0001" })).toEqual({
      ok: false,
      reason: { clientSaleId: "LOOKS_LIKE_SALE_NUMBER" },
    })
  })

  it("monta a chave com ambos os lados normalizados", () => {
    expect(buildSaleIdentityKey({ storeId: " loja-2 ", clientSaleId: ` ${UUID} ` })).toEqual({
      ok: true,
      key: { storeId: "loja-2", clientSaleId: UUID },
    })
  })

  it("lojas diferentes podem usar o mesmo clientSaleId", () => {
    const loja1: SaleIdentityKey = { storeId: "loja-1", clientSaleId: UUID }
    const loja2: SaleIdentityKey = { storeId: "loja-2", clientSaleId: UUID }
    expect(saleIdentityKeysMatch(loja1, loja2)).toBe(false)
    expect(saleIdentityKeysMatch(loja1, { ...loja1 })).toBe(true)
  })
})

describe("create vs replay", () => {
  const key: SaleIdentityKey = { storeId: "loja-1", clientSaleId: UUID }

  it("sem venda existente é create", () => {
    expect(classifySaleWriteIntent({ key })).toEqual({ kind: "create", key })
    expect(classifySaleWriteIntent({ key, existing: null })).toEqual({ kind: "create", key })
  })

  it("mesma loja + mesmo clientSaleId é replay e devolve o pedidoId existente", () => {
    const decision = classifySaleWriteIntent({
      key,
      existing: {
        storeId: "loja-1",
        clientSaleId: UUID,
        pedidoId: "VDA-RC01-2026-000042",
      },
    })
    expect(decision).toEqual({ kind: "replay", key, pedidoId: "VDA-RC01-2026-000042" })
    expect(isReplayDecision(decision)).toBe(true)
  })

  it("replay é idempotente: N reenvios da mesma tentativa dão sempre a mesma decisão", () => {
    const existing = {
      storeId: "loja-1",
      clientSaleId: UUID,
      pedidoId: "VDA-RC01-2026-000042",
    }
    const decisions = Array.from({ length: 5 }, () =>
      classifySaleWriteIntent({ key, existing }),
    )
    for (const decision of decisions) {
      expect(decision).toEqual(decisions[0])
      expect(decision.kind).toBe("replay")
    }
  })

  it("venda de outra loja é conflito, nunca replay", () => {
    expect(
      classifySaleWriteIntent({
        key,
        existing: { storeId: "loja-2", clientSaleId: UUID, pedidoId: "VDA-RC02-2026-000001" },
      }),
    ).toEqual({ kind: "conflict", reason: "STORE_MISMATCH" })
  })

  it("outra identidade técnica na mesma loja é conflito", () => {
    expect(
      classifySaleWriteIntent({
        key,
        existing: { storeId: "loja-1", clientSaleId: ULID, pedidoId: "VDA-RC01-2026-000009" },
      }),
    ).toEqual({ kind: "conflict", reason: "CLIENT_SALE_ID_MISMATCH" })
  })

  it("venda histórica sem clientSaleId nunca vira replay", () => {
    expect(
      classifySaleWriteIntent({
        key,
        existing: { storeId: "loja-1", clientSaleId: null, pedidoId: "VDA-2026-0001" },
      }),
    ).toEqual({ kind: "conflict", reason: "EXISTING_SALE_WITHOUT_CLIENT_SALE_ID" })
  })

  it("venda sem número comercial é invariante quebrada, não replay", () => {
    for (const pedidoId of [null, "", "   "]) {
      expect(
        classifySaleWriteIntent({
          key,
          existing: { storeId: "loja-1", clientSaleId: UUID, pedidoId },
        }),
      ).toEqual({ kind: "conflict", reason: "EXISTING_SALE_WITHOUT_PEDIDO_ID" })
    }
  })

  it("o pedidoId existente nunca é usado como clientSaleId de volta", () => {
    const decision = classifySaleWriteIntent({
      key,
      existing: { storeId: "loja-1", clientSaleId: UUID, pedidoId: "VDA-RC01-2026-000042" },
    })
    expect(isReplayDecision(decision) && decision.key.clientSaleId).toBe(UUID)
    expect(isValidClientSaleId("VDA-RC01-2026-000042")).toBe(false)
  })
})
