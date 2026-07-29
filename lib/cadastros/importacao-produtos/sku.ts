/**
 * Identidade do produto importado — o que é SKU de verdade e o que é resíduo do parser.
 *
 * `linha-N` é o índice interno que o merger usa quando a planilha não tem coluna-chave
 * (`mergePlanilhaIndependente`). Ele nunca pode chegar ao cadastro: virou SKU comercial
 * dos 13 produtos da NF-e Martins 5.380.135 e quebrou dedupe, score e conferência.
 */

/** Prefixos gravados automaticamente por importadores antigos — não fazem parte do código. */
const PREFIXO_IMPORTADOR_RE = /^(?:gc-|prod-|id-)+/i

/** Índice de linha do parser: `linha-1`, `LINHA-999`, `gc-linha-3`. */
const LINHA_N_RE = /^linha[-_ ]?\d+$/i

/**
 * Fallback histórico do persistidor: `IMP-${slugCategoria}-${slugNome}`.
 * Exige os dois segmentos para não marcar como sintético um código legítimo
 * de fornecedor do tipo `IMP-4471`.
 */
const IMP_GERADO_RE = /^imp-[a-z0-9_]+-[a-z0-9][a-z0-9-]*$/i

/** Preenchimentos de "sem código" que aparecem em planilha e em UI. */
const PLACEHOLDERS = new Set(["", "-", "--", "—", "–", "n/a", "na", "null", "undefined", "sem sku", "sem codigo", "sem código"])

function base(value: unknown): string {
  return String(value ?? "").trim()
}

/** Remove prefixos de importador antes de julgar o miolo do código. */
function semPrefixoImportador(value: string): string {
  return value.replace(PREFIXO_IMPORTADOR_RE, "").trim()
}

/** Placeholder de "não informado" — não é identificador nem para dedupe nem para score. */
export function isPlaceholderIdentifier(value: unknown): boolean {
  const raw = base(value)
  if (!raw) return true
  return PLACEHOLDERS.has(raw.toLowerCase())
}

/**
 * `true` quando o valor foi FABRICADO por um importador e não veio da planilha.
 * Reconhece `linha-N` e o `IMP-<categoria>-<nome>` gerado pelo persistidor, com ou
 * sem prefixo automático (`gc-`, `prod-`, `id-`) por cima.
 */
export function isSyntheticImportSku(value: unknown): boolean {
  const raw = base(value)
  if (!raw) return false
  const miolo = semPrefixoImportador(raw)
  if (!miolo) return false
  return LINHA_N_RE.test(miolo) || IMP_GERADO_RE.test(miolo)
}

/**
 * SKU utilizável como identidade comercial: existe, não é placeholder e não é sintético.
 * É o único predicado que deve autorizar gravar/pontuar/deduplicar por SKU.
 */
export function isRealProductSku(value: unknown): boolean {
  if (isPlaceholderIdentifier(value)) return false
  return !isSyntheticImportSku(value)
}

/**
 * SKU pronto para persistir: string limpa ou `null`.
 * Ausência permanece ausência — o importador não inventa mais `IMP-*`.
 */
export function normalizeImportSku(value: unknown): string | null {
  const raw = base(value)
  if (!isRealProductSku(raw)) return null
  return raw
}

/** Comparação de SKU entre planilha e banco (case-insensitive, sem prefixo de importador). */
export function chaveSku(value: unknown): string {
  const miolo = semPrefixoImportador(base(value)).toLowerCase()
  return miolo
}

/** Código de barras normalizado: só dígitos. Vazio quando não houver dígito algum. */
export function normalizeBarcode(value: unknown): string | null {
  const digits = base(value).replace(/\D/g, "")
  if (!digits) return null
  return digits
}

/** Nome normalizado para matching exato (sem acento, sem caixa, espaços colapsados). */
export function chaveNomeProduto(value: unknown): string {
  return base(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}
