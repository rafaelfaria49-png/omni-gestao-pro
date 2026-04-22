/**
 * Detecção e utilitários para exportações brutas do GestãoClick (planilhas).
 */

export type GestaoClickFileKind = "gestaoclick_produtos" | "gestaoclick_clientes" | "gestaoclick_vendas" | "unknown"

function normCell(s: unknown): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

/** Cabeçalhos que são ruído (colunas “Matriz”, “10”, etc.) — não viram chave de objeto. */
export function shouldSkipGestaoClickHeaderNoise(raw: string): boolean {
  const t = String(raw ?? "").trim()
  if (!t) return true
  const n = normCell(t)
  if (n === "matriz" || n === "filial") return true
  if (/^\d{1,4}$/.test(t.trim())) return true
  return false
}

function rowCellsLower(row: unknown[] | undefined): string[] {
  if (!Array.isArray(row)) return []
  const out: string[] = []
  for (let i = 0; i < row.length; i += 1) {
    out.push(normCell(row[i]))
  }
  return out
}

/** Primeira linha que parece cabeçalho de clientes (Nome + CPF/CNPJ). */
export function findGestaoClickClienteHeaderRow(grid: unknown[][]): number {
  const max = Math.min(grid.length, 120)
  for (let r = 0; r < max; r += 1) {
    const row = grid[r]
    if (!Array.isArray(row)) continue
    const cells = rowCellsLower(row)
    const hasNome = cells.some((c) => c === "nome" || c.startsWith("nome ") || c.includes("nome do"))
    const hasDoc = cells.some(
      (c) => c.includes("cpf") || c.includes("cnpj") || c.includes("documento") || c.includes("cpf/cnpj")
    )
    if (hasNome && hasDoc) return r
  }
  return -1
}

function scoreClienteHeader(row: unknown[] | undefined): number {
  if (!Array.isArray(row)) return 0
  const cells = rowCellsLower(row)
  let s = 0
  if (cells.some((c) => c === "nome" || c.includes("nome"))) s += 3
  if (cells.some((c) => c.includes("cpf") || c.includes("cnpj"))) s += 3
  if (cells.some((c) => c.includes("email") || c.includes("e-mail"))) s += 1
  if (cells.some((c) => c.includes("telefone") || c.includes("celular"))) s += 1
  if (cells.some((c) => c.includes("endereco") || c.includes("endere"))) s += 1
  return s
}

function scoreVendasKeywordsInGrid(grid: unknown[][], maxRows: number): number {
  const scan = Math.min(grid.length, maxRows)
  let score = 0
  for (let r = 0; r < scan; r += 1) {
    const row = grid[r]
    if (!Array.isArray(row)) continue
    for (let c = 0; c < row.length; c += 1) {
      const t = normCell(row[c])
      if (!t) continue
      if (/\b(nfe|nf-?e|nota fiscal|pedido|orcamento|orcamento|venda|compra)\b/.test(t)) score += 2
      if (t.includes("valor total") || t.includes("total geral")) score += 1
    }
  }
  return score
}

function scoreProdutosWideSheet(grid: unknown[][]): number {
  const headerOrFirst =
    grid[0] && Array.isArray(grid[0]) && grid[0].length >= 12 ? (grid[0] as unknown[]).length : 0
  const sampleRow = grid.find((r) => Array.isArray(r) && r.length >= 12)
  const w = Math.max(headerOrFirst, sampleRow ? (sampleRow as unknown[]).length : 0)
  if (w >= 20) return 3
  if (w >= 15) return 2
  if (w >= 12) return 1
  return 0
}

/**
 * Detecta o tipo de arquivo GestãoClick com base na grade (primeiras linhas + largura).
 * Não aloca strings gigantes: examina só um recorte do grid.
 */
