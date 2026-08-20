/**
 * GOAL 087 — evidência YA04 (tpIntegra) para tPag 03/04.
 */
import { describe, expect, it } from "vitest"
import {
  CAMPOS_CARTAO_PROIBIDOS,
  campoCartaoProibidoPresente,
  erroTpIntegraCartao,
  isFormaCartao,
  isTPagCartao,
} from "./card-evidence"

describe("card-evidence · capacidade atual = só tpIntegra 2", () => {
  it("reconhece tPag 03/04 e formas de cartão", () => {
    expect(isTPagCartao("03")).toBe(true)
    expect(isTPagCartao("04")).toBe(true)
    expect(isTPagCartao("17")).toBe(false)
    expect(isTPagCartao("01")).toBe(false)
    expect(isFormaCartao("cartaoCredito")).toBe(true)
    expect(isFormaCartao("cartaoDebito")).toBe(true)
    expect(isFormaCartao("pix")).toBe(false)
  })

  it("tpIntegra ausente / inválido / 1 / 2", () => {
    expect(erroTpIntegraCartao(undefined, "x")?.code).toBe("PAGAMENTO_CARTAO_TPINTEGRA_AUSENTE")
    expect(erroTpIntegraCartao("", "x")?.code).toBe("PAGAMENTO_CARTAO_TPINTEGRA_AUSENTE")
    expect(erroTpIntegraCartao("3", "x")?.code).toBe("PAGAMENTO_CARTAO_TPINTEGRA_INVALIDO")
    expect(erroTpIntegraCartao("1", "x")?.code).toBe("PAGAMENTO_CARTAO_INTEGRADO_NAO_SUPORTADO")
    expect(erroTpIntegraCartao("2", "x")).toBeNull()
  })

  it("campos YA05–YA11 / NSU / card arbitrário são proibidos", () => {
    expect(CAMPOS_CARTAO_PROIBIDOS).toEqual([
      "CNPJ",
      "tBand",
      "cAut",
      "CNPJReceb",
      "idTermPag",
      "NSU",
      "card",
      "maquininhaId",
    ])
    expect(campoCartaoProibidoPresente({ tPag: "03", CNPJ: "11222333000181" })).toBe("CNPJ")
    expect(campoCartaoProibidoPresente({ tBand: "01" })).toBe("tBand")
    expect(campoCartaoProibidoPresente({ cAut: "ABC" })).toBe("cAut")
    expect(campoCartaoProibidoPresente({ NSU: "1" })).toBe("NSU")
    expect(campoCartaoProibidoPresente({ formaOrigem: "cartaoCredito", tpIntegra: "2" })).toBeNull()
  })
})
