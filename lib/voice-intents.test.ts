import { describe, expect, it } from "vitest"
import { parseVoiceIntent } from "./voice-intents"

describe("parseVoiceIntent", () => {
  it("interpreta venda com item e valor em reais", () => {
    const result = parseVoiceIntent("Quero vender uma película de 30 reais")
    expect(result).toEqual({
      kind: "pdv_sale",
      itemName: "uma película",
      price: 30,
    })
  })

  it("interpreta orçamento em variação coloquial", () => {
    const result = parseVoiceIntent("Faz um orçamento pro João")
    expect(result).toEqual({ kind: "orcamento" })
  })

  it("interpreta consulta de estoque em linguagem natural", () => {
    const result = parseVoiceIntent("Verifica quanto tem de iPhone no estoque")
    expect(result).toEqual({ kind: "estoque_view" })
  })

  it("interpreta preço de produto", () => {
    const result = parseVoiceIntent("Consultar preço de capa anti impacto")
    expect(result).toEqual({ kind: "preco_consulta", produtoQuery: "capa anti impacto" })
  })

  it("retorna null para frase sem mapeamento", () => {
    expect(parseVoiceIntent("me conte uma piada")).toBeNull()
  })
})
