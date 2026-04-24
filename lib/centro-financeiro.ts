/**
 * Centro financeiro (maquininhas e taxas) — persistência em localStorage (v3).
 * Multiloja: cada `storeId` tem silo próprio.
 */

import { LEGACY_PRIMARY_STORE_ID } from "@/lib/store-defaults"

export const STORAGE_KEY_V1 = "centro-financeiro-v1"
export const STORAGE_KEY_V2 = "centro-financeiro-v2"
export const STORAGE_KEY_V3 = "centro-financeiro-v3"

/** Chave v3 por unidade (multiloja). */
export function centroFinanceiroStorageKeyV3(storeId: string): string {
  const sid = (storeId || LEGACY_PRIMARY_STORE_ID).trim() || LEGACY_PRIMARY_STORE_ID
  return `${STORAGE_KEY_V3}::${sid}`
}

/** IDs estáveis das três maquininhas iniciais (migração a partir de slug). */
export const MAQ_ID_PAGBANK = "maq-pagbank"
export const MAQ_ID_SICREDI = "maq-sicredi"
export const MAQ_ID_MERCADO = "maq-mercado"

export type ContaTemplate =
  | "pagbank"
  | "nubank"
  | "sicredi"
  | "mercado_pago"
  | "santander"
  | "caixa_fisico"
  | "outro"

export type ContaBanco = {
  id: string
  nomeExibicao: string
  saldo: number
  template: ContaTemplate
}

export type TaxasMaquininha = {
  debito: number
  credito: number
  parcelas2a12: number[]
}

/** Slug legado das três primeiras sugestões; "custom" = criada pelo usuário. */
export type MaquininhaSlug = "pagbank" | "sicredi" | "mercado_pago" | "custom"

export type MaquininhaConfig = {
  id: string
  slug?: MaquininhaSlug
  nome: string
  /** Por padrão false — só após ativar no painel. */
  ativo: boolean
  taxas: TaxasMaquininha
}

export type CentroFinanceiroV3 = {
  version: 3
  contas: ContaBanco[]
  pixPadraoContaId: string
  maquininhas: MaquininhaConfig[]
  /** Qual maquininha está em foco na calculadora / edição. */
  maquininhaEdicaoId: string
  metaFaturamento: number
  metaObservacao: string
}

const SLUG_TO_STABLE_ID: Record<"pagbank" | "sicredi" | "mercado_pago", string> = {
  pagbank: MAQ_ID_PAGBANK,
  sicredi: MAQ_ID_SICREDI,
  mercado_pago: MAQ_ID_MERCADO,
}

function defaultParcelas2a12(): number[] {
  return Array.from({ length: 11 }, (_, i) => {
    const n = i + 2
    return 2.2 + (n - 2) * 0.35
  })
}

/** Valores sugeridos PagBank (referência). */
export function taxasSugeridasPagBank(): TaxasMaquininha {
  return {
    debito: 1.99,
    credito: 4.99,
    parcelas2a12: defaultParcelas2a12(),
  }
}

function taxasSugeridasSicredi(): TaxasMaquininha {
  return {
    debito: 2.05,
    credito: 4.75,
    parcelas2a12: defaultParcelas2a12().map((x) => x + 0.15),
  }
}

function taxasSugeridasMercadoPago(): TaxasMaquininha {
  return {
    debito: 2.39,
    credito: 4.98,
    parcelas2a12: defaultParcelas2a12().map((x) => x + 0.25),
  }
}

/** Taxas zeradas para nova maquininha criada pelo usuário. */
export function emptyTaxasMaquininha(): TaxasMaquininha {
  return {
    debito: 0,
    credito: 0,
    parcelas2a12: Array.from({ length: 11 }, () => 0),
  }
}

export function defaultMaquininhasLista(): MaquininhaConfig[] {
  return [
    { id: MAQ_ID_PAGBANK, slug: "pagbank", nome: "PagBank", ativo: false, taxas: taxasSugeridasPagBank() },
    { id: MAQ_ID_SICREDI, slug: "sicredi", nome: "Sicredi", ativo: false, taxas: taxasSugeridasSicredi() },
    { id: MAQ_ID_MERCADO, slug: "mercado_pago", nome: "Mercado Pago", ativo: false, taxas: taxasSugeridasMercadoPago() },
  ]
}

