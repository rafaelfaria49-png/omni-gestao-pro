import type { PurchasePlanningRow } from "@/lib/purchase-planning"
import { PURCHASE_COVERAGE_ALERT_DAYS, PURCHASE_WINDOW_DAYS, suggestedOrderQty } from "@/lib/purchase-planning"

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function groupByCategory(rows: PurchasePlanningRow[]): Map<string, PurchasePlanningRow[]> {
  const map = new Map<string, PurchasePlanningRow[]>()
  for (const r of rows) {
    const cat = r.category || "Sem categoria"
    if (!map.has(cat)) map.set(cat, [])
    map.get(cat)!.push(r)
  }
  return new Map([...map.entries()].sort((a, b) => a[0].localeCompare(b[0], "pt-BR")))
}

/**
 * Abre janela com HTML otimizado para impressão; use &quot;Salvar como PDF&quot; no diálogo de impressão.
 */
export function openPurchaseListPrintWindow(
  rows: PurchasePlanningRow[],
  empresaNome: string,
  options?: { onlySuggested?: boolean }
): void {
  const onlySuggested = options?.onlySuggested !== false
  const list = onlySuggested ? rows.filter((r) => r.suggestPurchase) : rows
  const grouped = groupByCategory(list)
  const generated = new Date().toLocaleString("pt-BR")

  const br = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })

  let body = ""
  for (const [category, items] of grouped) {
    body += `<h2 class="cat">${escapeHtml(category)}</h2>
<table>
<thead><tr>
<th>Produto</th><th>Estoque</th><th>Vendas líq. (${PURCHASE_WINDOW_DAYS}d)</th><th>Média/dia</th><th>Cobertura (dias)</th><th>Sugestão qtd</th><th>Custo est.</th>
</tr></thead><tbody>`
    for (const r of items) {
      const cov =
        r.coverageDays != null ? r.coverageDays.toFixed(1) : "—"
      const sug = suggestedOrderQty(r)
      body += `<tr>
<td>${escapeHtml(r.name)}</td>
<td>${r.stock}</td>
<td>${r.qtyNet30d}</td>
<td>${r.avgDaily.toFixed(3)}</td>
<td>${cov}</td>
<td>${sug}</td>
<td>${br.format(r.cost * Math.max(sug, 0))}</td>
</tr>`
    }
    body += `</tbody></table>`
  }

  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"/>
<title>Lista de Compras — ${escapeHtml(empresaNome)}</title>
<style>
  body { font-family: system-ui, Segoe UI, sans-serif; font-size: 12px; color: #111; padding: 16px; }
  h1 { font-size: 18px; margin: 0 0 8px; }
  .meta { color: #555; font-size: 11px; margin-bottom: 20px; }
  h2.cat { font-size: 14px; border-bottom: 2px solid #c00; padding-bottom: 4px; margin: 20px 0 10px; page-break-after: avoid; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
  th { background: #f5f5f5; font-size: 11px; }
  @media print { body { padding: 8px; } }
</style></head><body>
<h1>Lista de Compras (fornecedores)</h1>
<p class="meta">${escapeHtml(empresaNome)} · Gerado em ${escapeHtml(generated)} · Itens com cobertura &lt; ${PURCHASE_COVERAGE_ALERT_DAYS} dias ou estoque ≤ 0</p>
${body || "<p>Nenhum item na lista de sugestão.</p>"}
<script>window.onload=function(){setTimeout(function(){window.print()},200)}</script>
</body></html>`

  const w = window.open("", "_blank", "noopener,noreferrer")
  if (!w) return
  w.document.open()
  w.document.write(html)
  w.document.close()
}
