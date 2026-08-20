/**
 * Hash autenticável do PIN de supervisor — OMNIGESTAO-PIN-HASH-MIGRATION-FIX-014.
 *
 * Construção: HMAC-SHA256(pepper, PIN) → bcryptjs custo 12.
 * O pepper NÃO é o PIN e NÃO é logado. Precedência:
 *   PIN_HASH_PEPPER → AUTH_SECRET → NEXTAUTH_SECRET (fail-closed se vazio).
 *
 * Este módulo não consulta o banco, não emite cookie e nunca regista o PIN.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import bcrypt from "bcryptjs"

export const PIN_HASH_BCRYPT_COST = 12
export const ENV_KEY_PIN_HASH_PEPPER = "PIN_HASH_PEPPER" as const

/** Prefixo de marcador opaco gravado em `User.pin` — nunca é um PIN autenticável. */
export const OPAQUE_UNUSABLE_PIN_PREFIX = "x:" as const

const BCRYPT_HASH_RE = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/

type EnvLike = Record<string, string | undefined>

export class PinHashMisconfiguredError extends Error {
  readonly code = "pin_hash_misconfigured" as const
  constructor() {
    super("Supervisor PIN hash is not configured.")
    this.name = "PinHashMisconfiguredError"
  }
}

export function resolvePinHashPepper(env: EnvLike = process.env): string | null {
  const base = (
    env[ENV_KEY_PIN_HASH_PEPPER] ??
    env.AUTH_SECRET ??
    env.NEXTAUTH_SECRET ??
    ""
  ).trim()
  return base.length > 0 ? base : null
}

/** Detecta um hash bcrypt canónico (60 caracteres, prefixo $2a$/$2b$/$2y$). */
export function isBcryptHash(value: string | null | undefined): boolean {
  return typeof value === "string" && BCRYPT_HASH_RE.test(value)
}

/**
 * HMAC-SHA256 do PIN com o pepper como chave. O digest hex (64 chars) cabe no
 * limite de 72 bytes do bcrypt e nunca é o PIN em claro.
 */
export function pepperSupervisorPin(pin: string, pepper: string): string {
  return createHmac("sha256", pepper).update(pin, "utf8").digest("hex")
}

export function timingSafeEqualString(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8")
  const b = Buffer.from(right, "utf8")
  if (a.length !== b.length) {
    timingSafeEqual(a, a)
    return false
  }
  return timingSafeEqual(a, b)
}

/** Marcador único para `User.pin` quando o PIN real só existe em `pinHash`. */
export function newOpaqueUnusablePin(): string {
  return `${OPAQUE_UNUSABLE_PIN_PREFIX}${randomBytes(16).toString("hex")}`
}

export function isOpaqueUnusablePin(value: string): boolean {
  return value.startsWith(OPAQUE_UNUSABLE_PIN_PREFIX)
}

export async function hashSupervisorPin(pin: string, env: EnvLike = process.env): Promise<string> {
  const pepper = resolvePinHashPepper(env)
  if (!pepper) throw new PinHashMisconfiguredError()
  return bcrypt.hash(pepperSupervisorPin(pin, pepper), PIN_HASH_BCRYPT_COST)
}

/**
 * Compara um PIN candidato a um `pinHash` bcrypt. Fail-closed: hash inválido,
 * pepper ausente ou PIN vazio passam por um dummy hash e devolvem false.
 * O PIN nunca é logado.
 */
export async function verifySupervisorPin(
  pin: string,
  pinHash: string,
  env: EnvLike = process.env,
): Promise<boolean> {
  const dummy = await dummySupervisorPinHash()
  const pepper = resolvePinHashPepper(env)
  if (!pepper || pin.length === 0) {
    await bcrypt.compare("0", dummy)
    return false
  }
  if (!isBcryptHash(pinHash)) {
    await bcrypt.compare(pepperSupervisorPin(pin, pepper), dummy)
    return false
  }
  return bcrypt.compare(pepperSupervisorPin(pin, pepper), pinHash)
}

let dummyHashPromise: Promise<string> | null = null

/** Hash dummy cacheado — caminhos de falha também pagam uma avaliação bcrypt. */
export async function dummySupervisorPinHash(): Promise<string> {
  dummyHashPromise ??= bcrypt.hash("dummy-supervisor-pin-fail-closed", PIN_HASH_BCRYPT_COST)
  return dummyHashPromise
}

/** Só para testes — esvazia o dummy cacheado. */
export function __resetDummySupervisorPinHashForTests(): void {
  dummyHashPromise = null
}
