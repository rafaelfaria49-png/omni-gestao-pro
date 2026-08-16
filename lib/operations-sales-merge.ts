import type { SaleRecord } from "@/lib/operations-sale-types"
import { isSaleIdentityConflictCode } from "@/lib/vendas/sale-identity-conflict"
import { stripClientSyncFlags } from "@/lib/vendas/sale-sync-flags"

function reconcileConfirmed(
  local: SaleRecord,
  remote: SaleRecord,
): SaleRecord {
  const nextStatus = remote.status ?? local.status
  const confirmed: SaleRecord = {
    ...stripClientSyncFlags(local),
    id: remote.id,
    serverId: remote.serverId ?? local.serverId,
    clientSaleId: local.clientSaleId ?? remote.clientSaleId,
    status: nextStatus,
    syncPending: false,
  }
  delete confirmed.syncBlockedCode
  return confirmed
}

function sameClientSaleId(local: SaleRecord, remote: SaleRecord): boolean {
  return Boolean(local.clientSaleId && remote.clientSaleId && local.clientSaleId === remote.clientSaleId)
}

function isDistinctIdentityCollision(local: SaleRecord, remote: SaleRecord): boolean {
  if (sameClientSaleId(local, remote)) return false
  if (local.clientSaleId && remote.clientSaleId && local.clientSaleId !== remote.clientSaleId) {
    return true
  }
  return isSaleIdentityConflictCode(local.syncBlockedCode)
}

/**
 * Mescla vendas do Postgres com o localStorage.
 *
 * V1: casa por `id` (`pedidoId`), preservando `status` autoritativo do banco.
 * V2: casa por `clientSaleId`. Local provisório `PEND-…` reconcilia in-place para o
 * `pedidoId` remoto. Colisão de `pedidoId` com `clientSaleId` diferente NÃO confirma
 * a cópia local — as duas entidades permanecem na projeção.
 */
export function mergeSalesById(local: SaleRecord[], remote: SaleRecord[]): SaleRecord[] {
  const remoteByClientSaleId = new Map<string, SaleRecord>()
  const remoteById = new Map<string, SaleRecord>()
  for (const r of remote) {
    if (r.clientSaleId) remoteByClientSaleId.set(r.clientSaleId, r)
    if (r.id) remoteById.set(r.id, r)
  }

  let changed = false
  const consumedRemote = new Set<SaleRecord>()
  const mergedLocal = local.map((s) => {
    const remoteByKey = s.clientSaleId ? remoteByClientSaleId.get(s.clientSaleId) : undefined
    if (remoteByKey) {
      consumedRemote.add(remoteByKey)
      const next = reconcileConfirmed(s, remoteByKey)
      if (
        next.id !== s.id ||
        next.status !== s.status ||
        next.serverId !== s.serverId ||
        s.syncPending === true ||
        s.syncBlockedCode !== undefined
      ) {
        changed = true
        return next
      }
      return s
    }

    const r = s.id ? remoteById.get(s.id) : undefined
    if (!r) return s

    if (isDistinctIdentityCollision(s, r)) {
      if (s.syncPending === true && isSaleIdentityConflictCode(s.syncBlockedCode)) return s
      changed = true
      return { ...s, syncPending: true }
    }

    consumedRemote.add(r)
    const nextStatus = r.status ?? s.status
    const limpaMarcadores = s.syncPending === true || s.syncBlockedCode !== undefined
    if (nextStatus !== s.status || limpaMarcadores) {
      changed = true
      return limpaMarcadores
        ? { ...stripClientSyncFlags(s), status: nextStatus, syncPending: false }
        : { ...s, status: nextStatus }
    }
    return s
  })

  const extra = remote
    .filter((s) => s.id && !consumedRemote.has(s))
    .map((s) => stripClientSyncFlags(s))
  if (extra.length === 0 && !changed) return local
  return [...mergedLocal, ...extra].sort((a, b) => a.at.localeCompare(b.at))
}
