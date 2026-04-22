/**
 * Filtros para ignorar linhas de metadados / cabeçalhos soltos em planilhas de produtos.
 */

const METADATA_LABELS = new Set([
  "matriz",
  "filial",
  "subtotal",
  "sub-total",
  "total",
  "totais",
  "—",
  "-",
])

/** Ignora linha se o nome estiver vazio, for só número curto (ex.: "10") ou for rótulo de metadata. */
export function shouldSkipInventoryImportName(rawName: string): boolean {
  const name = String(rawName ?? "").trim()
  if (!name) return true
  const lower = name.toLowerCase()
  if (METADATA_LABELS.has(lower)) return true
  // Apenas dígitos com até 4 caracteres (ex.: "10", "2")
  if (/^\d{1,4}$/.test(name)) return true
  return false
}

/** Índice do primeiro item cuja coluna nome parece ser um produto real (após normalizar string). */
export function indexOfFirstRealProductName(names: string[]): number {
  for (let i = 0; i < names.length; i += 1) {
    if (!shouldSkipInventoryImportName(names[i] ?? "")) return i
  }
  return names.length
}
