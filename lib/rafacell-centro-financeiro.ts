/**
 * Centro financeiro RAFACELL — persistência em localStorage (v3).
 * Maquininhas: lista dinâmica (id + nome + ativo + taxas); padrão com três sugestões (PagBank, Sicredi, Mercado Pago).
 */

export const STORAGE_KEY_V1 = "rafacell-centro-financeiro-v1"
export const STORAGE_KEY_V2 = "rafacell-centro-financeiro-v2"
export const STORAGE_KEY_V3 = "rafacell-centro-financeiro-v3"

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

  const defTriple = defaults
  const out: MaquininhaConfig[] = []
  const seen = new Set<string>()

  for (const item of raw) {
    const m = item as Partial<MaquininhaConfig>
    let id = typeof m.id === "string" && m.id.trim() ? m.id.trim() : ""
    let slug = parseSlug(m.slug)
    if (!slug && id === MAQ_ID_PAGBANK) slug = "pagbank"
    if (!slug && id === MAQ_ID_SICREDI) slug = "sicredi"
    if (!slug && id === MAQ_ID_MERCADO) slug = "mercado_pago"
    if (!id && slug && slug !== "custom") {
      id = SLUG_TO_STABLE_ID[slug]
    }
    if (!id) id = newId("maq")
    if (seen.has(id)) continue
    seen.add(id)

    let base: MaquininhaConfig
    if (slug === "pagbank" || slug === "sicredi" || slug === "mercado_pago") {
      base = defaultForSlug(slug)
    } else if (!slug || slug === "custom") {
      base = {
        id,
        slug: "custom",
        nome: "Maquininha",
        ativo: false,
        taxas: emptyTaxasMaquininha(),
      }
    } else {
      base = defTriple[0]!
    }

    const nome =
      typeof m.nome === "string" && m.nome.trim() ? m.nome.trim() : base.nome
    const ativo = typeof m.ativo === "boolean" ? m.ativo : false
    const taxas = normalizeTaxas(m.taxas, base.taxas)

    out.push({
      id,
      slug: slug ?? (base.slug === "pagbank" || base.slug === "sicredi" || base.slug === "mercado_pago" ? base.slug : "custom"),
      nome,
      ativo,
      taxas,
    })
  }

  return out.length > 0 ? out : defaults.map((d) => ({ ...d }))
}

function resolveEdicaoId(
  p: Partial<CentroFinanceiroV3> & { maquininhaEdicaoSlug?: string },
  maquininhas: MaquininhaConfig[]
): string {
  let id = typeof p.maquininhaEdicaoId === "string" && p.maquininhaEdicaoId.trim() ? p.maquininhaEdicaoId.trim() : ""
  const legacySlug = p.maquininhaEdicaoSlug
  if (!id && (legacySlug === "pagbank" || legacySlug === "sicredi" || legacySlug === "mercado_pago")) {
    id = SLUG_TO_STABLE_ID[legacySlug]
  }
  if (id && maquininhas.some((m) => m.id === id)) return id
  const firstActive = maquininhas.find((m) => m.ativo)
  if (firstActive) return firstActive.id
  return maquininhas[0]?.id ?? ""
}

export function normalizeCentroV3(p: Partial<CentroFinanceiroV3> | null): CentroFinanceiroV3 {
  const base = defaultCentroFinanceiroV3()
  if (!p || p.version !== 3) return base

  const contas = Array.isArray(p.contas)
    ? p.contas.map((c) => ({
        id: c.id || newId("conta"),
        nomeExibicao: (c.nomeExibicao ?? "").trim() || "Conta",
        saldo: typeof c.saldo === "number" && Number.isFinite(c.saldo) ? c.saldo : 0,
        template: (c.template as ContaTemplate) || "outro",
      }))
    : base.contas
  if (contas.length === 0) return base

  let pixPadraoContaId = p.pixPadraoContaId ?? ""
  if (!contas.some((c) => c.id === pixPadraoContaId)) {
    pixPadraoContaId = contas[0]!.id
  }

  const maquininhas = normalizeMaquininhasV3(p.maquininhas, base.maquininhas)
  const maquininhaEdicaoId = resolveEdicaoId(p as Partial<CentroFinanceiroV3> & { maquininhaEdicaoSlug?: string }, maquininhas)

  return {
    version: 3,
    contas,
    pixPadraoContaId,
    maquininhas,
    maquininhaEdicaoId,
    metaFaturamento: typeof p.metaFaturamento === "number" ? p.metaFaturamento : 0,
    metaObservacao: typeof p.metaObservacao === "string" ? p.metaObservacao : "",
  }
}

