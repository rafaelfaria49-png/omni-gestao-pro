export const SALE_IDENTITY_CONFLICT_CODES = [
  "PEDIDO_ID_DE_OUTRA_LOJA",
  "PEDIDO_ID_CONFLITO_MESMA_LOJA",
] as const

export type SaleIdentityConflictCode = (typeof SALE_IDENTITY_CONFLICT_CODES)[number]

const SALE_IDENTITY_CONFLICT_CODE_SET = new Set<string>(SALE_IDENTITY_CONFLICT_CODES)

export function isSaleIdentityConflictCode(code: unknown): code is SaleIdentityConflictCode {
  return typeof code === "string" && SALE_IDENTITY_CONFLICT_CODE_SET.has(code)
}

export const SALE_IDENTITY_CONFLICT_TITLE = "Conflito técnico de identificação"

export const SALE_IDENTITY_CONFLICT_GUIDANCE =
  "Nenhuma venda foi sobrescrita. Preserve esta cópia local e solicite recuperação administrada."

export function saleSyncActionsForCode(code: unknown) {
  const quarantined = isSaleIdentityConflictCode(code)
  return {
    quarantined,
    canAutoRetry: !quarantined,
    canManualRetry: !quarantined,
    canRetroactiveRetry: !quarantined,
    canDiscard: !quarantined,
  }
}

/**
 * Propaga códigos de quarentena de forma monotônica entre snapshots/abas.
 * Uma aba com estado antigo não pode apagar o bloqueio permanente gravado por outra.
 */
export function preserveSaleIdentityConflictCodes<
  T extends { id: string; syncBlockedCode?: string },
>(target: readonly T[], source: readonly T[]): T[] {
  const protectedById = new Map(
    source
      .filter((sale) => isSaleIdentityConflictCode(sale.syncBlockedCode))
      .map((sale) => [sale.id, sale.syncBlockedCode] as const),
  )
  if (protectedById.size === 0) return [...target]

  return target.map((sale) => {
    const code = protectedById.get(sale.id)
    return code && !isSaleIdentityConflictCode(sale.syncBlockedCode)
      ? { ...sale, syncBlockedCode: code }
      : sale
  })
}
