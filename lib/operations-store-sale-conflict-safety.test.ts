/**
 * Contrato estático do cliente PDV para conflitos permanentes de identidade.
 *
 * O helper puro cobre a política; este teste garante que as superfícies que disparam
 * efeitos realmente consultem essa política antes de qualquer persist/ação destrutiva.
 *
 * Arquitetura atual (Writer V2 / quarentena):
 * - auto-retry e reenvio passam por `persistPendingSale` (não por `fetch(vendaPersistUrl)` direto);
 * - conflito vira quarentena e só sai por `recoverQuarantinedSale`;
 * - o ocupante remoto não é sobrescrito nem troca de número automaticamente.
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

  const persistPending = between(
    store,
    "const persistPendingSale = useCallback",
    "const flushPendingSales = useCallback",
  )
  const flush = between(
    store,
    "const flushPendingSales = useCallback",
    "const refreshSalesFromServer = useCallback",
  )
  const retry = between(
    store,
    "const doRetrySyncSale = useCallback",
    "const retrySyncSale = useCallback",
  )
  const wrappers = between(
    store,
    "const retrySyncSale = useCallback",
    "const discardLocalPendingSale = useCallback",
  )
  const recover = between(
    store,
    "const recoverQuarantinedSale = useCallback",
    "const discardLocalPendingSale = useCallback",
  )
  const recoverIndividual = between(
    store,
    "const recoverQuarantinedSale = useCallback",
    "const collectQuarantinedCandidates = useCallback",
  )
  const individual = between(
    store,
    "const discardLocalPendingSale = useCallback",
    "const bulkDiscardLocalPendingSales = useCallback",
  )
  const bulk = between(
    store,
    "const bulkDiscardLocalPendingSales = useCallback",
    "const flushPendingDevolucoes = useCallback",
  )

  it("auto-retry ignora o conflito antes do persist e não recupera sozinho", () => {
    const conflictGate = flush.indexOf("persistedSaleIdentityConflictCode(storageKey, sale)")
    const persist = flush.indexOf("persistPendingSale(")
    expect(conflictGate).toBeGreaterThanOrEqual(0)
    expect(persist).toBeGreaterThan(conflictGate)
    expect(flush).toMatch(
      /persistedSaleIdentityConflictCode\(storageKey, sale\)\)\s+continue[\s\S]*persistPendingSale\(/,
    )
    expect(flush).not.toContain("recoverQuarantinedSale")
    expect(flush).not.toContain("recoverQuarantinedSaleUrl")
  })

  it("reenvio manual e retroativo compartilham o bloqueio anterior ao persist", () => {
    const conflictGate = retry.indexOf("persistedSaleIdentityConflictCode(storageKey, sale)")
    const persist = retry.indexOf("persistPendingSale(")
    expect(conflictGate).toBeGreaterThanOrEqual(0)
    expect(persist).toBeGreaterThan(conflictGate)
    expect(retry).toContain("SALE_IDENTITY_CONFLICT_TITLE")
    expect(retry).toContain("SALE_IDENTITY_CONFLICT_GUIDANCE")
    expect(retry).not.toContain("recoverQuarantinedSaleUrl")

    expect(wrappers).toContain("doRetrySyncSale(saleId, false)")
    expect(wrappers).toContain("doRetrySyncSale(saleId, true)")
  })

  it("descarte individual e em lote preservam conflitos sem consultar o servidor", () => {
    expect(individual.indexOf("persistedSaleIdentityConflictCode(storageKey, sale)")).toBeLessThan(
      individual.indexOf("fetch("),
    )
    expect(individual).toContain("SALE_IDENTITY_CONFLICT_TITLE")
    expect(individual).toContain("SALE_IDENTITY_CONFLICT_GUIDANCE")
    expect(individual).not.toContain("recoverQuarantinedSaleUrl")

    expect(bulk).toMatch(
      /persistedSaleIdentityConflictCode\(storageKey, sale\)\)\s*\{[\s\S]*conflicts \+= 1[\s\S]*continue[\s\S]*fetch\(`\/api\/vendas\//,
    )
  })

  it("a UI condiciona reenvio, retroativo e descarte à política de quarentena", () => {
    expect(archive).toContain("pendingSaleSyncActions.canManualRetry &&")
    expect(archive).toContain("pendingSaleSyncActions.canRetroactiveRetry &&")
    expect(archive).toContain("pendingSaleSyncActions.canDiscard &&")
    expect(archive).toContain("saleSyncActionsForCode")
    expect(archive).toContain("LOCAL_QUARANTINED")
    expect(archive).toContain("REMOTE_CONFIRMED")
    expect(archive).toContain("LOCAL_PENDING")
    expect(archive).toContain("O número desta venda já estava em uso. Seus dados foram preservados e nenhuma venda existente foi")
    expect(archive).toContain("A venda antiga permanece intacta")
    expect(archive).toContain("nunca altera a venda que já ocupa o número conflitante")
    expect(archive).not.toContain("A venda será regravada com um número novo")
    expect(archive).not.toContain("predictedNovaVendaId")
  })

  it("recovery administrado é o único caminho que chama recoverQuarantinedSale", () => {
    expect(persistPending).toContain("postV2Sale")
    expect(persistPending).toContain("postV1Sale")
    expect(persistPending).not.toContain("recoverQuarantinedSaleUrl")
    expect(persistPending).not.toContain("predictedNovaVendaId")

    expect(recover).toContain("recoverQuarantinedSaleUrl")
    expect(recover).toContain("isSaleIdentityConflictCode")
    expect(recover).toContain("conflictingPedidoId")
    expect(recover).not.toContain("persistPendingSale(")

    expect(archive).toContain("openRecoverDialog")
    expect(archive).toContain("recoverQuarantinedSale")
    expect(archive).toContain("Recuperar venda")
    expect(archive).toContain("Venda precisa de recuperação")
  })

  it("recovery individual reconcilia só por clientSaleId — nunca pelo VDA antigo", () => {
    expect(recoverIndividual).toContain("buildIndividualRecoveryConfirmations")
    expect(recoverIndividual).toContain("applyRecoveryConfirmations")
    expect(recoverIndividual).not.toContain("markSaleConfirmed")
    expect(recoverIndividual).not.toContain("saleMatches(s, token)")
  })

  it("botão individual fica indisponível com Writer V1 e abre com Writer V2", () => {
    expect(archive).toContain("canStartIndividualQuarantineRecovery")
    expect(archive).toContain("probeSaleWriterCapability")
    expect(archive).toContain("INDIVIDUAL_QUARANTINE_RECOVERY_UNAVAILABLE")
    expect(archive).toContain("disabled={!individualRecoveryEnabled}")
    expect(archive).toContain("openRecoverDialog")
    expect(archive).toMatch(/if \(!canStartIndividualQuarantineRecovery\(writerEnabled\)\) return/)
  })
})
