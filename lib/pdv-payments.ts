import type { PaymentMethod } from "@/components/dashboard/vendas/payment-modal"
import type { PaymentBreakdownFull } from "@/lib/operations-sale-types"

/**
 * Soma o dinheiro fisicamente informado pelo operador, ANTES de
 * `normalizePaymentsToMatchTotal` cortar o excedente ao total da venda.
 * Não é receita nem valor aplicado — é a evidência do entregue em espécie.
 */
export function sumCashTendered(payments: ReadonlyArray<{ type: string; value: number }>): number {
  return Math.round(payments.reduce((s, p) => (p.type === "dinheiro" ? s + p.value : s), 0) * 100) / 100
}

/**
 * Redução canônica `PaymentMethod[]` → `PaymentBreakdownFull`.
 *
 * Mesma lógica que estava duplicada inline em vários PDVs (clássico, supermercado,
 * assistência, venda-completa, black). Fonte única para convergir o fluxo de
 * pagamento sem reescrever os PDVs — adoção incremental.
 */
export function reducePaymentsToBreakdown(payments: PaymentMethod[]): PaymentBreakdownFull {
  const b: PaymentBreakdownFull = {
    dinheiro: 0,
    pix: 0,
    cartaoDebito: 0,
    cartaoCredito: 0,
    carne: 0,
    aPrazo: 0,
    creditoVale: 0,
  }
  for (const p of payments) {
    switch (p.type) {
      case "dinheiro": b.dinheiro += p.value; break
      case "pix": b.pix += p.value; break
      case "cartao_debito": b.cartaoDebito += p.value; break
      case "cartao_credito": b.cartaoCredito += p.value; break
      case "carne": b.carne += p.value; break
      case "a_prazo": b.aPrazo += p.value; break
      case "credito_vale": b.creditoVale += p.value; break
    }
  }
  return b
}
