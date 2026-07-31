import { describe, expect, it } from "vitest"

import { detectarDominio, mapearHeaders, resolverCampoSemantico } from "./detector"

describe("resolverCampoSemantico — aliases de PRODUTOS", () => {
  it('resolve "Código de barras" no PLURAL (defeito da NF-e Martins)', () => {
    expect(resolverCampoSemantico("Código de barras", "produtos")).toBe("produto.barcode")
  })

  it("resolve todas as variações de código de barras exigidas", () => {
    const aliases = [
      "Código de barras",
      "Código de barra",
      "Código barras",
      "Codigo barra",
      "Cod barras",
      "Barras",
      "EAN",
      "GTIN",
      "GTIN/EAN",
      "EAN/GTIN",
      "Código usado na importação",
    ]
    for (const a of aliases) {
      expect(resolverCampoSemantico(a, "produtos"), a).toBe("produto.barcode")
    }
  })

  it("separa EAN comercial e EAN tributável em campos fiscais próprios", () => {
    expect(resolverCampoSemantico("EAN comercial", "produtos")).toBe("produto.gtinComercial")
    expect(resolverCampoSemantico("GTIN comercial", "produtos")).toBe("produto.gtinComercial")
    expect(resolverCampoSemantico("EAN tributável", "produtos")).toBe("produto.gtinTributavel")
    expect(resolverCampoSemantico("GTIN tributável", "produtos")).toBe("produto.gtinTributavel")
  })

  it("Marca e Fabricante viram marca do PRODUTO, não do equipamento", () => {
    expect(resolverCampoSemantico("Marca", "produtos")).toBe("produto.marca")
    expect(resolverCampoSemantico("Fabricante", "produtos")).toBe("produto.marca")
    // Fora do domínio produtos o comportamento antigo é preservado.
    expect(resolverCampoSemantico("Marca")).toBe("equipamento.marca")
    expect(resolverCampoSemantico("Marca", "ordens_servicos")).toBe("equipamento.marca")
  })

  it("resolve fornecedor e código do fornecedor", () => {
    expect(resolverCampoSemantico("Fornecedor", "produtos")).toBe("produto.fornecedor")
    expect(resolverCampoSemantico("Nome do fornecedor", "produtos")).toBe("produto.fornecedor")
    expect(resolverCampoSemantico("Código do fornecedor", "produtos")).toBe("produto.codigoFornecedor")
    expect(resolverCampoSemantico("Referência do fornecedor", "produtos")).toBe("produto.codigoFornecedor")
  })

  it("resolve NCM e CEST", () => {
    expect(resolverCampoSemantico("NCM", "produtos")).toBe("produto.ncm")
    expect(resolverCampoSemantico("Código NCM", "produtos")).toBe("produto.ncm")
    expect(resolverCampoSemantico("CEST", "produtos")).toBe("produto.cest")
    expect(resolverCampoSemantico("Código CEST", "produtos")).toBe("produto.cest")
  })

  it("resolve unidades", () => {
    expect(resolverCampoSemantico("Unidade", "produtos")).toBe("produto.unidadeComercial")
    expect(resolverCampoSemantico("Unidade de venda", "produtos")).toBe("produto.unidadeComercial")
    expect(resolverCampoSemantico("Unidade de compra", "produtos")).toBe("produto.unidadeComercial")
    expect(resolverCampoSemantico("Unidade tributável", "produtos")).toBe("produto.unidadeTributavel")
  })

  it('"Código" NÃO vira código de cliente quando o domínio é produtos', () => {
    expect(resolverCampoSemantico("Código", "produtos")).toBe("produto.sku")
    expect(resolverCampoSemantico("Codigo", "produtos")).toBe("produto.sku")
    // Sem domínio o alias genérico segue valendo (clientes/OS não mudam).
    expect(resolverCampoSemantico("Código")).toBe("cliente.codigo")
    expect(resolverCampoSemantico("Código", "clientes")).toBe("cliente.codigo")
  })

  it("resolve custo e preço de venda separadamente", () => {
    expect(resolverCampoSemantico("Valor de custo", "produtos")).toBe("financeiro.custo")
    expect(resolverCampoSemantico("Custo", "produtos")).toBe("financeiro.custo")
    expect(resolverCampoSemantico("Preço de venda", "produtos")).toBe("financeiro.precoVenda")
    expect(resolverCampoSemantico("Valor Varejo", "produtos")).toBe("financeiro.precoVenda")
  })
})

describe("mapearHeaders com domínio", () => {
  it("mapeia o cabeçalho da NF-e Martins por completo", () => {
    const headers = ["Código de barras", "Descrição", "Categoria", "NCM", "CEST", "Valor de custo", "Fornecedor"]
    expect(mapearHeaders(headers, "produtos")).toEqual({
      "Código de barras": "produto.barcode",
      "Descrição": "produto.nome",
      "Categoria": "produto.categoria",
      "NCM": "produto.ncm",
      "CEST": "produto.cest",
      "Valor de custo": "financeiro.custo",
      "Fornecedor": "produto.fornecedor",
    })
  })

  it("sem domínio, o mesmo cabeçalho perde barcode/CEST/fornecedor (regressão original)", () => {
    const headers = ["Código de barras", "CEST", "Fornecedor"]
    const mapa = mapearHeaders(headers)
    expect(mapa["Código de barras"]).toBeUndefined()
    expect(mapa["CEST"]).toBeUndefined()
    expect(mapa["Fornecedor"]).toBeUndefined()
  })
})

describe("detectarDominio", () => {
  it("classifica a planilha da NF-e Martins como produtos", () => {
    const headers = ["Código de barras", "Descrição", "Categoria", "NCM", "CEST", "Valor de custo", "Fornecedor"]
    const r = detectarDominio(headers, "nfe-5380135-martins.xlsx")
    expect(r.dominio).toBe("produtos")
  })

  it("usa o código de barras como chave de join quando existir", () => {
    const headers = ["Código de barras", "Descrição", "Valor de custo"]
    const r = detectarDominio(headers, "catalogo.xlsx")
    expect(r.dominio).toBe("produtos")
    expect(r.chaveJoin).toBe("Código de barras")
  })

  it("não reclassifica planilhas de outros domínios", () => {
    expect(detectarDominio(["Nº da OS", "Cliente", "Situação"], "ordens_servicos.xlsx").dominio).toBe("ordens_servicos")
    expect(detectarDominio(["Nome", "Tipo de pessoa", "CPF"], "clientes.xlsx").dominio).toBe("clientes")
  })
})
