/**
 * Backfill seguro de `User.pinHash` a partir de PINs plaintext legados.
 *
 * Uso:
 *   npx tsx scripts/backfill-supervisor-pin-hash.ts           → dry-run
 *   npx tsx scripts/backfill-supervisor-pin-hash.ts --exec    → grava pinHash
 *
 * Regras:
 *  - Só ADMIN/admin com pinHash vazio e `pin` numérico 4–12 dígitos.
 *  - Usa a mesma `hashSupervisorPin` da autenticação.
 *  - NÃO altera `User.pin`. NÃO imprime o PIN.
 *  - Recusa VERCEL_ENV=production. Este GOAL NÃO executa em Production.
 */

import { PrismaClient } from "../generated/prisma"
import * as dotenv from "dotenv"
import { resolve } from "path"
import { hashSupervisorPin, isBcryptHash, isOpaqueUnusablePin } from "../lib/auth/pin-hash"

dotenv.config({ path: resolve(__dirname, "../.env") })

const PIN_REGEX = /^\d{4,12}$/

type BackfillEnv = Record<string, string | undefined>

export function isProductionBackfillForbidden(env: BackfillEnv = process.env): boolean {
  return env.VERCEL_ENV === "production"
}

export function shouldBackfillSupervisorPin(row: { pin: string; pinHash: string | null }): boolean {
  if (typeof row.pinHash === "string" && isBcryptHash(row.pinHash)) return false
  if (typeof row.pinHash === "string" && row.pinHash.length > 0) return false
  if (isOpaqueUnusablePin(row.pin)) return false
  return PIN_REGEX.test(row.pin)
}

export async function backfillSupervisorPinHash(
  db: PrismaClient,
  opts: { exec: boolean; env?: BackfillEnv } = { exec: false },
): Promise<{ scanned: number; eligible: number; written: number; ids: string[] }> {
  const env = opts.env ?? process.env
  if (isProductionBackfillForbidden(env)) {
    throw new Error("Backfill recusado: VERCEL_ENV=production. Este GOAL não escreve em Production.")
  }

  const rows = await db.user.findMany({
    where: { OR: [{ role: "ADMIN" }, { role: "admin" }] },
    select: { id: true, pin: true, pinHash: true },
    orderBy: { createdAt: "asc" },
  })

  const eligible = rows.filter(shouldBackfillSupervisorPin)
  const ids = eligible.map((r) => r.id)
  let written = 0

  if (opts.exec) {
    for (const row of eligible) {
      const pinHash = await hashSupervisorPin(row.pin, env)
      await db.user.update({
        where: { id: row.id },
        data: { pinHash },
      })
      written += 1
    }
  }

  console.log(
    JSON.stringify({
      event: "supervisor_pin_hash_backfill",
      mode: opts.exec ? "exec" : "dry-run",
      scanned: rows.length,
      eligible: eligible.length,
      written,
      ids,
    }),
  )

  return { scanned: rows.length, eligible: eligible.length, written, ids }
}

function isDirectRun(): boolean {
  const entry = process.argv[1]?.replace(/\\/g, "/") ?? ""
  return /backfill-supervisor-pin-hash\.(ts|js|mts|cjs|mjs)$/.test(entry) && !entry.includes(".test.")
}

if (isDirectRun()) {
  const db = new PrismaClient()
  const exec = process.argv.includes("--exec")
  backfillSupervisorPinHash(db, { exec })
    .catch((err) => {
      console.error("✗ Erro no backfill de pinHash:", err instanceof Error ? err.message : err)
      process.exit(1)
    })
    .finally(() => db.$disconnect())
}
