/**
 * Script temporário: localiza a venda pelo nome do cliente, remove pagamentos
 * vinculados e redefine total_value, remaining_balance e status.
 *
 * Ajuste SCHEMA / TABLE_VENDAS / TABLE_PAGAMENTOS / COL_CLIENTE / COL_VENDA_FK
 * se no seu Postgres os nomes forem diferentes.
 */
import { PrismaClient } from "../generated/prisma/index.js"

const SCHEMA = "public"
const TABLE_VENDAS = "vendas"
const TABLE_PAGAMENTOS = "venda_pagamentos"
const COL_CLIENTE = "client_name"
const COL_VENDA_FK = "venda_id"

const CLIENTE_ALVO = "CLETON RICARDO SIQUEIRA"

const prisma = new PrismaClient()

async function main() {
  const qV = `"${SCHEMA}"."${TABLE_VENDAS}"`
  const qP = `"${SCHEMA}"."${TABLE_PAGAMENTOS}"`
  const qCc = `"${COL_CLIENTE}"`
  const qFk = `"${COL_VENDA_FK}"`

  try {
    await prisma.$connect()
  } catch (e) {
    console.error("[reset-cleiton] Falha ao conectar. Verifique DATABASE_URL no .env.", e)
    throw e
  }

  const vendas = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id::text AS id FROM ${qV} WHERE UPPER(TRIM(${qCc}::text)) = UPPER(TRIM($1))`,
    CLIENTE_ALVO
  )

  if (vendas.length === 0) {
    console.log("[reset-cleiton] Nenhuma venda encontrada para este cliente.")
    return
  }

  if (vendas.length > 1) {
    console.warn(
      `[reset-cleiton] Atenção: ${vendas.length} vendas encontradas; todas serão processadas.`
    )
  }

  for (const row of vendas) {
    const id = row.id

    const del = await prisma.$executeRawUnsafe(
      `DELETE FROM ${qP} WHERE ${qFk} = $1`,
      id
    )
    console.log(`[reset-cleiton] Pagamentos removidos (linhas afetadas): ${del} — venda id=${id}`)

    const upd = await prisma.$executeRawUnsafe(
      `UPDATE ${qV} SET "total_value" = $1, "remaining_balance" = $2, "status" = $3 WHERE id::text = $4`,
      1290.0,
      1090.0,
      "PENDENTE",
      id
    )
    console.log(`[reset-cleiton] Venda atualizada (linhas): ${upd} — id=${id}`)
  }

  console.log("[reset-cleiton] Concluído.")
}

main()
  .catch((e: unknown) => {
    const code =
      e && typeof e === "object" && "code" in e ? String((e as { code?: string }).code) : ""
    const meta =
      e && typeof e === "object" && "meta" in e ? (e as { meta?: { code?: string } }).meta : undefined
    if (meta?.code === "42P01" || code === "P2010") {
      console.error(
        "[reset-cleiton] Tabela não encontrada. Ajuste SCHEMA, TABLE_VENDAS e TABLE_PAGAMENTOS no topo do script para bater com o seu Postgres (ou crie as tabelas/colunas esperadas)."
      )
    }
    console.error("[reset-cleiton] Erro:", e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
