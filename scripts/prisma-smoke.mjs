/**
 * Teste rápido: Prisma + tabela mapeada `cliente` (model `Cliente`).
 * Uso: node --env-file=.env scripts/prisma-smoke.mjs
 */
import { PrismaClient } from "../generated/prisma/index.js"

const prisma = new PrismaClient()

try {
  await prisma.$connect()
  const total = await prisma.cliente.count()
  const sample = await prisma.cliente.findFirst({
    select: { id: true, nome: true, telefone: true, email: true, cpf: true },
    orderBy: { updatedAt: "desc" },
  })
  console.log("[prisma-smoke] OK — conexão com o banco estabelecida.")
  console.log("[prisma-smoke] Total de linhas em cliente:", total)
  console.log("[prisma-smoke] Registro de exemplo:", sample ?? "(nenhum)")
  process.exit(0)
} catch (e) {
  console.error("[prisma-smoke] FALHA:", e)
  process.exit(1)
} finally {
  await prisma.$disconnect()
}
