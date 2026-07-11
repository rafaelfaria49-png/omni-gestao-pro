/**
 * Contrato canônico de Produto.category.
 *
 * A coluna é uma string opcional e guarda o nome/slug textual escolhido pela UI.
 * IDs e objetos de CategoriaCadastro não são persistidos neste campo.
 */
export function normalizeProdutoCategory(value: unknown): string | null {
  if (typeof value !== "string") return null
  const normalized = value.trim()
  return normalized || null
}

/**
 * Em updates, ausência preserva a categoria atual; string vazia/null remove.
 */
export function produtoCategoryPatch(
  value: string | null | undefined,
): { category?: string | null } {
  return value === undefined ? {} : { category: normalizeProdutoCategory(value) }
}

/**
 * Read-back compatível com registros antigos que tenham null, vazio ou whitespace.
 */
export function produtoCategoryForRead(value: unknown, empty = ""): string {
  return normalizeProdutoCategory(value) ?? empty
}
