/**
 * Importação inteligente universal: detecta colunas pelo cabeçalho da planilha
 * e aplica fallbacks fixos (GestãoClick típico: E=nome, K=custo, Z=preço, U=estoque).
 */

import { createHash } from "node:crypto"

import { shouldSkipInventoryImportName } from "@/lib/inventory-import-filters"

/** Índices 0-based = colunas Excel A=0, D=3, E=4, K=10, U=20, Z=25 */
export const COL_PRODUTO_CATEGORIA_PADRAO = 3
export const COL_PRODUTO_NOME_PADRAO = 4
export const COL_PRODUTO_CUSTO_PADRAO = 10
export const COL_PRODUTO_PRECO_Z_PADRAO = 25
export const COL_PRODUTO_ESTOQUE_PADRAO = 20

function cellNormHeader(h: unknown): string {
  return String(h ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/**
 * Converte valores monetários do tipo "18,00", "R$ 109,90", "1.234,56".
 * Garante vírgula decimal (pt-BR) e evita preço zerado por parsing ingênuo.
 */
export function parseValorMonetarioUniversal(input: unknown): number {
  if (typeof input === "number" && Number.isFinite(input)) return input
  let s = String(input ?? "").trim()
  if (!s) return 0
  s = s.replace(/\s+/g, "").replace(/r\$/gi, "")
  s = s.replace(/[^\d,.\-]/g, "")
  if (!s) return 0
  if (s.includes(",")) {
    const normalized = s.replace(/\./g, "").replace(",", ".")
    const n = parseFloat(normalized)
    return Number.isFinite(n) ? n : 0
  }
  const n = parseFloat(s.replace(",", "."))
  return Number.isFinite(n) ? n : 0
}

export type ProductColumnMap = {
  headerRowIndex: number
  nameCol: number
  costCol: number
  priceCol: number | null
  stockCol: number | null
  /** Coluna de categoria (ex.: GestãoClick coluna D); null = usar padrão fixo. */
  categoryCol: number | null
}

function matchNameColumn(h: string): boolean {
  if (!h) return false
  if (h === "nome") return true
  if (h.includes("nome") && !h.includes("fantasia")) return true
  if ((h.includes("descricao") || h.includes("produto")) && !h.includes("preco") && !h.includes("codigo")) return true
  return false
}

function matchCostColumn(h: string): boolean {
  if (!h) return false
  if (h.includes("custo") && !h.includes("venda")) return true
  if (h.includes("preco") && h.includes("custo")) return true
  return false
}

function matchSalePriceColumn(h: string): boolean {
  if (!h) return false
  if (h.includes("venda") && (h.includes("preco") || h.includes("preço") || h.includes("valor"))) return true
  if (h.includes("preco") && h.includes("venda")) return true
  if (h.includes("valor") && (h.includes("venda") || h.includes("final"))) return true
  return false
}

function matchStockColumn(h: string): boolean {
  if (!h) return false
  return h.includes("estoque") || h.includes("quant") || h.includes("saldo")
}

function matchCategoryColumn(h: string): boolean {
  if (!h) return false
  if (h === "categoria") return true
  if (h.includes("categoria") && !h.includes("fiscal")) return true
  if (h.includes("grupo") && h.includes("prod")) return true
  return false
}

/** Analisa uma linha candidata a cabeçalho e devolve mapa se for convincente. */
export function tryMapProductColumnsFromHeaderRow(row: unknown[], rowIndex: number): ProductColumnMap | null {
  if (!Array.isArray(row) || row.length < 3) return null
  let nameCol = -1
  let costCol = -1
  let priceCol: number | null = null
  let stockCol: number | null = null
  let categoryCol: number | null = null

  for (let c = 0; c < row.length; c += 1) {
    const h = cellNormHeader(row[c])
    if (!h) continue
    if (nameCol < 0 && matchNameColumn(h)) nameCol = c
    if (costCol < 0 && matchCostColumn(h)) costCol = c
    if (priceCol == null && matchSalePriceColumn(h)) priceCol = c
    if (stockCol == null && matchStockColumn(h)) stockCol = c
    if (categoryCol == null && matchCategoryColumn(h)) categoryCol = c
  }

  if (nameCol < 0) return null
  if (costCol < 0 && priceCol == null) return null

  if (costCol < 0) costCol = COL_PRODUTO_CUSTO_PADRAO
  if (priceCol == null) priceCol = COL_PRODUTO_PRECO_Z_PADRAO

  return {
    headerRowIndex: rowIndex,
    nameCol,
    costCol,
    priceCol,
    stockCol,
    categoryCol,
  }
}

/** Percorre as primeiras linhas da grade e escolhe o melhor cabeçalho de produtos. */
export function findProductColumnMap(grid: unknown[][]): ProductColumnMap | null {
  const max = Math.min(grid.length, 45)
  let best: ProductColumnMap | null = null
  let bestScore = 0

  for (let r = 0; r < max; r += 1) {
    const row = grid[r]
    const mapped = tryMapProductColumnsFromHeaderRow(row, r)
    if (!mapped) continue
    let score = 1
    if (mapped.nameCol >= 0) score += 2
    if (mapped.costCol >= 0) score += 1
    if (mapped.priceCol != null) score += 1
    if (mapped.stockCol != null) score += 1
    if (mapped.categoryCol != null) score += 1
    if (score > bestScore) {
      bestScore = score
      best = mapped
    }
  }
  return best
}

/** Mapa padrão quando não há cabeçalho reconhecível (GestãoClick bruto). */
export function defaultProductColumnMap(): ProductColumnMap {
  return {
    headerRowIndex: -1,
    nameCol: COL_PRODUTO_NOME_PADRAO,
    costCol: COL_PRODUTO_CUSTO_PADRAO,
    priceCol: COL_PRODUTO_PRECO_Z_PADRAO,
    stockCol: COL_PRODUTO_ESTOQUE_PADRAO,
    categoryCol: COL_PRODUTO_CATEGORIA_PADRAO,
  }
}

export function findFirstProductDataRowFrom(grid: unknown[][], nameColIndex: number, startFrom: number): number {
  const from = Math.max(0, startFrom)
  for (let i = from; i < grid.length; i += 1) {
    const row = grid[i]
    if (!Array.isArray(row)) continue
    const name = String(row[nameColIndex] ?? "").trim()
    if (!shouldSkipInventoryImportName(name)) return i
  }
  return grid.length
}

/** Código de barras: colunas A/B ou início da linha — só aceita padrões 789/206 longos. */
export function pickBarcodeFromRow(row: unknown[]): string {
  for (let idx = 0; idx <= 1; idx += 1) {
    const d = String(row[idx] ?? "")
      .trim()
      .replace(/\D/g, "")
    if (/^(789|206)\d{8,}$/.test(d)) return d
  }
  for (let i = 0; i < Math.min(row.length, 8); i += 1) {
    const d = String(row[i] ?? "")
      .trim()
      .replace(/\D/g, "")
    if (/^(789|206)\d{8,}$/.test(d)) return d
  }
  return ""
}

/**
 * Preço de venda: coluna Z (25) ou cabeçalho detectado; se vazio, última coluna com valor monetário > 0.
 */
export function pickSalePriceUniversal(
  row: unknown[],
  preferredCols: Array<number | null | undefined>,
  parse: (v: unknown) => number
): number {
  const tried = new Set<number>()
  for (const c of preferredCols) {
    if (c == null || c < 0) continue
    if (c >= row.length) continue
    if (tried.has(c)) continue
    tried.add(c)
    const n = parse(row[c])
    if (n > 0) return n
  }
  for (let i = row.length - 1; i >= 0; i -= 1) {
    const n = parse(row[i])
    if (n > 0) return n
  }
  return 0
}

/**
 * ID estável: código de barras (789/206) quando existir; senão hash de nome + preço + linha
 * (evita colapsar várias linhas com o mesmo nome em um único produto).
 */
export function makeUniversalProductId(barcode: string, name: string, price: number, rowIndex: number): string {
  if (barcode) return `gc-${barcode}`
  const key = `${name.trim()}\0${String(price)}\0${rowIndex}`
  const h = createHash("sha256").update(key, "utf8").digest("hex").slice(0, 22)
  return `gc-np-${h}`
}

/** Garante ids únicos quando o mesmo código de barras aparece em mais de uma linha. */
export function dedupeProductIds<T extends { id: string }>(products: T[]): T[] {
  const countById = new Map<string, number>()
  for (const p of products) {
    countById.set(p.id, (countById.get(p.id) ?? 0) + 1)
  }
  const seen = new Map<string, number>()
  return products.map((p) => {
    const total = countById.get(p.id) ?? 1
    if (total <= 1) return p
    const n = (seen.get(p.id) ?? 0) + 1
    seen.set(p.id, n)
    if (n <= 1) return p
    return { ...p, id: `${p.id}__${n}` }
  })
}
