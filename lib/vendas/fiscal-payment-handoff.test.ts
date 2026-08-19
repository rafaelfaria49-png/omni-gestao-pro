/**
 * GOAL 075 — handoff fiscal de pagamento no instante da persistência da Venda.
 *
 * Cobre o contrato produzido a partir do `PaymentBreakdownFull` real dos PDVs:
 * tPag só quando unívoco; PIX/carnê/a prazo/vale bloqueados; sem troco fabricado;
 * sem metadata de cartão inventada.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  FISCAL_PAYMENT_HANDOFF_VERSION,
  HANDOFF_TPAG_COMPROVADO,
  buildFiscalPaymentHandoff,
} from "./fiscal-payment-handoff"

describe("buildFiscalPaymentHandoff · formas com tPag comprovado", () => {
  it("dinheiro → tPag 01 suportado", () => {
    const h = buildFiscalPaymentHandoff({ dinheiro: 50, pix: 0, cartaoDebito: 0, cartaoCredito: 0, carne: 0, aPrazo: 0, creditoVale: 0 }, 50)
    expect(h.version).toBe(FISCAL_PAYMENT_HANDOFF_VERSION)
    expect(h.linhas).toEqual([
      { formaOrigem: "dinheiro", valor: 50, tPag: "01", capability: "supported", status: "ok" },
    ])
    expect("vTroco" in h).toBe(false)
    expect("valorEntregue" in h).toBe(false)
  })

  it("débito → tPag 04 sem metadata de cartão", () => {
    const h = buildFiscalPaymentHandoff({ cartaoDebito: 25.5 }, 25.5)
    expect(h.linhas).toEqual([
      { formaOrigem: "cartaoDebito", valor: 25.5, tPag: "04", capability: "supported", status: "ok" },
    ])
    expect(JSON.stringify(h)).not.toMatch(/tpIntegra|tBand|cAut|maquininha|CNPJ|adquirente/)
  })

  it("crédito → tPag 03 sem metadata de cartão", () => {
    const h = buildFiscalPaymentHandoff({ cartaoCredito: 100 }, 100)
    expect(h.linhas[0]).toEqual({
      formaOrigem: "cartaoCredito",
      valor: 100,
      tPag: "03",
      capability: "supported",
      status: "ok",
    })
    expect(h.linhas[0]!.tPag).toBe(HANDOFF_TPAG_COMPROVADO.cartaoCredito)
  })

  it("split dinheiro + débito + crédito", () => {
    const h = buildFiscalPaymentHandoff({ dinheiro: 10, cartaoDebito: 30, cartaoCredito: 60 }, 100)
    expect(h.linhas.map((l) => [l.formaOrigem, l.tPag])).toEqual([
      ["cartaoCredito", "03"],
      ["cartaoDebito", "04"],
      ["dinheiro", "01"],
    ])
    expect(h.linhas.every((l) => l.capability === "supported")).toBe(true)
  })
})

describe("buildFiscalPaymentHandoff · formas bloqueadas (sem inferir tPag)", () => {
  it("PIX genérico não infere 17/20/23", () => {
    const h = buildFiscalPaymentHandoff({ pix: 80 }, 80)
    expect(h.linhas).toHaveLength(1)
    expect(h.linhas[0]!.formaOrigem).toBe("pix")
    expect(h.linhas[0]!.valor).toBe(80)
    expect(h.linhas[0]!.tPag).toBeUndefined()
    expect(h.linhas[0]!.capability).toBe("blocked")
    expect(h.linhas[0]!.status).toBe("blocked")
    expect(h.linhas[0]!.motivo).toBe("pix_subtipo_nao_discriminado")
    expect(JSON.stringify(h)).not.toMatch(/"tPag":"17"|"tPag":"20"|"tPag":"23"/)
  })

  it("carne permanece bloqueado (05 vs 15; boleto colapsa nesta chave)", () => {
    const h = buildFiscalPaymentHandoff({ carne: 50 }, 50)
    expect(h.linhas[0]!.tPag).toBeUndefined()
    expect(h.linhas[0]!.capability).toBe("blocked")
    expect(h.linhas[0]!.motivo).toBe("carne_tpag_ambiguo")
    expect(h.linhas[0]!.dadoAdicionalNecessario).toMatch(/05|15/)
  })

  it("aPrazo permanece bloqueado (05 vs 91 vs 15)", () => {
    const h = buildFiscalPaymentHandoff({ aPrazo: 50 }, 50)
    expect(h.linhas[0]!.tPag).toBeUndefined()
    expect(h.linhas[0]!.capability).toBe("blocked")
    expect(h.linhas[0]!.motivo).toBe("aprazo_tpag_ambiguo")
    expect(h.linhas[0]!.dadoAdicionalNecessario).toMatch(/91/)
  })

  it("creditoVale permanece bloqueado (19 vs 21)", () => {
    const h = buildFiscalPaymentHandoff({ creditoVale: 40 }, 40)
    expect(h.linhas[0]!.tPag).toBeUndefined()
    expect(h.linhas[0]!.capability).toBe("blocked")
    expect(h.linhas[0]!.motivo).toBe("credito_vale_tpag_ambiguo")
  })

  it("forma desconhecida não vira tPag=99", () => {
    const h = buildFiscalPaymentHandoff({ cripto: 50 }, 50)
    expect(h.linhas[0]!.formaOrigem).toBe("cripto")
    expect(h.linhas[0]!.tPag).toBeUndefined()
    expect(h.linhas[0]!.motivo).toBe("forma_desconhecida")
    expect(JSON.stringify(h)).not.toMatch(/"tPag":"99"/)
  })

  it("split com PIX bloqueia a linha PIX e mantém dinheiro comprovado", () => {
    const h = buildFiscalPaymentHandoff({ dinheiro: 20, pix: 80 }, 100)
    expect(h.linhas.find((l) => l.formaOrigem === "dinheiro")?.tPag).toBe("01")
    expect(h.linhas.find((l) => l.formaOrigem === "pix")?.tPag).toBeUndefined()
    expect(h.linhas.find((l) => l.formaOrigem === "pix")?.capability).toBe("blocked")
  })
})

describe("buildFiscalPaymentHandoff · troco e formato", () => {
  it("não persiste vTroco nem valorEntregue mesmo com dinheiro", () => {
    const h = buildFiscalPaymentHandoff({ dinheiro: 50 }, 50)
    expect("vTroco" in h).toBe(false)
    expect("valorEntregue" in h).toBe(false)
    expect(JSON.stringify(h)).not.toMatch(/vTroco|valorEntregue|valorRecebido/)
  })

  it("zeros são omitidos", () => {
    const h = buildFiscalPaymentHandoff({ dinheiro: 10, pix: 0, carne: 0 }, 10)
    expect(h.linhas).toHaveLength(1)
    expect(h.linhas[0]!.formaOrigem).toBe("dinheiro")
  })

  it("breakdown ausente → linhas vazias (versão presente)", () => {
    const h = buildFiscalPaymentHandoff(null, 50)
    expect(h.version).toBe(1)
    expect(h.linhas).toEqual([])
  })

  it("array (formato heurístico) → linha de formato inválido, sem inventar tPag", () => {
    const h = buildFiscalPaymentHandoff([{ forma: "dinheiro", valor: 50 }], 50)
    expect(h.linhas[0]!.motivo).toBe("formato_invalido")
    expect(h.linhas[0]!.tPag).toBeUndefined()
  })

  it("ordem das chaves não altera linhas canônicas", () => {
    const a = buildFiscalPaymentHandoff({ pix: 50, dinheiro: 50 }, 100)
    const b = buildFiscalPaymentHandoff({ dinheiro: 50, pix: 50 }, 100)
    expect(a.linhas).toEqual(b.linhas)
  })
})

describe("fronteira do produtor — zero Caixa/Financeiro/PDV vivo / SEFAZ", () => {
  it("o módulo do handoff não importa Prisma, Caixa, Financeiro, upsert nem PaymentModal", () => {
    const src = readFileSync(resolve(process.cwd(), "lib/vendas/fiscal-payment-handoff.ts"), "utf8")
    expect(src).not.toMatch(/from ["']@\/lib\/prisma/)
    expect(src).not.toMatch(/from ["']@\/lib\/caixa/)
    expect(src).not.toMatch(/from ["']@\/lib\/financeiro/)
    expect(src).not.toMatch(/from ["']@\/lib\/ops-upsert-venda/)
    expect(src).not.toMatch(/from ["'].*payment-modal/)
    expect(src).not.toMatch(/from ["'].*sefaz/i)
    expect(src).not.toMatch(/maquininhaId/)
  })
})
