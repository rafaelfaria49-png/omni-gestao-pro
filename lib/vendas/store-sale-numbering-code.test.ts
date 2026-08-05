import { describe, expect, it } from "vitest"

import {
  classifyStoreSaleNumberingCode,
  isValidStoreSaleNumberingCode,
  normalizeStoreSaleNumberingCode,
  planStoreSaleNumberingCodes,
  STORE_SALE_NUMBERING_CODE_MAX_LENGTH,
  STORE_SALE_NUMBERING_CODE_MIN_LENGTH,
  STORE_SALE_NUMBERING_CODE_PATTERN,
} from "./store-sale-numbering-code"

describe("codigoNumeracaoVenda — validação", () => {
  it("aceita códigos válidos e normaliza para maiúsculas", () => {
    expect(classifyStoreSaleNumberingCode("RC01")).toEqual({ ok: true, codigo: "RC01" })
    expect(classifyStoreSaleNumberingCode(" rc01 ")).toEqual({ ok: true, codigo: "RC01" })
    expect(normalizeStoreSaleNumberingCode("mtz")).toBe("MTZ")
    expect(isValidStoreSaleNumberingCode("AB")).toBe(true)
    expect(isValidStoreSaleNumberingCode("12345678")).toBe(true)
  })

  it("respeita a mesma faixa do CHECK físico da migration 0016", () => {
    expect(STORE_SALE_NUMBERING_CODE_PATTERN.source).toBe("^[A-Z0-9]{2,8}$")
    expect(isValidStoreSaleNumberingCode("A".repeat(STORE_SALE_NUMBERING_CODE_MIN_LENGTH))).toBe(
      true,
    )
    expect(isValidStoreSaleNumberingCode("A".repeat(STORE_SALE_NUMBERING_CODE_MAX_LENGTH))).toBe(
      true,
    )
    expect(classifyStoreSaleNumberingCode("A")).toEqual({ ok: false, reason: "TOO_SHORT" })
    expect(classifyStoreSaleNumberingCode("A".repeat(9))).toEqual({
      ok: false,
      reason: "TOO_LONG",
    })
  })

  it("recusa código ausente, vazio e de tipo errado", () => {
    expect(classifyStoreSaleNumberingCode(undefined)).toEqual({ ok: false, reason: "MISSING" })
    expect(classifyStoreSaleNumberingCode(null)).toEqual({ ok: false, reason: "MISSING" })
    expect(classifyStoreSaleNumberingCode("")).toEqual({ ok: false, reason: "EMPTY" })
    expect(classifyStoreSaleNumberingCode("   ")).toEqual({ ok: false, reason: "EMPTY" })
    expect(classifyStoreSaleNumberingCode(1234)).toEqual({ ok: false, reason: "NOT_A_STRING" })
    expect(normalizeStoreSaleNumberingCode(null)).toBeNull()
  })

  it("recusa caracteres fora de [A-Z0-9]", () => {
    for (const value of ["RC-1", "RC_1", "RÇ01", "RC 01", "RC.1", "RC\n01"]) {
      expect(classifyStoreSaleNumberingCode(value), value).toEqual({
        ok: false,
        reason: "INVALID_CHARACTERS",
      })
    }
  })
})

describe("codigoNumeracaoVenda — plano de atribuição", () => {
  it("aprova candidatos válidos e distintos", () => {
    const plan = planStoreSaleNumberingCodes([
      { storeId: "loja-1", codigo: "RC01" },
      { storeId: "loja-2", codigo: " rc02 " },
    ])
    expect(plan.assignments).toEqual([
      { storeId: "loja-1", codigo: "RC01" },
      { storeId: "loja-2", codigo: "RC02" },
    ])
    expect(plan.rejections).toEqual([])
  })

  it("recusa código duplicado dentro do lote, apontando a loja em conflito", () => {
    const plan = planStoreSaleNumberingCodes([
      { storeId: "loja-1", codigo: "RC01" },
      { storeId: "loja-2", codigo: "rc01" },
    ])
    expect(plan.assignments).toEqual([{ storeId: "loja-1", codigo: "RC01" }])
    expect(plan.rejections).toEqual([
      { storeId: "loja-2", reason: "DUPLICATE", conflictsWithStoreId: "loja-1" },
    ])
  })

  it("recusa código já ocupado por outra loja", () => {
    const plan = planStoreSaleNumberingCodes(
      [{ storeId: "loja-3", codigo: "RC01" }],
      new Map([["RC01", "loja-1"]]),
    )
    expect(plan.assignments).toEqual([])
    expect(plan.rejections).toEqual([
      { storeId: "loja-3", reason: "DUPLICATE", conflictsWithStoreId: "loja-1" },
    ])
  })

  it("reapresentar o próprio código da loja não é duplicata", () => {
    const plan = planStoreSaleNumberingCodes(
      [{ storeId: "loja-1", codigo: "RC01" }],
      new Map([["RC01", "loja-1"]]),
    )
    expect(plan.assignments).toEqual([{ storeId: "loja-1", codigo: "RC01" }])
    expect(plan.rejections).toEqual([])
  })

  it("recusa candidato sem código e sem loja", () => {
    const plan = planStoreSaleNumberingCodes([
      { storeId: "loja-1", codigo: null },
      { storeId: "   ", codigo: "RC09" },
    ])
    expect(plan.assignments).toEqual([])
    expect(plan.rejections).toEqual([
      { storeId: "loja-1", reason: "MISSING" },
      { storeId: "", reason: "MISSING" },
    ])
  })

  it("não muta o mapa de códigos já ocupados", () => {
    const taken = new Map([["RC01", "loja-1"]])
    planStoreSaleNumberingCodes([{ storeId: "loja-2", codigo: "RC02" }], taken)
    expect([...taken.entries()]).toEqual([["RC01", "loja-1"]])
  })
})
