import type { DailyLedger } from "@/lib/operations-store"
import { buildDailyClosingWhatsAppMessage, digitsOnlyPhone } from "@/lib/daily-report"
import { prisma } from "@/lib/prisma"
import { sendWhatsAppText } from "@/lib/whatsapp-send"

function todayStr(): string {
  return new Date().toISOString().split("T")[0]
}

function normalizeLedgerPayload(raw: unknown, date: string): DailyLedger {
  const o = raw as Record<string, unknown>
  const legacy = typeof o.vendasCartao === "number" ? o.vendasCartao : 0
  return {
    date: typeof o.date === "string" ? o.date.slice(0, 10) : date,
    vendasDinheiro: Number(o.vendasDinheiro) || 0,
    vendasPix: Number(o.vendasPix) || 0,
    vendasCartaoDebito: (Number(o.vendasCartaoDebito) || 0) + legacy,
    vendasCartaoCredito: Number(o.vendasCartaoCredito) || 0,
    vendasCarne: Number(o.vendasCarne) || 0,
    vendasCreditoVale: Number(o.vendasCreditoVale) || 0,
    totalVendas: Number(o.totalVendas) || 0,
    osAbertas: Number(o.osAbertas) || 0,
  }
}

export async function sendDailyClosingToPhone(params: {
  phoneDigits: string
  empresaNome: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const date = todayStr()
  const snap = await prisma.ledgerSnapshot.findUnique({ where: { date } })
  let ledger: DailyLedger
  if (snap?.payload) {
    try {
      ledger = normalizeLedgerPayload(JSON.parse(snap.payload), date)
    } catch {
      ledger = {
        date,
        vendasDinheiro: 0,
        vendasPix: 0,
        vendasCartaoDebito: 0,
        vendasCartaoCredito: 0,
        vendasCarne: 0,
        vendasCreditoVale: 0,
        totalVendas: 0,
        osAbertas: 0,
      }
    }
  } else {
    ledger = {
      date,
      vendasDinheiro: 0,
      vendasPix: 0,
      vendasCartaoDebito: 0,
      vendasCartaoCredito: 0,
      vendasCarne: 0,
      vendasCreditoVale: 0,
      totalVendas: 0,
      osAbertas: 0,
    }
  }

  const dataLabel = new Date().toLocaleDateString("pt-BR")
  const msg = buildDailyClosingWhatsAppMessage({
    empresaNome: params.empresaNome,
    dataLabel,
    ledger,
  })

  const digits = digitsOnlyPhone(params.phoneDigits)
  return sendWhatsAppText(digits, msg)
}
