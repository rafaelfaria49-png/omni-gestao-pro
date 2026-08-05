/**
 * Contrato PURO de `Store.codigoNumeracaoVenda` (GOAL 002C-0).
 *
 * Decisão canônica: `docs/decisions/ADR-0021-identidade-tecnica-e-numero-comercial-da-venda.md`.
 *
 * O código é o componente `{CODIGO}` de `VDA-{CODIGO}-{ANO}-{NNNNNN}` (ADR-0019) e
 * também o `prefixo` write-once de `SerieVenda`. A coluna física é
 * `stores."codigoNumeracaoVenda" VARCHAR(8)`, NULLABLE, com unique global e
 * `CHECK ("codigoNumeracaoVenda" ~ '^[A-Z0-9]{2,8}$')`
 * (migration `0016_add_sale_numbering_infrastructure`).
 *
 * Este módulo é o espelho puro dessas regras: zero Prisma, zero `server-only`,
 * zero I/O. Ele NÃO provisiona código para loja alguma — provisionamento é o
 * gate G1, tratado em GOAL próprio.
 *
 * `lib/vendas/server-sale-numbering.ts` mantém sua própria cópia do normalizador
 * porque é `server-only`; a equivalência é travada por teste de paridade em
 * `sale-numbering-contracts.static.test.ts`.
 */

export const STORE_SALE_NUMBERING_CODE_MIN_LENGTH = 2
export const STORE_SALE_NUMBERING_CODE_MAX_LENGTH = 8

/** Idêntico ao CHECK físico da migration 0016. */
export const STORE_SALE_NUMBERING_CODE_PATTERN = /^[A-Z0-9]{2,8}$/

const ALLOWED_CHARACTERS_PATTERN = /^[A-Z0-9]+$/

export type StoreSaleNumberingCodeRejectionReason =
  | "MISSING"
  | "NOT_A_STRING"
  | "EMPTY"
  | "TOO_SHORT"
  | "TOO_LONG"
  | "INVALID_CHARACTERS"
  | "DUPLICATE"

export type StoreSaleNumberingCodeResult =
  | { readonly ok: true; readonly codigo: string }
  | { readonly ok: false; readonly reason: StoreSaleNumberingCodeRejectionReason }

/**
 * `trim` + `toUpperCase`, então valida contra o CHECK físico.
 * O upper-case é seguro aqui (diferente de `clientSaleId`): o domínio é `[A-Z0-9]`
 * por constraint de banco, então normalizar não perde informação.
 */
export function normalizeStoreSaleNumberingCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const normalized = raw.trim().toUpperCase()
  return STORE_SALE_NUMBERING_CODE_PATTERN.test(normalized) ? normalized : null
}

export function isValidStoreSaleNumberingCode(raw: unknown): boolean {
  return normalizeStoreSaleNumberingCode(raw) !== null
}

/** Mesma validação, com a razão da recusa. `DUPLICATE` só sai de `planStoreSaleNumberingCodes`. */
export function classifyStoreSaleNumberingCode(raw: unknown): StoreSaleNumberingCodeResult {
  if (raw === null || raw === undefined) return { ok: false, reason: "MISSING" }
  if (typeof raw !== "string") return { ok: false, reason: "NOT_A_STRING" }

  const normalized = raw.trim().toUpperCase()
  if (normalized.length === 0) return { ok: false, reason: "EMPTY" }
  if (!ALLOWED_CHARACTERS_PATTERN.test(normalized)) {
    return { ok: false, reason: "INVALID_CHARACTERS" }
  }
  if (normalized.length < STORE_SALE_NUMBERING_CODE_MIN_LENGTH) {
    return { ok: false, reason: "TOO_SHORT" }
  }
  if (normalized.length > STORE_SALE_NUMBERING_CODE_MAX_LENGTH) {
    return { ok: false, reason: "TOO_LONG" }
  }

  return { ok: true, codigo: normalized }
}

export type StoreSaleNumberingCodeCandidate = {
  readonly storeId: string
  readonly codigo: unknown
}

export type StoreSaleNumberingCodeAssignment = {
  readonly storeId: string
  readonly codigo: string
}

export type StoreSaleNumberingCodeRejection = {
  readonly storeId: string
  readonly reason: StoreSaleNumberingCodeRejectionReason
  /** Loja que já detém o código normalizado, quando `reason === "DUPLICATE"`. */
  readonly conflictsWithStoreId?: string
}

export type StoreSaleNumberingCodePlan = {
  readonly assignments: readonly StoreSaleNumberingCodeAssignment[]
  readonly rejections: readonly StoreSaleNumberingCodeRejection[]
}

/**
 * Valida um lote de candidatos contra o formato e contra o unique global do código.
 *
 * `taken` representa os códigos já ocupados (`codigo normalizado -> storeId`), lidos
 * fora daqui. A mesma loja reapresentando o código que já possui NÃO é duplicata.
 * Nenhuma escrita acontece: o retorno é um plano, não um efeito.
 */
export function planStoreSaleNumberingCodes(
  candidates: readonly StoreSaleNumberingCodeCandidate[],
  taken: ReadonlyMap<string, string> = new Map(),
): StoreSaleNumberingCodePlan {
  const assignments: StoreSaleNumberingCodeAssignment[] = []
  const rejections: StoreSaleNumberingCodeRejection[] = []
  const owners = new Map<string, string>(taken)

  for (const candidate of candidates) {
    const storeId = typeof candidate.storeId === "string" ? candidate.storeId.trim() : ""
    if (!storeId) {
      rejections.push({ storeId: "", reason: "MISSING" })
      continue
    }

    const parsed = classifyStoreSaleNumberingCode(candidate.codigo)
    if (!parsed.ok) {
      rejections.push({ storeId, reason: parsed.reason })
      continue
    }

    const owner = owners.get(parsed.codigo)
    if (owner !== undefined && owner !== storeId) {
      rejections.push({ storeId, reason: "DUPLICATE", conflictsWithStoreId: owner })
      continue
    }

    owners.set(parsed.codigo, storeId)
    assignments.push({ storeId, codigo: parsed.codigo })
  }

  return { assignments, rejections }
}
