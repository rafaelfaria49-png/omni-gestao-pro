/**
 * GOAL 075 — Fiscal consome `fiscalPaymentHandoff` quando presente.
 *
 * Cobre: dinheiro/débito/crédito/split via handoff; PIX/carnê/aPrazo/vale bloqueados;
 * forma desconhecida; handoff inconsistente sem fallback; venda histórica sem handoff;
 * zero tPag=01 de fallback; zero consulta a módulos vivos.
 */
import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import { buildFiscalPaymentHandoff } from "@/lib/vendas/fiscal-payment-handoff"
import {
  derivePagamentoFiscal,
  derivePagamentoFiscalFromHandoff,
  PAGAMENTO_FISCAL_CONTRATO_VERSAO,
} from "./index"

describe("derivePagamentoFiscalFromHandoff · formas suportadas", () => {
  it("dinheiro", () => {
    const h = buildFiscalPaymentHandoff({ dinheiro: 50 }, 50)
    const r = derivePagamentoFiscalFromHandoff(h, 50)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.pagamento.fonte).toBe("venda.payload.fiscalPaymentHandoff")
    expect(r.pagamento.versao).toBe(PAGAMENTO_FISCAL_CONTRATO_VERSAO)
    expect(r.pagamento.det).toEqual([{ formaInterna: "dinheiro", tPag: "01", vPag: 50 }])
    expect(r.pagamento.vTroco).toBeNull()
  })

  it("débito sem grupo card", () => {
    const r = derivePagamentoFiscalFromHandoff(buildFiscalPaymentHandoff({ cartaoDebito: 25.5 }, 25.5), 25.5)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.pagamento.det[0]).toEqual({ formaInterna: "cartaoDebito", tPag: "04", vPag: 25.5 })
    expect(JSON.stringify(r.pagamento)).not.toMatch(/tpIntegra|tBand|cAut/)
  })

  it("crédito", () => {
    const r = derivePagamentoFiscalFromHandoff(buildFiscalPaymentHandoff({ cartaoCredito: 100 }, 100), 100)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.pagamento.det[0]).toEqual({ formaInterna: "cartaoCredito", tPag: "03", vPag: 100 })
  })

  it("split dinheiro + débito + crédito", () => {
    const r = derivePagamentoFiscalFromHandoff(
      buildFiscalPaymentHandoff({ dinheiro: 10, cartaoDebito: 30, cartaoCredito: 60 }, 100),
      100,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.pagamento.det.map((d) => d.tPag)).toEqual(["01", "03", "04"])
    expect(r.pagamento.soma).toBe(100)
  })
})

describe("derivePagamentoFiscalFromHandoff · bloqueios explícitos", () => {
  it("PIX genérico não infere tPag 17", () => {
    const r = derivePagamentoFiscalFromHandoff(buildFiscalPaymentHandoff({ pix: 80 }, 80), 80)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.erro.code).toBe("PAGAMENTO_FORMA_SEM_CAPACIDADE_FISCAL")
    expect(r.erro.mensagem).not.toMatch(/tPag=01|dinheiro/i)
  })

  it("carne", () => {
    const r = derivePagamentoFiscalFromHandoff(buildFiscalPaymentHandoff({ carne: 50 }, 50), 50)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erro.code).toBe("PAGAMENTO_FORMA_SEM_CAPACIDADE_FISCAL")
  })

  it("aPrazo", () => {
    const r = derivePagamentoFiscalFromHandoff(buildFiscalPaymentHandoff({ aPrazo: 50 }, 50), 50)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erro.code).toBe("PAGAMENTO_FORMA_SEM_CAPACIDADE_FISCAL")
  })

  it("creditoVale", () => {
    const r = derivePagamentoFiscalFromHandoff(buildFiscalPaymentHandoff({ creditoVale: 40 }, 40), 40)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erro.code).toBe("PAGAMENTO_FORMA_SEM_CAPACIDADE_FISCAL")
  })

  it("forma desconhecida", () => {
    const r = derivePagamentoFiscalFromHandoff(buildFiscalPaymentHandoff({ cripto: 50 }, 50), 50)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.erro.code).toBe("PAGAMENTO_FORMA_DESCONHECIDA")
      expect(r.erro.mensagem).not.toMatch(/99|outros/i)
    }
  })

  it("split dinheiro + PIX → bloqueia o conjunto (não emite só o dinheiro)", () => {
    const r = derivePagamentoFiscalFromHandoff(buildFiscalPaymentHandoff({ dinheiro: 20, pix: 80 }, 100), 100)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erro.code).toBe("PAGAMENTO_FORMA_SEM_CAPACIDADE_FISCAL")
  })
})

