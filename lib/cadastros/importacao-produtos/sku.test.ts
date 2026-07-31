import { describe, expect, it } from "vitest"

import {
  chaveNomeProduto,
  chaveSku,
  isPlaceholderIdentifier,
  isRealProductSku,
  isSyntheticImportSku,
  normalizeBarcode,
  normalizeImportSku,
} from "./sku"

describe("isSyntheticImportSku", () => {
  it("reconhece o índice de linha do parser", () => {
    expect(isSyntheticImportSku("linha-1")).toBe(true)
    expect(isSyntheticImportSku("linha-13")).toBe(true)
    expect(isSyntheticImportSku("linha-999")).toBe(true)
    expect(isSyntheticImportSku("LINHA-7")).toBe(true)
    expect(isSyntheticImportSku("linha_4")).toBe(true)
    expect(isSyntheticImportSku("linha 4")).toBe(true)
  })

  it("reconhece linha-N mesmo com prefixo de importador por cima", () => {
    expect(isSyntheticImportSku("gc-linha-3")).toBe(true)
    expect(isSyntheticImportSku("prod-linha-3")).toBe(true)
    expect(isSyntheticImportSku("id-linha-3")).toBe(true)
  })

  it("reconhece o fallback IMP-<categoria>-<nome> gerado pelo persistidor antigo", () => {
    expect(isSyntheticImportSku("IMP-produto-achoc-toddy-original")).toBe(true)
    expect(isSyntheticImportSku("IMP-pilhas_e_baterias-pilh-duracell")).toBe(true)
    expect(isSyntheticImportSku("imp-geral-fita-emp-prat")).toBe(true)
  })

  it("NÃO marca SKU legítimo como sintético", () => {
    // Códigos reais de fornecedor/ERP — nenhum pode ser descartado.
    expect(isSyntheticImportSku("IMP-4471")).toBe(false)
    expect(isSyntheticImportSku("7892840819170")).toBe(false)
    expect(isSyntheticImportSku("ABC-123")).toBe(false)
    expect(isSyntheticImportSku("LINHA")).toBe(false)
    expect(isSyntheticImportSku("linha-branca-01")).toBe(false)
    expect(isSyntheticImportSku("gc-7580381444976")).toBe(false)
    expect(isSyntheticImportSku("SKU-LINHA-2")).toBe(false)
  })

  it("string vazia não é sintética (é ausência)", () => {
    expect(isSyntheticImportSku("")).toBe(false)
    expect(isSyntheticImportSku(null)).toBe(false)
    expect(isSyntheticImportSku(undefined)).toBe(false)
  })
})

describe("isPlaceholderIdentifier", () => {
  it("trata vazios e travessões como ausência", () => {
    for (const v of ["", "  ", "-", "--", "—", "N/A", "null", "undefined", "sem sku"]) {
      expect(isPlaceholderIdentifier(v)).toBe(true)
    }
  })

  it("não trata código real como placeholder", () => {
    expect(isPlaceholderIdentifier("7892840819170")).toBe(false)
    expect(isPlaceholderIdentifier("NA-1")).toBe(false)
  })
})

describe("isRealProductSku", () => {
  it("só aceita identificador comercial de verdade", () => {
    expect(isRealProductSku("7892840819170")).toBe(true)
    expect(isRealProductSku("IMP-4471")).toBe(true)
    expect(isRealProductSku("linha-1")).toBe(false)
    expect(isRealProductSku("—")).toBe(false)
    expect(isRealProductSku("")).toBe(false)
  })
})

describe("normalizeImportSku", () => {
  it("mantém SKU real da planilha", () => {
    expect(normalizeImportSku(" ABC-123 ")).toBe("ABC-123")
  })

  it("devolve null para linha-N — ausência permanece ausência", () => {
    expect(normalizeImportSku("linha-1")).toBeNull()
    expect(normalizeImportSku("linha-13")).toBeNull()
  })

  it("devolve null para ausência e placeholder (sem inventar IMP-*)", () => {
    expect(normalizeImportSku("")).toBeNull()
    expect(normalizeImportSku(undefined)).toBeNull()
    expect(normalizeImportSku("—")).toBeNull()
  })
})

describe("chaveSku", () => {
  it("iguala o mesmo código com e sem prefixo de importador", () => {
    expect(chaveSku("gc-7580381444976")).toBe(chaveSku("7580381444976"))
    expect(chaveSku("ABC-1")).toBe(chaveSku("abc-1"))
  })
})

describe("normalizeBarcode", () => {
  it("mantém apenas dígitos e preserva zero à esquerda", () => {
    expect(normalizeBarcode("041333038865")).toBe("041333038865")
    expect(normalizeBarcode(" 7892840819170 ")).toBe("7892840819170")
    expect(normalizeBarcode("789-284.081/9170")).toBe("7892840819170")
  })

  it("devolve null quando não há dígito", () => {
    expect(normalizeBarcode("")).toBeNull()
    expect(normalizeBarcode("—")).toBeNull()
    expect(normalizeBarcode(null)).toBeNull()
  })
})

describe("chaveNomeProduto", () => {
  it("normaliza caixa, acento e espaços", () => {
    expect(chaveNomeProduto("  LAMP.LED  A.P.FOX.75W  ")).toBe("lamp.led a.p.fox.75w")
    expect(chaveNomeProduto("Eletroportáteis")).toBe(chaveNomeProduto("ELETROPORTATEIS"))
  })
})
