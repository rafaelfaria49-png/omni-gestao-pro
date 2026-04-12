import type { OrdemServico } from "@/components/dashboard/os/ordens-servico"
import type { InventoryItem, PaymentBreakdownFull, SaleRecord } from "@/lib/operations-store"
import { APP_DISPLAY_NAME } from "@/lib/app-brand"

export type ContadorMovimento = {
  data: string
  tipo: "Venda" | "OS"
  valorTotal: number
  custoPeca: number
  formaPagamento: string
  referencia: string
}

function dateInMonthFromIso(iso: string, year: number, month: number): boolean {
  const d = new Date(iso)
  return d.getFullYear() === year && d.getMonth() + 1 === month
}

function dateStrInMonth(dateStr: string, year: number, month: number): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  if (!m) return false
  return parseInt(m[1], 10) === year && parseInt(m[2], 10) === month
}

export function saleInventoryCost(sale: SaleRecord, inventory: InventoryItem[]): number {
  let sum = 0
  for (const ln of sale.lines) {
    const inv = inventory.find((i) => i.id === ln.inventoryId)
    const cost = inv?.cost ?? 0
    const qty = Math.max(0, ln.quantity - (ln.qtyReturned ?? 0))
    sum += cost * qty
  }
  return Math.round(sum * 100) / 100
}

export function formatPaymentBreakdown(pb: PaymentBreakdownFull): string {
  const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
  const parts: string[] = []
  if (pb.dinheiro > 0) parts.push(`Dinheiro ${brl.format(pb.dinheiro)}`)
  if (pb.pix > 0) parts.push(`Pix ${brl.format(pb.pix)}`)
  if (pb.cartaoDebito > 0) parts.push(`Cartão débito ${brl.format(pb.cartaoDebito)}`)
  if (pb.cartaoCredito > 0) parts.push(`Cartão crédito ${brl.format(pb.cartaoCredito)}`)
  if (pb.carne > 0) parts.push(`Carnê ${brl.format(pb.carne)}`)
  if (pb.creditoVale > 0) parts.push(`Crédito/vale ${brl.format(pb.creditoVale)}`)
  return parts.length ? parts.join("; ") : "—"
}

/**
 * Vendas do PDV no mês + OS finalizadas no mês que não foram “cobertas” por uma venda no mesmo dia e valor
 * (evita duplicar quando a OS foi quitada pelo PDV).
 */
export function buildMovimentosMes(
  sales: SaleRecord[],
  ordens: OrdemServico[],
  inventory: InventoryItem[],
  year: number,
  month: number
): ContadorMovimento[] {
  const monthSales = sales.filter((s) => dateInMonthFromIso(s.at, year, month))
  const osMonth = ordens.filter(
    (o) =>
      o.status === "finalizado" &&
      o.dataSaida != null &&
      dateStrInMonth(o.dataSaida, year, month)
  )

  const coveredOsIds = new Set<string>()
  for (const s of monthSales) {
    const saleDate = s.at.slice(0, 10)
    const matchOs = osMonth.find(
      (o) =>
        Math.abs(o.valorServico + o.valorPecas - s.total) < 0.02 && o.dataSaida === saleDate
    )
    if (matchOs) coveredOsIds.add(matchOs.id)
  }

  const movs: ContadorMovimento[] = []

  for (const s of monthSales) {
    const saleDate = s.at.slice(0, 10)
    movs.push({
      data: saleDate,
      tipo: "Venda",
      valorTotal: s.total,
      custoPeca: saleInventoryCost(s, inventory),
      formaPagamento: formatPaymentBreakdown(s.paymentBreakdown),
      referencia: s.id,
    })
  }

  for (const o of osMonth) {
    if (coveredOsIds.has(o.id)) continue
    const total = o.valorServico + o.valorPecas
    movs.push({
      data: o.dataSaida!,
      tipo: "OS",
      valorTotal: total,
      custoPeca: o.valorPecas,
      formaPagamento: "Não registrado no PDV",
      referencia: o.numero,
    })
  }

  movs.sort((a, b) => {
    const c = a.data.localeCompare(b.data)
    return c !== 0 ? c : a.referencia.localeCompare(b.referencia)
  })
  return movs
}

export function sumFaturamento(movs: ContadorMovimento[]): number {
  return movs.reduce((s, m) => s + m.valorTotal, 0)
}

export function sumCustosPecas(movs: ContadorMovimento[]): number {
  return movs.reduce((s, m) => s + m.custoPeca, 0)
}

/** Estimativa de imposto (Simples/MEI): percentual sobre o faturamento bruto do período. */
export function estimativaImposto(faturamentoBruto: number, aliquotaPercent: number): number {
  if (faturamentoBruto <= 0 || aliquotaPercent <= 0) return 0
  return Math.round(faturamentoBruto * (aliquotaPercent / 100) * 100) / 100
}

export function movimentosToCsv(movs: ContadorMovimento[], mesLabel: string): string {
  const sep = ";"
  const header = ["Data", "Tipo", "Valor Total", "Custo Peça", "Forma de Pagamento", "Referência"]
  const escape = (v: string) => {
    if (/[";\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`
    return v
  }
  const numBr = (n: number) =>
    new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
  const lines = [
    header.join(sep),
    ...movs.map((m) =>
      [
        m.data,
        m.tipo,
        numBr(m.valorTotal),
        numBr(m.custoPeca),
        escape(m.formaPagamento),
        m.referencia,
      ].join(sep)
    ),
  ]
  return "\uFEFF" + `# ${APP_DISPLAY_NAME} — Exportação contador — ${mesLabel}\n` + lines.join("\n")
}

export function movimentosToXml(movs: ContadorMovimento[], year: number, month: number): string {
  const n2 = (x: number) => x.toFixed(2)
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
  const appEsc = esc(APP_DISPLAY_NAME)
  const body = movs
    .map(
      (m) =>
        `  <movimento data="${m.data}" tipo="${esc(m.tipo)}" valorTotal="${n2(m.valorTotal)}" custoPeca="${n2(
          m.custoPeca
        )}" referencia="${esc(m.referencia)}">\n    <formaPagamento>${esc(m.formaPagamento)}</formaPagamento>\n  </movimento>`
    )
    .join("\n")
  return `<?xml version="1.0" encoding="UTF-8"?>\n<movimentos ano="${year}" mes="${String(month).padStart(2, "0")}" gerado="${appEsc}">\n${body}\n</movimentos>\n`
}
