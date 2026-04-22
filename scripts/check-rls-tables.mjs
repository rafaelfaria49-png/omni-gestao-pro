/**
 * Diagnóstico local: RLS (relrowsecurity) e contagens nas tabelas do app.
 * Rode na máquina que alcança o Postgres (mesmo .env do app):
 *   node --env-file=.env scripts/check-rls-tables.mjs
 */
import { PrismaClient } from "../generated/prisma/index.js"

const prisma = new PrismaClient()

const TABLES = ["clientes_importados", "estoque_produtos", "categorias_produto", "ordens_servico"]

async function main() {
  await prisma.$connect()
  console.log("[check-rls] conexão OK\n")

  const meta = await prisma.$queryRawUnsafe(`
    SELECT c.relname AS name, c.relrowsecurity AS rls_on
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND c.relname IN (${TABLES.map((t) => `'${t.replace(/'/g, "''")}'`).join(", ")})
    ORDER BY c.relname
  `)
  console.log("[check-rls] Row Level Security por tabela (rls_on = true → RLS ativo no Postgres):")
  console.table(meta)

  const byLojaCliente = await prisma.$queryRaw`
    SELECT "lojaId" AS loja_id, COUNT(*)::bigint AS n
    FROM clientes_importados
    GROUP BY "lojaId"
    ORDER BY n DESC
  `
  const byLojaProd = await prisma.$queryRaw`
    SELECT "lojaId" AS loja_id, COUNT(*)::bigint AS n
    FROM estoque_produtos
    GROUP BY "lojaId"
    ORDER BY n DESC
  `
  console.log("\n[check-rls] clientes_importados por lojaId:")
  console.table(byLojaCliente)
  console.log("[check-rls] estoque_produtos por lojaId:")
  console.table(byLojaProd)

  const totalC = await prisma.cliente.count()
  const totalP = await prisma.produto.count()
  console.log("\n[check-rls] totais via Prisma (mesmo path da API):", { clientes: totalC, produtos: totalP })

  await prisma.$disconnect()
  process.exit(0)
}

main().catch((e) => {
  console.error("[check-rls] erro:", e)
  prisma.$disconnect().finally(() => process.exit(1))
})
