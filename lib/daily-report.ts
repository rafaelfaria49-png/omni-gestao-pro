import type { DailyLedger } from "@/lib/operations-store"
import { APP_DISPLAY_NAME } from "@/lib/app-brand"

export function formatBrl(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value)
}

export function buildDailyClosingWhatsAppMessage(params: {
  empresaNome: string
  dataLabel: string
  ledger: DailyLedger
}): string {
  const { empresaNome, dataLabel, ledger } = params
  const deb = ledger.vendasCartaoDebito ?? 0
  return (
    `*${empresaNome} — Fechamento ${dataLabel}*\n\n` +
    `Total de vendas: ${formatBrl(ledger.totalVendas)}\n` +
    `• Dinheiro: ${formatBrl(ledger.vendasDinheiro)}\n` +
    `• Pix: ${formatBrl(ledger.vendasPix)}\n` +
    `• Cartão débito: ${formatBrl(deb)}\n` +
    `• Cartão crédito: ${formatBrl(ledger.vendasCartaoCredito)}\n` +
    `• Carnê: ${formatBrl(ledger.vendasCarne)}\n` +
    `• Crédito/Vale usado: ${formatBrl(ledger.vendasCreditoVale)}\n\n` +
    `O.S. abertas no dia: ${ledger.osAbertas}\n\n` +
    `_${APP_DISPLAY_NAME} — relatório automático_`
  )
}

export function digitsOnlyPhone(phone: string): string {
  return phone.replace(/\D/g, "")
}
