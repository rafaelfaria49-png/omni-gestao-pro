/**
 * Cria o usuário Supervisor inicial (PIN do PDV) no banco de dados.
 *
 * Uso: npx tsx scripts/seed-supervisor-pin.ts
 *
 * Variáveis de ambiente:
 *   SUPERVISOR_DEFAULT_PIN  — obrigatório. 4–12 dígitos, fora da lista bloqueada
 *                             (nunca "1234").
 *   SUPERVISOR_DEFAULT_NAME — Nome exibido. Default: "Supervisor Padrão".
 *
 * Comportamento idempotente:
 *  - Se já existir QUALQUER usuário com role ADMIN/admin, o seed NÃO faz nada.
 *  - Se NÃO existir, cria um User { role: "ADMIN", pinHash: hash(PIN), pin: marcador opaco }.
 *  - O PIN real NUNCA é gravado em User.pin nem impresso nos logs.
 *
 * Alterações posteriores: Master Console (`/dashboard/master-console`).
 */

import { PrismaClient } from "../generated/prisma"
import * as dotenv from "dotenv"
import { resolve } from "path"
import { isBlockedLegacySupervisorPin } from "../lib/auth/pin-authorization"
import { hashSupervisorPin, newOpaqueUnusablePin } from "../lib/auth/pin-hash"

dotenv.config({ path: resolve(__dirname, "../.env") })

const PIN_REGEX = /^\d{4,12}$/

export function resolveSupervisorSeedPin(raw: string | undefined): string {
  const pin = (raw ?? "").trim()
  if (!pin) {
    throw new Error(
      "Defina SUPERVISOR_DEFAULT_PIN (4–12 dígitos) antes de rodar o seed. O valor legado 1234 é bloqueado.",
    )
  }
  if (!PIN_REGEX.test(pin)) {
    throw new Error("SUPERVISOR_DEFAULT_PIN deve ter entre 4 e 12 dígitos numéricos.")
  }
  if (isBlockedLegacySupervisorPin(pin)) {
    throw new Error("SUPERVISOR_DEFAULT_PIN usa um valor padrão bloqueado. Escolha outro PIN.")
  }
  return pin
}

type SeedEnv = Record<string, string | undefined>

export async function seedSupervisorPin(db: PrismaClient, env: SeedEnv = process.env): Promise<{
  action: "skipped" | "created"
  id?: string
}> {
  const pin = resolveSupervisorSeedPin(env.SUPERVISOR_DEFAULT_PIN)
  const name = (env.SUPERVISOR_DEFAULT_NAME ?? "Supervisor Padrão").trim()

  const existing = await db.user.findFirst({
    where: { OR: [{ role: "ADMIN" }, { role: "admin" }] },
    select: { id: true, name: true, role: true },
  })

  if (existing) {
    console.log(
      `✓ Já existe um usuário supervisor (id=${existing.id}, role=${existing.role}). Nada a fazer.`,
    )
    return { action: "skipped", id: existing.id }
  }

  const pinHash = await hashSupervisorPin(pin, env)
  const opaquePin = newOpaqueUnusablePin()

  const created = await db.user.create({
    data: {
      name,
      pin: opaquePin,
      pinHash,
      role: "ADMIN",
    },
    select: { id: true, name: true, role: true },
  })

  console.log(
    `✓ Supervisor criado: ${created.name} (id=${created.id}, role=${created.role}). Autenticação somente via pinHash.`,
  )
  return { action: "created", id: created.id }
}

function isDirectRun(): boolean {
  const entry = process.argv[1]?.replace(/\\/g, "/") ?? ""
  return /seed-supervisor-pin\.(ts|js|mts|cjs|mjs)$/.test(entry) && !entry.includes(".test.")
}

if (isDirectRun()) {
  const db = new PrismaClient()
  seedSupervisorPin(db)
    .catch((err) => {
      console.error("✗ Erro no seed do supervisor:", err instanceof Error ? err.message : err)
      process.exit(1)
    })
    .finally(() => db.$disconnect())
}
