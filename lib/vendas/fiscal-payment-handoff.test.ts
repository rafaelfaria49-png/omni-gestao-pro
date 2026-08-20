/**
 * GOAL 075 — handoff fiscal de pagamento no instante da persistência da Venda.
 *
 * Cobre o contrato produzido a partir do `PaymentBreakdownFull` real dos PDVs:
 * tPag só quando unívoco; PIX/carnê/a prazo bloqueados; creditoVale→21;
 * sem troco fabricado; sem metadata de cartão inventada.
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

  it("débito → tPag 04 + tpIntegra 2; sem CNPJ/tBand/cAut/maquininha", () => {
    const h = buildFiscalPaymentHandoff({ cartaoDebito: 25.5 }, 25.5)
    expect(h.linhas).toEqual([
      {
        formaOrigem: "cartaoDebito",
        valor: 25.5,
        tPag: "04",
        tpIntegra: "2",
        capability: "supported",
        status: "ok",
      },
    ])
    expect(JSON.stringify(h)).not.toMatch(/tBand|cAut|maquininha|CNPJ|adquirente|"tpIntegra":"1"/)
  })

  it("crédito → tPag 03 + tpIntegra 2", () => {
    const h = buildFiscalPaymentHandoff({ cartaoCredito: 100 }, 100)
    expect(h.linhas[0]).toEqual({
      formaOrigem: "cartaoCredito",
      valor: 100,
      tPag: "03",
      tpIntegra: "2",
      capability: "supported",
      status: "ok",
    })
    expect(h.linhas[0]!.tPag).toBe(HANDOFF_TPAG_COMPROVADO.cartaoCredito)
  })

  it("split dinheiro + débito + crédito: cada 03/04 leva tpIntegra 2; dinheiro não", () => {
    const h = buildFiscalPaymentHandoff({ dinheiro: 10, cartaoDebito: 30, cartaoCredito: 60 }, 100)
    expect(h.linhas.map((l) => [l.formaOrigem, l.tPag, l.tpIntegra])).toEqual([
      ["cartaoCredito", "03", "2"],
      ["cartaoDebito", "04", "2"],
      ["dinheiro", "01", undefined],
    ])
    expect(h.linhas.every((l) => l.capability === "supported")).toBe(true)
  })

  it("creditoVale → tPag 21 suportado (crédito em loja de devolução)", () => {
    const h = buildFiscalPaymentHandoff({ creditoVale: 40 }, 40)
    expect(h.linhas).toEqual([
      { formaOrigem: "creditoVale", valor: 40, tPag: "21", capability: "supported", status: "ok" },
    ])
    expect(JSON.stringify(h)).not.toMatch(/"tPag":"12"|"tPag":"19"|"tPag":"99"/)
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

  it("aPrazo permanece bloqueado (05 vs 91; 15/14 excluídos)", () => {
    const h = buildFiscalPaymentHandoff({ aPrazo: 50 }, 50)
    expect(h.linhas[0]!.tPag).toBeUndefined()
    expect(h.linhas[0]!.capability).toBe("blocked")
    expect(h.linhas[0]!.motivo).toBe("aprazo_tpag_ambiguo")
    expect(h.linhas[0]!.dadoAdicionalNecessario).toMatch(/91/)
    expect(h.linhas[0]!.dadoAdicionalNecessario).toMatch(/05/)
  })

  it("hints.tPag 19 no creditoVale é ignorado — servidor deriva 21", () => {
    const h = buildFiscalPaymentHandoff({ creditoVale: 40 }, 40, { ...( { tPag: "19" } as object ) })
    expect(h.linhas[0]).toMatchObject({ formaOrigem: "creditoVale", tPag: "21", capability: "supported" })
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

describe("buildFiscalPaymentHandoff · pixQrKind (GOAL 077)", () => {
  it.each([
    ["dinamico", "17"],
    ["estatico", "20"],
    ["automatico", "23"],
  ] as const)("PIX com pixQrKind %s → tPag %s suportado", (kind, tPag) => {
    const h = buildFiscalPaymentHandoff({ pix: 80 }, 80, { pixQrKind: kind })
    expect(h.linhas).toEqual([
      {
        formaOrigem: "pix",
        valor: 80,
        pixQrKind: kind,
        tPag,
        capability: "supported",
        status: "ok",
      },
    ])
  })

  it("PIX sem pixQrKind permanece bloqueado — sem default 17/20/23", () => {
    const h = buildFiscalPaymentHandoff({ pix: 50 }, 50, {})
    expect(h.linhas[0]!.tPag).toBeUndefined()
    expect(h.linhas[0]!.pixQrKind).toBeUndefined()
    expect(h.linhas[0]!.capability).toBe("blocked")
    expect(h.linhas[0]!.motivo).toBe("pix_subtipo_nao_discriminado")
  })

  it("pixQrKind desconhecido bloqueia e não inventa tPag", () => {
    const h = buildFiscalPaymentHandoff({ pix: 50 }, 50, { pixQrKind: "17" })
    expect(h.linhas[0]!.tPag).toBeUndefined()
    expect(h.linhas[0]!.capability).toBe("blocked")
    expect(h.linhas[0]!.motivo).toBe("pix_qr_kind_desconhecido")
    expect(JSON.stringify(h)).not.toMatch(/"tPag":"17"|"tPag":"20"|"tPag":"23"|"tPag":"01"|"tPag":"99"/)
  })

  it("hints.tPag do cliente é ignorado — só pixQrKind deriva tPag", () => {
    const h = buildFiscalPaymentHandoff({ pix: 50 }, 50, { pixQrKind: "estatico", ...( { tPag: "17" } as object ) })
    expect(h.linhas[0]!.tPag).toBe("20")
    expect(h.linhas[0]!.pixQrKind).toBe("estatico")
  })

  it("venda sem PIX ignora pixQrKind — não cria linha PIX", () => {
    const h = buildFiscalPaymentHandoff({ dinheiro: 50 }, 50, { pixQrKind: "dinamico" })
    expect(h.linhas).toEqual([
      { formaOrigem: "dinheiro", valor: 50, tPag: "01", capability: "supported", status: "ok" },
    ])
    expect(JSON.stringify(h)).not.toMatch(/pixQrKind/)
  })

  it("split PIX + dinheiro com pixQrKind estático", () => {
    const h = buildFiscalPaymentHandoff({ dinheiro: 20, pix: 80 }, 100, { pixQrKind: "estatico" })
    expect(h.linhas.find((l) => l.formaOrigem === "dinheiro")).toMatchObject({ tPag: "01", capability: "supported" })
    expect(h.linhas.find((l) => l.formaOrigem === "pix")).toMatchObject({
      tPag: "20",
      pixQrKind: "estatico",
      capability: "supported",
    })
  })

  it("hints.tpIntegra=1 / CNPJ / tBand do cliente são ignorados — servidor grava 2", () => {
    const h = buildFiscalPaymentHandoff({ cartaoCredito: 50 }, 50, {
      ...( { tpIntegra: "1", CNPJ: "11222333000181", tBand: "01", cAut: "XYZ", maquininhaId: "maq-pagbank" } as object ),
    })
    expect(h.linhas[0]).toMatchObject({ formaOrigem: "cartaoCredito", tPag: "03", tpIntegra: "2" })
    expect(JSON.stringify(h)).not.toMatch(/"tpIntegra":"1"|tBand|cAut|11222333000181|maq-pagbank/)
  })

  it("PIX não recebe tpIntegra por analogia", () => {
    const h = buildFiscalPaymentHandoff({ pix: 50 }, 50, { pixQrKind: "dinamico" })
    expect(h.linhas[0]!.tPag).toBe("17")
    expect(h.linhas[0]!.tpIntegra).toBeUndefined()
    expect(JSON.stringify(h)).not.toMatch(/tpIntegra/)
  })

  it("split PIX + cartão com pixQrKind dinâmico: 17 sem card; 03 com tpIntegra 2", () => {
    const h = buildFiscalPaymentHandoff({ pix: 40, cartaoCredito: 60 }, 100, { pixQrKind: "dinamico" })
    expect(h.linhas.find((l) => l.formaOrigem === "pix")).toMatchObject({ tPag: "17", pixQrKind: "dinamico" })
    expect(h.linhas.find((l) => l.formaOrigem === "pix")?.tpIntegra).toBeUndefined()
    expect(h.linhas.find((l) => l.formaOrigem === "cartaoCredito")).toMatchObject({ tPag: "03", tpIntegra: "2" })
    expect(h.linhas.every((l) => l.capability === "supported")).toBe(true)
  })

  it("split creditoVale + dinheiro", () => {
    const h = buildFiscalPaymentHandoff({ dinheiro: 60, creditoVale: 40 }, 100)
    expect(h.linhas.find((l) => l.formaOrigem === "dinheiro")).toMatchObject({ tPag: "01", capability: "supported" })
    expect(h.linhas.find((l) => l.formaOrigem === "creditoVale")).toMatchObject({ tPag: "21", capability: "supported" })
  })

  it("split creditoVale + PIX com pixQrKind estático", () => {
    const h = buildFiscalPaymentHandoff({ pix: 30, creditoVale: 70 }, 100, { pixQrKind: "estatico" })
    expect(h.linhas.find((l) => l.formaOrigem === "pix")).toMatchObject({ tPag: "20", capability: "supported" })
    expect(h.linhas.find((l) => l.formaOrigem === "creditoVale")).toMatchObject({ tPag: "21", capability: "supported" })
  })

  it("split creditoVale + cartão", () => {
    const h = buildFiscalPaymentHandoff({ cartaoDebito: 25, creditoVale: 25 }, 50)
    expect(h.linhas.find((l) => l.formaOrigem === "cartaoDebito")?.tPag).toBe("04")
    expect(h.linhas.find((l) => l.formaOrigem === "creditoVale")?.tPag).toBe("21")
  })

  it("split carne + dinheiro: carne bloqueado, dinheiro comprovado", () => {
    const h = buildFiscalPaymentHandoff({ dinheiro: 20, carne: 80 }, 100)
    expect(h.linhas.find((l) => l.formaOrigem === "dinheiro")?.tPag).toBe("01")
    expect(h.linhas.find((l) => l.formaOrigem === "carne")).toMatchObject({
      capability: "blocked",
      motivo: "carne_tpag_ambiguo",
    })
    expect(h.linhas.find((l) => l.formaOrigem === "carne")?.tPag).toBeUndefined()
  })
})

describe("buildFiscalPaymentHandoff · troco e formato", () => {
  it("sem cashTendered não persiste vTroco nem valorEntregue mesmo com dinheiro", () => {
    const h = buildFiscalPaymentHandoff({ dinheiro: 50 }, 50)
    expect("vTroco" in h).toBe(false)
    expect("valorEntregue" in h).toBe(false)
    expect("cashTendered" in h).toBe(false)
    expect(JSON.stringify(h)).not.toMatch(/vTroco|valorEntregue|valorRecebido/)
  })

  it("cashTendered exato (= aplicado) persiste evidência e não gera vTroco no handoff", () => {
    const h = buildFiscalPaymentHandoff({ dinheiro: 100 }, 100, { cashTendered: 100 })
    expect(h.cashTendered).toBe(100)
    expect(h.linhas.find((l) => l.formaOrigem === "dinheiro")?.valor).toBe(100)
    expect("vTroco" in h).toBe(false)
  })

  it("cashTendered acima do aplicado persiste evidência; linhas.valor continuam aplicadas", () => {
    const h = buildFiscalPaymentHandoff({ dinheiro: 60, pix: 40 }, 100, { cashTendered: 70 })
    expect(h.cashTendered).toBe(70)
    expect(h.linhas.find((l) => l.formaOrigem === "dinheiro")?.valor).toBe(60)
    expect(h.linhas.find((l) => l.formaOrigem === "pix")?.valor).toBe(40)
    expect("vTroco" in h).toBe(false)
  })

  it("cashTendered ausente não gera evidência", () => {
    const h = buildFiscalPaymentHandoff({ dinheiro: 50 }, 50, {})
    expect(h.cashTendered).toBeUndefined()
  })

  it("cashTendered menor que o aplicado não é evidência", () => {
    const h = buildFiscalPaymentHandoff({ dinheiro: 60 }, 60, { cashTendered: 50 })
    expect(h.cashTendered).toBeUndefined()
    expect("vTroco" in h).toBe(false)
  })

  it("cashTendered inválido (NaN/negativo) não é evidência", () => {
    expect(buildFiscalPaymentHandoff({ dinheiro: 50 }, 50, { cashTendered: Number.NaN }).cashTendered).toBeUndefined()
    expect(buildFiscalPaymentHandoff({ dinheiro: 50 }, 50, { cashTendered: -1 }).cashTendered).toBeUndefined()
    expect(buildFiscalPaymentHandoff({ dinheiro: 50 }, 50, { cashTendered: "70" }).cashTendered).toBeUndefined()
  })

  it("cashTendered é irrelevante quando não há dinheiro aplicado", () => {
    const h = buildFiscalPaymentHandoff({ pix: 50 }, 50, { cashTendered: 70 })
    expect(h.cashTendered).toBeUndefined()
  })

  it("hints.vTroco do cliente é ignorado", () => {
    const h = buildFiscalPaymentHandoff({ dinheiro: 50 }, 50, { cashTendered: 70, ...( { vTroco: 20 } as object ) })
    expect(h.cashTendered).toBe(70)
    expect("vTroco" in h).toBe(false)
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
