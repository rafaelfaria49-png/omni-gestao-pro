/**
 * Verificador CENTRAL do PIN de supervisor.
 *
 * Todas as rotas que autenticam um PIN ({ pin }, { supervisorPin }, { currentPin })
 * passam por aqui. Nenhuma consulta SQL compara o candidato com `User.pin`.
 *
 *  - `pinHash` bcrypt válido → HMAC+bcrypt
 *  - legado plaintext (sem pinHash) → comparação timing-safe; sucesso preenche pinHash
 *    e deixa `User.pin` intacto nesta fase
 *  - PIN legado 1234 é recusado ANTES de carregar candidatos
 */

import { prisma, prismaEnsureConnected } from "@/lib/prisma"
import { isBlockedLegacySupervisorPin, LEGACY_DEFAULT_SUPERVISOR_PIN } from "@/lib/auth/pin-authorization"
import {
  dummySupervisorPinHash,
  hashSupervisorPin,
  isBcryptHash,
  PinHashMisconfiguredError,
  resolvePinHashPepper,
  timingSafeEqualString,
  verifySupervisorPin,
} from "@/lib/auth/pin-hash"
import bcrypt from "bcryptjs"

export const SUPERVISOR_ROLE_FILTER: { OR: { role: string }[] } = {
  OR: [{ role: "ADMIN" }, { role: "admin" }],
}

export type SupervisorPinRecord = {
  id: string
  name: string
  pin: string
  pinHash: string | null
}

export type SupervisorPinMatch = {
  id: string
  name: string
}

type EnvLike = Record<string, string | undefined>

/**
 * Compara o candidato a UM registro. Não aplica o bloqueio de 1234 (a rotação
 * precisa aceitar o default legado como `currentPin`). Não grava upgrade.
 */
export async function verifySupervisorPinRecord(
  candidate: string,
  record: { pin: string; pinHash: string | null },
  env: EnvLike = process.env,
): Promise<boolean> {
  const pin = candidate.trim()
  if (pin.length === 0) return false

  const storedHash = record.pinHash
  if (typeof storedHash === "string" && isBcryptHash(storedHash)) {
    return verifySupervisorPin(pin, storedHash, env)
  }

  if (typeof storedHash === "string" && storedHash.length > 0) {
    const dummy = await dummySupervisorPinHash()
    await bcrypt.compare(pin, dummy)
    return false
  }

  return timingSafeEqualString(record.pin, pin)
}

/**
 * `isDefault` do Master Console: o registro ainda autentica como o PIN legado
 * bloqueado (plaintext residual ou hash de 1234). Não devolve o PIN.
 */
export async function isDefaultSupervisorPinRecord(
  record: { pin: string; pinHash: string | null },
  env: EnvLike = process.env,
): Promise<boolean> {
  return verifySupervisorPinRecord(LEGACY_DEFAULT_SUPERVISOR_PIN, record, env)
}

/**
 * Autentica um PIN de supervisor. Recusa 1234 e PIN vazio sem consultar o banco.
 * Em sucesso de legado plaintext, preenche `pinHash` e não altera `pin`.
 */
export async function authenticateSupervisorPin(
  candidate: string,
  env: EnvLike = process.env,
): Promise<SupervisorPinMatch | null> {
  const pin = candidate.trim()
  if (pin.length === 0 || isBlockedLegacySupervisorPin(pin)) {
    return null
  }

  if (!resolvePinHashPepper(env)) {
    const dummy = await dummySupervisorPinHash()
    await bcrypt.compare(pin, dummy)
    return null
  }

  await prismaEnsureConnected()
  const candidates = await prisma.user.findMany({
    where: SUPERVISOR_ROLE_FILTER,
    select: { id: true, name: true, pin: true, pinHash: true },
    orderBy: { createdAt: "asc" },
  })

  let matched: SupervisorPinRecord | null = null
  for (const row of candidates) {
    if (await verifySupervisorPinRecord(pin, row, env)) {
      matched = row
      break
    }
  }

  if (!matched) {
    const dummy = await dummySupervisorPinHash()
    await bcrypt.compare(pin, dummy)
    return null
  }

  if (!isBcryptHash(matched.pinHash)) {
    try {
      const pinHash = await hashSupervisorPin(pin, env)
      await prisma.user.update({
        where: { id: matched.id },
        data: { pinHash },
      })
    } catch (e) {
      if (!(e instanceof PinHashMisconfiguredError)) {
        console.error(
          "[verify-supervisor-pin:upgrade]",
          e instanceof Error ? e.message : String(e),
        )
      }
    }
  }

  return { id: matched.id, name: matched.name }
}
