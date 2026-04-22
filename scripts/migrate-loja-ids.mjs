/**
 * Atualiza `lojaId` em massa quando dados legados estão em um id (ex.: loja-1)
 * e a multiloja passou a usar outro id.
 *
 * Uso:
 *   node --env-file=.env scripts/migrate-loja-ids.mjs --from=loja-antiga --to=loja-1
 *   node --env-file=.env scripts/migrate-loja-ids.mjs --from=loja-1 --to=minha-loja-ativa --dry-run
 */
import { PrismaClient } from "../generated/prisma/index.js"

const prisma = new PrismaClient()

function arg(name) {
  const eq = `--${name}=`
  const hitEq = process.argv.find((a) => a.startsWith(eq))
  if (hitEq) return hitEq.slice(eq.length)

  const flag = `--${name}`
  const idx = process.argv.findIndex((a) => a === flag)
  if (idx >= 0) {
    const next = process.argv[idx + 1]
    if (next && !next.startsWith("--")) return next
  }
  return undefined
}

const from = arg("from")
const to = arg("to")
const dry = process.argv.includes("--dry-run")

async function tableExists(tableName) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT 1 AS ok FROM information_schema.tables WHERE table_schema='public' AND table_name='${String(tableName).replace(/'/g, "''")}' LIMIT 1`
  )
  return Array.isArray(rows) && rows.length > 0
}

async function main() {
  if (!from || !to || from === to) {
    console.error("Uso: node --env-file=.env scripts/migrate-loja-ids.mjs --from=<id_origem> --to=<id_destino> [--dry-run]")
    process.exit(1)
  }

  await prisma.$connect()

  const hasClientes = await tableExists("clientes_importados")
  const hasProdutos = await tableExists("estoque_produtos")
  const hasCategorias = await tableExists("categorias_produto")
  const hasOrdens = await tableExists("ordens_servico")

  console.log("[migrate-loja-ids] tabelas detectadas:", {
    clientes_importados: hasClientes,
    estoque_produtos: hasProdutos,
    categorias_produto: hasCategorias,
    ordens_servico: hasOrdens,
  })

  const counts = async () => {
    const [clientes, produtos, categorias, ordens] = await Promise.all([
      hasClientes ? prisma.cliente.count({ where: { lojaId: from } }) : Promise.resolve(0),
      hasProdutos ? prisma.produto.count({ where: { lojaId: from } }) : Promise.resolve(0),
      hasCategorias ? prisma.categoriaProduto.count({ where: { lojaId: from } }) : Promise.resolve(0),
      hasOrdens ? prisma.ordemServico.count({ where: { lojaId: from } }) : Promise.resolve(0),
    ])
    return { clientes, produtos, categorias, ordens }
  }

  const before = await counts()
  console.log(`[migrate-loja-ids] origem=${from} destino=${to} dry-run=${dry}`)
  console.log("[migrate-loja-ids] linhas com lojaId=origem:", before)

  if (dry) {
    await prisma.$disconnect()
    process.exit(0)
  }

  const r1 = hasClientes
    ? await prisma.cliente.updateMany({ where: { lojaId: from }, data: { lojaId: to } })
    : { count: 0 }
  const r2 = hasProdutos
    ? await prisma.produto.updateMany({ where: { lojaId: from }, data: { lojaId: to } })
    : { count: 0 }
  const r3 = hasCategorias
    ? await prisma.categoriaProduto.updateMany({ where: { lojaId: from }, data: { lojaId: to } })
    : { count: 0 }
  const r4 = hasOrdens
    ? await prisma.ordemServico.updateMany({ where: { lojaId: from }, data: { lojaId: to } })
    : { count: 0 }

  console.log("[migrate-loja-ids] atualizados:", {
    clientes: r1.count,
    produtos: r2.count,
    categorias: r3.count,
    ordens: r4.count,
  })

  const after = await counts()
  console.log("[migrate-loja-ids] linhas restantes com lojaId=origem (deve ser 0):", after)

  await prisma.$disconnect()
  process.exit(0)
}

main().catch((e) => {
  console.error("[migrate-loja-ids] erro:", e)
  const code = e && typeof e === "object" && "code" in e ? String((e).code) : ""
  if (code === "P1001" || /Can't reach database/i.test(String(e))) {
    console.error(
      "[migrate-loja-ids] Dica: execute este script na sua máquina (onde o Next/Prisma já conecta) com o mesmo .env:"
    )
    console.error('  npm run db:migrate-loja -- --from=loja-antiga --to=loja-1')
  }
  prisma.$disconnect().finally(() => process.exit(1))
})
