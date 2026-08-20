/**
 * Verificador central — hash, legado plaintext + upgrade, 1234, fail-closed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.setConfig({ testTimeout: 20_000 })
import { BLOCKED_LEGACY_SUPERVISOR_PINS } from "@/lib/auth/pin-authorization"
import { hashSupervisorPin, newOpaqueUnusablePin } from "@/lib/auth/pin-hash"

const PIN = "908172"
const OTHER = "111999"
const PIN_BLOQUEADO = BLOCKED_LEGACY_SUPERVISOR_PINS[0]!
const PEPPER = "pepper-de-teste-verify-supervisor-014"
const SUPERVISOR_ID = "supervisor-1"

const h = vi.hoisted(() => ({
  ensureConnected: vi.fn(async (): Promise<void> => undefined),
  findMany: vi.fn(async (): Promise<unknown[]> => []),
  update: vi.fn(async (): Promise<unknown> => ({})),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: h.findMany, update: h.update },
  },
  prismaEnsureConnected: h.ensureConnected,
}))

import {
  authenticateSupervisorPin,
  isDefaultSupervisorPinRecord,
  verifySupervisorPinRecord,
} from "./verify-supervisor-pin"

const ENV = { PIN_HASH_PEPPER: PEPPER }

beforeEach(() => {
  vi.clearAllMocks()
  process.env.PIN_HASH_PEPPER = PEPPER
  h.findMany.mockResolvedValue([])
  h.update.mockResolvedValue({})
})

afterEach(() => {
  delete process.env.PIN_HASH_PEPPER
  delete process.env.AUTH_SECRET
  delete process.env.NEXTAUTH_SECRET
})

describe("authenticateSupervisorPin — bloqueio 1234", () => {
  it("1234 é sempre rejeitado antes de consultar candidatos", async () => {
    const r = await authenticateSupervisorPin(PIN_BLOQUEADO, ENV)
    expect(r).toBeNull()
    expect(h.findMany).not.toHaveBeenCalled()
    expect(h.update).not.toHaveBeenCalled()
  })

  it("PIN vazio não consulta o banco", async () => {
    expect(await authenticateSupervisorPin("   ", ENV)).toBeNull()
    expect(h.findMany).not.toHaveBeenCalled()
  })
})

describe("authenticateSupervisorPin — pinHash", () => {
  it("pinHash válido autentica e não altera o pin legado", async () => {
    const pinHash = await hashSupervisorPin(PIN, ENV)
    const opaque = newOpaqueUnusablePin()
    h.findMany.mockResolvedValue([
      { id: SUPERVISOR_ID, name: "Supervisora", pin: opaque, pinHash },
    ])

    const r = await authenticateSupervisorPin(PIN, ENV)
    expect(r).toEqual({ id: SUPERVISOR_ID, name: "Supervisora" })
    expect(h.update).not.toHaveBeenCalled()
  })

  it("PIN errado contra pinHash não autentica e não grava upgrade", async () => {
    const pinHash = await hashSupervisorPin(PIN, ENV)
    h.findMany.mockResolvedValue([
      { id: SUPERVISOR_ID, name: "Supervisora", pin: "x:opaque", pinHash },
    ])

    expect(await authenticateSupervisorPin(OTHER, ENV)).toBeNull()
    expect(h.update).not.toHaveBeenCalled()
  })
})

describe("authenticateSupervisorPin — legado plaintext + upgrade", () => {
  it("plaintext legado autentica e preenche pinHash sem alterar pin", async () => {
    h.findMany.mockResolvedValue([
      { id: SUPERVISOR_ID, name: "Supervisora", pin: PIN, pinHash: null },
    ])

    const r = await authenticateSupervisorPin(PIN, ENV)
    expect(r).toEqual({ id: SUPERVISOR_ID, name: "Supervisora" })
    expect(h.update).toHaveBeenCalledTimes(1)
    const args = (h.update.mock.calls[0] as unknown as [{
      where: { id: string }
      data: { pinHash?: string; pin?: string }
    }])[0]
    expect(args.where.id).toBe(SUPERVISOR_ID)
    expect(args.data.pin).toBeUndefined()
    expect(typeof args.data.pinHash).toBe("string")
    expect(args.data.pinHash!.startsWith("$2")).toBe(true)
  })

  it("PIN inválido não grava upgrade", async () => {
    h.findMany.mockResolvedValue([
      { id: SUPERVISOR_ID, name: "Supervisora", pin: PIN, pinHash: null },
    ])
    expect(await authenticateSupervisorPin(OTHER, ENV)).toBeNull()
    expect(h.update).not.toHaveBeenCalled()
  })
})

describe("authenticateSupervisorPin — secrets", () => {
  it("ausência de secrets é fail-closed e não consulta candidatos", async () => {
    delete process.env.PIN_HASH_PEPPER
    delete process.env.AUTH_SECRET
    delete process.env.NEXTAUTH_SECRET
    expect(await authenticateSupervisorPin(PIN, {})).toBeNull()
    expect(h.findMany).not.toHaveBeenCalled()
    expect(h.update).not.toHaveBeenCalled()
  })
})

describe("verifySupervisorPinRecord / isDefault", () => {
  it("isDefault é true no plaintext 1234 e false após hash de outro PIN", async () => {
    expect(
      await isDefaultSupervisorPinRecord({ pin: PIN_BLOQUEADO, pinHash: null }, ENV),
    ).toBe(true)

    const pinHash = await hashSupervisorPin(PIN, ENV)
    expect(
      await isDefaultSupervisorPinRecord({ pin: PIN_BLOQUEADO, pinHash }, ENV),
    ).toBe(false)
  })

  it("currentPin legado 1234 ainda confere para rotação (sem o bloqueio de auth)", async () => {
    expect(
      await verifySupervisorPinRecord(PIN_BLOQUEADO, { pin: PIN_BLOQUEADO, pinHash: null }, ENV),
    ).toBe(true)
  })
})

describe("respostas/logs sem PIN", () => {
  it("upgrade em erro não inclui o PIN na mensagem", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    h.findMany.mockResolvedValue([
      { id: SUPERVISOR_ID, name: "Supervisora", pin: PIN, pinHash: null },
    ])
    h.update.mockRejectedValue(new Error("db down"))
    await authenticateSupervisorPin(PIN, ENV)
    const logged = errSpy.mock.calls.map((c) => c.map(String).join(" ")).join("\n")
    expect(logged).not.toContain(PIN)
    errSpy.mockRestore()
  })
})
