/**
 * Remove clientes criados recentemente (para desfazer import errado).
 *
 * Uso:
 *   node --env-file=.env scripts/cleanup-recent-clientes.mjs --minutes 15 --lojaId loja-1
 *
 * Segurança:
 * - Mostra contagem antes/depois.
 * - Deleta SOMENTE por `createdAt >= now - minutes`.
 */
import { PrismaClient } from "../generated/prisma/index.js"
 
const prisma = new PrismaClient()
 
function argValue(flag) {
  const i = process.argv.indexOf(flag)
  if (i === -1) return null
  return process.argv[i + 1] ?? null
}
 
async function main() {
  const minutesRaw = argValue("--minutes")
  const lojaId = (argValue("--lojaId") || "loja-1").trim() || "loja-1"
  const minutes = Math.max(1, Math.floor(Number(minutesRaw || "15")))
  const cutoff = new Date(Date.now() - minutes * 60 * 1000)
 
  await prisma.$connect()
 
  const totalBefore = await prisma.cliente.count({ where: { lojaId } })
  const recentBefore = await prisma.cliente.count({ where: { lojaId, createdAt: { gte: cutoff } } })
  const sample = await prisma.cliente.findMany({
    where: { lojaId, createdAt: { gte: cutoff } },
    select: { id: true, nome: true, createdAt: true, telefone: true, docDigits: true },
    orderBy: { createdAt: "desc" },
    take: 5,
  })
 
  console.log(
    JSON.stringify(
      { lojaId, minutes, cutoff: cutoff.toISOString(), totalBefore, recentBefore, sampleRecent: sample },
      null,
      2
    )
  )
 
  const del = await prisma.cliente.deleteMany({ where: { lojaId, createdAt: { gte: cutoff } } })
  const totalAfter = await prisma.cliente.count({ where: { lojaId } })
 
  console.log(JSON.stringify({ deleted: del.count, totalAfter }, null, 2))
}
 
main()
  .catch((e) => {
    console.error("[cleanup-recent-clientes] FALHA:", e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

