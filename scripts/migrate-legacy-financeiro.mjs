/**
 * Copia dados de tabelas legadas (ex.: `contas_receber` sem sufixo `_titulos`)
 * para `contas_receber_titulos`, usando `localKey` + `payload` JSON.
 *
 * Uso:
 *   node --env-file=.env scripts/migrate-legacy-financeiro.mjs
 *   node --env-file=.env scripts/migrate-legacy-financeiro.mjs --table=contas_receber --storeId=loja-1 --dry-run
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

async function tableExists(tableName) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT 1 AS ok FROM information_schema.tables WHERE table_schema='public' AND table_name='${String(tableName).replace(/'/g, "''")}' LIMIT 1`
  )
  return Array.isArray(rows) && rows.length > 0
}

async function listSimilarTables() {
  const rows = await prisma.$queryRaw`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND (
        table_name = 'contas_receber'
        OR table_name LIKE 'contas%receber%'
      )
    ORDER BY table_name
  `
  return Array.isArray(rows) ? rows.map((r) => r.table_name) : []
}

function pickString(row, keys) {
  for (const k of keys) {
    const v = row[k]
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v)
  }
  return ""
}

function pickNumber(row, keys) {
  for (const k of keys) {
    const v = row[k]
    if (typeof v === "number" && Number.isFinite(v)) return v
    if (typeof v === "string" && v.trim()) {
      const n = Number(v.replace(/\./g, "").replace(",", "."))
      if (Number.isFinite(n)) return n
    }
  }
  return 0
}

async function migrateContasFromTable(sourceTable, storeId, dry) {
  const exists = await tableExists(sourceTable)
  if (!exists) {
    console.log(`[migrate-legacy-financeiro] tabela origem inexistente: ${sourceTable}`)
    return 0
  }
  if (sourceTable === "contas_receber_titulos") {
    console.log("[migrate-legacy-financeiro] ignorando destino contas_receber_titulos como origem")
    return 0
  }

  const rows = await prisma.$queryRawUnsafe(`SELECT * FROM "${sourceTable.replace(/"/g, '""')}" LIMIT 20000`)
  if (!Array.isArray(rows) || rows.length === 0) {
    console.log(`[migrate-legacy-financeiro] ${sourceTable}: 0 linhas`)
    return 0
  }

  let n = 0
  for (const raw of rows) {
    const row = raw
    const id =
      pickString(row, ["id", "ID", "codigo", "Codigo", "uuid"]) ||
      `legacy-${sourceTable}-${n}-${Math.random().toString(36).slice(2, 9)}`
    const localKey = String(id)
    const descricao = pickString(row, ["descricao", "descricao_titulo", "titulo", "historico", "observacao"])
    const cliente = pickString(row, ["cliente", "nome_cliente", "cliente_nome", "nome"])
    const valor = pickNumber(row, ["valor", "valor_titulo", "total", "saldo"])
    const vencimento = pickString(row, ["vencimento", "data_vencimento", "vencto", "due_date"])
    const status = pickString(row, ["status", "situacao", "situação"]) || "pendente"

    let legacySafe = row
    try {
      legacySafe = JSON.parse(JSON.stringify(row))
    } catch {
      legacySafe = {}
    }
    const payload = {
      id: localKey,
      descricao,
      cliente,
      valor,
      vencimento,
      status,
      tipo: "Importado",
      legacy: legacySafe,
    }

    if (dry) {
      console.log("[dry-run] localKey=", localKey, "descricao=", descricao.slice(0, 40))
      n += 1
      continue
    }

    await prisma.contaReceberTitulo.upsert({
      where: { storeId_localKey: { storeId, localKey } },
      create: {
        storeId,
        localKey,
        payload,
        descricao,
        cliente,
        valor,
        vencimento,
        status,
      },
      update: {
        storeId,
        payload,
        descricao,
        cliente,
        valor,
        vencimento,
        status,
      },
    })
    n += 1
  }

  console.log(`[migrate-legacy-financeiro] ${sourceTable}: migradas ${n} linhas (dry-run=${dry})`)
  return n
}

async function main() {
  const dry = process.argv.includes("--dry-run")
  const storeId = arg("storeId") || "loja-1"
  const explicitTable = arg("table")

  await prisma.$connect()

  const names = await listSimilarTables()
  console.log("[migrate-legacy-financeiro] tabelas candidatas:", names)

  let total = 0
  const targets = explicitTable ? [explicitTable] : names.filter((t) => t !== "contas_receber_titulos")

  for (const t of targets) {
    total += await migrateContasFromTable(t, storeId, dry)
  }

  await prisma.$disconnect()
  console.log("[migrate-legacy-financeiro] concluído. total upserts:", total, "storeId=", storeId)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
