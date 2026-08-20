/**
 * GOAL 075 — Fiscal consome `fiscalPaymentHandoff` quando presente.
 *
 * Cobre: dinheiro/débito/crédito/creditoVale/split via handoff; PIX/carnê/aPrazo bloqueados;
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

  it("débito com tpIntegra 2", () => {
    const r = derivePagamentoFiscalFromHandoff(buildFiscalPaymentHandoff({ cartaoDebito: 25.5 }, 25.5), 25.5)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.pagamento.det[0]).toEqual({ formaInterna: "cartaoDebito", tPag: "04", vPag: 25.5, tpIntegra: "2" })
    expect(JSON.stringify(r.pagamento)).not.toMatch(/tBand|cAut|"tpIntegra":"1"/)
  })

  it("crédito com tpIntegra 2", () => {
    const r = derivePagamentoFiscalFromHandoff(buildFiscalPaymentHandoff({ cartaoCredito: 100 }, 100), 100)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.pagamento.det[0]).toEqual({ formaInterna: "cartaoCredito", tPag: "03", vPag: 100, tpIntegra: "2" })
  })

  it("split dinheiro + débito + crédito", () => {
    const r = derivePagamentoFiscalFromHandoff(
      buildFiscalPaymentHandoff({ dinheiro: 10, cartaoDebito: 30, cartaoCredito: 60 }, 100),
      100,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.pagamento.det.map((d) => d.tPag)).toEqual(["01", "03", "04"])
    expect(r.pagamento.det.find((d) => d.tPag === "03")).toMatchObject({ tpIntegra: "2" })
    expect(r.pagamento.det.find((d) => d.tPag === "04")).toMatchObject({ tpIntegra: "2" })
    expect(r.pagamento.det.find((d) => d.tPag === "01")?.tpIntegra).toBeUndefined()
    expect(r.pagamento.soma).toBe(100)
    expect(r.pagamento.vTroco).toBeNull()
  })

  it("creditoVale → tPag 21", () => {
    const r = derivePagamentoFiscalFromHandoff(buildFiscalPaymentHandoff({ creditoVale: 40 }, 40), 40)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.pagamento.fonte).toBe("venda.payload.fiscalPaymentHandoff")
    expect(r.pagamento.det).toEqual([{ formaInterna: "creditoVale", tPag: "21", vPag: 40 }])
    expect(JSON.stringify(r.pagamento)).not.toMatch(/"12"|"19"|"99"/)
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

  it("creditoVale legado no handoff (capability blocked, sem tPag) permanece fail-closed", () => {
    const r = derivePagamentoFiscalFromHandoff(
      {
        version: 1,
        catalogoTPag: "IT-2024.002-v1.11",
        linhas: [
          {
            formaOrigem: "creditoVale",
            valor: 40,
            capability: "blocked",
            status: "blocked",
            motivo: "credito_vale_tpag_ambiguo",
          },
        ],
      },
      40,
    )
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

describe("derivePagamentoFiscalFromHandoff · pixQrKind (GOAL 077)", () => {
  it.each([
    ["dinamico", "17"],
    ["estatico", "20"],
    ["automatico", "23"],
  ] as const)("PIX %s → tPag %s", (kind, tPag) => {
    const r = derivePagamentoFiscalFromHandoff(buildFiscalPaymentHandoff({ pix: 80 }, 80, { pixQrKind: kind }), 80)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.pagamento.fonte).toBe("venda.payload.fiscalPaymentHandoff")
    expect(r.pagamento.det).toEqual([
      kind === "dinamico"
        ? { formaInterna: "pix", tPag, vPag: 80, tpIntegra: "2" }
        : { formaInterna: "pix", tPag, vPag: 80 },
    ])
    expect(JSON.stringify(r.pagamento)).not.toMatch(/tBand|cAut|"01"|"99"/)
    if (kind === "dinamico") {
      expect(r.pagamento.det[0]!.tpIntegra).toBe("2")
    } else {
      expect(r.pagamento.det[0]!.tpIntegra).toBeUndefined()
    }
  })

  it("split PIX estático + dinheiro", () => {
    const r = derivePagamentoFiscalFromHandoff(
      buildFiscalPaymentHandoff({ dinheiro: 20, pix: 80 }, 100, { pixQrKind: "estatico" }),
      100,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.pagamento.det.map((d) => d.tPag)).toEqual(["01", "20"])
  })

  it("split PIX dinâmico + dinheiro: 17 com tpIntegra 2; 01 sem", () => {
    const r = derivePagamentoFiscalFromHandoff(
      buildFiscalPaymentHandoff({ dinheiro: 20, pix: 80 }, 100, { pixQrKind: "dinamico" }),
      100,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.pagamento.det.find((d) => d.tPag === "17")).toMatchObject({ tpIntegra: "2" })
    expect(r.pagamento.det.find((d) => d.tPag === "01")?.tpIntegra).toBeUndefined()
  })

  it("split PIX dinâmico + crédito", () => {
    const r = derivePagamentoFiscalFromHandoff(
      buildFiscalPaymentHandoff({ pix: 40, cartaoCredito: 60 }, 100, { pixQrKind: "dinamico" }),
      100,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.pagamento.det.map((d) => d.tPag)).toEqual(["03", "17"])
    expect(r.pagamento.det.find((d) => d.tPag === "03")).toMatchObject({ tpIntegra: "2" })
    expect(r.pagamento.det.find((d) => d.tPag === "17")).toMatchObject({ tpIntegra: "2" })
  })

  it("split creditoVale + dinheiro", () => {
    const r = derivePagamentoFiscalFromHandoff(buildFiscalPaymentHandoff({ dinheiro: 60, creditoVale: 40 }, 100), 100)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.pagamento.det.map((d) => d.tPag)).toEqual(["01", "21"])
  })

  it("split creditoVale + PIX estático", () => {
    const r = derivePagamentoFiscalFromHandoff(
      buildFiscalPaymentHandoff({ pix: 30, creditoVale: 70 }, 100, { pixQrKind: "estatico" }),
      100,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.pagamento.det.map((d) => d.tPag)).toEqual(["20", "21"])
  })

  it("split creditoVale + cartão", () => {
    const r = derivePagamentoFiscalFromHandoff(
      buildFiscalPaymentHandoff({ cartaoCredito: 25, creditoVale: 25 }, 50),
      50,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.pagamento.det.map((d) => d.tPag)).toEqual(["03", "21"])
    expect(r.pagamento.det.find((d) => d.tPag === "03")).toMatchObject({ tpIntegra: "2" })
    expect(r.pagamento.det.find((d) => d.tPag === "21")?.tpIntegra).toBeUndefined()
  })

  it("tPag 19 injetado em creditoVale é rejeitado (esperado 21)", () => {
    const r = derivePagamentoFiscalFromHandoff(
      {
        version: 1,
        catalogoTPag: "IT-2024.002-v1.11",
        linhas: [{ formaOrigem: "creditoVale", valor: 40, tPag: "19", capability: "supported", status: "ok" }],
      },
      40,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erro.code).toBe("PAGAMENTO_HANDOFF_INVALIDO")
  })

  it("tPag 12 injetado em creditoVale é rejeitado", () => {
    const r = derivePagamentoFiscalFromHandoff(
      {
        version: 1,
        catalogoTPag: "IT-2024.002-v1.11",
        linhas: [{ formaOrigem: "creditoVale", valor: 40, tPag: "12", capability: "supported", status: "ok" }],
      },
      40,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erro.code).toBe("PAGAMENTO_HANDOFF_INVALIDO")
  })

  it("tPag 17 injetado no handoff sem pixQrKind continua rejeitado", () => {
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

  it("pixQrKind e tPag divergentes são rejeitados", () => {
    const r = derivePagamentoFiscalFromHandoff(
      {
        version: 1,
        catalogoTPag: "IT-2024.002-v1.11",
        linhas: [
          {
            formaOrigem: "pix",
            valor: 50,
            pixQrKind: "estatico",
            tPag: "17",
            capability: "supported",
            status: "ok",
          },
        ],
      },
      50,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erro.code).toBe("PAGAMENTO_HANDOFF_INVALIDO")
  })
})

describe("derivePagamentoFiscalFromHandoff · cashTendered / vTroco (GOAL 083)", () => {
  it("dinheiro exato: vPag = aplicado, vTroco null", () => {
    const r = derivePagamentoFiscalFromHandoff(
      buildFiscalPaymentHandoff({ dinheiro: 100 }, 100, { cashTendered: 100 }),
      100,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.pagamento.det).toEqual([{ formaInterna: "dinheiro", tPag: "01", vPag: 100 }])
    expect(r.pagamento.soma).toBe(100)
    expect(r.pagamento.vTroco).toBeNull()
  })

  it("dinheiro acima do total: vPag = entregue, vTroco = diferença, Σ − vTroco = vNF", () => {
    const r = derivePagamentoFiscalFromHandoff(
      buildFiscalPaymentHandoff({ dinheiro: 100 }, 100, { cashTendered: 150 }),
      100,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.pagamento.det).toEqual([{ formaInterna: "dinheiro", tPag: "01", vPag: 150 }])
    expect(r.pagamento.soma).toBe(150)
    expect(r.pagamento.vTroco).toBe(50)
    expect(r.pagamento.soma - r.pagamento.vTroco!).toBe(100)
  })

  it("split dinheiro + PIX com troco (total 100, PIX 40, aplicado 60, entregue 70)", () => {
    const r = derivePagamentoFiscalFromHandoff(
      buildFiscalPaymentHandoff({ dinheiro: 60, pix: 40 }, 100, { pixQrKind: "estatico", cashTendered: 70 }),
      100,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.pagamento.det).toEqual([
      { formaInterna: "dinheiro", tPag: "01", vPag: 70 },
      { formaInterna: "pix", tPag: "20", vPag: 40 },
    ])
    expect(r.pagamento.soma).toBe(110)
    expect(r.pagamento.vTroco).toBe(10)
    expect(r.pagamento.soma - r.pagamento.vTroco!).toBe(100)
  })

  it("split dinheiro + cartão com troco", () => {
    const r = derivePagamentoFiscalFromHandoff(
      buildFiscalPaymentHandoff({ dinheiro: 60, cartaoCredito: 40 }, 100, { cashTendered: 70 }),
      100,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.pagamento.det.map((d) => [d.tPag, d.vPag, d.tpIntegra ?? null])).toEqual([
      ["01", 70, null],
      ["03", 40, "2"],
    ])
    expect(r.pagamento.vTroco).toBe(10)
    expect(r.pagamento.soma - 10).toBe(100)
  })

  it("cashTendered ausente não gera troco", () => {
    const r = derivePagamentoFiscalFromHandoff(buildFiscalPaymentHandoff({ dinheiro: 50 }, 50), 50)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.pagamento.vTroco).toBeNull()
    expect(r.pagamento.det[0]?.vPag).toBe(50)
  })

  it("cashTendered menor que o aplicado no handoff persistido é fail-closed", () => {
    const r = derivePagamentoFiscalFromHandoff(
      {
        version: 1,
        catalogoTPag: "IT-2024.002-v1.11",
        linhas: [{ formaOrigem: "dinheiro", valor: 60, tPag: "01", capability: "supported", status: "ok" }],
        cashTendered: 50,
      },
      60,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.erro.code).toBe("PAGAMENTO_VALOR_INVALIDO")
      expect(r.erro.mensagem).not.toMatch(/tPag=01 de fallback/i)
    }
  })

  it("cashTendered inválido no handoff é fail-closed", () => {
    const r = derivePagamentoFiscalFromHandoff(
      {
        version: 1,
        catalogoTPag: "IT-2024.002-v1.11",
        linhas: [{ formaOrigem: "dinheiro", valor: 50, tPag: "01", capability: "supported", status: "ok" }],
        cashTendered: -1,
      },
      50,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erro.code).toBe("PAGAMENTO_VALOR_INVALIDO")
  })

  it("vTroco injetado pelo cliente no handoff é ignorado — só cashTendered deriva", () => {
    const r = derivePagamentoFiscalFromHandoff(
      {
        version: 1,
        catalogoTPag: "IT-2024.002-v1.11",
        linhas: [{ formaOrigem: "dinheiro", valor: 100, tPag: "01", capability: "supported", status: "ok" }],
        cashTendered: 120,
        vTroco: 99,
      },
      100,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.pagamento.vTroco).toBe(20)
    expect(r.pagamento.det[0]?.vPag).toBe(120)
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

  it("aPrazo com tPag 91 inventado é rejeitado", () => {
    const r = derivePagamentoFiscalFromHandoff(
      {
        version: 1,
        catalogoTPag: "IT-2024.002-v1.11",
        linhas: [{ formaOrigem: "aPrazo", valor: 50, tPag: "91", capability: "supported", status: "ok" }],
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

describe("derivePagamentoFiscalFromHandoff · cartão YA04 (GOAL 087)", () => {
  const base = { version: 1 as const, catalogoTPag: "IT-2024.002-v1.11" as const }

  it("handoff 03/04 sem tpIntegra fail-closed", () => {
    const r = derivePagamentoFiscalFromHandoff(
      {
        ...base,
        linhas: [{ formaOrigem: "cartaoCredito", valor: 50, tPag: "03", capability: "supported", status: "ok" }],
      },
      50,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erro.code).toBe("PAGAMENTO_CARTAO_TPINTEGRA_AUSENTE")
  })

  it("tpIntegra inválido fail-closed", () => {
    const r = derivePagamentoFiscalFromHandoff(
      {
        ...base,
        linhas: [
          {
            formaOrigem: "cartaoDebito",
            valor: 50,
            tPag: "04",
            tpIntegra: "3",
            capability: "supported",
            status: "ok",
          },
        ],
      },
      50,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erro.code).toBe("PAGAMENTO_CARTAO_TPINTEGRA_INVALIDO")
  })

  it("tpIntegra=1 sem capacidade TEF fail-closed", () => {
    const r = derivePagamentoFiscalFromHandoff(
      {
        ...base,
        linhas: [
          {
            formaOrigem: "cartaoCredito",
            valor: 50,
            tPag: "03",
            tpIntegra: "1",
            capability: "supported",
            status: "ok",
          },
        ],
      },
      50,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.erro.code).toBe("PAGAMENTO_CARTAO_INTEGRADO_NAO_SUPORTADO")
      expect(r.erro.mensagem).not.toMatch(/tPag=01|"01"|"99"/)
    }
  })

  it("CNPJ / tBand / cAut / NSU no handoff fail-closed — não emite", () => {
    for (const extra of [{ CNPJ: "11222333000181" }, { tBand: "01" }, { cAut: "XYZ" }, { NSU: "1" }]) {
      const r = derivePagamentoFiscalFromHandoff(
        {
          ...base,
          linhas: [
            {
              formaOrigem: "cartaoCredito",
              valor: 50,
              tPag: "03",
              tpIntegra: "2",
              capability: "supported",
              status: "ok",
              ...extra,
            },
          ],
        },
        50,
      )
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.erro.code).toBe("PAGAMENTO_CARTAO_DADOS_NAO_SUPORTADOS")
    }
  })

  it("PIX 17 novo com tpIntegra=2 é válido — não é analogia de cartão", () => {
    const r = derivePagamentoFiscalFromHandoff(
      {
        ...base,
        linhas: [
          {
            formaOrigem: "pix",
            valor: 50,
            pixQrKind: "dinamico",
            tPag: "17",
            tpIntegra: "2",
            capability: "supported",
            status: "ok",
          },
        ],
      },
      50,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.pagamento.det[0]).toEqual({ formaInterna: "pix", tPag: "17", vPag: 50, tpIntegra: "2" })
  })

  it("handoff histórico tPag 17 sem tpIntegra fail-closed — não presume 2", () => {
    const r = derivePagamentoFiscalFromHandoff(
      {
        ...base,
        linhas: [
          {
            formaOrigem: "pix",
            valor: 50,
            pixQrKind: "dinamico",
            tPag: "17",
            capability: "supported",
            status: "ok",
          },
        ],
      },
      50,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erro.code).toBe("PAGAMENTO_PIX_TPINTEGRA_AUSENTE")
  })

  it("PIX dinâmico tpIntegra=1 fail-closed — sem fabricar PSP", () => {
    const r = derivePagamentoFiscalFromHandoff(
      {
        ...base,
        linhas: [
          {
            formaOrigem: "pix",
            valor: 50,
            pixQrKind: "dinamico",
            tPag: "17",
            tpIntegra: "1",
            capability: "supported",
            status: "ok",
          },
        ],
      },
      50,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erro.code).toBe("PAGAMENTO_PIX_INTEGRADO_NAO_SUPORTADO")
  })

  it("PIX dinâmico tpIntegra inválido fail-closed", () => {
    const r = derivePagamentoFiscalFromHandoff(
      {
        ...base,
        linhas: [
          {
            formaOrigem: "pix",
            valor: 50,
            pixQrKind: "dinamico",
            tPag: "17",
            tpIntegra: "3",
            capability: "supported",
            status: "ok",
          },
        ],
      },
      50,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erro.code).toBe("PAGAMENTO_PIX_TPINTEGRA_INVALIDO")
  })

  it("PIX estático 20 e automático 23 rejeitam tpIntegra (sem card)", () => {
    for (const kind of ["estatico", "automatico"] as const) {
      const tPag = kind === "estatico" ? "20" : "23"
      const r = derivePagamentoFiscalFromHandoff(
        {
          ...base,
          linhas: [
            {
              formaOrigem: "pix",
              valor: 50,
              pixQrKind: kind,
              tPag,
              tpIntegra: "2",
              capability: "supported",
              status: "ok",
            },
          ],
        },
        50,
      )
      expect(r.ok, kind).toBe(false)
      if (!r.ok) expect(r.erro.code).toBe("PAGAMENTO_CARTAO_DADOS_NAO_SUPORTADOS")
    }
  })
})

describe("derivePagamentoFiscal · venda histórica sem handoff", () => {
  it("PIX legado sem evidência de subtipo é bloqueado (não infere 17)", () => {
    const r = derivePagamentoFiscal({ pix: 80 }, 80)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.erro.code).toBe("PAGAMENTO_PIX_LEGADO_SEM_EVIDENCIA")
      expect(r.erro.mensagem).not.toMatch(/tPag=01|"01"|"99"/)
    }
  })

  it("handoff undefined (não null object) usa o breakdown", () => {
    const r = derivePagamentoFiscal({ dinheiro: 10 }, 10, undefined)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.pagamento.fonte).toBe("venda.payload.paymentBreakdown")
  })

  it("venda histórica sem handoff + creditoVale permanece fail-closed", () => {
    const r = derivePagamentoFiscal({ creditoVale: 40 }, 40)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.erro.code).toBe("PAGAMENTO_FORMA_SEM_CAPACIDADE_FISCAL")
      expect(r.erro.mensagem).not.toMatch(/tPag=01|"01"|"99"/)
    }
  })

  it("venda histórica sem handoff + cartão 03/04 não presume POS simples", () => {
    const credito = derivePagamentoFiscal({ cartaoCredito: 50 }, 50)
    const debito = derivePagamentoFiscal({ cartaoDebito: 50 }, 50)
    expect(credito.ok).toBe(false)
    expect(debito.ok).toBe(false)
    if (!credito.ok) expect(credito.erro.code).toBe("PAGAMENTO_CARTAO_LEGADO_SEM_EVIDENCIA")
    if (!debito.ok) expect(debito.erro.code).toBe("PAGAMENTO_CARTAO_LEGADO_SEM_EVIDENCIA")
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
