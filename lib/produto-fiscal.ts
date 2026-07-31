/**
 * Identidade fiscal do PRODUTO (GOAL_004 — Produto Fiscal Persist).
 *
 * Fonte ÚNICA da verdade fiscal do produto. Hoje persiste em `Produto.metadata.fiscal`
 * (JSONB já existente — sem alteração de schema, sem migration, sem db:push), de forma
 * ADITIVA e DORMENTE. A promoção para colunas dedicadas é um GOAL de schema futuro e fica
 * INVISÍVEL aos consumidores graças a este contrato: ninguém lê campos fiscais direto do
 * produto — todo acesso passa por `getProdutoFiscal()`.
 *
 * NÃO calcula imposto, NÃO emite nada. Apenas guarda/lê o cadastro fiscal.
 *
 * Compatibilidade:
 *  - Produtos NOVOS (form/API): gravam em `metadata.fiscal`.
 *  - Importador legado: gravava `metadata.ncm`/`metadata.cest` no topo — `getProdutoFiscal`
 *    faz fallback para essas chaves (produtos antigos continuam lidos corretamente).
 *  - Produtos SEM dado fiscal: retornam o contrato com campos vazios (nunca lança).
 */

/** Campos fiscais do produto. Sempre presentes como string ("" = não informado). */
export type ProdutoFiscal = {
  /** NCM — 8 dígitos. */
  ncm: string
  /** CEST — 7 dígitos. */
  cest: string
  /** CFOP padrão da venda — 4 dígitos. */
  cfop: string
  /** CST (regime normal) — tabela ICMS. */
  cst: string
  /** CSOSN (Simples Nacional). */
  csosn: string
  /** Origem da mercadoria — 1 caractere "0".."8". */
  origemMercadoria: string
  /** Unidade comercial (uCom), ex.: "UN", "KG". */
  unidadeComercial: string
  /** Unidade tributável (uTrib). */
  unidadeTributavel: string
  /** Código ANP (combustíveis) — quando aplicável. */
  codigoAnp: string
  /** EX TIPI — quando aplicável. */
  exTipi: string
}

/** Entrada crua (parcial) — aceita aliases comuns vindos de form/IA/importador. */
export type ProdutoFiscalInput = Partial<{
  ncm: string | null
  cest: string | null
  cfop: string | null
  cst: string | null
  csosn: string | null
  origemMercadoria: string | null
  /** alias do form/IA */
  origem: string | null
  unidadeComercial: string | null
  /** aliases comuns */
  unidade: string | null
  unidadeTributavel: string | null
  codigoAnp: string | null
  exTipi: string | null
}>

export const PRODUTO_FISCAL_VAZIO: Readonly<ProdutoFiscal> = Object.freeze({
  ncm: "",
  cest: "",
  cfop: "",
  cst: "",
  csosn: "",
  origemMercadoria: "",
  unidadeComercial: "",
  unidadeTributavel: "",
  codigoAnp: "",
  exTipi: "",
})

function s(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim()
}
function digits(v: unknown, max: number): string {
  return s(v).replace(/\D/g, "").slice(0, max)
}

/** Normaliza/valida campos fiscais (puro). Não inventa dados; só limpa formato. */
export function sanitizeProdutoFiscal(input: ProdutoFiscalInput | null | undefined): ProdutoFiscal {
  if (!input || typeof input !== "object") return { ...PRODUTO_FISCAL_VAZIO }
  const ncm = digits(input.ncm, 8)
  let cest = digits(input.cest, 7)
  if (cest.length > 0 && cest.length < 7) cest = cest.padStart(7, "0")
  const cfop = digits(input.cfop, 4)
  const origemRaw = s(input.origemMercadoria ?? input.origem).replace(/\D/g, "").slice(0, 1)
  const origemMercadoria = /^[0-8]$/.test(origemRaw) ? origemRaw : ""
  return {
    ncm: ncm.length === 8 ? ncm : "",
    cest: cest.length === 7 ? cest : "",
    cfop: cfop.length === 4 ? cfop : "",
    cst: s(input.cst).replace(/\D/g, "").slice(0, 3),
    csosn: s(input.csosn).replace(/\D/g, "").slice(0, 4),
    origemMercadoria,
    unidadeComercial: s(input.unidadeComercial ?? input.unidade).toUpperCase().slice(0, 6),
    unidadeTributavel: s(input.unidadeTributavel).toUpperCase().slice(0, 6),
    codigoAnp: digits(input.codigoAnp, 9),
    exTipi: digits(input.exTipi, 3),
  }
}

/** Campos do contrato canônico, na ordem de gravação. */
const FISCAL_KEYS = Object.keys(PRODUTO_FISCAL_VAZIO) as (keyof ProdutoFiscal)[]

/** True se nenhum campo fiscal foi informado. */
export function isProdutoFiscalVazio(f: ProdutoFiscal): boolean {
  return FISCAL_KEYS.every((k) => !f[k])
}

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/**
 * LEITURA CANÔNICA — única forma de obter os dados fiscais do produto.
 * Aceita o produto (`{ metadata }`) ou diretamente o objeto `metadata`.
 * Preferência: `metadata.fiscal.*`; fallback legado: `metadata.ncm`/`metadata.cest` (topo).
 */
