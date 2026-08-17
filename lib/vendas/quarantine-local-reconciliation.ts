/**
 * Reconciliação LOCAL após a recuperação em lote
 * (GOAL PDV-VENDAS-QUARENTENA-RECOVERY-ALL-P0-006A).
 *
 * Funções puras: sem Prisma, sem rede, sem relógio, sem `setState`. O store aplica.
 *
 * Regra única e não negociável: uma cópia local só sai da quarentena quando existe
 * EVIDÊNCIA server-side da venda recuperada (`venda.pedidoId` + `venda.id`). Nada de
 * apagar o bloqueio por otimismo, timeout ou "provavelmente deu certo".
 */

import { isSaleIdentityConflictCode } from "@/lib/vendas/sale-identity-conflict"

/**
 * Tamanho da fatia enviada por requisição.
 *
 * O cliente fatia porque o número de quarentenas varia por máquina e a rota tem teto:
 * sem fatiar, uma instalação carregada bateria no limite e ficaria sem caminho de
 * recuperação. Fatias também mantêm cada requisição curta — e como cada venda é
 * idempotente por `(storeId, clientSaleId)`, uma fatia que falhe na rede não desfaz as
 * anteriores nem duplica no retry.
 */
export const QUARANTINE_RECOVERY_CHUNK = 50

/** Fatia um array em blocos de `size`. Puro. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const limit = Math.max(1, Math.floor(size))
  const slices: T[][] = []
  for (let index = 0; index < items.length; index += limit) {
    slices.push(items.slice(index, index + limit))
  }
  return slices
}

/** Recorte mínimo de uma venda local. Estrutural para não acoplar ao `SaleRecord`. */
export type LocalSaleShape = {
  readonly id: string
  readonly clientSaleId?: string
  readonly serverId?: string
  readonly syncPending?: boolean
  readonly syncBlockedCode?: string
}

export type RecoveryResultShape = {
  readonly conflictingPedidoId: string
  readonly clientSaleId: string | null
  readonly status: string
  readonly venda: { readonly id: string; readonly pedidoId: string; readonly clientSaleId?: string | null } | null
}

