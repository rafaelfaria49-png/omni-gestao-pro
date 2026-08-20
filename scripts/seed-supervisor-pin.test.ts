import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.setConfig({ testTimeout: 20_000 })
import { BLOCKED_LEGACY_SUPERVISOR_PINS } from "@/lib/auth/pin-authorization"
import { isOpaqueUnusablePin } from "@/lib/auth/pin-hash"
import { resolveSupervisorSeedPin, seedSupervisorPin } from "./seed-supervisor-pin"

const PIN = "908172"
const BLOCKED = BLOCKED_LEGACY_SUPERVISOR_PINS[0]!
const PEPPER = "pepper-de-teste-seed-supervisor-014"

const db = {
  user: {
    findFirst: vi.fn(async (): Promise<unknown> => null),
    create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
      id: "sup-new",
      name: args.data.name,
      role: args.data.role,
    })),
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.PIN_HASH_PEPPER = PEPPER
  db.user.findFirst.mockResolvedValue(null)
})

afterEach(() => {
  delete process.env.PIN_HASH_PEPPER
  delete process.env.SUPERVISOR_DEFAULT_PIN
})

describe("resolveSupervisorSeedPin", () => {
  it("exige PIN e recusa 1234", () => {
    expect(() => resolveSupervisorSeedPin(undefined)).toThrow(/SUPERVISOR_DEFAULT_PIN/)
    expect(() => resolveSupervisorSeedPin(BLOCKED)).toThrow(/bloqueado/)
    expect(() => resolveSupervisorSeedPin("12")).toThrow(/4 e 12/)
    expect(resolveSupervisorSeedPin(PIN)).toBe(PIN)
  })
})

describe("seedSupervisorPin", () => {
  it("não recria se já existe ADMIN", async () => {
    db.user.findFirst.mockResolvedValue({ id: "already", name: "X", role: "ADMIN" })
    const r = await seedSupervisorPin(db as never, {
      SUPERVISOR_DEFAULT_PIN: PIN,
      PIN_HASH_PEPPER: PEPPER,
    })
    expect(r.action).toBe("skipped")
    expect(db.user.create).not.toHaveBeenCalled()
  })

  it("grava autenticação somente via pinHash e pin opaco — nunca o PIN real", async () => {
    const r = await seedSupervisorPin(db as never, {
      SUPERVISOR_DEFAULT_PIN: PIN,
      SUPERVISOR_DEFAULT_NAME: "Supervisora",
      PIN_HASH_PEPPER: PEPPER,
    })
    expect(r.action).toBe("created")
    expect(db.user.create).toHaveBeenCalledTimes(1)
    const data = (db.user.create.mock.calls[0] as unknown as [{ data: Record<string, string> }])[0].data
    expect(data.role).toBe("ADMIN")
    expect(data.pinHash.startsWith("$2")).toBe(true)
    expect(isOpaqueUnusablePin(data.pin)).toBe(true)
    expect(data.pin).not.toBe(PIN)
    expect(JSON.stringify(data)).not.toContain(PIN)
  })
})
