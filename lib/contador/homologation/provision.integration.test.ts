/**
 * Prova opt-in contra PostgreSQL local já provisionado. Sem
 * CONTADOR_FISCAL_HOMOLOGATION_DATABASE_URL a suíte é pulada (CI padrão).
 *
 * SELECT only. Zero FiscalLog. Não importa xml-storage-reader. Não abre GOAL 018.
 */
import { afterAll, describe, expect, it } from "vitest"

import { PrismaClient } from "@/generated/prisma"

import { assertLocalHomologationDatabaseUrl } from "./guard-url"
import { LINHAS_MASSA, STORE_A, STORE_B, STORE_IDS } from "./massa"

const rawUrl = process.env.CONTADOR_FISCAL_HOMOLOGATION_DATABASE_URL
const integration = rawUrl ? describe : describe.skip

const prisma = new PrismaClient({
  datasourceUrl: rawUrl ? assertLocalHomologationDatabaseUrl(rawUrl) : undefined,
  log: ["error"],
})

integration("provisionamento fiscal homologação (SELECT)", () => {
  afterAll(async () => {
    await prisma.$disconnect()
  })

  it("persiste as 7 linhas sintéticas sem FiscalLog e sem cruzar loja", async () => {
    const notas = await prisma.notaFiscal.findMany({
      where: { storeId: { in: [...STORE_IDS] } },
      select: {
        id: true,
        storeId: true,
        status: true,
        ambiente: true,
        vigente: true,
        protocolo: true,
        chaveAcesso: true,
        xmlAutorizado: true,
        localKey: true,
        numero: true,
        serie: true,
        modelo: true,
      },
      orderBy: { numero: "asc" },
    })

    expect(notas).toHaveLength(7)

    const vendas = await prisma.venda.count({
      where: { storeId: { in: [...STORE_IDS] } },
    })
    expect(vendas).toBe(7)

    const porCaso = new Map(LINHAS_MASSA.map((l) => [l.notaId, l]))
    for (const nota of notas) {
      const esperado = porCaso.get(nota.id)
      expect(esperado, `nota inesperada ${nota.id}`).toBeTruthy()
      expect(nota.storeId).toBe(esperado!.storeId)
      expect(nota.status).toBe(esperado!.status)
      expect(nota.ambiente).toBe(esperado!.ambiente)
      expect(nota.vigente).toBe(esperado!.vigente)
      expect(nota.chaveAcesso).toBe(esperado!.chaveAcesso)
      expect(nota.xmlAutorizado).toBe(esperado!.xmlAutorizado)
      expect(nota.localKey).toBe(esperado!.localKey)
    }

    const lojaA = notas.filter((n) => n.storeId === STORE_A)
    const lojaB = notas.filter((n) => n.storeId === STORE_B)
    expect(lojaA).toHaveLength(6)
    expect(lojaB).toHaveLength(1)
    expect(lojaB[0]?.id).toBe("nota-homolog-loja-b")

    const vazamento = await prisma.notaFiscal.findMany({
      where: { storeId: STORE_A, id: "nota-homolog-loja-b" },
    })
    expect(vazamento).toHaveLength(0)

    const logs = await prisma.fiscalLog.findMany({
      where: {
        OR: [
          { storeId: { in: [...STORE_IDS] } },
          { notaFiscalId: { in: notas.map((n) => n.id) } },
        ],
      },
    })
    expect(logs).toHaveLength(0)

    const eventos = await prisma.eventoFiscal.findMany({
      where: { storeId: { in: [...STORE_IDS] } },
    })
    expect(eventos).toHaveLength(0)

    const feliz = notas.find((n) => n.id === "nota-homolog-ok")
    expect(feliz?.xmlAutorizado).toContain("<dhEmi>2026-07-14T12:00:00-03:00</dhEmi>")
    expect(feliz?.ambiente).toBe("HOMOLOGACAO")
    expect(feliz?.status).toBe("AUTORIZADA")

    const producao = notas.find((n) => n.id === "nota-homolog-prod")
    expect(producao?.ambiente).toBe("PRODUCAO")
    expect(producao?.storeId).toBe(STORE_A)
    expect(producao?.id).not.toBe(feliz?.id)
  })
})
