/**
 * Recibo consolidado do recebimento multitítulo — GOAL
 * `PDV-RECEBIMENTO-MULTITITULO-UI-G3-005`.
 *
 * Dois defeitos a fechar (achado G da auditoria de design): o cupom caía no literal
 * "Minha Loja" mesmo com identidade real disponível, e um pagamento único que baixava
 * N títulos não tinha documento — só sobrava imprimir N recibos individuais.
 */
import { describe, expect, it } from "vitest"
import {
  RECIBO_LOJA_NOME_FALLBACK,
  RECIBO_LOJA_NOME_PADRAO,
  buildReciboLoteInnerHtml,
  buildReciboPagamentoInnerHtml,
  resolveReciboLojaNome,
  type ReciboLotePayload,
} from "@/lib/contas-receber-recibo"

const BASE: ReciboLotePayload = {
  lojaNome: "Loja 1 - Rafacell Centro",
  cliente: "Ana Souza",
  dataPagamento: new Date("2026-09-04T14:36:00.000Z"),
  formaPagamento: "Dinheiro",
  itens: [
    { descricao: "OS #2291 — Troca de tela", valorRecebido: 89.9, saldoRestante: 0 },
    { descricao: "Crediário 1/4 — Venda #10432", valorRecebido: 64.5, saldoRestante: 0 },
    { descricao: "Crediário 3/4 — Venda #10432", valorRecebido: 20, saldoRestante: 23.48 },
  ],
  totalRecebido: 174.4,
  saldoDevedorAtual: 87.96,
}

describe("nome real da loja", () => {
  it("usa a primeira fonte real e ignora candidatos vazios", () => {
    expect(resolveReciboLojaNome("", "  ", "Loja 1 - Rafacell Centro")).toBe("Loja 1 - Rafacell Centro")
    expect(resolveReciboLojaNome("Prop do call site", "Cadastro da unidade")).toBe("Prop do call site")
  })

  it("sem NENHUMA fonte real, cai em rótulo neutro — nunca inventa nome comercial", () => {
    expect(resolveReciboLojaNome(null, undefined, "")).toBe(RECIBO_LOJA_NOME_FALLBACK)
    expect(RECIBO_LOJA_NOME_FALLBACK).not.toBe(RECIBO_LOJA_NOME_PADRAO)
  })

  it('havendo identidade real, o cupom NÃO imprime "Minha Loja"', () => {
    const html = buildReciboLoteInnerHtml({ ...BASE, lojaNome: resolveReciboLojaNome("", "Loja 1 - Rafacell Centro") })
    expect(html).toContain("Loja 1 - Rafacell Centro")
    expect(html).not.toContain(RECIBO_LOJA_NOME_PADRAO)
  })
})

describe("recibo consolidado", () => {
  const html = buildReciboLoteInnerHtml(BASE)

  it("é UM documento para os N títulos", () => {
    expect(html).toContain("3 títulos recebidos")
    // Um cabeçalho de cupom, não três.
    expect(html.match(/Recibo de recebimento/g)).toHaveLength(1)
  })

  it("traz loja, cliente, forma, data/hora e cada título com seu valor", () => {
    expect(html).toContain("Loja 1 - Rafacell Centro")
    expect(html).toContain("Ana Souza")
    expect(html).toContain("Dinheiro")
    expect(html).toMatch(/04\/09\/2026/)
    expect(html).toContain("OS #2291 — Troca de tela")
    expect(html).toContain("Crediário 1/4 — Venda #10432")
    expect(html).toContain("Crediário 3/4 — Venda #10432")
  })

  it("distingue título quitado de título só abatido", () => {
    expect(html).toContain("quitado")
    expect(html).toMatch(/abatido — resta[^<]*23,48/)
  })

  it("mostra total recebido e saldo devedor restante do cliente", () => {
    expect(html).toMatch(/Total recebido[\s\S]*174,40/)
    expect(html).toMatch(/SALDO DEVEDOR ATUAL:[^<]*87,96/)
  })

  it("escapa conteúdo vindo do cadastro (nome de cliente não injeta HTML)", () => {
    const html2 = buildReciboLoteInnerHtml({ ...BASE, cliente: '<img src=x onerror="alert(1)">' })
    expect(html2).not.toContain("<img")
    expect(html2).toContain("&lt;img")
  })

  it("um único título também rende um cupom coerente", () => {
    const html1 = buildReciboLoteInnerHtml({
      ...BASE,
      itens: [BASE.itens[0]!],
      totalRecebido: 89.9,
    })
    expect(html1).toContain("1 título recebido")
  })
})

describe("recibo singular preservado", () => {
  it("continua montando o cupom de um título só, com o mesmo contrato", () => {
    const html = buildReciboPagamentoInnerHtml({
      lojaNome: "Loja 1 - Rafacell Centro",
      cliente: "Ana Souza",
      descricaoTitulo: "OS #2291 — Troca de tela",
      valorPago: 89.9,
      dataPagamento: new Date("2026-09-04T14:36:00.000Z"),
      formaPagamento: "Dinheiro",
      saldoDevedorAtual: 172.46,
    })
    expect(html).toContain("Recibo de pagamento")
    expect(html).toContain("OS #2291 — Troca de tela")
    expect(html).toMatch(/SALDO DEVEDOR ATUAL:[^<]*172,46/)
    // O cupom singular NÃO virou uma lista de títulos.
    expect(html).not.toContain("títulos recebidos")
  })
})
