/**
 * Slug estável para `Produto.category` e `CategoriaProduto.slug` (único por loja).
 */
export function slugFromCategoriaProdutoLabel(raw: string): string {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "")
  return s || "sem-categoria"
}
