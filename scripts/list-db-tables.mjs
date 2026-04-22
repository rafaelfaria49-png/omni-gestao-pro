/**
 * Lista tabelas/visões de TODOS os schemas (exceto system schemas) via SQL bruto.
 * Uso:
 *   node --env-file=.env scripts/list-db-tables.mjs
 */
import { PrismaClient } from "../generated/prisma/index.js"
 
const prisma = new PrismaClient()
 
function sortBySchemaThenName(a, b) {
  const sa = String(a.schema || "")
  const sb = String(b.schema || "")
  if (sa !== sb) return sa.localeCompare(sb)
  return String(a.name || "").localeCompare(String(b.name || ""))
}
 
async function main() {
  await prisma.$connect()
 
  const schemas = await prisma.$queryRawUnsafe(`
    SELECT nspname AS schema
    FROM pg_catalog.pg_namespace
    WHERE nspname NOT IN ('pg_catalog','information_schema')
    ORDER BY nspname;
  `)
 
  const objects = await prisma.$queryRawUnsafe(`
    SELECT
      n.nspname AS schema,
      c.relname AS name,
      c.relkind AS kind
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r','p','v','m','f')
      AND n.nspname NOT IN ('pg_catalog','information_schema')
    ORDER BY n.nspname, c.relname;
  `)
 
  const maybeClientes = objects
    .filter((o) => {
      const n = String(o.name || "").toLowerCase()
      return n.includes("cliente") || n.includes("import") || n.includes("backup")
    })
    .sort(sortBySchemaThenName)
 
  console.log(
    JSON.stringify(
      {
        schemas,
        count: objects.length,
        maybeClientes,
        objects,
      },
      null,
      2
    )
  )
}
 
main()
  .catch((e) => {
    console.error("[list-db-tables] FALHA:", e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

