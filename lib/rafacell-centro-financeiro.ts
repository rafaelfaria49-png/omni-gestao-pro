/**
 * Centro financeiro RAFACELL — persistência em localStorage (v3).
 * Maquininhas fixas: PagBank, Sicredi, Mercado Pago (cada uma com ativo + taxas).
 */

export const STORAGE_KEY_V1 = "rafacell-centro-financeiro-v1"
export const STORAGE_KEY_V2 = "rafacell-centro-financeiro-v2"
export const STORAGE_KEY_V3 = "rafacell-centro-financeiro-v3"

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

/** Identificador fixo da maquininha (três opções). */
export type MaquininhaSlug = "pagbank" | "sicredi" | "mercado_pago"

export type MaquininhaConfig = {
  slug: MaquininhaSlug
  nome: string
  /** Por padrão false — só após ativar no painel. */
  ativo: boolean
  taxas: TaxasMaquininha
}

export type CentroFinanceiroV3 = {
  version: 3
  contas: ContaBanco[]
  pixPadraoContaId: string
  maquininhas: [MaquininhaConfig, MaquininhaConfig, MaquininhaConfig]
  /** Qual bloco está em foco na calculadora / edição. */
  maquininhaEdicaoSlug: MaquininhaSlug
  metaFaturamento: number
  metaObservacao: string
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

export function defaultMaquininhasTriple(): [MaquininhaConfig, MaquininhaConfig, MaquininhaConfig] {
  return [
    { slug: "pagbank", nome: "PagBank", ativo: false, taxas: taxasSugeridasPagBank() },
    { slug: "sicredi", nome: "Sicredi", ativo: false, taxas: taxasSugeridasSicredi() },
    { slug: "mercado_pago", nome: "Mercado Pago", ativo: false, taxas: taxasSugeridasMercadoPago() },
  ]
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
  return {
    version: 3,
    contas,
    pixPadraoContaId: contas[0]?.id ?? "",
    maquininhas: defaultMaquininhasTriple(),
    maquininhaEdicaoSlug: "pagbank",
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

function normalizeMaquininhasV3(
  raw: unknown,
  defaults: [MaquininhaConfig, MaquininhaConfig, MaquininhaConfig]
): [MaquininhaConfig, MaquininhaConfig, MaquininhaConfig] {
  if (!Array.isArray(raw)) return defaults
  const bySlug = new Map<MaquininhaSlug, MaquininhaConfig>()
  for (const m of raw) {
    const slug = (m as MaquininhaConfig)?.slug as MaquininhaSlug
    if (slug === "pagbank" || slug === "sicredi" || slug === "mercado_pago") {
      const def = defaults.find((d) => d.slug === slug)!
      bySlug.set(slug, {
        slug,
        nome: typeof (m as MaquininhaConfig).nome === "string" && (m as MaquininhaConfig).nome.trim()
          ? (m as MaquininhaConfig).nome.trim()
          : def.nome,
        ativo: typeof (m as MaquininhaConfig).ativo === "boolean" ? (m as MaquininhaConfig).ativo : false,
        taxas: normalizeTaxas((m as MaquininhaConfig).taxas, def.taxas),
      })
    }
  }
  return [
    bySlug.get("pagbank") ?? defaults[0],
    bySlug.get("sicredi") ?? defaults[1],
    bySlug.get("mercado_pago") ?? defaults[2],
  ]
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

  const slug: MaquininhaSlug =
    p.maquininhaEdicaoSlug === "sicredi" || p.maquininhaEdicaoSlug === "mercado_pago"
      ? p.maquininhaEdicaoSlug
      : "pagbank"

  const maquininhas = normalizeMaquininhasV3(p.maquininhas, base.maquininhas)

  return {
    version: 3,
    contas,
    pixPadraoContaId,
    maquininhas,
    maquininhaEdicaoSlug: slug,
    metaFaturamento: typeof p.metaFaturamento === "number" ? p.metaFaturamento : 0,
    metaObservacao: typeof p.metaObservacao === "string" ? p.metaObservacao : "",
  }
}

/** Migração v2 → v3: três maquininhas fixas; tenta copiar taxas da primeira entrada legada “PagBank”. */
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
      base.maquininhas[0] = {
        ...base.maquininhas[0],
        taxas: normalizeTaxas(pb.taxas, base.maquininhas[0].taxas),
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
      base.maquininhas[0] = {
        ...base.maquininhas[0],
        taxas: normalizeTaxas(p.pagbankTaxas, base.maquininhas[0].taxas),
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
      const parsed = JSON.parse(v3) as Partial<CentroFinanceiroV3>
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
