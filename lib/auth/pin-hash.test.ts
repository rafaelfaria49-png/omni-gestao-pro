/**
 * OMNIGESTAO-PIN-HASH-MIGRATION-FIX-014 — primitivas HMAC + bcrypt do PIN.
 *
 * Nenhum PIN de produção aparece aqui. Os valores são fictícios de teste.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.setConfig({ testTimeout: 20_000 })
import {
  __resetDummySupervisorPinHashForTests,
  dummySupervisorPinHash,
  hashSupervisorPin,
  isBcryptHash,
  isOpaqueUnusablePin,
  newOpaqueUnusablePin,
  PIN_HASH_BCRYPT_COST,
  PinHashMisconfiguredError,
  resolvePinHashPepper,
  verifySupervisorPin,
} from "./pin-hash"

const PIN = "908172"
const OTHER = "111999"
const PEPPER_A = "pepper-de-teste-pin-hash-014-aaaa"
const PEPPER_B = "pepper-de-teste-pin-hash-014-bbbb"
const AUTH_SECRET = "segredo-de-teste-pin-hash-014"

const ENV_KEYS = ["PIN_HASH_PEPPER", "AUTH_SECRET", "NEXTAUTH_SECRET"] as const

function wipeSecrets(): void {
  for (const k of ENV_KEYS) delete process.env[k]
}

beforeEach(() => {
  wipeSecrets()
  process.env.PIN_HASH_PEPPER = PEPPER_A
})

afterEach(() => {
  wipeSecrets()
  __resetDummySupervisorPinHashForTests()
})

describe("resolvePinHashPepper", () => {
  it("PIN_HASH_PEPPER tem precedência", () => {
    process.env.AUTH_SECRET = AUTH_SECRET
    process.env.NEXTAUTH_SECRET = "next-secret"
    expect(resolvePinHashPepper()).toBe(PEPPER_A)
  })

  it("cai em AUTH_SECRET quando o pepper dedicado está ausente", () => {
    delete process.env.PIN_HASH_PEPPER
    process.env.AUTH_SECRET = AUTH_SECRET
    expect(resolvePinHashPepper()).toBe(AUTH_SECRET)
  })

  it("cai em NEXTAUTH_SECRET por último", () => {
    delete process.env.PIN_HASH_PEPPER
    delete process.env.AUTH_SECRET
    process.env.NEXTAUTH_SECRET = "next-secret"
    expect(resolvePinHashPepper()).toBe("next-secret")
  })

  it("ausência de secrets é fail-closed (null)", () => {
    wipeSecrets()
    expect(resolvePinHashPepper()).toBeNull()
  })
})

describe("isBcryptHash", () => {
  it("reconhece um hash bcrypt custo 12", async () => {
    const hash = await hashSupervisorPin(PIN)
    expect(isBcryptHash(hash)).toBe(true)
    expect(hash.startsWith(`$2b$${String(PIN_HASH_BCRYPT_COST).padStart(2, "0")}$`) || hash.startsWith("$2a$12$") || hash.startsWith("$2y$12$")).toBe(true)
  })

  it("rejeita plaintext, vazio e lixo", () => {
    expect(isBcryptHash(PIN)).toBe(false)
    expect(isBcryptHash("")).toBe(false)
    expect(isBcryptHash(null)).toBe(false)
    expect(isBcryptHash("$2b$12$not-a-real-hash")).toBe(false)
  })
})

describe("hashSupervisorPin / verifySupervisorPin", () => {
  it("hash e verify do mesmo PIN passam", async () => {
    const hash = await hashSupervisorPin(PIN)
    expect(await verifySupervisorPin(PIN, hash)).toBe(true)
  })

  it("PIN incorreto falha", async () => {
    const hash = await hashSupervisorPin(PIN)
    expect(await verifySupervisorPin(OTHER, hash)).toBe(false)
  })

  it("mesmo PIN produz hashes distintos (salt bcrypt)", async () => {
    const a = await hashSupervisorPin(PIN)
    const b = await hashSupervisorPin(PIN)
    expect(a).not.toBe(b)
    expect(await verifySupervisorPin(PIN, a)).toBe(true)
    expect(await verifySupervisorPin(PIN, b)).toBe(true)
  })

  it("pepper diferente invalida o hash", async () => {
    const hash = await hashSupervisorPin(PIN, { PIN_HASH_PEPPER: PEPPER_A })
    expect(await verifySupervisorPin(PIN, hash, { PIN_HASH_PEPPER: PEPPER_B })).toBe(false)
    expect(await verifySupervisorPin(PIN, hash, { PIN_HASH_PEPPER: PEPPER_A })).toBe(true)
  })

  it("ausência de secrets no hash lança fail-closed", async () => {
    await expect(hashSupervisorPin(PIN, {})).rejects.toBeInstanceOf(PinHashMisconfiguredError)
  })

  it("ausência de secrets no verify devolve false (fail-closed)", async () => {
    const hash = await hashSupervisorPin(PIN)
    expect(await verifySupervisorPin(PIN, hash, {})).toBe(false)
  })

  it("hash que não é bcrypt devolve false após dummy compare", async () => {
    expect(await verifySupervisorPin(PIN, PIN)).toBe(false)
  })

  it("dummy hash é bcrypt válido e não contém o PIN", async () => {
    const dummy = await dummySupervisorPinHash()
    expect(isBcryptHash(dummy)).toBe(true)
    expect(dummy).not.toContain(PIN)
  })
})

describe("marcador opaco", () => {
  it("não é um PIN numérico e dois marcadores diferem", () => {
    const a = newOpaqueUnusablePin()
    const b = newOpaqueUnusablePin()
    expect(a).not.toBe(b)
    expect(isOpaqueUnusablePin(a)).toBe(true)
    expect(/^\d{4,12}$/.test(a)).toBe(false)
  })
})

describe("nunca loga o PIN", () => {
  it("o módulo de hash não contém console.log/info/debug", async () => {
    const { readFileSync } = await import("node:fs")
    const { resolve } = await import("node:path")
    const src = readFileSync(resolve(__dirname, "pin-hash.ts"), "utf8")
    expect(src).not.toMatch(/console\.(log|info|debug|warn)/)
    expect(src).not.toContain(PIN)
  })
})
