/**
 * Cancelamento no Histórico de Vendas (GOAL PDV-VENDAS-CANCELAMENTO-UI-NO-POST-FIX-013).
 *
 * Funções puras + POST único para `/api/vendas/[id]/cancelar`. Sem Prisma.
 *
 * Regra: venda confirmada no servidor (`REMOTE_CONFIRMED` ou GET /api/vendas/[id]
 * ok=true) usa o servidor como fonte da verdade. Cópia local stale com o mesmo
 * id/clientSaleId NÃO bloqueia o POST. Entidade realmente LOCAL_PENDING ou
 * LOCAL_QUARANTINED continua bloqueada.
 */

import {
  classifyLocalSaleSync,
  type LocalSaleSyncKind,
} from "@/lib/vendas/local-sale-identity"

export type HistoricoSaleKind = LocalSaleSyncKind

export type SaleIdentityRef = {
  id: string
  clientSaleId?: string | null
  kind?: HistoricoSaleKind | null
}

export type LocalSyncSaleRef = SaleIdentityRef & {
  syncPending?: boolean
  syncBlockedCode?: string
}

function norm(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : ""
}

/** Dois refs descrevem a mesma venda se id ou clientSaleId coincidem. */
export function saleIdentitiesOverlap(a: SaleIdentityRef, b: SaleIdentityRef): boolean {
  const aId = norm(a.id)
  const bId = norm(b.id)
  if (aId && bId && aId === bId) return true
  const aCs = norm(a.clientSaleId)
  const bCs = norm(b.clientSaleId)
  if (aCs && bCs && aCs === bCs) return true
  if (aCs && bId && aCs === bId) return true
  if (bCs && aId && bCs === aId) return true
  return false
}

export function isRemoteConfirmedEvidence(input: {
  vendaId: string
  clientSaleId?: string | null
  actionKind?: HistoricoSaleKind | null
  serverDetailOk?: boolean
  remoteRows: readonly SaleIdentityRef[]
}): boolean {
  if (input.actionKind === "REMOTE_CONFIRMED") return true
  if (input.serverDetailOk === true) return true
  const target: SaleIdentityRef = { id: input.vendaId, clientSaleId: input.clientSaleId }
  return input.remoteRows.some(
    (row) =>
      (row.kind == null || row.kind === "REMOTE_CONFIRMED") &&
      saleIdentitiesOverlap(target, row),
  )
}

export function isGenuineLocalOnlyEntity(input: {
  vendaId: string
  clientSaleId?: string | null
  actionKind?: HistoricoSaleKind | null
  localSales: readonly LocalSyncSaleRef[]
}): boolean {
  if (input.actionKind === "LOCAL_PENDING" || input.actionKind === "LOCAL_QUARANTINED") {
    return true
  }
  const target: SaleIdentityRef = { id: input.vendaId, clientSaleId: input.clientSaleId }
  return input.localSales.some((sale) => {
    if (!saleIdentitiesOverlap(target, sale)) return false
    const kind = sale.kind ?? classifyLocalSaleSync(sale)
    return kind === "LOCAL_PENDING" || kind === "LOCAL_QUARANTINED"
  })
}

/**
 * Bloqueia Cancelar / Troca / Corrigir / Imprimir somente para entidade
 * local real. Cópia stale de uma venda já confirmada no servidor não bloqueia.
 */
export function blocksConfirmedSaleAction(input: {
  vendaId: string
  clientSaleId?: string | null
  actionKind?: HistoricoSaleKind | null
  serverDetailOk?: boolean
  remoteRows: readonly SaleIdentityRef[]
  localSales: readonly LocalSyncSaleRef[]
}): boolean {
  const vendaId = norm(input.vendaId)
  if (!vendaId) return true
  // A entidade clicada é local de verdade — não cancelar o ocupante server-side
  // que por acaso compartilha o mesmo número.
  if (input.actionKind === "LOCAL_PENDING" || input.actionKind === "LOCAL_QUARANTINED") {
    return true
  }
  if (
    isRemoteConfirmedEvidence({
      vendaId,
      clientSaleId: input.clientSaleId,
      actionKind: input.actionKind,
      serverDetailOk: input.serverDetailOk,
      remoteRows: input.remoteRows,
    })
  ) {
    return false
  }
  return isGenuineLocalOnlyEntity({
    vendaId,
    clientSaleId: input.clientSaleId,
    actionKind: input.actionKind,
    localSales: input.localSales,
  })
}

