import { prisma } from "@/lib/prisma"
import { slugFromCategoriaProdutoLabel } from "@/lib/categoria-produto-utils"

/** slug -> rótulo de exibição (primeiro nome visto na importação). */
export type CategoriaDisplayBySlug = Map<string, string>

const BASE: Array<{ slug: string; nome: string }> = [
  { slug: "peca", nome: "Peça" },
  { slug: "acessorio", nome: "Acessório" },
  { slug: "servico", nome: "Serviço" },
]

/**
 * Garante linhas em `categorias_produto` para os slugs informados (upsert).
 * Sempre inclui peça / acessório / serviço como rótulos padrão.
 */
export async function ensureCategoriasProduto(lojaId: string, displayBySlug: CategoriaDisplayBySlug): Promise<void> {
  const merged = new Map<string, string>()
  for (const { slug, nome } of BASE) {
    merged.set(slug, nome)
  }
  const baseSlugs = new Set(BASE.map((b) => b.slug))
  for (const [slug, nome] of displayBySlug) {
    const label = nome.trim()
    if (!label) continue
    if (baseSlugs.has(slug)) continue
    merged.set(slug, label)
  }

  for (const [slug, nome] of merged) {
    await prisma.categoriaProduto.upsert({
      where: { lojaId_slug: { lojaId, slug } },
      create: { lojaId, slug, nome },
      update: { nome },
    })
  }
}

/** Converte texto livre (coluna ou modelo) em slug e acumula rótulo para ensure. */
export function collectCategoriaFromLabel(
  raw: string | undefined | null,
  dest: CategoriaDisplayBySlug,
  emptyFallbackSlug: string = "peca"
): string {
  const t = String(raw ?? "").trim()
  if (!t) return emptyFallbackSlug
  const slug = slugFromCategoriaProdutoLabel(t)
  if (!dest.has(slug)) dest.set(slug, t)
  return slug
}
