/**
 * GOAL 030 — contrato canônico de pagamento fiscal (fail-closed).
 *
 * Cobre o formato REAL persistido pelos PDVs (`PaymentBreakdownFull`) e recusa
 * heurística / fallback / formas sem capacidade fiscal.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  PAGAMENTO_FISCAL_CONTRATO_VERSAO,
  TPAG_CATALOGO_FONTE,
  assertPagamentoFiscalCanonico,
  derivePagamentoFiscalFromBreakdown,
  isTPagOficial,
} from "./index"

describe("catálogo tPag oficial", () => {
  it("IT 2024.002 v1.11 inclui os códigos que o contrato emite", () => {
    expect(TPAG_CATALOGO_FONTE).toBe("IT-2024.002-v1.11")
    expect(isTPagOficial("01")).toBe(true)
    expect(isTPagOficial("03")).toBe(true)
    expect(isTPagOficial("04")).toBe(true)
    expect(isTPagOficial("05")).toBe(true)
    expect(isTPagOficial("15")).toBe(true)
    expect(isTPagOficial("17")).toBe(true)
    expect(isTPagOficial("19")).toBe(true)
    expect(isTPagOficial("20")).toBe(true)
    expect(isTPagOficial("21")).toBe(true)
    expect(isTPagOficial("23")).toBe(true)
    expect(isTPagOficial("91")).toBe(true)
    expect(isTPagOficial("99")).toBe(true)
    expect(isTPagOficial("00")).toBe(false)
    expect(isTPagOficial("1")).toBe(false)
  })
})

describe("derivePagamentoFiscalFromBreakdown · formas válidas", () => {
  it("dinheiro válido", () => {
    const r = derivePagamentoFiscalFromBreakdown({ dinheiro: 50, pix: 0, cartaoDebito: 0, cartaoCredito: 0, carne: 0, aPrazo: 0, creditoVale: 0 }, 50)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.pagamento.versao).toBe(PAGAMENTO_FISCAL_CONTRATO_VERSAO)
    expect(r.pagamento.det).toEqual([{ formaInterna: "dinheiro", tPag: "01", vPag: 50 }])
    expect(r.pagamento.vTroco).toBeNull()
    expect(r.pagamento.fonte).toBe("venda.payload.paymentBreakdown")
  })

  it("PIX no breakdown legado não infere tPag 17", () => {
    const r = derivePagamentoFiscalFromBreakdown({ pix: 80 }, 80)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.erro.code).toBe("PAGAMENTO_PIX_LEGADO_SEM_EVIDENCIA")
    expect(r.erro.mensagem).toMatch(/sem evidência de subtipo/i)
    expect(r.erro.mensagem).not.toMatch(/tPag=01|"01"|"99"/)
  })

  it("débito no breakdown legado não presume POS simples", () => {
    const r = derivePagamentoFiscalFromBreakdown({ cartaoDebito: 25.5 }, 25.5)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.erro.code).toBe("PAGAMENTO_CARTAO_LEGADO_SEM_EVIDENCIA")
      expect(JSON.stringify(r)).not.toMatch(/tPag=01|"01"|"99"/)
    }
  })

  it("crédito no breakdown legado não presume POS simples", () => {
    const r = derivePagamentoFiscalFromBreakdown({ cartaoCredito: 100 }, 100)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erro.code).toBe("PAGAMENTO_CARTAO_LEGADO_SEM_EVIDENCIA")
  })

  it("split legado dinheiro + débito + crédito bloqueia o conjunto (não emite só o dinheiro)", () => {
    const r = derivePagamentoFiscalFromBreakdown(
      { dinheiro: 10, pix: 0, cartaoDebito: 30, cartaoCredito: 60 },
      100,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.erro.code).toBe("PAGAMENTO_CARTAO_LEGADO_SEM_EVIDENCIA")
      expect(r.erro.mensagem).not.toMatch(/tPag=01|"01"|"99"/)
    }
  })

  it("ordem de chaves do breakdown não altera o fail-closed de cartão", () => {
    const a = derivePagamentoFiscalFromBreakdown({ cartaoDebito: 50, dinheiro: 50 }, 100)
    const b = derivePagamentoFiscalFromBreakdown({ dinheiro: 50, cartaoDebito: 50 }, 100)
    expect(a.ok).toBe(false)
    expect(b.ok).toBe(false)
    if (!a.ok && !b.ok) {
      expect(a.erro.code).toBe("PAGAMENTO_CARTAO_LEGADO_SEM_EVIDENCIA")
      expect(b.erro.code).toBe(a.erro.code)
    }
  })

  it("split legado com PIX bloqueia o conjunto (não emite só o dinheiro)", () => {
    const r = derivePagamentoFiscalFromBreakdown({ dinheiro: 20, pix: 80 }, 100)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.erro.code).toBe("PAGAMENTO_PIX_LEGADO_SEM_EVIDENCIA")
      expect(r.erro.mensagem).not.toMatch(/tPag=01|"01"|"99"/)
    }
  })
})

describe("derivePagamentoFiscalFromBreakdown · fail-closed", () => {
  it("forma desconhecida", () => {
    const r = derivePagamentoFiscalFromBreakdown({ cripto: 50 }, 50)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.erro.code).toBe("PAGAMENTO_FORMA_DESCONHECIDA")
    expect(r.erro.mensagem).not.toMatch(/99|outros/i)
  })

  it("não converte forma desconhecida para tPag=99", () => {
    const r = derivePagamentoFiscalFromBreakdown({ vale: 10, dinheiro: 40 }, 50)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.erro.code).toBe("PAGAMENTO_FORMA_DESCONHECIDA")
  })

  it("breakdown ausente", () => {
    expect(derivePagamentoFiscalFromBreakdown(null, 50).ok).toBe(false)
    const r = derivePagamentoFiscalFromBreakdown(null, 50)
    if (!r.ok) expect(r.erro.code).toBe("PAGAMENTO_AUSENTE")
  })

  it("objeto vazio / todos zeros → ausência", () => {
    const r = derivePagamentoFiscalFromBreakdown({ dinheiro: 0, pix: 0 }, 50)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erro.code).toBe("PAGAMENTO_AUSENTE")
  })

  it("array (formato heurístico) → formato inválido", () => {
    const r = derivePagamentoFiscalFromBreakdown([{ forma: "dinheiro", valor: 50 }], 50)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erro.code).toBe("PAGAMENTO_FORMATO_INVALIDO")
  })

  it("soma abaixo do total", () => {
    const r = derivePagamentoFiscalFromBreakdown({ dinheiro: 40 }, 50)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.erro.code).toBe("PAGAMENTO_SOMA_DIVERGENTE")
      expect(r.erro.mensagem).toMatch(/abaixo/)
    }
  })

  it("soma acima do total", () => {
    const r = derivePagamentoFiscalFromBreakdown({ dinheiro: 60 }, 50)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.erro.code).toBe("PAGAMENTO_SOMA_DIVERGENTE")
      expect(r.erro.mensagem).toMatch(/acima/)
    }
  })

  it("valor inválido (NaN)", () => {
    const r = derivePagamentoFiscalFromBreakdown({ dinheiro: Number.NaN }, 50)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erro.code).toBe("PAGAMENTO_VALOR_INVALIDO")
  })

  it("valor negativo", () => {
    const r = derivePagamentoFiscalFromBreakdown({ pix: -10 }, 50)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erro.code).toBe("PAGAMENTO_VALOR_INVALIDO")
  })

  it("a prazo persistido sem capacidade fiscal (não inventa tPag=05/91)", () => {
    const r = derivePagamentoFiscalFromBreakdown({ aPrazo: 50 }, 50)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erro.code).toBe("PAGAMENTO_FORMA_SEM_CAPACIDADE_FISCAL")
  })

  it("carne persistido sem capacidade fiscal", () => {
    const r = derivePagamentoFiscalFromBreakdown({ carne: 50 }, 50)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erro.code).toBe("PAGAMENTO_FORMA_SEM_CAPACIDADE_FISCAL")
  })

  it("crédito-vale no breakdown legado permanece sem capacidade fiscal (não infere 21)", () => {
    const r = derivePagamentoFiscalFromBreakdown({ creditoVale: 50 }, 50)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.erro.code).toBe("PAGAMENTO_FORMA_SEM_CAPACIDADE_FISCAL")
      expect(r.erro.mensagem).not.toMatch(/tPag=21|"21"|"19"|"12"/)
    }
  })

  it("não fabrica troco", () => {
    const r = derivePagamentoFiscalFromBreakdown({ dinheiro: 50 }, 50)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.pagamento.vTroco).toBeNull()
    expect("valorRecebido" in r.pagamento).toBe(false)
  })
})

describe("assertPagamentoFiscalCanonico", () => {
  it("contrato com vTroco oficial (Σ vPag − vTroco = total) é válido", () => {
    const frozen = {
      versao: PAGAMENTO_FISCAL_CONTRATO_VERSAO,
      fonte: "venda.payload.fiscalPaymentHandoff" as const,
      catalogoTPag: "IT-2024.002-v1.11" as const,
      det: [
        { formaInterna: "dinheiro" as const, tPag: "01" as const, vPag: 70 },
        { formaInterna: "pix" as const, tPag: "20" as const, vPag: 40 },
      ],
      soma: 110,
      vTroco: 10,
    }
    const a = assertPagamentoFiscalCanonico(frozen, 100)
    expect(a.ok).toBe(true)
  })

  it("vTroco que não fecha Σ − vNF é recusado (YA09-10)", () => {
    const frozen = {
      versao: PAGAMENTO_FISCAL_CONTRATO_VERSAO,
      fonte: "venda.payload.fiscalPaymentHandoff" as const,
      catalogoTPag: "IT-2024.002-v1.11" as const,
      det: [{ formaInterna: "dinheiro" as const, tPag: "01" as const, vPag: 150 }],
      soma: 150,
      vTroco: 10,
    }
    const a = assertPagamentoFiscalCanonico(frozen, 100)
    expect(a.ok).toBe(false)
    if (!a.ok) expect(a.erro.code).toBe("PAGAMENTO_SOMA_DIVERGENTE")
  })

  it("breakdown legado continua sem fabricar troco", () => {
    const d = derivePagamentoFiscalFromBreakdown({ dinheiro: 50 }, 50)
    expect(d.ok).toBe(true)
    if (!d.ok) return
    expect(d.pagamento.vTroco).toBeNull()
    const a = assertPagamentoFiscalCanonico({ ...d.pagamento, vTroco: 5 }, 50)
    expect(a.ok).toBe(false)
  })

  it("fonte paymentBreakdown + PIX tPag 17 bloqueia emissão futura", () => {
    const frozen = {
      versao: PAGAMENTO_FISCAL_CONTRATO_VERSAO,
      fonte: "venda.payload.paymentBreakdown" as const,
      catalogoTPag: "IT-2024.002-v1.11" as const,
      det: [{ formaInterna: "pix" as const, tPag: "17", vPag: 50 }],
      soma: 50,
      vTroco: null,
    }
    const a = assertPagamentoFiscalCanonico(frozen, 50)
    expect(a.ok).toBe(false)
    if (!a.ok) {
      expect(a.erro.code).toBe("PAGAMENTO_PIX_LEGADO_SEM_EVIDENCIA")
      expect(a.erro.mensagem).not.toMatch(/tPag=01|"01"|"99"/)
    }
  })

  it("fonte fiscalPaymentHandoff + PIX tPag 17 permanece válido", () => {
    const frozen = {
      versao: PAGAMENTO_FISCAL_CONTRATO_VERSAO,
      fonte: "venda.payload.fiscalPaymentHandoff" as const,
      catalogoTPag: "IT-2024.002-v1.11" as const,
      det: [{ formaInterna: "pix" as const, tPag: "17", vPag: 50 }],
      soma: 50,
      vTroco: null,
    }
    expect(assertPagamentoFiscalCanonico(frozen, 50).ok).toBe(true)
  })

  it("contrato vs total XML divergente → soma divergente", () => {
    const d = derivePagamentoFiscalFromBreakdown({ dinheiro: 50 }, 50)
    expect(d.ok).toBe(true)
    if (!d.ok) return
    const a = assertPagamentoFiscalCanonico(d.pagamento, 40)
    expect(a.ok).toBe(false)
    if (!a.ok) expect(a.erro.code).toBe("PAGAMENTO_SOMA_DIVERGENTE")
  })

  it("PIX com tPag 20/23 (handoff) continua canônico; 01/99 não", () => {
    const base = {
      versao: PAGAMENTO_FISCAL_CONTRATO_VERSAO,
      fonte: "venda.payload.fiscalPaymentHandoff" as const,
      catalogoTPag: "IT-2024.002-v1.11" as const,
      soma: 50,
      vTroco: null,
    }
    expect(assertPagamentoFiscalCanonico({ ...base, det: [{ formaInterna: "pix", tPag: "20", vPag: 50 }] }, 50).ok).toBe(true)
    expect(assertPagamentoFiscalCanonico({ ...base, det: [{ formaInterna: "pix", tPag: "23", vPag: 50 }] }, 50).ok).toBe(true)
    expect(assertPagamentoFiscalCanonico({ ...base, det: [{ formaInterna: "pix", tPag: "17", vPag: 50 }] }, 50).ok).toBe(true)
    expect(assertPagamentoFiscalCanonico({ ...base, det: [{ formaInterna: "pix", tPag: "01", vPag: 50 }] }, 50).ok).toBe(false)
    expect(assertPagamentoFiscalCanonico({ ...base, det: [{ formaInterna: "pix", tPag: "99", vPag: 50 }] }, 50).ok).toBe(false)
  })

  it("fonte paymentBreakdown + creditoVale tPag 21 bloqueia emissão futura", () => {
    const frozen = {
      versao: PAGAMENTO_FISCAL_CONTRATO_VERSAO,
      fonte: "venda.payload.paymentBreakdown" as const,
      catalogoTPag: "IT-2024.002-v1.11" as const,
      det: [{ formaInterna: "creditoVale" as const, tPag: "21", vPag: 40 }],
      soma: 40,
      vTroco: null,
    }
    const a = assertPagamentoFiscalCanonico(frozen, 40)
    expect(a.ok).toBe(false)
    if (!a.ok) expect(a.erro.code).toBe("PAGAMENTO_FORMA_SEM_CAPACIDADE_FISCAL")
  })

  it("fonte fiscalPaymentHandoff + creditoVale tPag 21 permanece válido", () => {
    const frozen = {
      versao: PAGAMENTO_FISCAL_CONTRATO_VERSAO,
      fonte: "venda.payload.fiscalPaymentHandoff" as const,
      catalogoTPag: "IT-2024.002-v1.11" as const,
      det: [{ formaInterna: "creditoVale" as const, tPag: "21", vPag: 40 }],
      soma: 40,
      vTroco: null,
    }
    expect(assertPagamentoFiscalCanonico(frozen, 40).ok).toBe(true)
    expect(assertPagamentoFiscalCanonico({ ...frozen, det: [{ formaInterna: "creditoVale", tPag: "19", vPag: 40 }] }, 40).ok).toBe(false)
  })

  it("fonte paymentBreakdown + cartão 03/04 bloqueia emissão futura", () => {
    const frozen = {
      versao: PAGAMENTO_FISCAL_CONTRATO_VERSAO,
      fonte: "venda.payload.paymentBreakdown" as const,
      catalogoTPag: "IT-2024.002-v1.11" as const,
      det: [{ formaInterna: "cartaoCredito" as const, tPag: "03", vPag: 50 }],
      soma: 50,
      vTroco: null,
    }
    const a = assertPagamentoFiscalCanonico(frozen, 50)
    expect(a.ok).toBe(false)
    if (!a.ok) expect(a.erro.code).toBe("PAGAMENTO_CARTAO_LEGADO_SEM_EVIDENCIA")
  })

  it("fonte fiscalPaymentHandoff + 03/04 sem tpIntegra bloqueia XML", () => {
    const frozen = {
      versao: PAGAMENTO_FISCAL_CONTRATO_VERSAO,
      fonte: "venda.payload.fiscalPaymentHandoff" as const,
      catalogoTPag: "IT-2024.002-v1.11" as const,
      det: [{ formaInterna: "cartaoDebito" as const, tPag: "04", vPag: 50 }],
      soma: 50,
      vTroco: null,
    }
    const a = assertPagamentoFiscalCanonico(frozen, 50)
    expect(a.ok).toBe(false)
    if (!a.ok) expect(a.erro.code).toBe("PAGAMENTO_CARTAO_TPINTEGRA_AUSENTE")
  })

  it("fonte fiscalPaymentHandoff + 03 + tpIntegra 2 é válido; 1 não", () => {
    const base = {
      versao: PAGAMENTO_FISCAL_CONTRATO_VERSAO,
      fonte: "venda.payload.fiscalPaymentHandoff" as const,
      catalogoTPag: "IT-2024.002-v1.11" as const,
      soma: 50,
      vTroco: null,
    }
    expect(
      assertPagamentoFiscalCanonico(
        { ...base, det: [{ formaInterna: "cartaoCredito", tPag: "03", vPag: 50, tpIntegra: "2" }] },
        50,
      ).ok,
    ).toBe(true)
    const integrado = assertPagamentoFiscalCanonico(
      { ...base, det: [{ formaInterna: "cartaoCredito", tPag: "03", vPag: 50, tpIntegra: "1" }] },
      50,
    )
    expect(integrado.ok).toBe(false)
    if (!integrado.ok) expect(integrado.erro.code).toBe("PAGAMENTO_CARTAO_INTEGRADO_NAO_SUPORTADO")
  })

  it("PIX 17 do handoff continua sem tpIntegra (YA04 residual)", () => {
    const frozen = {
      versao: PAGAMENTO_FISCAL_CONTRATO_VERSAO,
      fonte: "venda.payload.fiscalPaymentHandoff" as const,
      catalogoTPag: "IT-2024.002-v1.11" as const,
      det: [{ formaInterna: "pix" as const, tPag: "17", vPag: 50 }],
      soma: 50,
      vTroco: null,
    }
    expect(assertPagamentoFiscalCanonico(frozen, 50).ok).toBe(true)
    const analogia = assertPagamentoFiscalCanonico(
      { ...frozen, det: [{ formaInterna: "pix", tPag: "17", vPag: 50, tpIntegra: "2" }] },
      50,
    )
    expect(analogia.ok).toBe(false)
    if (!analogia.ok) expect(analogia.erro.code).toBe("PAGAMENTO_CARTAO_DADOS_NAO_SUPORTADOS")
  })
})

describe("fronteira — zero Caixa/Financeiro/PDV vivo no módulo", () => {
  it("sources de payment/** não importam Prisma, Caixa, Financeiro nem PDV", () => {
    const dir = resolve(process.cwd(), "lib/fiscal/payment")
    for (const file of ["index.ts", "types.ts", "tpag-catalog.ts", "from-venda-breakdown.ts", "from-handoff.ts", "card-evidence.ts"]) {
      const src = readFileSync(resolve(dir, file), "utf8")
      expect(src).not.toMatch(/from ["']@\/lib\/prisma/)
      expect(src).not.toMatch(/from ["']@\/lib\/caixa/)
      expect(src).not.toMatch(/from ["']@\/lib\/financeiro/)
      expect(src).not.toMatch(/from ["']@\/lib\/ops-upsert-venda/)
      expect(src).not.toMatch(/finalizeSaleTransaction/)
      expect(src).not.toMatch(/PaymentModal/)
    }
    const breakdown = readFileSync(resolve(dir, "from-venda-breakdown.ts"), "utf8")
    expect(breakdown).not.toMatch(/pix:\s*"17"/)
  })
})
