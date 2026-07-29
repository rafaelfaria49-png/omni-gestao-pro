import { describe, expect, it } from "vitest"

import {
  diffAtualizacao,
  marcaEhCopiaDaCategoria,
  marcaParaGravar,
  montarAtualizacaoProduto,
  montarCriacaoProduto,
} from "./escrita"
import { extrairLinhaProduto } from "./linha"
import type { ProdutoCandidato, ProdutoImportLinha } from "./types"

function linha(campos: Record<string, unknown> = {}, over: Partial<ProdutoImportLinha> = {}): ProdutoImportLinha {
  return {
    ...extrairLinhaProduto({ "produto.nome": "PILH.DURACELL MOEDA 2032 5X1", ...campos }, { linhaOrigem: 1 }),
    ...over,
  }
}

function alvo(over: Partial<ProdutoCandidato> = {}): ProdutoCandidato {
  return {
    id: "p1",
    name: "PILH.DURACELL MOEDA 2032 5X1",
    sku: null,
    barcode: null,
    brand: "",
    supplierName: "",
    active: true,
    price: 0,
    ...over,
  }
}

describe("marcaParaGravar", () => {
  it("grava a marca informada", () => {
    expect(marcaParaGravar(linha({ "produto.marca": "Duracell" }), "Pilhas e Baterias")).toBe("Duracell")
  })

  it("nunca grava a categoria como marca", () => {
    expect(marcaParaGravar(linha({ "produto.marca": "Pilhas e Baterias" }), "Pilhas e Baterias")).toBe("")
    expect(marcaParaGravar(linha({ "produto.marca": "pilhas_e_baterias" }), "Pilhas e Baterias")).toBe("")
  })

  it("planilha sem marca não inventa marca a partir do nome", () => {
    expect(marcaParaGravar(linha(), "Pilhas e Baterias")).toBe("")
  })
})

describe("marcaEhCopiaDaCategoria", () => {
  it("reconhece o defeito brand = category nas duas grafias", () => {
    expect(marcaEhCopiaDaCategoria("pilhas_e_baterias", "Pilhas e Baterias", "Pilhas e Baterias")).toBe(true)
    expect(marcaEhCopiaDaCategoria("Mercearia", "Mercearia", "Mercearia")).toBe(true)
    expect(marcaEhCopiaDaCategoria("mercearia", "MERCEARIA", "Mercearia")).toBe(true)
  })

  it("preserva marca curada pelo operador", () => {
    expect(marcaEhCopiaDaCategoria("Duracell", "Pilhas e Baterias", "Pilhas e Baterias")).toBe(false)
    expect(marcaEhCopiaDaCategoria("Panasonic", "Pilhas e Baterias", "Pilhas e Baterias")).toBe(false)
  })

  it("marca vazia não é cópia de nada", () => {
    expect(marcaEhCopiaDaCategoria("", "Mercearia", "Mercearia")).toBe(false)
    expect(marcaEhCopiaDaCategoria(null, "Mercearia", "Mercearia")).toBe(false)
  })
})

describe("montarCriacaoProduto", () => {
  it("política nao_movimentar cadastra com estoque 0 mesmo com estoque na planilha", () => {
    const dados = montarCriacaoProduto(linha({ "produto.estoque": "40" }), {
      categoria: "Pilhas e Baterias",
      politicaEstoque: "nao_movimentar",
    })
    expect(dados.stock).toBe(0)
  })

  it("política planilha_somente_novos usa o estoque da planilha", () => {
    const dados = montarCriacaoProduto(linha({ "produto.estoque": "40" }), {
      categoria: "Pilhas e Baterias",
      politicaEstoque: "planilha_somente_novos",
    })
    expect(dados.stock).toBe(40)
  })

  it("estoque ausente na planilha vira 0 mesmo na política da planilha", () => {
    const dados = montarCriacaoProduto(linha(), {
      categoria: "C",
      politicaEstoque: "planilha_somente_novos",
    })
    expect(dados.stock).toBe(0)
  })

  it("produto sem preço nasce inativo", () => {
    const dados = montarCriacaoProduto(linha(), { categoria: "C", politicaEstoque: "nao_movimentar" })
    expect(dados).toMatchObject({ active: false, status: "Inativo", price: 0 })
  })

  it("produto completo nasce ativo", () => {
    const dados = montarCriacaoProduto(linha({ "financeiro.precoVenda": "29,90" }), {
      categoria: "C",
      politicaEstoque: "nao_movimentar",
    })
    expect(dados).toMatchObject({ active: true, status: "Ativo", price: 29.9 })
  })

  it("categoria vazia grava null (não inventa 'geral')", () => {
    expect(montarCriacaoProduto(linha(), { categoria: "", politicaEstoque: "nao_movimentar" }).category).toBeNull()
  })
})