/** Nova entrada em branco para o painel de taxas. */
export function novaMaquininhaVazia(): MaquininhaConfig {
  return {
    id: newId("maq"),
    slug: "custom",
    nome: "Nova maquininha",
    ativo: false,
    taxas: emptyTaxasMaquininha(),
  }
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

function defaultContasFromTemplates(): ContaBanco[] {
  const T: Array<{ template: ContaTemplate; label: string }> = [
    { template: "pagbank", label: "PagBank" },
    { template: "nubank", label: "Nubank" },
    { template: "sicredi", label: "Sicredi" },
    { template: "mercado_pago", label: "Mercado Pago" },
    { template: "santander", label: "Santander" },
    { template: "caixa_fisico", label: "Caixa físico" },
  ]
  return T.map((row, i) => ({
    id: `conta-inicial-${i}`,
    nomeExibicao: row.label,
    saldo: 0,
    template: row.template,
  }))
}

export function defaultCentroFinanceiroV3(): CentroFinanceiroV3 {
  const contas = defaultContasFromTemplates()
  const maquininhas = defaultMaquininhasLista()
  return {
    version: 3,
    contas,
    pixPadraoContaId: contas[0]?.id ?? "",
    maquininhas,
    maquininhaEdicaoId: maquininhas[0]!.id,
    metaFaturamento: 0,
    metaObservacao: "",
  }
}

function normalizeTaxas(t: Partial<TaxasMaquininha> | undefined, fallback: TaxasMaquininha): TaxasMaquininha {
  if (!t) return fallback
  return {
    debito: typeof t.debito === "number" ? t.debito : fallback.debito,
    credito: typeof t.credito === "number" ? t.credito : fallback.credito,
    parcelas2a12:
      Array.isArray(t.parcelas2a12) && t.parcelas2a12.length === 11
        ? t.parcelas2a12.map((x) => (typeof x === "number" ? x : 0))
        : fallback.parcelas2a12,
  }
}

function defaultForSlug(slug: "pagbank" | "sicredi" | "mercado_pago"): MaquininhaConfig {
  const list = defaultMaquininhasLista()
  return list.find((m) => m.slug === slug)!
}

function parseSlug(raw: unknown): MaquininhaSlug | undefined {
  if (raw === "pagbank" || raw === "sicredi" || raw === "mercado_pago" || raw === "custom") return raw
  return undefined
}

/**
 * Aceita array dinâmico; migra tupla legada de 3 itens só com `slug` (sem `id`).
 */
function normalizeMaquininhasV3(raw: unknown, defaults: MaquininhaConfig[]): MaquininhaConfig[] {
  if (!Array.isArray(raw)) return defaults.map((d) => ({ ...d, taxas: normalizeTaxas(d.taxas, d.taxas) }))
  /** Lista vazia gravada de propósito (usuário excluiu todas) — não recriar o trio padrão. */
  if (raw.length === 0) return []

  const out: MaquininhaConfig[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const o = item as any
    const slug = parseSlug(o.slug)
    const base = slug && slug !== "custom" ? defaultForSlug(slug) : undefined
    const id =
      typeof o.id === "string" && o.id.trim()
        ? String(o.id).trim()
        : slug && slug !== "custom"
          ? SLUG_TO_STABLE_ID[slug as "pagbank" | "sicredi" | "mercado_pago"]
          : newId("maq")
    out.push({
      id,
      slug,
      nome: typeof o.nome === "string" ? o.nome : base?.nome || "Maquininha",
      ativo: typeof o.ativo === "boolean" ? o.ativo : false,
      taxas: normalizeTaxas(o.taxas, base?.taxas || emptyTaxasMaquininha()),
    })
  }
  return out
}

function normalizeContas(raw: unknown): ContaBanco[] {
  if (!Array.isArray(raw)) return defaultContasFromTemplates()
  const out: ContaBanco[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const o = item as any
    out.push({
      id: typeof o.id === "string" ? o.id : newId("conta"),
      nomeExibicao: typeof o.nomeExibicao === "string" ? o.nomeExibicao : "Conta",
      saldo: typeof o.saldo === "number" ? o.saldo : 0,
      template: (typeof o.template === "string" ? o.template : "outro") as ContaTemplate,
    })
  }
  return out
}

export function normalizeCentroV3(raw: unknown): CentroFinanceiroV3 {
  const o = raw && typeof raw === "object" ? (raw as any) : {}
  const contas = normalizeContas(o.contas)
  const maquininhas = normalizeMaquininhasV3(o.maquininhas, defaultMaquininhasLista())
  return {
    version: 3,
    contas,
    pixPadraoContaId: typeof o.pixPadraoContaId === "string" ? o.pixPadraoContaId : (contas[0]?.id ?? ""),
    maquininhas,
    maquininhaEdicaoId:
      typeof o.maquininhaEdicaoId === "string"
        ? o.maquininhaEdicaoId
        : (maquininhas[0]?.id ?? ""),
    metaFaturamento: typeof o.metaFaturamento === "number" ? o.metaFaturamento : 0,
    metaObservacao: typeof o.metaObservacao === "string" ? o.metaObservacao : "",
  }
}

export function loadCentroFinanceiroV3ForStore(storeId: string): CentroFinanceiroV3 {
  if (typeof window === "undefined") return defaultCentroFinanceiroV3()
  try {
    const raw = localStorage.getItem(centroFinanceiroStorageKeyV3(storeId))
    if (!raw) return defaultCentroFinanceiroV3()
    return normalizeCentroV3(JSON.parse(raw))
  } catch {
    return defaultCentroFinanceiroV3()
  }
}

export function persistCentroFinanceiroV3ForStore(storeId: string, draft: CentroFinanceiroV3): void {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(centroFinanceiroStorageKeyV3(storeId), JSON.stringify(draft))
  } catch {
    /* ignore */
  }
}

/** PDV: retorna só as maquininhas ativas. */
export function getMaquininhasParaPdvForStore(storeId: string): MaquininhaConfig[] {
  const centro = loadCentroFinanceiroV3ForStore(storeId)
  return (centro.maquininhas || []).filter((m) => !!m.ativo)
}