export type RecoveryConfirmation = {
  readonly clientSaleId: string
  readonly pedidoId: string
  readonly serverId: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Agregação no cliente
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resumos recalculados no cliente porque o plano e o resultado chegam FATIADOS.
 *
 * Duplicam de propósito a soma feita no servidor (`summarizeQuarantinePlan` /
 * `summarizeBatchResults`): aqueles módulos são server-only — a cadeia do planner puxa
 * `node:crypto` pelo fingerprint — e não podem entrar no bundle do navegador.
 */
export type PlanItemShape = {
  readonly bucket: string
  readonly klass: string
  readonly total: number
}

export function summarizePlanItems(items: readonly PlanItemShape[]) {
  const byClass: Record<string, number> = {}
  let ready = 0
  let alreadyRecovered = 0
  let requiresConfirmation = 0
  let blocked = 0
  let valorTotal = 0
  let valorExecutavel = 0

  const round = (value: number) => Math.round(value * 100) / 100

  for (const item of items) {
    byClass[item.klass] = (byClass[item.klass] ?? 0) + 1
    const total = typeof item.total === "number" && Number.isFinite(item.total) ? item.total : 0
    valorTotal = round(valorTotal + total)
    if (item.bucket === "READY" || item.bucket === "REQUIRES_CONFIRMATION") {
      valorExecutavel = round(valorExecutavel + total)
    }
    if (item.bucket === "READY") ready += 1
    else if (item.bucket === "ALREADY_RECOVERED") alreadyRecovered += 1
    else if (item.bucket === "REQUIRES_CONFIRMATION") requiresConfirmation += 1
    else blocked += 1
  }

  return {
    total: items.length,
    ready,
    alreadyRecovered,
    requiresConfirmation,
    blocked,
    valorTotal,
    valorExecutavel,
    byClass,
  }
}

export function summarizeRecoveryResults(results: readonly { readonly status: string }[]) {
  let recovered = 0
  let alreadyRecovered = 0
  let requiresConfirmation = 0
  let blocked = 0
  let failed = 0
  for (const result of results) {
    if (result.status === "RECOVERED") recovered += 1
    else if (result.status === "ALREADY_RECOVERED") alreadyRecovered += 1
    else if (result.status === "REQUIRES_CONFIRMATION") requiresConfirmation += 1
    else if (result.status === "BLOCKED") blocked += 1
    else failed += 1
  }
  return {
    total: results.length,
    recovered,
    alreadyRecovered,
    requiresConfirmation,
    blocked,
    failed,
  }
}

/** `true` quando a venda local está em quarentena de identidade. */
export function isQuarantinedLocalSale(sale: LocalSaleShape): boolean {
  return (
    Boolean(sale.id) &&
    sale.syncPending === true &&
    isSaleIdentityConflictCode(sale.syncBlockedCode)
  )
}

/**
 * Confirmações aplicáveis, extraídas do resultado do lote.
 *
 * Só `RECOVERED` e `ALREADY_RECOVERED` COM venda completa entram. `REQUIRES_CONFIRMATION`,
 * `BLOCKED` e `FAILED` são descartados de propósito — a quarentena permanece.
 */
export function buildRecoveryConfirmations(
  results: readonly RecoveryResultShape[],
): RecoveryConfirmation[] {
  const confirmations: RecoveryConfirmation[] = []
  const seen = new Set<string>()

  for (const result of results) {
    if (result.status !== "RECOVERED" && result.status !== "ALREADY_RECOVERED") continue
    const venda = result.venda
    if (!venda) continue

    const pedidoId = typeof venda.pedidoId === "string" ? venda.pedidoId.trim() : ""
    const serverId = typeof venda.id === "string" ? venda.id.trim() : ""
    const clientSaleId =
      (typeof result.clientSaleId === "string" ? result.clientSaleId.trim() : "") ||
      (typeof venda.clientSaleId === "string" ? venda.clientSaleId.trim() : "")

    // Sem os três, não há como casar a cópia local com segurança.
    if (!pedidoId || !serverId || !clientSaleId) continue
    if (seen.has(clientSaleId)) continue
    seen.add(clientSaleId)
    confirmations.push({ clientSaleId, pedidoId, serverId })
  }

  return confirmations
}

/**
 * Aplica as confirmações às vendas locais.
 *
 * Casa por `clientSaleId` EXATO — nunca por `id`. Duas quarentenas distintas podem
 * compartilhar o MESMO número antigo (é a colisão que originou o incidente); casar por
 * número confirmaria a venda errada e apagaria o bloqueio de uma venda que nunca foi
 * persistida no servidor.
 *
 * Não muta a entrada: devolve novo array.
 */
export function applyRecoveryConfirmations<T extends LocalSaleShape>(
  sales: readonly T[],
  confirmations: readonly RecoveryConfirmation[],
): { sales: T[]; reconciled: number } {
  if (confirmations.length === 0) return { sales: [...sales], reconciled: 0 }

  const byClientSaleId = new Map(
    confirmations.map((confirmation) => [confirmation.clientSaleId, confirmation] as const),
  )
  let reconciled = 0

  const next = sales.map((sale) => {
    const clientSaleId = typeof sale.clientSaleId === "string" ? sale.clientSaleId : ""
    if (!clientSaleId) return sale
    const confirmation = byClientSaleId.get(clientSaleId)
    if (!confirmation) return sale
    reconciled += 1
    return {
      ...sale,
      id: confirmation.pedidoId,
      serverId: confirmation.serverId,
      syncPending: false,
      syncBlockedCode: undefined,
    }
  })

  return { sales: next, reconciled }
}