export function detectGestaoClickFileKind(grid: unknown[][] | undefined, preferredHeaderRow: number): GestaoClickFileKind {
  if (!grid || grid.length === 0) return "unknown"

  const vendasScore = scoreVendasKeywordsInGrid(grid, 40)
  if (vendasScore >= 3) return "gestaoclick_vendas"

  const hiCliente = findGestaoClickClienteHeaderRow(grid)
  const clienteCandidato = hiCliente >= 0 ? grid[hiCliente] : undefined
  const clienteScore = scoreClienteHeader(clienteCandidato)

  const prodWide = scoreProdutosWideSheet(grid)

  // Primeira linha “de relatório” às vezes é confundida com header
  const altHeader = Math.min(Math.max(0, preferredHeaderRow), grid.length - 1)
  const prefRow = grid[altHeader]
  const prefClienteScore = scoreClienteHeader(prefRow)

  if (hiCliente >= 0 && (clienteScore >= 4 || clienteScore > prefClienteScore)) {
    return "gestaoclick_clientes"
  }

  if (prefClienteScore >= 4) {
    return "gestaoclick_clientes"
  }

  if (prodWide >= 2 && hiCliente < 0) return "gestaoclick_produtos"
  if (prodWide >= 1 && vendasScore === 0 && hiCliente < 0) return "gestaoclick_produtos"

  if (hiCliente >= 0) return "gestaoclick_clientes"

  return "unknown"
}

/**
 * Reconstrói headers + rows a partir da grade e do índice da linha de cabeçalho (clientes GC).
 * Ignora colunas cujo título é ruído (Matriz, 10, etc.) para alinhar com o arquivo bruto.
 */
export function rebuildParsedRowsFromGrid(
  grid: unknown[][],
  headerRowIndex: number,
  _fileName: string
): { headers: string[]; rows: Record<string, unknown>[]; headerRowIndex: number } {
  const headerRow = grid[headerRowIndex]
  if (!Array.isArray(headerRow)) {
    return { headers: [], rows: [], headerRowIndex }
  }

  const colToKey: string[] = []
  for (let c = 0; c < headerRow.length; c += 1) {
    const raw = String(headerRow[c] ?? "").trim()
    if (!raw || shouldSkipGestaoClickHeaderNoise(raw)) {
      colToKey.push("")
      continue
    }
    colToKey.push(raw)
  }

  const headers: string[] = []
  const headerSeen = new Set<string>()
  for (const k of colToKey) {
    if (!k) continue
    if (!headerSeen.has(k)) {
      headerSeen.add(k)
      headers.push(k)
    }
  }

  const rows: Record<string, unknown>[] = []
  for (let r = headerRowIndex + 1; r < grid.length; r += 1) {
    const row = grid[r]
    if (!Array.isArray(row)) continue
    let any = false
    const obj: Record<string, unknown> = {}
    for (let c = 0; c < colToKey.length; c += 1) {
      const key = colToKey[c]
      if (!key) continue
      const v = row[c]
      if (String(v ?? "").trim() !== "") any = true
      obj[key] = v
    }
    if (any) rows.push(obj)
  }

  return { headers, rows, headerRowIndex }
}

/** Resultado de parse (cliente) — estende na UI com os mesmos campos. */
export type GestaoClickParsedSlice = {
  fileName: string
  headers: string[]
  rows: Record<string, unknown>[]
  grid?: unknown[][]
  headerRowIndex?: number
  detectedKind?: GestaoClickFileKind
}

/**
 * Após `parseXlsx`, ajusta cabeçalho/linhas se for exportação de clientes GC (linhas de título antes do header).
 */
export function applyGestaoClickPostParse(parsed: GestaoClickParsedSlice): GestaoClickParsedSlice {
  const grid = parsed.grid
  const defaultHi = parsed.headerRowIndex ?? 0
  if (!grid || grid.length === 0) {
    return { ...parsed, detectedKind: parsed.detectedKind ?? "unknown", headerRowIndex: defaultHi }
  }

  const clienteHi = findGestaoClickClienteHeaderRow(grid)
  const detected = detectGestaoClickFileKind(grid, defaultHi)
  const clienteRow = clienteHi >= 0 ? grid[clienteHi] : undefined
  const strongClienteHeader = clienteRow != null && scoreClienteHeader(clienteRow) >= 5

  if ((detected === "gestaoclick_clientes" || strongClienteHeader) && clienteHi >= 0) {
    const rebuilt = rebuildParsedRowsFromGrid(grid, clienteHi, parsed.fileName)
    return {
      ...parsed,
      headers: rebuilt.headers,
      rows: rebuilt.rows,
      headerRowIndex: rebuilt.headerRowIndex,
      grid,
      detectedKind: "gestaoclick_clientes",
    }
  }

  return { ...parsed, detectedKind: detected, headerRowIndex: defaultHi }
}
