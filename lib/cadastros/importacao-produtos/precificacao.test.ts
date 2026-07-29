import { describe, expect, it } from "vitest"

import {
  acrescimoSobreCusto,
  aplicarArredondamento,
  arredondarParaFinal,
  calcularPrecoLote,
  margemBrutaSobreVenda,
  preverPrecoLote,
} from "./precificacao"

describe("arredondarParaFinal", () => {
  it("sobe para o próximo final ,90", () => {
    expect(arredondarParaFinal(18.32, 90)).toBe(18.9)
    expect(arredondarParaFinal(18.9, 90)).toBe(18.9)
    expect(arredondarParaFinal(18.95, 90)).toBe(19.9)
    expect(arredondarParaFinal(19, 90)).toBe(19.9)
  })

  it("sobe para o próximo final ,99", () => {
    expect(arredondarParaFinal(18.32, 99)).toBe(18.99)
    expect(arredondarParaFinal(18.99, 99)).toBe(18.99)
    expect(arredondarParaFinal(19.5, 99)).toBe(19.99)
  })

  it("nunca desce", () => {
    expect(arredondarParaFinal(18.91, 90)).toBeGreaterThanOrEqual(18.91)
    expect(arredondarParaFinal(100.5, 90)).toBe(100.9)
  })

  it("valor inválido devolve 0", () => {
    expect(arredondarParaFinal(0, 90)).toBe(0)
    expect(arredondarParaFinal(-5, 90)).toBe(0)
    expect(arredondarParaFinal(NaN, 99)).toBe(0)
  })
})

describe("aplicarArredondamento", () => {
  it("modo nenhum só arredonda a 2 casas", () => {
    expect(aplicarArredondamento(18.3456, "nenhum")).toBe(18.35)
  })
})

describe("calcularPrecoLote", () => {
  it("definir usa o valor informado", () => {
    expect(calcularPrecoLote(14.94, { tipo: "definir", valor: 29.9 })).toBe(29.9)
  })

  it("definir funciona mesmo sem custo", () => {
    expect(calcularPrecoLote(0, { tipo: "definir", valor: 19.9 })).toBe(19.9)
  })

  it("acréscimo percentual incide sobre o CUSTO", () => {
    // 14,94 + 100% = 29,88
    expect(calcularPrecoLote(14.94, { tipo: "acrescimo_percentual", percentual: 100 })).toBe(29.88)
    // 34,91 + 60% = 55,856 → 55,86
    expect(calcularPrecoLote(34.91, { tipo: "acrescimo_percentual", percentual: 60 })).toBe(55.86)
  })

  it("acréscimo fixo soma ao custo", () => {
    expect(calcularPrecoLote(14.94, { tipo: "acrescimo_fixo", valor: 10 })).toBe(24.94)
  })

  it("custo zero em regra dependente de custo devolve 0 (linha segue pendente)", () => {
    expect(calcularPrecoLote(0, { tipo: "acrescimo_percentual", percentual: 100 })).toBe(0)
    expect(calcularPrecoLote(0, { tipo: "acrescimo_fixo", valor: 10 })).toBe(0)
  })

  it("combina acréscimo com arredondamento ,90 e ,99", () => {
    expect(calcularPrecoLote(14.94, { tipo: "acrescimo_percentual", percentual: 100 }, "90")).toBe(29.9)
    expect(calcularPrecoLote(14.94, { tipo: "acrescimo_percentual", percentual: 100 }, "99")).toBe(29.99)
    expect(calcularPrecoLote(148.46, { tipo: "acrescimo_percentual", percentual: 50 }, "90")).toBe(222.9)
  })
})

describe("acréscimo sobre custo vs margem bruta sobre venda", () => {
  it("são grandezas diferentes e não devem ser confundidas", () => {
    // custo 50, preço 100 → acréscimo 100% sobre o custo, margem bruta 50% sobre a venda.
    expect(acrescimoSobreCusto(50, 100)).toBe(100)
    expect(margemBrutaSobreVenda(50, 100)).toBe(50)
  })

  it("acréscimo sobre custo zero é 0 (não infinito)", () => {
    expect(acrescimoSobreCusto(0, 100)).toBe(0)
  })

  it("margem com custo zero é 100%", () => {
    expect(margemBrutaSobreVenda(0, 100)).toBe(100)
  })

  it("preço zero zera as duas", () => {
    expect(acrescimoSobreCusto(50, 0)).toBe(0)
    expect(margemBrutaSobreVenda(50, 0)).toBe(0)
  })
})

describe("preverPrecoLote", () => {
  it("gera prévia por linha com antes/depois e as duas grandezas", () => {
    const previa = preverPrecoLote(
      [
        { produtoId: "a", custo: 14.94, preco: 0 },
        { produtoId: "b", custo: 0, preco: 0 },
      ],
      { tipo: "acrescimo_percentual", percentual: 100 },
      "90",
    )

    expect(previa[0]).toMatchObject({
      produtoId: "a",
      precoAtual: 0,
      precoNovo: 29.9,
      semCusto: false,
    })
    expect(previa[0]!.acrescimoSobreCusto).toBeCloseTo(100.13, 1)
    expect(previa[0]!.margemBrutaSobreVenda).toBeCloseTo(50.03, 1)

    // Sem custo a regra não consegue precificar — a prévia diz isso em vez de inventar.
    expect(previa[1]).toMatchObject({ produtoId: "b", precoNovo: 0, semCusto: true })
  })
})
