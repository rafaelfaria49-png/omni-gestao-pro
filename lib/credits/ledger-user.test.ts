import { describe, expect, it } from "vitest"
import { isOpaqueUnusablePin } from "@/lib/auth/pin-hash"
import { CREDITS_LEDGER_USER_ROLE, creditsLedgerUserCreateData } from "./ledger-user"

describe("creditsLedgerUserCreateData", () => {
  it("nunca cria ADMIN autenticável nem PIN previsível mock-${userId}", () => {
    const userId = "user-abc-001"
    const a = creditsLedgerUserCreateData(userId)
    const b = creditsLedgerUserCreateData(userId)
    expect(a.role).toBe(CREDITS_LEDGER_USER_ROLE)
    expect(a.role).not.toBe("ADMIN")
    expect(a.pin).not.toBe(`mock-${userId}`)
    expect(isOpaqueUnusablePin(a.pin)).toBe(true)
    expect(a.pin).not.toBe(b.pin)
    expect(JSON.stringify(a)).not.toMatch(/mock-/)
  })
})
