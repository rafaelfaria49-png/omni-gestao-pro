import { describe, expect, it } from "vitest"

import { contextoDeMatch, indexarCandidatos, type ProdutoCandidatoRow } from "./candidatos"
import { extrairLinhaProduto } from "./linha"
import { planejarMatchProduto } from "./matching"
import type { ProdutoImportLinha } from "./types"

function linha(over: Partial<ProdutoImportLinha> = {}): ProdutoImportLinha {
  const base = extrairLinhaProduto(
    {
      "produto.nome": "PILH.DURACELL MOEDA 2032 5X1",
      "produto.barcode": "041333038865",
      "produto.categoria": "Pilhas e Baterias",
      "produto.ncm": "85065010",
      "financeiro.custo": "34,91",
    },
    { linhaOrigem: 1 },
  )
  return { ...base, ...over }
}

function produto(over: Partial<ProdutoCandidatoRow> = {}): ProdutoCandidatoRow {
  return {
    id: "p1",
    name: "PILH.DURACELL MOEDA 2032 5X1",
    sku: null,
    barcode: null,
    brand: "",
    supplierName: "",
    active: true,
    price: 0,
    metadata: null,
    ...over,
  }
}

describe("planejarMatchProduto — ordem de precedência", () => {
  it("1. casa por código de barras exato", () => {
    const idx = indexarCandidatos([produto({ id: "pb", barcode: "041333038865", name: "OUTRO NOME" })])
    const l = linha()
    const plano = planejarMatchProduto(l, contextoDeMatch(l, idx))
    expect(plano).toMatchObject({ acao: "atualizar", produtoId: "pb", matchPor: "barcode" })
  })

  it("2. casa por SKU real quando não há barcode correspondente", () => {
    const idx = indexarCandidatos([produto({ id: "ps", sku: "ABC-123", name: "OUTRO NOME" })])
    const l = linha({ barcode: null, sku: "ABC-123" })
    const plano = planejarMatchProduto(l, contextoDeMatch(l, idx))
    expect(plano).toMatchObject({ acao: "atualizar", produtoId: "ps", matchPor: "sku" })
  })

  it("2b. SKU sintético nunca casa por SKU", () => {
    const idx = indexarCandidatos([produto({ id: "ps", sku: "linha-1", name: "OUTRO NOME" })])
    const l = linha({ barcode: null, sku: "linha-1" })
    const plano = planejarMatchProduto(l, contextoDeMatch(l, idx))
    expect(plano.matchPor).not.toBe("sku")
  })

  it("2c. o mesmo código com e sem prefixo gc- é o mesmo produto", () => {
    const idx = indexarCandidatos([produto({ id: "pg", sku: "gc-7580381444976", name: "OUTRO NOME" })])
    const l = linha({ barcode: null, sku: "7580381444976" })
    const plano = planejarMatchProduto(l, contextoDeMatch(l, idx))
    expect(plano).toMatchObject({ acao: "atualizar", produtoId: "pg", matchPor: "sku" })
  })

  it("3. casa por código do fornecedor quando há vínculo do MESMO fornecedor", () => {
    const idx = indexarCandidatos([
      produto({
        id: "pf",
        name: "OUTRO NOME",
        supplierName: "MARTINS COM SERV DISTR SA",
        metadata: { fornecedor: { codigo: "F-9911" } },
      }),
    ])
    const l = linha({
      barcode: null,
      sku: null,
      codigoFornecedor: "F-9911",
      fornecedorNome: "MARTINS COM SERV DISTR SA",
    })
    const plano = planejarMatchProduto(l, contextoDeMatch(l, idx))
    expect(plano).toMatchObject({ acao: "atualizar", produtoId: "pf", matchPor: "codigo_fornecedor" })
  })

  it("3b. código do fornecedor de OUTRO fornecedor não casa", () => {
    const idx = indexarCandidatos([
      produto({
        id: "pf",
        name: "OUTRO NOME",
        supplierName: "MODENUTI",
        metadata: { fornecedor: { codigo: "F-9911" } },
      }),
    ])
    const l = linha({
      barcode: null,
      sku: null,
      codigoFornecedor: "F-9911",
      fornecedorNome: "MARTINS COM SERV DISTR SA",
    })
    const plano = planejarMatchProduto(l, contextoDeMatch(l, idx))
    expect(plano.matchPor).not.toBe("codigo_fornecedor")
    expect(plano.acao).toBe("criar")
  })
})

