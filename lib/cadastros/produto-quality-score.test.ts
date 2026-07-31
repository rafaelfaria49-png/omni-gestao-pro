import { describe, expect, it } from "vitest"

import {
  catalogQualityScore,
  explicarQualityScore,
  qualityScoreInputFromProduto,
  QUALITY_SCORE_PESOS,
} from "./produto-quality-score"
import { construirLoteImportacao, mergeImportacaoIntoMetadata } from "./importacao-produtos/metadata"
import { CONTEXTO_LOTE_VAZIO } from "./importacao-produtos/types"
import { MARTINS_ITENS } from "./importacao-produtos/fixtures/martins-nfe-5380135"
import { mergeProdutoFiscalIntoMetadata } from "@/lib/produto-fiscal"

/** Produto como os 13 do Martins ficaram após a importação original (defeituosa). */
function martinsDegradado(i = 0) {
  const it = MARTINS_ITENS[i]!
  return {
    nome: it.descricao,
    sku: `linha-${i + 1}`,
    barras: "",
    categoria: it.categoria.toLowerCase().replace(/\s+/g, "_"),
    preco: 0,
    fornecedor: "—",
    marca: it.categoria.toLowerCase().replace(/\s+/g, "_"),
    garantia: 0,
  }
}

/** O mesmo produto depois do reparo pela importação corrigida + revisão humana. */
function martinsReparado(i = 0) {
  const it = MARTINS_ITENS[i]!
  return {
    nome: it.descricao,
    sku: "",
    barras: it.ean,
    categoria: it.categoria,
    preco: 29.9,
    fornecedor: "MARTINS COM SERV DISTR SA",
    marca: "",
    ncm: it.ncm,
    revisado: true,
  }
}

describe("pesos", () => {
  it("somam 100", () => {
    expect(Object.values(QUALITY_SCORE_PESOS).reduce((a, b) => a + b, 0)).toBe(100)
  })
})

describe("score dos produtos do Martins (estado degradado)", () => {
  it("não infla mais para 75 — cadastro incompleto tem score baixo", () => {
    for (let i = 0; i < MARTINS_ITENS.length; i++) {
      const score = catalogQualityScore(martinsDegradado(i))
      expect(score, `item ${i + 1}`).toBeLessThan(40)
    }
  })

  it("pontua apenas nome e categoria — nada mais é dado de graça", () => {
    const exp = explicarQualityScore(martinsDegradado(0))
    const ok = exp.itens.filter((i) => i.ok).map((i) => i.chave)
    expect(ok.sort()).toEqual(["categoria", "nome"])
    expect(exp.score).toBe(QUALITY_SCORE_PESOS.nome + QUALITY_SCORE_PESOS.categoria)
  })

  it("NÃO pontua SKU linha-N e explica o motivo", () => {
    const item = explicarQualityScore(martinsDegradado(0)).itens.find((i) => i.chave === "identificador")!
    expect(item.ok).toBe(false)
    expect(item.ganho).toBe(0)
    expect(item.motivo).toContain("sintético")
  })

  it("NÃO pontua marca igual à categoria e explica o motivo", () => {
    const item = explicarQualityScore(martinsDegradado(0)).itens.find((i) => i.chave === "marca")!
    expect(item.ok).toBe(false)
    expect(item.motivo).toBe("Marca é a própria categoria")
  })

  it("NÃO pontua preço zero, barcode vazio nem fornecedor placeholder", () => {
    const itens = explicarQualityScore(martinsDegradado(0)).itens
    expect(itens.find((i) => i.chave === "preco")!.ok).toBe(false)
    expect(itens.find((i) => i.chave === "barras")!.ok).toBe(false)
    expect(itens.find((i) => i.chave === "fornecedor")!.ok).toBe(false)
  })

  it("lista as pendências por peso decrescente", () => {
    const p = explicarQualityScore(martinsDegradado(0)).pendencias
    expect(p[0]!.chave).toBe("preco")
    expect(p.map((i) => i.chave)).toContain("barras")
    for (let i = 1; i < p.length; i++) {
      expect(p[i - 1]!.peso).toBeGreaterThanOrEqual(p[i]!.peso)
    }
  })
})

describe("score dos produtos do Martins (após reparo + revisão)", () => {
  it("sobe para faixa alta", () => {
    const score = catalogQualityScore(martinsReparado(0))
    expect(score).toBeGreaterThanOrEqual(74)
  })

  it("o único item pendente relevante é o SKU interno (que a nota não traz)", () => {
    const pend = explicarQualityScore(martinsReparado(0)).pendencias.map((i) => i.chave)
    expect(pend).toEqual(["identificador", "marca"])
  })

  it("reparo sem revisão vale menos que reparo revisado", () => {
    const semRevisao = catalogQualityScore({ ...martinsReparado(0), revisado: false })
    const comRevisao = catalogQualityScore(martinsReparado(0))
    expect(comRevisao - semRevisao).toBe(QUALITY_SCORE_PESOS.revisado)
  })
})

describe("placeholders", () => {
  it('"—" e "-" não pontuam', () => {
    const exp = explicarQualityScore({
      nome: "X",
      sku: "—",
      barras: " ",
      categoria: "-",
      preco: 0,
      fornecedor: "—",
      marca: "—",
    })
    expect(exp.score).toBe(QUALITY_SCORE_PESOS.nome)
  })
})

describe("qualityScoreInputFromProduto", () => {
  it("lê NCM do metadata.fiscal canônico", () => {
    const metadata = mergeProdutoFiscalIntoMetadata({}, { ncm: "18069000" })
    const input = qualityScoreInputFromProduto({
      nome: "X",
      sku: "",
      barras: "",
      categoria: "",
      preco: 0,
      fornecedor: "",
      marca: "",
      metadata,
    })
    expect(input.ncm).toBe("18069000")
  })

  it("lê NCM do metadata legado (topo)", () => {
    const input = qualityScoreInputFromProduto({
      nome: "X",
      sku: "",
      barras: "",
      categoria: "",
      preco: 0,
      fornecedor: "",
      marca: "",
      metadata: { ncm: "85061020" },
    })
    expect(input.ncm).toBe("85061020")
  })

  it("produto com lote pendente conta como não revisado", () => {
    const metadata = mergeImportacaoIntoMetadata(
      {},
      construirLoteImportacao({
        batchId: "b1",
        arquivo: "x.xlsx",
        acao: "criado",
        matchPor: null,
        linhaOrigem: 1,
        contexto: { ...CONTEXTO_LOTE_VAZIO },
      }),
    )
    const input = qualityScoreInputFromProduto({
      nome: "X",
      sku: "",
      barras: "",
      categoria: "",
      preco: 0,
      fornecedor: "",
      marca: "",
      metadata,
    })
    expect(input.revisado).toBe(false)
  })

  it("produto que nunca passou por importação não é penalizado por revisão", () => {
    const input = qualityScoreInputFromProduto({
      nome: "X",
      sku: "",
      barras: "",
      categoria: "",
      preco: 0,
      fornecedor: "",
      marca: "",
      metadata: null,
    })
    expect(input.revisado).toBe(true)
  })
})
