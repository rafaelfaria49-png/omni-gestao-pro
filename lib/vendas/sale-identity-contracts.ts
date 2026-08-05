/**
 * Contratos PUROS de identidade de venda (GOAL 002C-0).
 *
 * Decisão canônica: `docs/decisions/ADR-0021-identidade-tecnica-e-numero-comercial-da-venda.md`.
 *
 * Separação obrigatória:
 * - `clientSaleId` é a IDENTIDADE TÉCNICA, criada no cliente, estável entre retries
 *   e reenvios, única por `storeId`. Nunca é exibida como número comercial;
 * - `pedidoId` é o NÚMERO COMERCIAL definitivo, alocado exclusivamente pelo servidor
 *   no fluxo v2 (`lib/vendas/server-sale-numbering.ts`), dentro da transação da venda.
 *
 * Regras estruturais deste módulo:
 * - zero Prisma, zero `server-only`, zero I/O, zero relógio, zero aleatoriedade;
 * - **nunca** deriva `clientSaleId` de `pedidoId` — não há fallback, nem silencioso
 *   nem explícito. Um valor com forma de número comercial é REJEITADO como
 *   identidade técnica;
 * - **nunca** gera `clientSaleId`: a criação é do cliente, por decisão de arquitetura.
 *
 * Nenhum writer, rota, PDV ou store consome este módulo neste GOAL. Ele é contrato.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Fluxo do writer (representação pura da decisão v1 vs v2)
// ─────────────────────────────────────────────────────────────────────────────

export const SALE_WRITER_FLOW = Object.freeze({
  /** Writer atual: o cliente escolhe o número e ele vira `pedidoId`. */
  V1: "v1",
  /** Writer server-side: o servidor aloca o número; o cliente traz `clientSaleId`. */
  V2: "v2",
} as const)

export type SaleWriterFlow = (typeof SALE_WRITER_FLOW)[keyof typeof SALE_WRITER_FLOW]

export function isSaleWriterFlow(value: unknown): value is SaleWriterFlow {
  return value === SALE_WRITER_FLOW.V1 || value === SALE_WRITER_FLOW.V2
}

/** Somente o fluxo v2 exige identidade técnica do cliente. */
export function requiresClientSaleId(flow: SaleWriterFlow): boolean {
  return flow === SALE_WRITER_FLOW.V2
}

/** Somente o fluxo v2 aloca o número comercial no servidor. */
export function allocatesPedidoIdOnServer(flow: SaleWriterFlow): boolean {
  return flow === SALE_WRITER_FLOW.V2
}

// ─────────────────────────────────────────────────────────────────────────────
// clientSaleId — identidade técnica
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Faixa alinhada à coluna física `vendas."clientSaleId" VARCHAR(128)`
 * (migration `0016_add_sale_numbering_infrastructure`).
 */
export const CLIENT_SALE_ID_MIN_LENGTH = 8
export const CLIENT_SALE_ID_MAX_LENGTH = 128

/**
 * Token opaco: UUID, ULID, nanoid e afins passam. Case-sensitive de propósito —
 * a unique `(storeId, clientSaleId)` do PostgreSQL também é.
 */
const CLIENT_SALE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

/**
 * Prefixos reservados aos números comerciais em uso hoje: `VDA-` (PDV/writer v1 e
 * writer server-side) e `VND-` (faturamento de O.S.). Um valor com essa forma nunca
 * é aceito como identidade técnica — é o guard que impede `pedidoId` de virar
 * `clientSaleId` por acidente.
 */
export const RESERVED_SALE_NUMBER_PREFIXES = Object.freeze(["VDA", "VND"] as const)

const RESERVED_SALE_NUMBER_PREFIX_PATTERN = /^(?:VDA|VND)-/i

export type ClientSaleIdRejectionReason =
  | "MISSING"
  | "NOT_A_STRING"
  | "EMPTY"
  | "TOO_SHORT"
  | "TOO_LONG"
  | "INVALID_CHARACTERS"
  | "LOOKS_LIKE_SALE_NUMBER"

export type ClientSaleIdParseResult =
  | { readonly ok: true; readonly clientSaleId: string }
  | { readonly ok: false; readonly reason: ClientSaleIdRejectionReason }

/** Verdadeiro quando o valor tem forma de número comercial (`VDA-…`, `VND-…`). */
export function looksLikeSaleNumber(value: unknown): boolean {
  return typeof value === "string" && RESERVED_SALE_NUMBER_PREFIX_PATTERN.test(value.trim())
}

/**
 * Normaliza (apenas `trim`) e classifica. Não faz upper/lower-case: alterar o caixa
 * de um token opaco mudaria a chave de idempotência gravada no banco.
 */