export function claimCancelInFlight(lock: { current: boolean }): boolean {
  if (lock.current) return false
  lock.current = true
  return true
}

export function releaseCancelInFlight(lock: { current: boolean }): void {
  lock.current = false
}

export type CancelarVendaHistoricoInput = {
  pedidoId: string
  storeId: string
  motivo: string
  canceladaPor?: string
  forcar?: boolean
  actionKind?: HistoricoSaleKind | null
  clientSaleId?: string | null
  serverDetailOk?: boolean
  remoteRows: readonly SaleIdentityRef[]
  localSales: readonly LocalSyncSaleRef[]
  inFlight: { current: boolean }
}

export type CancelarVendaHistoricoResult =
  | { status: "cancelled"; pedidoId: string }
  | { status: "require_confirm" }
  | { status: "blocked"; error: string }
  | { status: "empty_motivo" }
  | { status: "in_flight" }
  | { status: "error"; error: string; httpStatus?: number }

const BLOQUEIO_PENDENTE =
  "Venda pendente não pode ser cancelada até sincronizar com o servidor."

function cancelarVendaUrl(pedidoId: string): string {
  return `/api/vendas/${encodeURIComponent(pedidoId)}/cancelar`
}

function readErrorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "error" in body) {
    const error = (body as { error?: unknown }).error
    if (typeof error === "string" && error.trim()) return error.trim()
  }
  return fallback
}

/**
 * Confirma o cancelamento: no máximo um POST ativo. Nunca envia forcar=true
 * sozinho — o caller precisa passar forcar após a segunda confirmação manual.
 */
export async function confirmCancelarVendaHistorico(
  input: CancelarVendaHistoricoInput,
  deps?: { fetch?: typeof fetch },
): Promise<CancelarVendaHistoricoResult> {
  const pedidoId = norm(input.pedidoId)
  const storeId = norm(input.storeId)
  const motivo = input.motivo.trim()
  if (!pedidoId || !motivo) return { status: "empty_motivo" }

  if (
    blocksConfirmedSaleAction({
      vendaId: pedidoId,
      clientSaleId: input.clientSaleId,
      actionKind: input.actionKind,
      serverDetailOk: input.serverDetailOk,
      remoteRows: input.remoteRows,
      localSales: input.localSales,
    })
  ) {
    return { status: "blocked", error: BLOQUEIO_PENDENTE }
  }

  if (!claimCancelInFlight(input.inFlight)) return { status: "in_flight" }

  const fetchFn = deps?.fetch ?? globalThis.fetch
  try {
    const res = await fetchFn(cancelarVendaUrl(pedidoId), {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "x-assistec-loja-id": storeId,
      },
      body: JSON.stringify({
        motivo,
        canceladaPor: input.canceladaPor?.trim() || "Operador",
        forcar: input.forcar === true,
      }),
    })

    let data: unknown = null
    try {
      data = await res.json()
    } catch {
      data = null
    }

    const payload = data && typeof data === "object" ? (data as Record<string, unknown>) : null
    if (payload?.ok === true) {
      return { status: "cancelled", pedidoId }
    }

    if (res.status === 409 && payload?.requireConfirm === true && input.forcar !== true) {
      return { status: "require_confirm" }
    }

    return {
      status: "error",
      error: readErrorMessage(payload, "Falha ao cancelar venda."),
      httpStatus: res.status,
    }
  } catch {
    return { status: "error", error: "Falha ao cancelar venda." }
  } finally {
    releaseCancelInFlight(input.inFlight)
  }
}