describe("montarAtualizacaoProduto", () => {
  it("não inclui stock nem active — estoque e situação são preservados", () => {
    const patch = montarAtualizacaoProduto(linha(), alvo(), { categoria: "C" })
    expect(patch).not.toHaveProperty("stock")
    expect(patch).not.toHaveProperty("active")
    expect(patch).not.toHaveProperty("status")
  })

  it("planilha sem preço não sobrescreve o preço existente", () => {
    const patch = montarAtualizacaoProduto(linha(), alvo({ price: 49.9 }), { categoria: "C" })
    expect(patch).not.toHaveProperty("price")
  })

  it("planilha com preço atualiza o preço", () => {
    const patch = montarAtualizacaoProduto(linha({ "financeiro.precoVenda": "59,90" }), alvo(), { categoria: "C" })
    expect(patch.price).toBe(59.9)
  })

  it("limpa SKU sintético do banco quando a planilha não traz SKU", () => {
    const patch = montarAtualizacaoProduto(linha(), alvo({ sku: "linha-9" }), { categoria: "C" })
    expect(patch.sku).toBeNull()
  })

  it("preserva SKU real do banco quando a planilha não traz SKU", () => {
    const patch = montarAtualizacaoProduto(linha(), alvo({ sku: "ABC-123" }), { categoria: "C" })
    expect(patch).not.toHaveProperty("sku")
  })

  it("SKU real da planilha sobrescreve", () => {
    const patch = montarAtualizacaoProduto(linha({}, { sku: "NOVO-1" }), alvo({ sku: "ABC-123" }), { categoria: "C" })
    expect(patch.sku).toBe("NOVO-1")
  })

  it("limpa a marca quando ela é cópia da categoria", () => {
    const patch = montarAtualizacaoProduto(
      linha({ "produto.categoria": "Pilhas e Baterias" }),
      alvo({ brand: "pilhas_e_baterias" }),
      { categoria: "Pilhas e Baterias" },
    )
    expect(patch.brand).toBe("")
  })

  it("preserva marca curada quando a planilha não traz marca", () => {
    const patch = montarAtualizacaoProduto(
      linha({ "produto.categoria": "Pilhas e Baterias" }),
      alvo({ brand: "Duracell" }),
      { categoria: "Pilhas e Baterias" },
    )
    expect(patch).not.toHaveProperty("brand")
  })

  it("marca da planilha vence a marca do banco", () => {
    const patch = montarAtualizacaoProduto(
      linha({ "produto.marca": "Panasonic", "produto.categoria": "Pilhas e Baterias" }),
      alvo({ brand: "Duracell" }),
      { categoria: "Pilhas e Baterias" },
    )
    expect(patch.brand).toBe("Panasonic")
  })
})

describe("diffAtualizacao", () => {
  it("declara estoque e situação como preservados", () => {
    const d = diffAtualizacao(linha(), alvo({ sku: "linha-1" }), { categoria: "Pilhas e Baterias" })
    expect(d.preservados).toContain("estoque")
    expect(d.preservados).toContain("situação ativo/inativo")
    expect(d.preservados).toContain("preço atual")
  })

  it("declara os campos que serão alterados", () => {
    const d = diffAtualizacao(
      linha({ "produto.barcode": "041333038865", "produto.categoria": "Pilhas e Baterias", "produto.ncm": "85065010" }),
      alvo({ sku: "linha-1", brand: "pilhas_e_baterias" }),
      { categoria: "Pilhas e Baterias" },
    )
    expect(d.alterados).toContain("sku (limpeza do sintético)")
    expect(d.alterados).toContain("marca (limpeza da cópia da categoria)")
    expect(d.alterados).toContain("código de barras")
    expect(d.alterados).toContain("categoria")
    expect(d.alterados).toContain("NCM/CEST")
  })
})