describe("derivePagamentoFiscalFromHandoff · inconsistente sem fallback", () => {
  it("versão desconhecida não cai para breakdown dinheiro", () => {
    const r = derivePagamentoFiscal({ dinheiro: 50 }, 50, { version: 99, linhas: [{ formaOrigem: "dinheiro", valor: 50, tPag: "01", capability: "supported", status: "ok" }] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erro.code).toBe("PAGAMENTO_HANDOFF_VERSAO_DESCONHECIDA")
  })

  it("dinheiro com tPag de PIX é rejeitado", () => {
    const r = derivePagamentoFiscalFromHandoff(
      {
        version: 1,
        catalogoTPag: "IT-2024.002-v1.11",
        linhas: [{ formaOrigem: "dinheiro", valor: 50, tPag: "17", capability: "supported", status: "ok" }],
      },
      50,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erro.code).toBe("PAGAMENTO_HANDOFF_INVALIDO")
  })

  it("PIX com tPag 17 inventado é rejeitado (não comprovado)", () => {
    const r = derivePagamentoFiscalFromHandoff(
      {
        version: 1,
        catalogoTPag: "IT-2024.002-v1.11",
        linhas: [{ formaOrigem: "pix", valor: 50, tPag: "17", capability: "supported", status: "ok" }],
      },
      50,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erro.code).toBe("PAGAMENTO_HANDOFF_INVALIDO")
  })

  it("carne com tPag 05 inventado é rejeitado", () => {
    const r = derivePagamentoFiscalFromHandoff(
      {
        version: 1,
        catalogoTPag: "IT-2024.002-v1.11",
        linhas: [{ formaOrigem: "carne", valor: 50, tPag: "05", capability: "supported", status: "ok" }],
      },
      50,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erro.code).toBe("PAGAMENTO_HANDOFF_INVALIDO")
  })

  it("handoff presente e breakdown dinheiro válido → não usa o breakdown", () => {
    const r = derivePagamentoFiscal({ dinheiro: 50 }, 50, { version: 2, linhas: [] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erro.code).toBe("PAGAMENTO_HANDOFF_VERSAO_DESCONHECIDA")
  })

  it("soma divergente no handoff", () => {
    const r = derivePagamentoFiscalFromHandoff(buildFiscalPaymentHandoff({ dinheiro: 40 }, 40), 50)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erro.code).toBe("PAGAMENTO_SOMA_DIVERGENTE")
  })
})

describe("derivePagamentoFiscal · venda histórica sem handoff", () => {
  it("preserva o legado fail-closed (PIX → 17)", () => {
    const r = derivePagamentoFiscal({ pix: 80 }, 80)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.pagamento.fonte).toBe("venda.payload.paymentBreakdown")
    expect(r.pagamento.det).toEqual([{ formaInterna: "pix", tPag: "17", vPag: 80 }])
  })

  it("handoff undefined (não null object) usa o breakdown", () => {
    const r = derivePagamentoFiscal({ dinheiro: 10 }, 10, undefined)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.pagamento.fonte).toBe("venda.payload.paymentBreakdown")
  })

  it("nunca cai para tPag=01 quando o handoff bloqueia PIX", () => {
    const r = derivePagamentoFiscal({ pix: 50 }, 50, buildFiscalPaymentHandoff({ pix: 50 }, 50))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.erro.code).toBe("PAGAMENTO_FORMA_SEM_CAPACIDADE_FISCAL")
      expect(r.erro.mensagem).not.toMatch(/tPag=01|"01"/)
    }
  })
})

describe("fronteira — zero Caixa/Financeiro/PDV vivo / SEFAZ", () => {
  it("from-handoff e demais sources de payment/** não consultam módulos vivos", () => {
    const dir = resolve(process.cwd(), "lib/fiscal/payment")
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    expect(files).toContain("from-handoff.ts")
    for (const file of files) {
      const src = readFileSync(resolve(dir, file), "utf8")
      expect(src).not.toMatch(/from ["']@\/lib\/prisma/)
      expect(src).not.toMatch(/from ["']@\/lib\/caixa/)
      expect(src).not.toMatch(/from ["']@\/lib\/financeiro/)
      expect(src).not.toMatch(/from ["']@\/lib\/ops-upsert-venda/)
      expect(src).not.toMatch(/finalizeSaleTransaction/)
      expect(src).not.toMatch(/from ["'].*payment-modal/)
      expect(src).not.toMatch(/from ["'].*sefaz/i)
    }
  })
})
