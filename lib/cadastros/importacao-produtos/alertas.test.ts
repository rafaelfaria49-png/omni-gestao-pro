import { describe, expect, it } from "vitest"

import { alertasDaLinha, avaliarAptidaoAtivacao, estadoConferencia, temBloqueio } from "./alertas"
import { extrairLinhaProduto } from "./linha"
import type { PlanoMatchProduto, ProdutoImportLinha } from "./types"

function linha(campos: Record<string, unknown> = {}): ProdutoImportLinha {
  return extrairLinhaProduto({ "produto.nome": "PRODUTO X", ...campos }, { linhaOrigem: 1 })
}

function plano(over: Partial<PlanoMatchProduto> = {}): PlanoMatchProduto {
  return { acao: "criar", produtoId: null, matchPor: null, motivo: "novo", conflitos: [], ...over }
}

function codigos(l: ProdutoImportLinha, p: PlanoMatchProduto): string[] {
  return alertasDaLinha(l, p).map((a) => a.codigo)
}

describe("alertasDaLinha", () => {
  it("sinaliza sem preço, sem barcode e sem categoria", () => {
    expect(codigos(linha(), plano())).toEqual(
      expect.arrayContaining(["sem_preco", "sem_barcode", "sem_categoria"]),
    )
  })

  it("não sinaliza o que está preenchido", () => {
    const l = linha({
      "produto.barcode": "7892840819170",
      "produto.categoria": "Mercearia",
      "financeiro.precoVenda": "29,90",
    })
    const c = codigos(l, plano())
    expect(c).not.toContain("sem_preco")
    expect(c).not.toContain("sem_barcode")
    expect(c).not.toContain("sem_categoria")
  })

  it("sinaliza marca igual à categoria", () => {
    const l = linha({ "produto.categoria": "Pilhas e Baterias", "produto.marca": "pilhas_e_baterias" })
    expect(codigos(l, plano())).toContain("marca_igual_categoria")
  })

  it("sinaliza NCM e CEST inválidos com o valor original na mensagem", () => {
    const l = linha({ "produto.ncm": "123", "produto.cest": "99" })
    const alertas = alertasDaLinha(l, plano())
    expect(alertas.map((a) => a.codigo)).toEqual(expect.arrayContaining(["ncm_invalido", "cest_invalido"]))
    expect(alertas.find((a) => a.codigo === "ncm_invalido")?.mensagem).toContain("123")
  })

  it("sinaliza match por nome exato", () => {
    const c = codigos(linha(), plano({ acao: "atualizar", matchPor: "nome_exato", produtoId: "p1" }))
    expect(c).toContain("match_por_nome")
  })

  it("conflito é ERRO e trava a importação", () => {
    const alertas = alertasDaLinha(linha(), plano({ acao: "conflito", motivo: "Dois produtos com este nome" }))
    const conflito = alertas.find((a) => a.codigo === "conflito_duplicidade")!
    expect(conflito.severidade).toBe("erro")
    expect(conflito.mensagem).toBe("Dois produtos com este nome")
    expect(temBloqueio(alertas)).toBe(true)
  })

  it("alertas comuns NÃO travam a importação", () => {
    expect(temBloqueio(alertasDaLinha(linha(), plano()))).toBe(false)
  })

  it("sinaliza SKU sintético quando a planilha manda linha-N explicitamente", () => {
    // `extrairLinhaProduto` já anula linha-N; aqui forçamos a linha para provar o alerta.
    const l = { ...linha(), sku: "linha-3" }
    expect(codigos(l, plano())).toContain("sku_sintetico")
  })
})

describe("avaliarAptidaoAtivacao", () => {
  it("apto exige nome, categoria e preço > 0", () => {
    expect(avaliarAptidaoAtivacao({ nome: "X", categoria: "Mercearia", preco: 10 })).toEqual({
      apto: true,
      pendencias: [],
    })
  })

  it("lista pendências específicas", () => {
    expect(avaliarAptidaoAtivacao({ nome: "", categoria: null, preco: 0 }).pendencias).toEqual([
      "Sem nome",
      "Sem categoria",
      "Sem preço de venda",
    ])
  })

  it("conflito de identidade bloqueia", () => {
    const r = avaliarAptidaoAtivacao({ nome: "X", categoria: "C", preco: 10, temConflitoIdentidade: true })
    expect(r.apto).toBe(false)
    expect(r.pendencias).toContain("Conflito de SKU ou código de barras")
  })

  it("barcode/fornecedor/NCM ausentes NÃO bloqueiam ativação", () => {
    // Só nome+categoria+preço entram na regra — nenhum campo fiscal aparece.
    expect(avaliarAptidaoAtivacao({ nome: "X", categoria: "C", preco: 1 }).apto).toBe(true)
  })
})

// A cobertura de `ativacaoDeProdutoNovo` migrou para `ativacao.test.ts`, junto com a
// função. A política de ativação de criação e de atualização é uma só (F-05).

describe("estadoConferencia", () => {
  it("erro e conflito vencem tudo", () => {
    expect(estadoConferencia({ statusRevisao: "revisado", nome: "X", categoria: "C", preco: 9, erro: true })).toBe("erro")
    expect(estadoConferencia({ statusRevisao: "revisado", nome: "X", categoria: "C", preco: 9, conflito: true })).toBe("conflito")
  })

  it("incompleto quando falta preço", () => {
    expect(estadoConferencia({ statusRevisao: "pendente", nome: "X", categoria: "C", preco: 0 })).toBe("incompleto")
  })

  it("pendente quando apto mas ainda não revisado", () => {
    expect(estadoConferencia({ statusRevisao: "pendente", nome: "X", categoria: "C", preco: 9 })).toBe("pendente")
  })

  it("revisado após conferência", () => {
    expect(estadoConferencia({ statusRevisao: "revisado", nome: "X", categoria: "C", preco: 9 })).toBe("revisado")
  })
})