export function parseClientSaleId(raw: unknown): ClientSaleIdParseResult {
  if (raw === null || raw === undefined) return { ok: false, reason: "MISSING" }
  if (typeof raw !== "string") return { ok: false, reason: "NOT_A_STRING" }

  const normalized = raw.trim()
  if (normalized.length === 0) return { ok: false, reason: "EMPTY" }
  if (looksLikeSaleNumber(normalized)) return { ok: false, reason: "LOOKS_LIKE_SALE_NUMBER" }
  if (!CLIENT_SALE_ID_PATTERN.test(normalized)) {
    return { ok: false, reason: "INVALID_CHARACTERS" }
  }
  if (normalized.length < CLIENT_SALE_ID_MIN_LENGTH) return { ok: false, reason: "TOO_SHORT" }
  if (normalized.length > CLIENT_SALE_ID_MAX_LENGTH) return { ok: false, reason: "TOO_LONG" }

  return { ok: true, clientSaleId: normalized }
}

/** `null` em vez de razão, para call sites que só precisam do valor. */
export function normalizeClientSaleId(raw: unknown): string | null {
  const parsed = parseClientSaleId(raw)
  return parsed.ok ? parsed.clientSaleId : null
}

export function isValidClientSaleId(raw: unknown): boolean {
  return parseClientSaleId(raw).ok
}

// ─────────────────────────────────────────────────────────────────────────────
// pedidoId — número comercial
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classificação por FORMA, não por origem. A origem persistida é
 * `Venda.numeracaoOrigem`; esta função apenas lê a string.
 */
export type SalePedidoIdShape =
  /** `VDA-{CODIGO}-{ANO}-{NNNNNN}` — formato alocado pelo servidor (ADR-0019). */
  | "SERVER_ALLOCATED"
  /** `VDA-{ANO}-{NNNN}` — número provisório do writer v1 (MAX+1 no navegador). */
  | "LEGACY_CLIENT_PROVISIONAL"
  /** `VND-{ANO}-{NNNNN}` — faturamento de O.S. (`count()+1`). */
  | "LEGACY_OS"
  | "UNKNOWN"

const SERVER_ALLOCATED_PEDIDO_ID_PATTERN = /^VDA-[A-Z0-9]{2,8}-\d{4}-\d{6}$/
const LEGACY_CLIENT_PEDIDO_ID_PATTERN = /^VDA-\d{4}-\d+$/
const LEGACY_OS_PEDIDO_ID_PATTERN = /^VND-\d{4}-\d+$/

export function classifySalePedidoIdShape(raw: unknown): SalePedidoIdShape {
  if (typeof raw !== "string") return "UNKNOWN"
  const value = raw.trim()
  if (SERVER_ALLOCATED_PEDIDO_ID_PATTERN.test(value)) return "SERVER_ALLOCATED"
  if (LEGACY_CLIENT_PEDIDO_ID_PATTERN.test(value)) return "LEGACY_CLIENT_PROVISIONAL"
  if (LEGACY_OS_PEDIDO_ID_PATTERN.test(value)) return "LEGACY_OS"
  return "UNKNOWN"
}

/**
 * Número provisório do writer v1. Um valor assim NUNCA pode ser persistido como
 * `pedidoId` definitivo de uma venda do fluxo v2.
 */
export function isProvisionalSalePedidoId(raw: unknown): boolean {
  return classifySalePedidoIdShape(raw) === "LEGACY_CLIENT_PROVISIONAL"
}

export function isServerAllocatedSalePedidoId(raw: unknown): boolean {
  return classifySalePedidoIdShape(raw) === "SERVER_ALLOCATED"
}

export type ClientPedidoIdRejectionReason =
  /** No fluxo v2 o número é do servidor; nenhum valor do cliente é aceito. */
  | "SERVER_ALLOCATES_IN_V2"
  /** No fluxo v1 o número continua sendo do cliente, mas não pode ser vazio. */
  | "EMPTY"

export type ClientPedidoIdAcceptance =
  | { readonly accepted: true; readonly pedidoId: string }
  | { readonly accepted: false; readonly reason: ClientPedidoIdRejectionReason }

/**
 * Decide se o `pedidoId` enviado pelo cliente pode ser aceito.
 *
 * v1: aceito (comportamento atual, preservado byte a byte pelo gate desligado).
 * v2: recusado sempre — inclusive quando o valor é bem-formado.
 */
