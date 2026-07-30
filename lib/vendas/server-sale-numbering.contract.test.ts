import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf8")
}

function executableSql(sql: string): string {
  return sql
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim()
}

describe("contrato estático da infraestrutura de numeração", () => {
  const helper = read("lib/vendas/server-sale-numbering.ts")
  const migration = read(
    "prisma/migrations/0016_add_sale_numbering_infrastructure/migration.sql",
  )
  const schema = read("prisma/schema.prisma")

  it("mantém o helper server-only, transacional e sem abrir transação própria", () => {
    expect(helper).toContain('import "server-only"')
    expect(helper).toContain("Prisma.TransactionClient")
    expect(helper).toContain("pg_advisory_xact_lock")
    expect(helper).toContain("proximoNumero: { increment: 1 }")
    expect(helper).not.toContain("@/lib/prisma")
    expect(helper).not.toMatch(/\.\$transaction\s*\(/)
  })

  it("não usa count, MAX, último registro ou salto por leitura", () => {
    expect(helper).not.toMatch(/\.\s*count\s*\(/i)
    expect(helper).not.toMatch(/\.\s*aggregate\s*\(/i)
    expect(helper).not.toMatch(/\.\s*findFirst\s*\(/i)
    expect(helper).not.toMatch(/\borderBy\s*:/i)
  })

  it("não possui call site nas rotas/writer v1 atuais", () => {
    for (const path of [
      "app/api/ops/venda-persist/route.ts",
      "app/api/ops/sync-legacy-vendas/route.ts",
      "lib/ops-upsert-venda.ts",
      "lib/operations-store.tsx",
    ]) {
      expect(read(path), path).not.toContain("server-sale-numbering")
      expect(read(path), path).not.toContain("allocateSaleNumber")
    }
  })

  it("mantém todos os novos metadados de Venda nullable", () => {
    for (const field of [
      "clientSaleId",
      "idempotencyHash",
      "idempotencyHashVersion",
      "serieVendaId",
      "anoNumero",
      "numeroSequencial",
      "numeradaEm",
      "numeracaoOrigem",
    ]) {
      expect(schema, field).toMatch(new RegExp(`\\b${field}\\s+\\w+\\?`))
    }

    const vendaColumns = migration.match(
      /ALTER TABLE "vendas" ADD COLUMN IF NOT EXISTS [^;]+;/g,
    )
    expect(vendaColumns).toHaveLength(8)
    for (const statement of vendaColumns ?? []) {
      expect(statement).not.toMatch(/\bNOT NULL\b/i)
      expect(statement).not.toMatch(/\bDEFAULT\b/i)
    }
  })

  it("migration é aditiva e contém as constraints multi-loja/numeração", () => {
    const sql = executableSql(migration)
    // ON DELETE/ON UPDATE são cláusulas referenciais legítimas; o gate bloqueia
    // comandos destrutivos no início de um statement.
    expect(sql).not.toMatch(/(?:^|;)\s*(DROP|DELETE|UPDATE|TRUNCATE|RENAME)\b/im)
    expect(sql).toContain('"series_venda_storeId_ano_key"')
    expect(sql).toContain('"series_venda_prefixo_ano_key"')
    expect(sql).toContain('"vendas_storeId_clientSaleId_key"')
    expect(sql).toContain('"vendas_serieVendaId_numeroSequencial_key"')
    expect(sql).toContain('"vendas_serieVendaId_storeId_fkey"')
    expect(sql).toContain('"series_venda_proximoNumero_faixa_check"')
    expect(sql).toContain('"vendas_numeroSequencial_faixa_check"')
  })
})
