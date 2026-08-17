/**
 * Sincronização cliente ↔ writer V2. Sem Prisma.
 *
 * Fallback V2→V1 SOMENTE quando o servidor declara explicitamente
 * `SALE_WRITER_V1_ACTIVE`. Rede, capability unknown, numeração e
 * `IDEMPOTENCY_KEY_REUSED` NÃO viram V1.
 */

export const SALE_WRITER_V1_ACTIVE = "SALE_WRITER_V1_ACTIVE"
export const CLIENT_SALE_ID_REQUIRED = "CLIENT_SALE_ID_REQUIRED"
export const IDEMPOTENCY_KEY_REUSED = "IDEMPOTENCY_KEY_REUSED"

export type SaleWriterCapability = "v1" | "v2" | "unknown"

export type SalePersistErrorBody = {
  error?: string
  detail?: string
  code?: string
}

export function parseSalePersistError(body: string): { message: string; code?: string } {
  try {
    const j = JSON.parse(body) as SalePersistErrorBody
    const parts = [j.error, j.detail, j.code ? `(${j.code})` : ""].filter(Boolean)
    return {
      message: parts.length > 0 ? parts.join(" — ") : body.trim() || "erro",
      code: typeof j.code === "string" ? j.code : undefined,
    }
  } catch {
    return { message: body.trim() || "erro" }
  }
}

export function classifySaleWriterCapability(input: unknown): SaleWriterCapability {
  if (!input || typeof input !== "object") return "unknown"
  const writer = (input as { writer?: unknown }).writer
  if (writer === "v2") return "v2"
  if (writer === "v1") return "v1"
  return "unknown"
}

/**
 * Único caso em que uma pendência V2 pode ser convertida para o writer legado:
 * o SERVIDOR respondeu `SALE_WRITER_V1_ACTIVE`.
 */
export function shouldFallbackV2ToV1(input: {
  httpStatus?: number
  code?: string
  networkError?: boolean
  capability?: SaleWriterCapability
}): boolean {
  if (input.networkError === true) return false
  if (input.capability === "unknown") return false
  if (input.code === IDEMPOTENCY_KEY_REUSED) return false
  if (input.code === CLIENT_SALE_ID_REQUIRED) return false
  if (
    input.code === "SALE_NUMBERING_NOT_CONFIGURED" ||
    input.code === "SALE_SEQUENCE_EXHAUSTED" ||
    input.code === "SALE_NUMBERING_INVARIANT_BROKEN"
  ) {
    return false
  }
  return input.code === SALE_WRITER_V1_ACTIVE
}

export function vendaPersistV2Url(lojaId: string): string {
  return `/api/ops/venda-persist/v2?storeId=${encodeURIComponent(lojaId)}`
}

export function vendaByClientSaleIdUrl(lojaId: string, clientSaleId: string): string {
  const params = new URLSearchParams({ storeId: lojaId, clientSaleId })
  return `/api/ops/vendas/by-client-sale-id?${params.toString()}`
}

export function recoverQuarantinedSaleUrl(lojaId: string): string {
  return `/api/ops/vendas/recover-quarantined?storeId=${encodeURIComponent(lojaId)}`
}

/** DRY-RUN do lote — read-only, nunca muta. */
export function quarantineRecoveryPreviewUrl(lojaId: string): string {
  return `/api/ops/vendas/quarantine-recovery/preview?storeId=${encodeURIComponent(lojaId)}`
}

/** Execução do lote — uma transação por venda, no MESMO núcleo do recovery individual. */
export function quarantineRecoveryBatchUrl(lojaId: string): string {
  return `/api/ops/vendas/quarantine-recovery/batch?storeId=${encodeURIComponent(lojaId)}`
}

export type ConfirmedVendaView = {
  id: string
  storeId: string
  pedidoId: string
  clientSaleId?: string | null
  total: number
  at: string
  status: string
}

export function extractConfirmedVenda(body: unknown): ConfirmedVendaView | null {
  if (!body || typeof body !== "object") return null
  const venda = (body as { venda?: unknown }).venda
  if (!venda || typeof venda !== "object") return null
  const v = venda as Record<string, unknown>
  const pedidoId = typeof v.pedidoId === "string" ? v.pedidoId.trim() : ""
  const id = typeof v.id === "string" ? v.id.trim() : ""
  if (!pedidoId || !id) return null
  return {
    id,
    storeId: typeof v.storeId === "string" ? v.storeId : "",
    pedidoId,
    clientSaleId: typeof v.clientSaleId === "string" ? v.clientSaleId : null,
    total: typeof v.total === "number" ? v.total : 0,
    at: typeof v.at === "string" ? v.at : "",
    status: typeof v.status === "string" ? v.status : "concluida",
  }
}
