/**
 * Categoria do produto importado — nome legível, nunca slug.
 *
 * O persistidor antigo aplicava `slugCategoria()` antes de gravar: "Pilhas e Baterias"
 * virava `pilhas_e_baterias` na coluna `category` e ainda era copiado para `brand`.
 * Aqui a categoria mantém o nome canônico e o slug fica restrito a comparação.
 */

/** Chave de comparação: sem acento, sem caixa, `_`/`-` viram espaço. */
export function chaveCategoria(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** Nome legível para gravar: só limpa espaços. Não sluga, não capitaliza à força. */
export function normalizarNomeCategoria(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim()
}

/**
 * Reconverte um slug legado (`pilhas_e_baterias`) em nome legível quando a planilha
 * já trouxe o valor slugado. Preserva nomes que não são slug.
 */
export function legibilizarCategoria(value: unknown): string {
  const raw = normalizarNomeCategoria(value)
  if (!raw) return ""
  // Só age em algo que parece slug: sem espaços, com separador e sem maiúscula.
  const pareceSlug = !/\s/.test(raw) && /[_-]/.test(raw) && raw === raw.toLowerCase()
  if (!pareceSlug) return raw
  const palavras = raw.split(/[_-]+/).filter(Boolean)
  const conectores = new Set(["e", "de", "da", "do", "das", "dos", "para", "com", "em"])
  return palavras
    .map((p, i) => (i > 0 && conectores.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(" ")
}

/**
 * Escolhe o nome final da categoria: quando a loja já tem uma `CategoriaCadastro`
 * equivalente, reaproveita a grafia dela; senão usa o nome legível da planilha.
 */
export function resolverNomeCategoria(
  daPlanilha: unknown,
  categoriasExistentes: ReadonlyArray<string>,
): string {
  const legivel = legibilizarCategoria(daPlanilha)
  if (!legivel) return ""
  const chave = chaveCategoria(legivel)
  const existente = categoriasExistentes.find((c) => chaveCategoria(c) === chave)
  return existente ?? legivel
}
