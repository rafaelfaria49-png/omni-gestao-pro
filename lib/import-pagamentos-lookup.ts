/**
 * Cruzamento com planilhas de pagamentos (vendas_pagamentos / ordens_servicos_pagamentos):
 * chaves armazenadas no navegador para forçar status Pago na importação financeira.
 */

const STORAGE_PEDIDOS_VENDAS = "assistec-import-pedidos-pagos-vendas"
const STORAGE_NUMEROS_OS = "assistec-import-os-pagas-numeros"
const STORAGE_PEDIDOS_VENDAS_VALORES = "assistec-import-pedidos-pagos-vendas-valores"
const STORAGE_NUMEROS_OS_VALORES = "assistec-import-os-pagas-valores"

function parseList(raw: string | null): string[] {
  if (!raw) return []
  try {
    const p = JSON.parse(raw) as unknown
    return Array.isArray(p) ? p.map((x) => String(x ?? "").trim()).filter(Boolean) : []
  } catch {
    return []
  }
}

function parseMoneyBr(raw: unknown): number {
  const s = String(raw ?? "")
    .trim()
    .replace(/\s/g, "")
    .replace(/R\$/gi, "")
    .replace(/[^\d,.-]/g, "")
  if (!s) return 0
  const norm = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "")
  const n = Number(norm)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
}

function parseValueMap(raw: string | null): Record<string, number> {
  if (!raw) return {}
  try {
    const p = JSON.parse(raw) as unknown
    if (!p || typeof p !== "object") return {}
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
      const key = String(k ?? "").trim()
      if (!key) continue
      const num = typeof v === "number" ? v : Number(v)
      out[key] = Number.isFinite(num) ? Math.round(num * 100) / 100 : 0
    }
    return out
  } catch {
    return {}
  }
}

export function getPedidosPagosVendas(): Set<string> {
  if (typeof window === "undefined") return new Set()
  return new Set(parseList(localStorage.getItem(STORAGE_PEDIDOS_VENDAS)))
}

/** Soma de pagamentos por pedido (para baixas parciais). */
export function getPedidosPagosVendasValores(): Map<string, number> {
  if (typeof window === "undefined") return new Map()
  const o = parseValueMap(localStorage.getItem(STORAGE_PEDIDOS_VENDAS_VALORES))
  return new Map(Object.entries(o).map(([k, v]) => [k, Number(v) || 0]))
}

export function mergePedidosPagosVendas(ids: string[]): void {
  if (typeof window === "undefined" || ids.length === 0) return
  const cur = getPedidosPagosVendas()
  for (const id of ids) {
    const k = String(id ?? "").trim()
    if (k) cur.add(k)
  }
  localStorage.setItem(STORAGE_PEDIDOS_VENDAS, JSON.stringify([...cur]))
}

export function mergePedidosPagosVendasValores(
  rows: Array<{ pedido: string; valorPago: unknown }>
): void {
  if (typeof window === "undefined" || rows.length === 0) return
  const cur = getPedidosPagosVendasValores()
  for (const r of rows) {
    const k = String(r.pedido ?? "").trim()
    if (!k) continue
    const v = parseMoneyBr(r.valorPago)
    if (v <= 0) continue
    cur.set(k, Math.round(((cur.get(k) ?? 0) + v) * 100) / 100)
  }
  localStorage.setItem(STORAGE_PEDIDOS_VENDAS_VALORES, JSON.stringify(Object.fromEntries(cur)))
}

export function getNumerosOsPagas(): Set<string> {
  if (typeof window === "undefined") return new Set()
  return new Set(parseList(localStorage.getItem(STORAGE_NUMEROS_OS)))
}

/** Soma de pagamentos por OS (para baixas parciais). */
export function getNumerosOsPagasValores(): Map<string, number> {
  if (typeof window === "undefined") return new Map()
  const o = parseValueMap(localStorage.getItem(STORAGE_NUMEROS_OS_VALORES))
  return new Map(Object.entries(o).map(([k, v]) => [k, Number(v) || 0]))
}

export function mergeNumerosOsPagas(numeros: string[]): void {
  if (typeof window === "undefined" || numeros.length === 0) return
  const cur = getNumerosOsPagas()
  for (const n of numeros) {
    const k = String(n ?? "").trim()
    if (k) cur.add(k)
  }
  localStorage.setItem(STORAGE_NUMEROS_OS, JSON.stringify([...cur]))
}

export function mergeNumerosOsPagasValores(
  rows: Array<{ osNumero: string; valorPago: unknown }>
): void {
  if (typeof window === "undefined" || rows.length === 0) return
  const cur = getNumerosOsPagasValores()
  for (const r of rows) {
    const k = String(r.osNumero ?? "").trim()
    if (!k) continue
    const v = parseMoneyBr(r.valorPago)
    if (v <= 0) continue
    cur.set(k, Math.round(((cur.get(k) ?? 0) + v) * 100) / 100)
  }
  localStorage.setItem(STORAGE_NUMEROS_OS_VALORES, JSON.stringify(Object.fromEntries(cur)))
}