export function classifyClientSuppliedPedidoId(
  flow: SaleWriterFlow,
  raw: unknown,
): ClientPedidoIdAcceptance {
  if (allocatesPedidoIdOnServer(flow)) {
    return { accepted: false, reason: "SERVER_ALLOCATES_IN_V2" }
  }
  const value = typeof raw === "string" ? raw.trim() : ""
  if (!value) return { accepted: false, reason: "EMPTY" }
  return { accepted: true, pedidoId: value }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconciliação: create vs replay
// ─────────────────────────────────────────────────────────────────────────────

/** Chave de reconciliação e idempotência do fluxo v2. Nunca inclui `pedidoId`. */
export type SaleIdentityKey = {
  readonly storeId: string
  readonly clientSaleId: string
}

/** Recorte mínimo de uma venda já persistida, sem tipos Prisma. */
export type ExistingSaleIdentity = {
  readonly storeId: string
  readonly clientSaleId: string | null
  readonly pedidoId: string | null
}

export type SaleIdentityKeyRejectionReason =
  | "STORE_ID_MISSING"
  | { readonly clientSaleId: ClientSaleIdRejectionReason }

export type SaleIdentityKeyResult =
  | { readonly ok: true; readonly key: SaleIdentityKey }
  | { readonly ok: false; readonly reason: SaleIdentityKeyRejectionReason }

/**
 * Monta a chave técnica. `storeId` é sempre explícito — sem fallback para `loja-1`,
 * pela mesma razão que o allocator recusa loja vazia (ADR-0003, ADR-0019).
 */
export function buildSaleIdentityKey(input: {
  storeId: unknown
  clientSaleId: unknown
}): SaleIdentityKeyResult {
  const storeId = typeof input.storeId === "string" ? input.storeId.trim() : ""
  if (!storeId) return { ok: false, reason: "STORE_ID_MISSING" }

  const parsed = parseClientSaleId(input.clientSaleId)
  if (!parsed.ok) return { ok: false, reason: { clientSaleId: parsed.reason } }

  return { ok: true, key: { storeId, clientSaleId: parsed.clientSaleId } }
}

/** Lojas diferentes podem usar o mesmo `clientSaleId`: a unique é composta. */
export function saleIdentityKeysMatch(a: SaleIdentityKey, b: SaleIdentityKey): boolean {
  return a.storeId === b.storeId && a.clientSaleId === b.clientSaleId
}

export type SaleWriteConflictReason =
  /** A venda encontrada pertence a outra loja — fail-closed, nunca replay. */
  | "STORE_MISMATCH"
  /** A venda encontrada tem outra identidade técnica. */
  | "CLIENT_SALE_ID_MISMATCH"
  /** Venda histórica/writer v1: `clientSaleId` NULL não prova replay de nada. */
  | "EXISTING_SALE_WITHOUT_CLIENT_SALE_ID"
  /** Invariante quebrada: venda persistida sem número comercial. */
  | "EXISTING_SALE_WITHOUT_PEDIDO_ID"

export type SaleWriteDecision =
  | { readonly kind: "create"; readonly key: SaleIdentityKey }
  | { readonly kind: "replay"; readonly key: SaleIdentityKey; readonly pedidoId: string }
  | { readonly kind: "conflict"; readonly reason: SaleWriteConflictReason }

/**
 * Classifica a tentativa de escrita a partir da chave técnica e da venda já
 * encontrada por `(storeId, clientSaleId)`.
 *
 * - `create` — nada existe: o writer aloca UM número;
 * - `replay` — a mesma tentativa: devolve o `pedidoId` existente, sem alocar número
 *   novo e sem repetir estoque, caixa, financeiro ou eventos;
 * - `conflict` — qualquer divergência: fail-closed, decisão do chamador (409).
 *
 * A função não conhece Prisma nem executa consulta: recebe o que já foi lido.
 */
export function classifySaleWriteIntent(input: {
  key: SaleIdentityKey
  existing?: ExistingSaleIdentity | null
}): SaleWriteDecision {
  const { key, existing } = input
  if (!existing) return { kind: "create", key }

  if (existing.storeId !== key.storeId) {
    return { kind: "conflict", reason: "STORE_MISMATCH" }
  }
  if (existing.clientSaleId === null || existing.clientSaleId === undefined) {
    return { kind: "conflict", reason: "EXISTING_SALE_WITHOUT_CLIENT_SALE_ID" }
  }
  if (existing.clientSaleId !== key.clientSaleId) {
    return { kind: "conflict", reason: "CLIENT_SALE_ID_MISMATCH" }
  }

  const pedidoId = typeof existing.pedidoId === "string" ? existing.pedidoId.trim() : ""
  if (!pedidoId) {
    return { kind: "conflict", reason: "EXISTING_SALE_WITHOUT_PEDIDO_ID" }
  }

  return { kind: "replay", key, pedidoId }
}

export function isReplayDecision(
  decision: SaleWriteDecision,
): decision is Extract<SaleWriteDecision, { kind: "replay" }> {
  return decision.kind === "replay"
}
