import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.setConfig({ testTimeout: 20_000 })
import { isOpaqueUnusablePin, newOpaqueUnusablePin } from "@/lib/auth/pin-hash"
import {
  backfillSupervisorPinHash,
  isProductionBackfillForbidden,
  shouldBackfillSupervisorPin,
} from "./backfill-supervisor-pin-hash"

const PIN = "908172"
const PEPPER = "pepper-de-teste-backfill-014"

const db = {
  user: {
    findMany: vi.fn(async (): Promise<unknown[]> => []),
    update: vi.fn(async (): Promise<unknown> => ({})),
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.PIN_HASH_PEPPER = PEPPER
  delete process.env.VERCEL_ENV
  db.user.findMany.mockResolvedValue([])
})

afterEach(() => {
  delete process.env.PIN_HASH_PEPPER
  delete process.env.VERCEL_ENV
})

describe("shouldBackfillSupervisorPin", () => {
  it("só pega plaintext numérico sem pinHash", () => {
    expect(shouldBackfillSupervisorPin({ pin: PIN, pinHash: null })).toBe(true)
    expect(shouldBackfillSupervisorPin({ pin: newOpaqueUnusablePin(), pinHash: null })).toBe(false)
    expect(shouldBackfillSupervisorPin({ pin: PIN, pinHash: "$2b$12$C6UzMDM.H6dfI/e7KqYpt.Oa0Lxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" })).toBe(false)
    expect(isOpaqueUnusablePin(newOpaqueUnusablePin())).toBe(true)
  })
})

describe("backfillSupervisorPinHash", () => {
  it("recusa Production", async () => {
    await expect(
      backfillSupervisorPinHash(db as never, { exec: true, env: { VERCEL_ENV: "production", PIN_HASH_PEPPER: PEPPER } }),
    ).rejects.toThrow(/production/i)
    expect(db.user.update).not.toHaveBeenCalled()
  })

  it("dry-run não grava; --exec preenche só pinHash", async () => {
    db.user.findMany.mockResolvedValue([{ id: "sup-1", pin: PIN, pinHash: null }])

    const dry = await backfillSupervisorPinHash(db as never, {
      exec: false,
      env: { PIN_HASH_PEPPER: PEPPER },
    })
    expect(dry.eligible).toBe(1)
    expect(dry.written).toBe(0)
    expect(db.user.update).not.toHaveBeenCalled()

    const exec = await backfillSupervisorPinHash(db as never, {
      exec: true,
      env: { PIN_HASH_PEPPER: PEPPER },
    })
    expect(exec.written).toBe(1)
    const args = (db.user.update.mock.calls[0] as unknown as [{
      data: { pinHash?: string; pin?: string }
    }])[0]
    expect(args.data.pin).toBeUndefined()
    expect(args.data.pinHash?.startsWith("$2")).toBe(true)
    expect(JSON.stringify(args)).not.toContain(PIN)
  })

  it("isProductionBackfillForbidden cobre o guard", () => {
    expect(isProductionBackfillForbidden({ VERCEL_ENV: "production" })).toBe(true)
    expect(isProductionBackfillForbidden({ VERCEL_ENV: "preview" })).toBe(false)
  })
})
