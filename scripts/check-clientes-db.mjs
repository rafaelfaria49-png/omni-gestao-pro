/**
 * Diagnóstico do banco: contagem e lojaId em `clientes_importados`.
 * Uso:
 *   node --env-file=.env scripts/check-clientes-db.mjs
 */
import { PrismaClient } from "../generated/prisma/index.js"

const prisma = new PrismaClient()

async function main() {
  await prisma.$connect()

  const total = await prisma.cliente.count()
  const distinctLoja = await prisma.cliente.findMany({
    select: { lojaId: true },
    distinct: ["lojaId"],
  })

  console.log(JSON.stringify({ total, distinctLojaId: distinctLoja }, null, 2))
}

main()
  .catch((e) => {
    console.error("[check-clientes-db] FALHA:", e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

