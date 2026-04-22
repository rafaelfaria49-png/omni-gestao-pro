/**
 * Script temporário (1x): reseta a venda do Cleton no BANCO (Postgres via Prisma).
 *
 * - Localiza Sale onde client_name = 'CLETON RICARDO SIQUEIRA'
 * - Deleta Payments associados
 * - Atualiza Sale: total_value=1290, entry_value=200, remaining_balance=1090, status='PENDENTE'
 * - Garante vencimento da 1ª parcela em 17/03/2026 (se existir uma coluna compatível na tabela Sale)
 *
 * Execução:
 *   npx tsx --env-file=.env scripts/reset-db.ts
 */
import { PrismaClient } from "../generated/prisma/index.js"

const SCHEMA = "public"
const TABLE_SALE = "Sale"
const TABLE_PAYMENT = "Payment"

const COL_CLIENT_NAME = "client_name"
const COL_PAYMENT_FK_SALE = "sale_id"

// Possíveis nomes de coluna para "vencimento 1ª parcela" na tabela Sale.
const DUE_DATE_CANDIDATES = [
  "first_installment_due_date",
  "first_due_date",
  "firstDueDate",
  "due_date_first_installment",
  "primeira_parcela_vencimento",
  "vencimento_primeira_parcela",
  "due_date",
] as const

const CLIENTE_ALVO = "CLETON RICARDO SIQUEIRA"

const TOTAL_VALUE = 1290
const ENTRY_VALUE = 200
const REMAINING_BALANCE = 1090
const STATUS = "PENDENTE"
const FIRST_DUE_DATE_BR = "17/03/2026"

const prisma = new PrismaClient()

async function findExistingDueDateColumn(): Promise<string | null> {
  const cols = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = $2
    `,
    SCHEMA,
    TABLE_SALE
  )
  const set = new Set(cols.map((c) => String(c.column_name)))
  for (const cand of DUE_DATE_CANDIDATES) {
    if (set.has(cand)) return cand
  }
  return null
}

function qTable(schema: string, table: string): string {
  return `"${schema}"."${table}"`
}

function qCol(col: string): string {
  return `"${col}"`
}

async function main() {
  await prisma.$connect()

  const qSale = qTable(SCHEMA, TABLE_SALE)
  const qPay = qTable(SCHEMA, TABLE_PAYMENT)
  const qClient = qCol(COL_CLIENT_NAME)
  const qFk = qCol(COL_PAYMENT_FK_SALE)

  const dueCol = await findExistingDueDateColumn()
  if (!dueCol) {
    console.warn(
      `[reset-db] Aviso: não achei coluna de vencimento da 1ª parcela em ${qSale}. Candidatas: ${DUE_DATE_CANDIDATES.join(", ")}`
    )
  }

  const sales = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id::text AS id FROM ${qSale} WHERE UPPER(TRIM(${qClient}::text)) = UPPER(TRIM($1))`,
    CLIENTE_ALVO
  )

  if (sales.length === 0) {
    console.log("[reset-db] Nenhuma Sale encontrada para este client_name.")
    return
  }
  if (sales.length > 1) {
    console.warn(`[reset-db] Atenção: ${sales.length} sales encontradas; todas serão processadas.`)
  }

  for (const s of sales) {
    const saleId = s.id

    const delPayments = await prisma.$executeRawUnsafe(
      `DELETE FROM ${qPay} WHERE ${qFk}::text = $1`,
      saleId
    )
    console.log(`[reset-db] Payments deletados (linhas): ${delPayments} — sale id=${saleId}`)

    if (dueCol) {
      const upd = await prisma.$executeRawUnsafe(
        `UPDATE ${qSale}
         SET
           "total_value" = $1,
           "entry_value" = $2,
           "remaining_balance" = $3,
           "status" = $4,
           ${qCol(dueCol)} = $5
         WHERE id::text = $6`,
        TOTAL_VALUE,
        ENTRY_VALUE,
        REMAINING_BALANCE,
        STATUS,
        FIRST_DUE_DATE_BR,
        saleId
      )
      console.log(`[reset-db] Sale atualizada (linhas): ${upd} — id=${saleId} (vencimento em ${dueCol}=${FIRST_DUE_DATE_BR})`)
    } else {
      const upd = await prisma.$executeRawUnsafe(
        `UPDATE ${qSale}
         SET
           "total_value" = $1,
           "entry_value" = $2,
           "remaining_balance" = $3,
           "status" = $4
         WHERE id::text = $5`,
        TOTAL_VALUE,
        ENTRY_VALUE,
        REMAINING_BALANCE,
        STATUS,
        saleId
      )
      console.log(`[reset-db] Sale atualizada (linhas): ${upd} — id=${saleId}`)
    }
  }

  console.log("[reset-db] Concluído.")
}

main()
  .catch((e: unknown) => {
    const meta =
      e && typeof e === "object" && "meta" in e ? (e as { meta?: { code?: string; message?: string } }).meta : undefined
    if (meta?.code === "42P01") {
      console.error(
        "[reset-db] Tabela não encontrada. Ajuste SCHEMA/TABLE_SALE/TABLE_PAYMENT/COL_* no topo do script para bater com o seu banco."
      )
    }
    console.error("[reset-db] Erro:", e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

