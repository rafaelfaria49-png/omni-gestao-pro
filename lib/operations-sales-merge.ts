import type { SaleRecord } from "@/lib/operations-sale-types"
import { isSaleIdentityConflictCode } from "@/lib/vendas/sale-identity-conflict"
import { stripClientSyncFlags } from "@/lib/vendas/sale-sync-flags"

/**
 * Mescla vendas do Postgres preservando o que já veio do localStorage (mesmo `id`),
 * EXCETO o `status`, que é a coluna autoritativa do banco. O payload JSONB da venda
 * local não é reescrito no cancelamento (feito na tela Vendas / servidor), então sem
 * propagar o `status` remoto a venda cancelada continuaria contando como concluída no
 * caixa/fechamento. Apenas `status` (e a baixa dos marcadores de sync) é sincronizado —
 * `lines`/`qtyReturned` permanecem locais para não descartar devolução offline pendente.
 *
 * Estar no `remote` normalmente significa estar no banco, ou seja, CONFIRMADA. A exceção
 * é uma cópia local em quarentena por colisão de `pedidoId`: a venda remota de mesmo id
 * pode ser justamente a venda diferente que causou o conflito e não confirma a cópia
 * local. Nesse caso o bloqueio e `syncPending` são monotônicos. Para pendências comuns,
 * os marcadores locais são zerados e nunca reinjetados por vendas remotas extras.
 *
 * Função PURA (sem React) para ser testável de forma isolada.
 */
export function mergeSalesById(local: SaleRecord[], remote: SaleRecord[]): SaleRecord[] {
  const remoteById = new Map<string, SaleRecord>()
  for (const r of remote) {
    if (r.id) remoteById.set(r.id, r)
  }
  let changed = false
  const mergedLocal = local.map((s) => {
    const r = s.id ? remoteById.get(s.id) : undefined
    if (!r) return s
    if (isSaleIdentityConflictCode(s.syncBlockedCode)) {
      if (s.syncPending === true) return s
      changed = true
      return { ...s, syncPending: true }
    }
    // Nunca apaga um status local com `undefined` remoto (legado): só sobrescreve quando
    // o servidor tem um status concreto.
    const nextStatus = r.status ?? s.status
    // Converge: depois da primeira limpeza os campos somem e a comparação vira estável
    // (sem churn de referência nos merges seguintes).
    const limpaMarcadores = s.syncPending === true || s.syncBlockedCode !== undefined
    if (nextStatus !== s.status || limpaMarcadores) {
      changed = true
      return limpaMarcadores
        ? { ...stripClientSyncFlags(s), status: nextStatus, syncPending: false }
        : { ...s, status: nextStatus }
    }
    return s
  })
  const ids = new Set(mergedLocal.map((s) => s.id))
  const extra = remote.filter((s) => s.id && !ids.has(s.id)).map((s) => stripClientSyncFlags(s))
  if (extra.length === 0 && !changed) return local
  return [...mergedLocal, ...extra].sort((a, b) => a.at.localeCompare(b.at))
}
