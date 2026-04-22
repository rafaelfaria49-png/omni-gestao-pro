/**
 * Descreve colunas da tabela `public.product`.
 * Uso:
 *   node --env-file=.env scripts/describe-product-table.mjs
 */
import { PrismaClient } from "../generated/prisma/index.js"

const prisma = new PrismaClient()

async function withRetry(label, fn, attempts = 8) {
  let last
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn()
    } catch (e) {
      last = e
      const msg = e instanceof Error ? e.message : String(e)
      const transient = /P1001|P1002|P1017|timeout|ECONNRESET|ENOTFOUND|connection|Can't reach database/i.test(msg)
      if (!transient || i === attempts - 1) break
      const ms = 650 * (i + 1)
      console.warn(`[describe-product-table] ${label} retry ${i + 1}/${attempts} em ${ms}ms:`, msg.slice(0, 160))
      await new Promise((r) => setTimeout(r, ms))
    }
  }
  throw last
}

async function main() {
  await withRetry("$connect", () => prisma.$connect())
  const cols = await prisma.$queryRawUnsafe(`
    SELECT
      table_schema AS schema,
      table_name AS table,
      column_name,
      data_type,
      is_nullable,
      column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'product'
    ORDER BY ordinal_position;
  `)
  console.log(JSON.stringify(cols, null, 2))
}

main()
  .catch((e) => {
    console.error("[describe-product-table] FALHA:", e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

