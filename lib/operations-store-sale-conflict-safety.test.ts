/**
 * Contrato estático do cliente PDV para conflitos permanentes de identidade.
 *
 * O helper puro cobre a política; este teste garante que as superfícies que disparam
 * efeitos realmente consultem essa política antes de qualquer fetch/ação destrutiva.
 */
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"

const REPO_ROOT = resolve(__dirname, "..")

function read(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), "utf8")
}

function between(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex + start.length)
  expect(startIndex, `marcador inicial ausente: ${start}`).toBeGreaterThanOrEqual(0)
  expect(endIndex, `marcador final ausente: ${end}`).toBeGreaterThan(startIndex)
  return source.slice(startIndex, endIndex)
}

describe("PDV-V1-ATOMIC-REPLAY-CONFLICT-HARDEN-001 — quarentena client-side", () => {
  const store = read("lib/operations-store.tsx")
  const archive = read("components/dashboard/vendas/vendas-arquivo-geral.tsx")

  it("auto-retry ignora o conflito antes do POST", () => {
    const flush = between(
      store,
      "const flushPendingSales = useCallback",
      "const refreshSalesFromServer = useCallback",
    )
    expect(flush).toMatch(
      /persistedSaleIdentityConflictCode\(storageKey, sale\)\)\s+continue[\s\S]*fetch\(vendaPersistUrl/,
    )
  })

  it("reenvio manual e retroativo compartilham o bloqueio anterior ao POST", () => {
    const retry = between(
      store,
      "const doRetrySyncSale = useCallback",
      "const retrySyncSale = useCallback",
    )
    const conflictGate = retry.indexOf("persistedSaleIdentityConflictCode(storageKey, sale)")
    const post = retry.indexOf("fetch(vendaPersistUrl")
    expect(conflictGate).toBeGreaterThanOrEqual(0)
    expect(post).toBeGreaterThan(conflictGate)

    const wrappers = between(
      store,
      "const retrySyncSale = useCallback",
      "const discardLocalPendingSale = useCallback",
    )
    expect(wrappers).toContain("doRetrySyncSale(saleId, false)")
    expect(wrappers).toContain("doRetrySyncSale(saleId, true)")
  })

  it("descarte individual e em lote preservam conflitos sem consultar o servidor", () => {
    const individual = between(
      store,
      "const discardLocalPendingSale = useCallback",
      "const bulkDiscardLocalPendingSales = useCallback",
    )
    expect(individual.indexOf("persistedSaleIdentityConflictCode(storageKey, sale)")).toBeLessThan(
      individual.indexOf("fetch(`/api/vendas/"),
    )

    const bulk = between(
      store,
      "const bulkDiscardLocalPendingSales = useCallback",
      "const flushPendingDevolucoes = useCallback",
    )
    expect(bulk).toMatch(
      /persistedSaleIdentityConflictCode\(storageKey, sale\)\)\s*\{[\s\S]*conflicts \+= 1[\s\S]*continue[\s\S]*fetch\(`\/api\/vendas\//,
    )
  })

  it("a UI condiciona reenvio, retroativo e descarte à política de quarentena", () => {
    expect(archive).toContain("pendingSaleSyncActions.canManualRetry &&")
    expect(archive).toContain("pendingSaleSyncActions.canRetroactiveRetry &&")
    expect(archive).toContain("pendingSaleSyncActions.canDiscard &&")
    expect(archive).toContain("o sistema não altera o número")
    expect(archive).not.toContain("A venda será regravada com um número novo")
  })
})
