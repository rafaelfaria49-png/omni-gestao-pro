import type { PdvCatalogProduct } from "@/lib/pdv-catalog"
import {
  serviceIdFromVirtualInventoryId,
  servicoInventoryId,
} from "@/lib/os-pdv-virtual-lines"

export type PdvShortcutKind = "produto" | "servico"

export type ServicoApiRow = {
  id: string
  nome: string
  categoria: string
  custo: number
  preco: number
  garantia: number
  termo: string
  active: boolean
  status: "Ativo" | "Inativo" | "Incompleto"
}
export type PdvServicoCatalogItem = PdvCatalogProduct & {
  catalogSource: "servico"
  serviceId: string
  custoServico: number
  warrantyDays: number
  serviceTerms: string
  serviceCategory: string
}

export type PdvAtalhoSaved = {
  id: string
  nome: string
  preco: number
  inventoryId?: string
  categoria?: string
  ativo?: boolean
  favorito?: boolean
  cor?: string
  posicao?: number
  /** Novo contrato explícito; ausente é formato legado e será inferido. */
  kind?: PdvShortcutKind
  /** Identidade estável no model `Servico`, independente do inventoryId virtual. */
  serviceId?: string
  /** Snapshot apenas para exibição histórica/fallback; a hidratação usa o catálogo atual. */
  serviceCategory?: string
}

export type PdvAtalhoEntry = {
  id: string
  nome: string
  preco: number
  categoria: string
  ativo: boolean
  favorito: boolean
  stockAtual: number
  orphan: boolean
  kind: PdvShortcutKind
  serviceId?: string
  serviceCategory?: string
  barcode?: string
  sku?: string
}

export const SERVICO_STOCK_SENTINEL = 999_999

export function normalizeServicoRow(s: ServicoApiRow): PdvServicoCatalogItem {
  return {
    id: servicoInventoryId(s.id),
    name: s.nome.trim(),
    price: Number.isFinite(s.preco) ? s.preco : 0,
    stock: SERVICO_STOCK_SENTINEL,
    // Categoria operacional genérica do PdvCatalogProduct. A categoria real vive
    // em `serviceCategory` e nunca é usada para descobrir o tipo da linha.
    category: "Serviços",
    catalogSource: "servico",
    serviceId: s.id,
    custoServico: Number.isFinite(s.custo) ? s.custo : 0,
    warrantyDays: Math.max(0, Math.trunc(s.garantia ?? 0)),
    serviceTerms: s.termo ?? "",
    serviceCategory: s.categoria && s.categoria !== "—" ? s.categoria : "",
  }
}

export function isServicoCatalogItem(item: PdvCatalogProduct): item is PdvServicoCatalogItem {
  return (item as Partial<PdvServicoCatalogItem>).catalogSource === "servico"
}

export function shortcutKindFromSaved(
  saved: PdvAtalhoSaved,
  products: PdvCatalogProduct[],
  services: PdvServicoCatalogItem[],
): PdvShortcutKind {
  if (saved.kind === "produto" || saved.kind === "servico") return saved.kind
  if (saved.serviceId || serviceIdFromVirtualInventoryId(saved.inventoryId ?? saved.id)) return "servico"

  const reference = saved.inventoryId ?? saved.id
  // Compatibilidade: Produto legado com category="Servicos" continua produto.
  if (products.some((product) => product.id === reference || product.id === saved.id)) return "produto"
  if (services.some((service) => service.id === reference || service.serviceId === saved.id)) return "servico"
  return "produto"
}

export function resolveSavedShortcut(
  saved: PdvAtalhoSaved,
  products: PdvCatalogProduct[],
  services: PdvServicoCatalogItem[],
): { kind: PdvShortcutKind; live: PdvCatalogProduct | PdvServicoCatalogItem | null } {
  const kind = shortcutKindFromSaved(saved, products, services)
  if (kind === "servico") {
    const serviceId = saved.serviceId ?? serviceIdFromVirtualInventoryId(saved.inventoryId ?? saved.id)
    const live = services.find(
      (service) =>
        (serviceId ? service.serviceId === serviceId : false) ||
        service.id === saved.inventoryId ||
        service.id === saved.id ||
        service.serviceId === saved.id,
    )
    return { kind, live: live ?? null }
  }
  const reference = saved.inventoryId ?? saved.id
  return {
    kind,
    live: products.find((product) => product.id === reference || product.id === saved.id) ?? null,
  }
}

