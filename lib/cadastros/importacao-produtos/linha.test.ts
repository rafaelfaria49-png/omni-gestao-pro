import { describe, expect, it } from "vitest"

import { extrairLinhaProduto, numeroBr, validarCest, validarNcm } from "./linha"

describe("validarNcm", () => {
  it("aceita 8 dígitos e remove pontuação", () => {
    expect(validarNcm("18069000")).toEqual({ valor: "18069000", invalido: null })
    expect(validarNcm("1806.90.00")).toEqual({ valor: "18069000", invalido: null })
    expect(validarNcm(" 8506.50.10 ")).toEqual({ valor: "85065010", invalido: null })
  })

  it("vazio é válido e não gera erro", () => {
    expect(validarNcm("")).toEqual({ valor: "", invalido: null })
    expect(validarNcm(null)).toEqual({ valor: "", invalido: null })
  })

  it("comprimento errado gera erro VISÍVEL e descarta o valor", () => {
    const r = validarNcm("1806900")
    expect(r.valor).toBe("")
    expect(r.invalido).toMatchObject({ campo: "ncm", valorOriginal: "1806900" })
    expect(r.invalido?.motivo).toContain("8 dígitos")
  })
})

describe("validarCest", () => {
  it("aceita 7 dígitos e remove pontuação", () => {
    expect(validarCest("1700600")).toEqual({ valor: "1700600", invalido: null })
    expect(validarCest("17.006.00")).toEqual({ valor: "1700600", invalido: null })
    // Zero à esquerda preservado — CEST 0900500 é o da lâmpada da nota Martins.
    expect(validarCest("0900500")).toEqual({ valor: "0900500", invalido: null })
  })

  it("vazio é válido", () => {
    expect(validarCest("")).toEqual({ valor: "", invalido: null })
  })

  it("NÃO completa com zero à esquerda — sinaliza inválido", () => {
    const r = validarCest("17006")
    expect(r.valor).toBe("")
    expect(r.invalido).toMatchObject({ campo: "cest" })
    expect(r.invalido?.motivo).toContain("7 dígitos")
  })
})

describe("numeroBr", () => {
  it("lê formato brasileiro", () => {
    expect(numeroBr("14,94")).toBe(14.94)
    expect(numeroBr("1.234,56")).toBe(1234.56)
    expect(numeroBr("R$ 148,46")).toBe(148.46)
  })

  it("lê formato americano", () => {
    expect(numeroBr("1,234.56")).toBe(1234.56)
    expect(numeroBr("63.61")).toBe(63.61)
  })

  it("devolve null sem número", () => {
    expect(numeroBr("")).toBeNull()
    expect(numeroBr("—")).toBeNull()
    expect(numeroBr(null)).toBeNull()
  })
})

describe("extrairLinhaProduto", () => {
  it("monta a linha canônica com fiscal saneado", () => {
    const l = extrairLinhaProduto(
      {
        "produto.nome": "ACHOC.TODDY ORIGINAL POTE 750G",
        "produto.barcode": "7892840819170",
        "produto.categoria": "Mercearia",
        "produto.ncm": "1806.90.00",
        "produto.cest": "1700600",
        "produto.unidadeComercial": "un",
        "financeiro.custo": "14,94",
        "produto.fornecedor": "MARTINS COM SERV DISTR SA",
      },
      { linhaOrigem: 1 },
    )

    expect(l).toMatchObject({
      linhaOrigem: 1,
      nome: "ACHOC.TODDY ORIGINAL POTE 750G",
      sku: null,
      barcode: "7892840819170",
      categoria: "Mercearia",
      marca: "",
      fornecedorNome: "MARTINS COM SERV DISTR SA",
      custo: 14.94,
      preco: 0,
      estoque: null,
    })
    expect(l.fiscal).toEqual({
      ncm: "18069000",
      cest: "1700600",
      unidadeComercial: "UN",
      unidadeTributavel: "",
      gtinComercial: "7892840819170",
      gtinTributavel: "",
    })
    expect(l.fiscalInvalido).toEqual([])
  })

  it("SKU ausente permanece null — nunca linha-N nem IMP-*", () => {
    const l = extrairLinhaProduto({ "produto.nome": "X" }, { linhaOrigem: 4 })
    expect(l.sku).toBeNull()
  })

  it("SKU sintético vindo da planilha é descartado", () => {
    const l = extrairLinhaProduto(
      { "produto.nome": "X", "produto.sku": "linha-4" },
      { linhaOrigem: 4 },
    )
    expect(l.sku).toBeNull()
  })

  it("código de barras NÃO é copiado para SKU", () => {
    const l = extrairLinhaProduto(
      { "produto.nome": "X", "produto.barcode": "7892840819170" },
      { linhaOrigem: 1 },
    )
    expect(l.sku).toBeNull()
    expect(l.barcode).toBe("7892840819170")
  })

  it("código do fornecedor NÃO substitui o SKU interno", () => {
    const l = extrairLinhaProduto(
      { "produto.nome": "X", "produto.codigoFornecedor": "F-9911" },
      { linhaOrigem: 1 },
    )
    expect(l.sku).toBeNull()
    expect(l.codigoFornecedor).toBe("F-9911")
  })

  it("slug legado de categoria volta a nome legível", () => {
    const l = extrairLinhaProduto(
      { "produto.nome": "X", "produto.categoria": "pilhas_e_baterias" },
      { linhaOrigem: 1 },
    )
    expect(l.categoria).toBe("Pilhas e Baterias")
  })

  it("fornecedorPadrao do lote entra quando a planilha não traz fornecedor", () => {
    const l = extrairLinhaProduto(
      { "produto.nome": "X" },
      { linhaOrigem: 1, fornecedorPadrao: "MARTINS COM SERV DISTR SA" },
    )
    expect(l.fornecedorNome).toBe("MARTINS COM SERV DISTR SA")
  })

  it("acumula erros de NCM e CEST inválidos", () => {
    const l = extrairLinhaProduto(
      { "produto.nome": "X", "produto.ncm": "123", "produto.cest": "99" },
      { linhaOrigem: 1 },
    )
    expect(l.fiscal.ncm).toBe("")
    expect(l.fiscal.cest).toBe("")
    expect(l.fiscalInvalido.map((i) => i.campo)).toEqual(["ncm", "cest"])
  })

  it("estoque ausente é null (≠ zero explícito)", () => {
    expect(extrairLinhaProduto({ "produto.nome": "X" }, { linhaOrigem: 1 }).estoque).toBeNull()
    expect(extrairLinhaProduto({ "produto.nome": "X", "produto.estoque": "0" }, { linhaOrigem: 1 }).estoque).toBe(0)
    expect(extrairLinhaProduto({ "produto.nome": "X", "produto.estoque": "12" }, { linhaOrigem: 1 }).estoque).toBe(12)
  })
})