export function getProdutoFiscal(
  source: { metadata?: unknown } | Record<string, unknown> | null | undefined,
): ProdutoFiscal {
  if (!source || typeof source !== "object") return { ...PRODUTO_FISCAL_VAZIO }
  // Aceita tanto o produto (tem `metadata`) quanto o próprio metadata.
  const maybeProduto = asObject((source as { metadata?: unknown }).metadata)
  const metadata = maybeProduto ?? asObject(source)
  if (!metadata) return { ...PRODUTO_FISCAL_VAZIO }

  const fiscalCanonico = asObject(metadata.fiscal)
  if (fiscalCanonico) return sanitizeProdutoFiscal(fiscalCanonico as ProdutoFiscalInput)

  // Fallback legado (importador antigo gravava no topo do metadata).
  if (metadata.ncm != null || metadata.cest != null) {
    return sanitizeProdutoFiscal({ ncm: s(metadata.ncm), cest: s(metadata.cest) })
  }
  return { ...PRODUTO_FISCAL_VAZIO }
}

/**
 * ESCRITA CANÔNICA — devolve um novo objeto `metadata` com `fiscal` saneado, preservando
 * todas as demais chaves. Se nada fiscal for informado, NÃO adiciona a chave (evita poluir).
 * `metadataBase` pode ser o metadata atual do produto (merge não-destrutivo).
 *
 * O merge é PARCIAL campo a campo — nunca substitui o bloco `fiscal` inteiro:
 *  - chave ausente / `undefined` / `null` / string vazia → preserva o valor atual;
 *  - valor válido depois do saneamento → substitui SOMENTE aquele campo;
 *  - valor inválido (NCM curto, origem fora de 0-8…) → omitido, preserva o atual;
 *  - entrada fiscal vazia → `metadata.fiscal` atual fica intacto;
 *  - chaves de `metadata.fiscal` fora do contrato canônico → preservadas (nunca lidas).
 *
 * Não existe canal de limpeza explícita de campo fiscal: as portas (`fiscalInputFromBody`,
 * `fiscalInputDaLinha`) já traduzem "não informado" para `null`/vazio, e apagar por omissão
 * foi exatamente o defeito que este contrato fecha.
 */
export function mergeProdutoFiscalIntoMetadata(
  metadataBase: unknown,
  fiscalInput: ProdutoFiscalInput | null | undefined,
): Record<string, unknown> {
  const base = { ...(asObject(metadataBase) ?? {}) }
  // Ponto de partida = identidade JÁ gravada (canônica; com o fallback legado do topo).
  const atual = getProdutoFiscal(base)
  const entrada = sanitizeProdutoFiscal(fiscalInput)
  const fiscal: ProdutoFiscal = { ...atual }
  for (const k of FISCAL_KEYS) {
    if (entrada[k]) fiscal[k] = entrada[k]
  }
  if (isProdutoFiscalVazio(fiscal)) return base
  // Chaves já persistidas em `metadata.fiscal` fora do contrato (ex.: GTIN gravado por caller
  // antigo): este helper não as interpreta, mas também não as apaga.
  const extras: Record<string, unknown> = {}
  const fiscalGravado = asObject(base.fiscal)
  if (fiscalGravado) {
    for (const [k, v] of Object.entries(fiscalGravado)) {
      if (!(k in PRODUTO_FISCAL_VAZIO)) extras[k] = v
    }
  }
  // Guarda apenas os campos não-vazios (JSONB enxuto).
  const compact: Record<string, unknown> = { ...extras }
  for (const k of FISCAL_KEYS) {
    if (fiscal[k]) compact[k] = fiscal[k]
  }
  base.fiscal = compact
  return base
}

/** Chaves fiscais aceitas no topo do body da API (além de `metadata.fiscal`). */
export const PRODUTO_FISCAL_BODY_KEYS = [
  "ncm", "cest", "cfop", "cst", "csosn", "origemMercadoria", "origem",
  "unidadeComercial", "unidade", "unidadeTributavel", "codigoAnp", "exTipi",
] as const

/** Extrai os campos fiscais presentes no body cru (top-level) → input para o helper. */
export function fiscalInputFromBody(raw: Record<string, unknown>): ProdutoFiscalInput | null {
  let any = false
  const out: ProdutoFiscalInput = {}
  for (const k of PRODUTO_FISCAL_BODY_KEYS) {
    if (raw[k] !== undefined && raw[k] !== null) {
      ;(out as Record<string, unknown>)[k] = raw[k]
      any = true
    }
  }
  // Também aceita `metadata.fiscal` vindo do body.
  const meta = asObject(raw.metadata)
  const metaFiscal = meta ? asObject(meta.fiscal) : null
  if (metaFiscal) {
    for (const k of PRODUTO_FISCAL_BODY_KEYS) {
      if (out[k as keyof ProdutoFiscalInput] === undefined && metaFiscal[k] != null) {
        ;(out as Record<string, unknown>)[k] = metaFiscal[k]
        any = true
      }
    }
  }
  return any ? out : null
}
