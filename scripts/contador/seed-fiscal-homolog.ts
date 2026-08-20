/**
 * CLI do seed HOMOLOGACAO. Só aceita CONTADOR_FISCAL_HOMOLOGATION_DATABASE_URL
 * (ou o default local). Nunca abre Prisma com DATABASE_URL de Production.
 */
import {
  resolveHomologationDatabaseUrl,
  seedFiscalHomologation,
} from "../../lib/contador/homologation"

async function main(): Promise<void> {
  const url = resolveHomologationDatabaseUrl()
  const result = await seedFiscalHomologation(url)
  if (result.notas !== 7 || result.vendas !== 7) {
    throw new Error(
      `Seed incompleto: notas=${result.notas} vendas=${result.vendas} (esperado 7/7).`,
    )
  }
  if (result.fiscalLogs !== 0) {
    throw new Error(`Seed gravou FiscalLog (${result.fiscalLogs}) — abortado.`)
  }
  console.log(
    `[contador-homolog] seed ok stores=${result.storeIds.join(",")} notas=${result.notas} fiscalLogs=${result.fiscalLogs}`,
  )
}

main().catch((error: unknown) => {
  console.error("[contador-homolog] seed falhou:", error)
  process.exit(1)
})