/** Migração v2 → v3: lista de maquininhas; tenta copiar taxas da primeira entrada legada “PagBank”. */
function migrateV2JsonToV3(raw: string): CentroFinanceiroV3 | null {
  try {
    const p = JSON.parse(raw) as {
      version?: number
      contas?: ContaBanco[]
      pixPadraoContaId?: string
      maquininhas?: Array<{ nome?: string; taxas?: TaxasMaquininha; ativo?: boolean }>
      maquininhaAtivaId?: string
      metaFaturamento?: number
      metaObservacao?: string
    }
    const base = defaultCentroFinanceiroV3()
    if (Array.isArray(p.contas) && p.contas.length > 0) {
      base.contas = p.contas.map((c, i) => ({
        id: c.id || `conta-inicial-${i}`,
        nomeExibicao: (c.nomeExibicao ?? "").trim() || "Conta",
        saldo: typeof c.saldo === "number" ? c.saldo : 0,
        template: (c.template as ContaTemplate) || "outro",
      }))
    }
    if (p.pixPadraoContaId && base.contas.some((c) => c.id === p.pixPadraoContaId)) {
      base.pixPadraoContaId = p.pixPadraoContaId
    }
    const legacy = p.maquininhas ?? []
    const pb = legacy.find((m) => (m.nome ?? "").toLowerCase().includes("pagbank"))
    if (pb?.taxas) {
      const idx = base.maquininhas.findIndex((m) => m.id === MAQ_ID_PAGBANK)
      if (idx >= 0) {
        base.maquininhas[idx] = {
          ...base.maquininhas[idx]!,
          taxas: normalizeTaxas(pb.taxas, base.maquininhas[idx]!.taxas),
        }
      }
    }
    base.metaFaturamento = typeof p.metaFaturamento === "number" ? p.metaFaturamento : 0
    base.metaObservacao = typeof p.metaObservacao === "string" ? p.metaObservacao : ""
    return normalizeCentroV3(base)
  } catch {
    return null
  }
}

function migrateV1JsonToV3(raw: string): CentroFinanceiroV3 | null {
  try {
    const p = JSON.parse(raw) as {
      saldos?: Record<string, number>
      pagbankTaxas?: { debito: number; credito: number; parcelas2a12: number[] }
      pixPadrao?: string
      metaFaturamento?: number
      metaObservacao?: string
    }
    const base = defaultCentroFinanceiroV3()
    const saldos = p.saldos ?? {}
    base.contas = base.contas.map((c) => ({
      ...c,
      saldo: typeof saldos[c.template] === "number" ? saldos[c.template]! : c.saldo,
    }))
    const pix = p.pixPadrao
    if (pix) {
      const match = base.contas.find((c) => c.template === pix)
      if (match) base.pixPadraoContaId = match.id
    }
    if (p.pagbankTaxas?.parcelas2a12?.length === 11) {
      const idx = base.maquininhas.findIndex((m) => m.id === MAQ_ID_PAGBANK)
      if (idx >= 0) {
        base.maquininhas[idx] = {
          ...base.maquininhas[idx]!,
          taxas: normalizeTaxas(p.pagbankTaxas, base.maquininhas[idx]!.taxas),
        }
      }
    }
    base.metaFaturamento = typeof p.metaFaturamento === "number" ? p.metaFaturamento : 0
    base.metaObservacao = typeof p.metaObservacao === "string" ? p.metaObservacao : ""
    return normalizeCentroV3(base)
  } catch {
    return null
  }
}

export function loadCentroFinanceiroV3(): CentroFinanceiroV3 {
  if (typeof window === "undefined") return defaultCentroFinanceiroV3()
  try {
    const v3 = localStorage.getItem(STORAGE_KEY_V3)
    if (v3) {
      const parsed = JSON.parse(v3) as Partial<CentroFinanceiroV3> & { maquininhaEdicaoSlug?: string }
      if (parsed.version === 3) {
        return normalizeCentroV3(parsed as CentroFinanceiroV3)
      }
    }
    const v2 = localStorage.getItem(STORAGE_KEY_V2)
    if (v2) {
      const m = migrateV2JsonToV3(v2)
      if (m) return m
    }
    const v1 = localStorage.getItem(STORAGE_KEY_V1)
    if (v1) {
      const m = migrateV1JsonToV3(v1)
      if (m) return m
    }
  } catch {
    /* fallthrough */
  }
  return defaultCentroFinanceiroV3()
}

export function persistCentroFinanceiroV3(data: CentroFinanceiroV3): void {
  try {
    localStorage.setItem(STORAGE_KEY_V3, JSON.stringify(normalizeCentroV3(data)))
  } catch {
    /* ignore */
  }
}

/** Maquininhas com ativo=true (para PDV / calculadora). */
export function getMaquininhasAtivas(): MaquininhaConfig[] {
  const c = loadCentroFinanceiroV3()
  return c.maquininhas.filter((m) => m.ativo)
}

/** Há pelo menos uma maquininha ativa — exibir débito/crédito no caixa. */
export function temMaquininhaAtivaNoCaixa(): boolean {
  return getMaquininhasAtivas().length > 0
}
