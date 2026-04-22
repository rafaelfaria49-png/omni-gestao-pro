/**
 * Teste rápido: Prisma + tabela mapeada `product` (model `Produto`).
 * Uso: node --env-file=.env scripts/produto-smoke.mjs
 */
import { PrismaClient } from "../generated/prisma/index.js"

const prisma = new PrismaClient()

try {
  await prisma.$connect()
  const total = await prisma.produto.count()
  const sample = await prisma.produto.findFirst({
    select: { id: true, lojaId: true, name: true, stock: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  })
  console.log("[produto-smoke] OK — conexão com o banco estabelecida.")
  console.log("[produto-smoke] Total de linhas em product:", total)
  console.log("[produto-smoke] Registro de exemplo:", sample ?? "(nenhum)")
  process.exit(0)
} catch (e) {
  console.error("[produto-smoke] FALHA:", e)
  process.exit(1)
} finally {
  await prisma.$disconnect()
}

