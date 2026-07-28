import { describe, expect, it } from "vitest"
import {
  isSaleIdentityConflictCode,
  preserveSaleIdentityConflictCodes,
  saleSyncActionsForCode,
} from "./sale-identity-conflict"

describe("sale-identity-conflict", () => {
  it.each([
    "PEDIDO_ID_DE_OUTRA_LOJA",
    "PEDIDO_ID_CONFLITO_MESMA_LOJA",
  ])("%s é permanente e bloqueia toda ação comum", (code) => {
    expect(isSaleIdentityConflictCode(code)).toBe(true)
    expect(saleSyncActionsForCode(code)).toEqual({
      quarantined: true,
      canAutoRetry: false,
      canManualRetry: false,
      canRetroactiveRetry: false,
      canDiscard: false,
    })
  })

  it("mantém ações atuais para pendências comuns", () => {
    expect(saleSyncActionsForCode("CAIXA_ORIGINAL_FECHADO")).toEqual({
      quarantined: false,
      canAutoRetry: true,
      canManualRetry: true,
      canRetroactiveRetry: true,
      canDiscard: true,
    })
  })

  it("propaga a quarentena entre snapshots sem reativá-la", () => {
    const stale = [{ id: "VDA-1", syncPending: false }]
    const protectedSnapshot = [
      {
        id: "VDA-1",
        syncPending: true,
        syncBlockedCode: "PEDIDO_ID_CONFLITO_MESMA_LOJA",
      },
    ]
    expect(preserveSaleIdentityConflictCodes(stale, protectedSnapshot)).toEqual(protectedSnapshot)
  })

  it("autorrecupera syncPending quando o próprio snapshot ainda tem o código permanente", () => {
    const stale = [
      {
        id: "VDA-1",
        syncPending: false,
        syncBlockedCode: "PEDIDO_ID_DE_OUTRA_LOJA",
      },
    ]
    expect(preserveSaleIdentityConflictCodes(stale, [])).toEqual([
      {
        id: "VDA-1",
        syncPending: true,
        syncBlockedCode: "PEDIDO_ID_DE_OUTRA_LOJA",
      },
    ])
  })
})