describe("planejarMatchProduto — match por nome exato (restrito)", () => {
  it("casa quando há exatamente 1 produto, sem barcode, e a linha traz barcode", () => {
    const idx = indexarCandidatos([produto({ id: "pn", sku: "linha-9", barcode: null })])
    const l = linha()
    const plano = planejarMatchProduto(l, contextoDeMatch(l, idx))
    expect(plano).toMatchObject({ acao: "atualizar", produtoId: "pn", matchPor: "nome_exato" })
    expect(plano.motivo).toBe("Correspondência por nome exato")
  })

  it("casa quando o produto tem barcode mas o SKU é sintético", () => {
    const idx = indexarCandidatos([produto({ id: "pn", sku: "linha-9", barcode: "999" })])
    const l = linha()
    const plano = planejarMatchProduto(l, contextoDeMatch(l, idx))
    // O barcode do produto existente é outro; o SKU sintético autoriza o match por nome.
    expect(plano).toMatchObject({ acao: "atualizar", matchPor: "nome_exato" })
  })

  it("NÃO casa quando o produto já tem identidade própria (barcode + SKU real)", () => {
    const idx = indexarCandidatos([produto({ id: "pn", sku: "ABC-1", barcode: "999" })])
    const l = linha()
    const plano = planejarMatchProduto(l, contextoDeMatch(l, idx))
    expect(plano.acao).toBe("criar")
  })

  it("NÃO casa quando a linha não enriquece (sem barcode e sem NCM)", () => {
    const idx = indexarCandidatos([produto({ id: "pn", sku: "linha-9" })])
    const l = linha({ barcode: null, fiscal: { ...linha().fiscal, ncm: "", gtinComercial: "" } })
    const plano = planejarMatchProduto(l, contextoDeMatch(l, idx))
    // Linha sem código próprio + candidato homônimo = conflito, não duplicação.
    expect(plano.acao).toBe("conflito")
  })

  it("NCM sozinho já enriquece o cadastro", () => {
    const idx = indexarCandidatos([produto({ id: "pn", sku: "linha-9" })])
    const l = linha({ barcode: null, sku: "ABC-9" })
    const plano = planejarMatchProduto(l, contextoDeMatch(l, idx))
    expect(plano).toMatchObject({ acao: "atualizar", matchPor: "nome_exato" })
  })

  it("dois produtos com o mesmo nome = CONFLITO, sem escolha automática", () => {
    const idx = indexarCandidatos([produto({ id: "a" }), produto({ id: "b" })])
    const l = linha()
    const plano = planejarMatchProduto(l, contextoDeMatch(l, idx))
    expect(plano.acao).toBe("conflito")
    expect(plano.produtoId).toBeNull()
    expect(plano.conflitos.sort()).toEqual(["a", "b"])
  })
})

describe("planejarMatchProduto — conflitos de identidade", () => {
  it("barcode e SKU apontando para produtos diferentes = conflito", () => {
    const idx = indexarCandidatos([
      produto({ id: "porBar", barcode: "041333038865", name: "X" }),
      produto({ id: "porSku", sku: "ABC-1", name: "Y" }),
    ])
    const l = linha({ sku: "ABC-1" })
    const plano = planejarMatchProduto(l, contextoDeMatch(l, idx))
    expect(plano.acao).toBe("conflito")
    expect(plano.conflitos.sort()).toEqual(["porBar", "porSku"])
  })

  it("mais de um produto com o mesmo código do fornecedor = conflito", () => {
    const meta = { fornecedor: { codigo: "F-1" } }
    const idx = indexarCandidatos([
      produto({ id: "f1", name: "X", supplierName: "MARTINS", metadata: meta }),
      produto({ id: "f2", name: "Y", supplierName: "MARTINS", metadata: meta }),
    ])
    const l = linha({ barcode: null, sku: null, codigoFornecedor: "F-1", fornecedorNome: "MARTINS" })
    const plano = planejarMatchProduto(l, contextoDeMatch(l, idx))
    expect(plano.acao).toBe("conflito")
  })
})

describe("planejarMatchProduto — criação e ignorados", () => {
  it("cria quando nada corresponde", () => {
    const idx = indexarCandidatos([])
    const l = linha()
    const plano = planejarMatchProduto(l, contextoDeMatch(l, idx))
    expect(plano).toMatchObject({ acao: "criar", produtoId: null, matchPor: null })
  })

  it("ignora linha sem nome", () => {
    const idx = indexarCandidatos([])
    const l = linha({ nome: "  " })
    const plano = planejarMatchProduto(l, contextoDeMatch(l, idx))
    expect(plano.acao).toBe("ignorar")
  })
})

describe("isolamento multi-loja", () => {
  it("o índice só vê o que o caller entregou — mesmo EAN em outra loja não colide", () => {
    // O persistidor consulta com `where: { storeId }`; simulamos a loja 3 sem o item.
    const idxLoja2 = indexarCandidatos([produto({ id: "l2", barcode: "041333038865" })])
    const idxLoja3 = indexarCandidatos([])
    const l = linha()

    expect(planejarMatchProduto(l, contextoDeMatch(l, idxLoja2))).toMatchObject({
      acao: "atualizar",
      produtoId: "l2",
    })
    expect(planejarMatchProduto(l, contextoDeMatch(l, idxLoja3))).toMatchObject({
      acao: "criar",
      produtoId: null,
    })
  })
})

describe("consumidos — duas linhas não caem no mesmo produto", () => {
  it("o segundo homônimo não reaproveita o produto já usado", () => {
    const idx = indexarCandidatos([produto({ id: "unico", sku: "linha-1" })])
    const l1 = linha()
    const p1 = planejarMatchProduto(l1, contextoDeMatch(l1, idx))
    expect(p1.produtoId).toBe("unico")

    const consumidos = new Set([p1.produtoId!])
    const l2 = linha({ barcode: "7896067203040" })
    const p2 = planejarMatchProduto(l2, contextoDeMatch(l2, idx, consumidos))
    expect(p2.acao).toBe("criar")
  })
})
