/**
 * GOAL 089 — evidência YA04 (tpIntegra) para tPag 17 (PIX dinâmico, não integrado).
 */
import { describe, expect, it } from "vitest"
import { erroTpIntegraPixDinamico, isTPagPixDinamico, tpIntegraPixDinamicoValido } from "./pix-ya04-evidence"

describe("pix-ya04-evidence · capacidade atual = só tpIntegra 2 em tPag 17", () => {
  it("reconhece só tPag 17 — 20/23 não são YA04-10", () => {
    expect(isTPagPixDinamico("17")).toBe(true)
    expect(isTPagPixDinamico("20")).toBe(false)
    expect(isTPagPixDinamico("23")).toBe(false)
    expect(isTPagPixDinamico("03")).toBe(false)
    expect(isTPagPixDinamico("04")).toBe(false)
  })

  it("tpIntegra ausente / inválido / 1 / 2 usam códigos PIX específicos", () => {
    expect(erroTpIntegraPixDinamico(undefined, "x")?.code).toBe("PAGAMENTO_PIX_TPINTEGRA_AUSENTE")
    expect(erroTpIntegraPixDinamico("", "x")?.code).toBe("PAGAMENTO_PIX_TPINTEGRA_AUSENTE")
    expect(erroTpIntegraPixDinamico("3", "x")?.code).toBe("PAGAMENTO_PIX_TPINTEGRA_INVALIDO")
    expect(erroTpIntegraPixDinamico("1", "x")?.code).toBe("PAGAMENTO_PIX_INTEGRADO_NAO_SUPORTADO")
    expect(erroTpIntegraPixDinamico("2", "x")).toBeNull()
    expect(tpIntegraPixDinamicoValido("2")).toBe(true)
    expect(tpIntegraPixDinamicoValido("1")).toBe(false)
  })

  it("não reutiliza códigos de cartão", () => {
    const codes = [
      erroTpIntegraPixDinamico(undefined, "x")?.code,
      erroTpIntegraPixDinamico("x", "x")?.code,
      erroTpIntegraPixDinamico("1", "x")?.code,
    ]
    expect(codes.join("")).not.toMatch(/CARTAO/)
  })
})
