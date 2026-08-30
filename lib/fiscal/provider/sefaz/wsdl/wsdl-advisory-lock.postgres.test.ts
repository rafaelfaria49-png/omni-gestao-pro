/**
 * GOAL 135 — prova regressiva do advisory lock contra PostgreSQL REAL (não-produtivo).
 *
 * Lacuna corrigida: a execução 134 (30/08) foi a primeira invocação REAL do primitive e falhou
 * com P2010 ("Failed to deserialize column of type 'void'") porque `pg_advisory_xact_lock`
 * retorna void — os testes anteriores usavam ledger emulado com lock no-op.
 *
 * Infraestrutura: mesma convenção da integração existente (`CONTADOR_FISCAL_HOMOLOGATION_DATABASE_URL`,
 * `lib/contador/homologation/provision.integration.test.ts`) — a suíte é PULADA quando nenhuma
 * URL de teste está presente (CI padrão permanece verde e sem banco). A URL aponta para o banco
 * NÃO-PRODUTIVO já configurado (`omnigestao_prod_candidate`); o teste RECUSA o banco de produção
 * exato por segurança e executa APENAS queries de lock/select — nenhum write persistente
 * (transações terminam em rollback intencional).
 */
import { describe, expect, it } from "vitest"
import { Prisma, PrismaClient } from "@/generated/prisma"
import {
  wsdlActivationAdvisoryLock,
  type WsdlActivationQueryRawRunner,
} from "./wsdl-ephemeral-execution-window"

const rawUrl =
  process.env.FISCAL_WSDL_LOCK_TEST_DATABASE_URL ??
  process.env.CONTADOR_FISCAL_HOMOLOGATION_DATABASE_URL

// Segurança: recusar explicitamente o banco de produção canônico (a candidate contém o nome
// como PREFIXO, por isso a comparação exata do dbname e não por substring).
const urlDbName = (() => {
  try {
    return new URL(rawUrl ?? "").pathname.replace(/^\//, "")
  } catch {
    return ""
  }
})()

const integration =
  rawUrl && urlDbName && urlDbName !== "omnigestao_prod" ? describe : describe.skip

function client(): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: rawUrl! } } })
}

function runnerOf(prisma: PrismaClient | Prisma.TransactionClient): WsdlActivationQueryRawRunner {
  const raw = (prisma as unknown as {
    $queryRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>
  }).$queryRaw
  return raw.bind(prisma) as WsdlActivationQueryRawRunner
}

integration("advisory lock do consumo one-shot contra PostgreSQL real", () => {
  it("a expressão ANTIGA (sem cast) reproduz o P2010/void de forma isolada — GOAL 134", async () => {
    const prisma = client()
    try {
      await expect(
        prisma.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"fiscal:wsdl:h9-h10:v1:p2010-prova"}))`,
      ).rejects.toMatchObject({ code: "P2010" })
    } finally {
      await prisma.$disconnect()
    }
  })

  it("a expressão NOVA (::text AS lock) roda via Prisma sem erro de desserialização", async () => {
    const prisma = client()
    try {
      await expect(
        wsdlActivationAdvisoryLock(runnerOf(prisma), "fiscal:wsdl:h9-h10:v1:fix-prova"),
      ).resolves.toBeUndefined()
    } finally {
      await prisma.$disconnect()
    }
  })

  it("o lock é transacional e serializa concorrentes na MESMA dedupeKey; chaves diferentes são isoladas", async () => {
    const prismaA = client()
    const prismaB = client()
    const chaveOcupada = "fiscal:wsdl:h9-h10:v1:concorrencia-mesma-chave"
    const chaveIsolada = "fiscal:wsdl:h9-h10:v1:concorrencia-chave-diferente"

    let liberarTransacaoA!: () => void
    const transacaoALiberada = new Promise<void>((resolve) => {
      liberarTransacaoA = resolve
    })
    let transacaoAIniciou!: () => void
    const lockAdquiridoPelaA = new Promise<void>((resolve) => {
      transacaoAIniciou = resolve
    })

    // Transação A: toma o lock e PERMANECE aberta (nada é escrito; rollback intencional).
    // Timeout holgado: nenhum falso-negativo se o scheduler atrasar a liberação.
    const transacaoA = prismaA
      .$transaction(
        async (tx) => {
          await wsdlActivationAdvisoryLock(runnerOf(tx), chaveOcupada)
          transacaoAIniciou()
          await transacaoALiberada
          throw new Error("ROLLBACK_INTENCIONAL_DO_TESTE")
        },
        { timeout: 15_000 },
      )
      .then(
        () => "committed" as const,
        () => "rolled_back" as const,
      )

    await lockAdquiridoPelaA
    try {
      // B (outra conexão) NÃO consegue o try-lock da MESMA chave enquanto A a segura ⇒
      // o lock é transacional e serializa consumidores (requisitos 3 e 4).
      const mesmaChaveEnquantoAOcupa = await prismaB.$queryRaw<
        Array<{ locked: boolean }>
      >`SELECT pg_try_advisory_xact_lock(hashtext(${chaveOcupada}))::text AS locked`
      expect(mesmaChaveEnquantoAOcupa[0]?.locked).toBe("false")

      // Chave DIFERENTE não perde isolamento: B toma a dela normalmente (requisito 5).
      await wsdlActivationAdvisoryLock(runnerOf(prismaB), chaveIsolada)
    } finally {
      liberarTransacaoA!()
      expect(await transacaoA).toBe("rolled_back")
      await prismaB.$disconnect()
      await prismaA.$disconnect()
    }

    // Com A encerrada (rollback), a chave volta a ficar disponível para um novo consumidor.
    const prismaC = client()
    try {
      const aposLiberacao = await prismaC.$queryRaw<Array<{ locked: boolean }>>
        `SELECT pg_try_advisory_xact_lock(hashtext(${chaveOcupada}))::text AS locked`
      expect(aposLiberacao[0]?.locked).toBe("true")
    } finally {
      await prismaC.$disconnect()
    }
  })
})
