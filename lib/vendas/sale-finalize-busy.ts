/**
 * Mutex síncrono da finalização no Venda Completa.
 *
 * Impede uma segunda tentativa (F1 / Enter / clique) enquanto a Promise da
 * primeira ainda não terminou. Não gera identidade nova — só ocupa/libera o lock.
 */
export function isSaleFinalizeBusy(lock: { current: boolean }): boolean {
  return lock.current === true
}

export function claimSaleFinalizeLock(lock: { current: boolean }): boolean {
  if (lock.current) return false
  lock.current = true
  return true
}

export function releaseSaleFinalizeLock(lock: { current: boolean }): void {
  lock.current = false
}
