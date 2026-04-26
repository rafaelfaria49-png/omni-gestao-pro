import type { PdvCatalogProduct } from "@/lib/pdv-catalog"

/** Localiza produto por código interno, EAN/GTIN ou nome exato (PDV Smart / bipe). */
export function findPdvProductByScan(raw: string, products: PdvCatalogProduct[]): PdvCatalogProduct | null {
  const t = raw.trim()
  if (!t) return null
  const lower = t.toLowerCase()
  for (const p of products) {
    if (p.id === t) return p
    const bc = (p.barcode || "").trim()
    if (bc && bc === t) return p
    if (p.name.toLowerCase() === lower) return p
  }
  return null
}