export function toPdvAtalhoEntry(
  saved: PdvAtalhoSaved,
  products: PdvCatalogProduct[],
  services: PdvServicoCatalogItem[],
  options?: { productCatalogReady?: boolean; serviceCatalogReady?: boolean },
): PdvAtalhoEntry {
  const resolved = resolveSavedShortcut(saved, products, services)
  const service = resolved.kind === "servico" && resolved.live && isServicoCatalogItem(resolved.live)
    ? resolved.live
    : null
  const live = resolved.live
  const catalogReady = resolved.kind === "servico"
    ? options?.serviceCatalogReady === true
    : options?.productCatalogReady === true || products.length > 0
  const categoria = service?.serviceCategory || live?.category || saved.serviceCategory || saved.categoria || "Outros"
  return {
    id: live?.id ?? saved.inventoryId ?? saved.id,
    nome: live?.name ?? saved.nome,
    preco: live?.price ?? saved.preco,
    categoria,
    ativo: saved.ativo !== false,
    favorito: saved.favorito === true,
    stockAtual: live?.stock ?? (resolved.kind === "servico" ? SERVICO_STOCK_SENTINEL : 0),
    orphan: catalogReady && !live,
    kind: resolved.kind,
    serviceId: service?.serviceId ?? saved.serviceId ?? serviceIdFromVirtualInventoryId(saved.inventoryId ?? saved.id) ?? undefined,
    serviceCategory: service?.serviceCategory ?? saved.serviceCategory,
    barcode: live?.barcode ?? live?.codigoBarras,
    sku: live?.sku ?? live?.codigo,
  }
}

export function fromPdvAtalhoEntry(entry: PdvAtalhoEntry): PdvAtalhoSaved {
  return {
    id: entry.id,
    nome: entry.nome,
    preco: entry.preco,
    categoria: entry.categoria,
    inventoryId: entry.id,
    ativo: entry.ativo,
    favorito: entry.favorito,
    kind: entry.kind,
    ...(entry.kind === "servico"
      ? { serviceId: entry.serviceId, serviceCategory: entry.serviceCategory ?? entry.categoria }
      : {}),
  }
}

export function atalhoEntryFromCatalogItem(item: PdvCatalogProduct): PdvAtalhoEntry {
  const service = isServicoCatalogItem(item) ? item : null
  return {
    id: item.id,
    nome: item.name,
    preco: item.price,
    categoria: service?.serviceCategory || item.category,
    ativo: true,
    favorito: false,
    stockAtual: item.stock,
    orphan: false,
    kind: service ? "servico" : "produto",
    serviceId: service?.serviceId,
    serviceCategory: service?.serviceCategory,
    barcode: item.barcode,
    sku: item.sku ?? item.codigo,
  }
}

export function resolveActiveShortcutItems(
  saved: PdvAtalhoSaved[],
  products: PdvCatalogProduct[],
  services: PdvServicoCatalogItem[],
  options?: { favoritesOnly?: boolean; kind?: PdvShortcutKind },
): Array<PdvCatalogProduct | PdvServicoCatalogItem> {
  const result: Array<PdvCatalogProduct | PdvServicoCatalogItem> = []
  for (const shortcut of saved) {
    if (shortcut.ativo === false || (options?.favoritesOnly && shortcut.favorito !== true)) continue
    const resolved = resolveSavedShortcut(shortcut, products, services)
    if (options?.kind && resolved.kind !== options.kind) continue
    if (resolved.live) result.push(resolved.live)
  }
  return result
}

export function buildServicoCartLine(item: PdvServicoCatalogItem, lineId: string, price = item.price) {
  return {
    lineId,
    inventoryId: item.id,
    title: item.name,
    price,
    qty: 1,
    itemType: "servico" as const,
    custoUnitario: item.custoServico > 0 ? item.custoServico : null,
    serviceId: item.serviceId,
    serviceCategory: item.serviceCategory,
    warrantyDays: item.warrantyDays,
    serviceTerms: item.serviceTerms,
  }
}
