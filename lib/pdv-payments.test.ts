/**
 * GOAL 083 — dinheiro entregue (cashTendered) vs dinheiro aplicado.
 *
 * O operador informa o valor físico; normalizePaymentsToMatchTotal corta o
 * excedente para o total comercial. A evidência fiscal é a soma original.
 */
import { describe, expect, it } from "vitest"
import { normalizePaymentsToMatchTotal, type PaymentMethod } from "@/components/dashboard/vendas/payment-modal"
import { reducePaymentsToBreakdown, sumCashTendered } from "./pdv-payments"

function pay(type: PaymentMethod["type"], value: number, id = type): PaymentMethod {
  return { id, type, value }
}

describe("sumCashTendered × normalizePaymentsToMatchTotal", () => {
  it("dinheiro exato: entregue = aplicado, sem troco visual", () => {
    const payments = [pay("dinheiro", 100)]
    expect(sumCashTendered(payments)).toBe(100)
    const normalized = normalizePaymentsToMatchTotal(payments, 100)
    expect(reducePaymentsToBreakdown(normalized).dinheiro).toBe(100)
    expect(sumCashTendered(normalized)).toBe(100)
  })

  it("dinheiro acima do total: entregue preservado, aplicado cortado", () => {
    const payments = [pay("dinheiro", 150)]
    expect(sumCashTendered(payments)).toBe(150)
    const normalized = normalizePaymentsToMatchTotal(payments, 100)
    expect(reducePaymentsToBreakdown(normalized).dinheiro).toBe(100)
    expect(sumCashTendered(payments)).toBe(150)
  })

  it("split PIX + dinheiro com troco: PIX intacto, dinheiro cortado, entregue = 70", () => {
    const payments = [pay("pix", 40), pay("dinheiro", 70)]
    expect(sumCashTendered(payments)).toBe(70)
    const normalized = normalizePaymentsToMatchTotal(payments, 100)
    const pb = reducePaymentsToBreakdown(normalized)
    expect(pb.pix).toBe(40)
    expect(pb.dinheiro).toBe(60)
    expect(pb.pix + pb.dinheiro).toBe(100)
    expect(sumCashTendered(payments) - pb.dinheiro).toBe(10)
  })

  it("split cartão + dinheiro com troco", () => {
    const payments = [pay("cartao_credito", 40), pay("dinheiro", 70)]
    const normalized = normalizePaymentsToMatchTotal(payments, 100)
    const pb = reducePaymentsToBreakdown(normalized)
    expect(pb.cartaoCredito).toBe(40)
    expect(pb.dinheiro).toBe(60)
    expect(sumCashTendered(payments)).toBe(70)
  })

  it("sem dinheiro: soma 0 — não há evidência de espécie", () => {
    expect(sumCashTendered([pay("pix", 100)])).toBe(0)
  })
})
