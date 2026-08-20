/**
 * Seed idempotente da massa HOMOLOGACAO do Contador — Postgres local apenas.
 *
 * Nunca importa `lib/prisma` (DSN de Production). Nunca chama SEFAZ, signer,
 * `xml-storage-reader` nem grava `FiscalLog`. Não fabrica `EventoFiscal`.
 */
import { PrismaClient } from "@/generated/prisma"

import { resolveHomologationDatabaseUrl } from "./guard-url"
import { LINHAS_MASSA, STORE_A, STORE_B, STORE_IDS } from "./massa"

export type SeedFiscalHomologationResult = Readonly<{
  storeIds: readonly string[]
  notas: number
  vendas: number
  fiscalLogs: number
}>

function createHomologClient(datasourceUrl: string): PrismaClient {
  return new PrismaClient({
    datasourceUrl,
    log: ["error"],
  })
}

async function limparMassa(prisma: PrismaClient): Promise<void> {
  const storeIds = [...STORE_IDS]
  await prisma.fiscalLog.deleteMany({ where: { storeId: { in: storeIds } } })
  await prisma.eventoFiscal.deleteMany({ where: { storeId: { in: storeIds } } })
  await prisma.notaFiscal.deleteMany({ where: { storeId: { in: storeIds } } })
  await prisma.venda.deleteMany({ where: { storeId: { in: storeIds } } })
  await prisma.store.deleteMany({ where: { id: { in: storeIds } } })
}

export async function seedFiscalHomologation(
  datasourceUrl: string = resolveHomologationDatabaseUrl(),
): Promise<SeedFiscalHomologationResult> {
  const prisma = createHomologClient(datasourceUrl)
  try {
    await prisma.$connect()
    await limparMassa(prisma)

    await prisma.store.createMany({
      data: [
        {
          id: STORE_A,
          name: "Loja sintética Contador homologação A",
          cnpj: "00000000000191",
        },
        {
          id: STORE_B,
          name: "Loja sintética Contador homologação B",
          cnpj: "00000000000272",
        },
      ],
    })

    for (const linha of LINHAS_MASSA) {
      await prisma.venda.create({
        data: {
          id: linha.vendaId,
          storeId: linha.storeId,
          pedidoId: linha.pedidoId,
          total: 1,
          status: "concluida",
          clienteNome: "Consumidor sintético homologação",
          fiscalStatus: "NAO_FISCAL",
        },
      })

      const autorizada = linha.status === "AUTORIZADA" || linha.status === "CANCELADA"
      await prisma.notaFiscal.create({
        data: {
          id: linha.notaId,
          storeId: linha.storeId,
          vendaId: linha.vendaId,
          modelo: linha.modelo,
          ambiente: linha.ambiente,
          tipoEmissao: "NORMAL",
          status: linha.status,
          vigente: linha.vigente,
          serie: linha.serie,
          numero: linha.numero,
          chaveAcesso: linha.chaveAcesso,
          protocolo: linha.protocolo,
          cStat: linha.status === "REJEITADA" ? "301" : "100",
          xMotivo:
            linha.status === "REJEITADA"
              ? "Rejeicao sintetica — homologacao Contador (sem SEFAZ)"
              : "Autorizado o uso da NF-e (sintetico)",
          dataAutorizacao: autorizada ? new Date("2026-07-14T15:00:00.000Z") : null,
          valorTotal: 1,
          localKey: linha.localKey,
          xmlAutorizado: linha.xmlAutorizado,
          emitidaPor: "contador-fiscal-homolog-seed",
        },
      })
    }

    const [notas, vendas, fiscalLogs] = await Promise.all([
      prisma.notaFiscal.count({ where: { storeId: { in: [...STORE_IDS] } } }),
      prisma.venda.count({ where: { storeId: { in: [...STORE_IDS] } } }),
      prisma.fiscalLog.count({ where: { storeId: { in: [...STORE_IDS] } } }),
    ])

    return Object.freeze({
      storeIds: STORE_IDS,
      notas,
      vendas,
      fiscalLogs,
    })
  } finally {
    await prisma.$disconnect()
  }
}
