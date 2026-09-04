/**
 * GOAL PDV-RECEBIMENTO-MULTITITULO-BACKEND-003 (G2) — prova do advisory lock e do
 * `SELECT ... FOR UPDATE` contra PostgreSQL REAL (não-produtivo).
 *
 * Por que existe: o harness de `recebimento-lote.test.ts` emula o lock com uma fila em
 * memória. Isso prova a ORDEM e o ESCOPO da chave no código, mas não prova que a
 * expressão roda no Postgres — a trilha Fiscal já pagou esse preço uma vez (GOAL 134/135:
 * `pg_advisory_xact_lock()` devolve `void` e o `$queryRaw` do Prisma estourou P2010 na
 * primeira invocação real). E o SQL cru da sessão usa nomes FÍSICOS de tabela/coluna, que
 * nenhum teste com banco fake valida.
 *
 * Infraestrutura: mesma convenção de `lib/fiscal/provider/sefaz/wsdl/wsdl-advisory-lock.postgres.test.ts`
 * — a suíte é PULADA quando nenhuma URL de teste está presente (CI padrão segue verde e
 * sem banco). O banco de produção canônico é RECUSADO explicitamente. Nada é escrito:
 * só locks, `SELECT` e transações que terminam em rollback intencional.
 */
import { describe, expect, it } from "vitest"
import { PrismaClient } from "@/generated/prisma"

const rawUrl =
  process.env.PDV_LOTE_LOCK_TEST_DATABASE_URL ?? process.env.CONTADOR_FISCAL_HOMOLOGATION_DATABASE_URL

// A candidate contém o nome da produção como PREFIXO — daí a comparação exata do dbname.
const urlDbName = (() => {
  try {
    return new URL(rawUrl ?? "").pathname.replace(/^\//, "")
  } catch {
    return ""
  }
})()

const integration = rawUrl && urlDbName && urlDbName !== "omnigestao_prod" ? describe : describe.skip

function client(): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: rawUrl! } } })
}

const CHAVE_A = "pdv-rc-lote:loja-test:sess-test:prova-lock-a"
const CHAVE_B = "pdv-rc-lote:loja-test:sess-test:prova-lock-b"

integration("advisory lock do recebimento em lote contra PostgreSQL real", () => {
  it("a expressão usada em produção roda via `$queryRaw` sem erro de desserialização", async () => {
    const prisma = client()
    try {
      await expect(
        prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${CHAVE_A}))::text AS lock`
          return "ok"
        }),
      ).resolves.toBe("ok")
    } finally {
      await prisma.$disconnect()
    }
  })

  it("sem o cast `::text` a MESMA chamada quebra com P2010 — o cast não é decorativo", async () => {
    const prisma = client()
    try {
      await expect(
        prisma.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${CHAVE_A}))`,
      ).rejects.toMatchObject({ code: "P2010" })
    } finally {
      await prisma.$disconnect()
    }
  })

  it("o lock é TRANSACIONAL e serializa concorrentes na mesma chave; chaves diferentes não bloqueiam", async () => {
    const prismaA = client()
    const prismaB = client()

    let liberarA!: () => void
    const podeSoltarA = new Promise<void>((r) => {
      liberarA = r
    })
    let avisarLockDeA!: () => void
    const lockDeATomado = new Promise<void>((r) => {
      avisarLockDeA = r
    })

    // Transação A: toma o lock de CHAVE_A e fica aberta. Rollback intencional no fim.
    const txA = prismaA
      .$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${CHAVE_A}))::text AS lock`
          avisarLockDeA()
          await podeSoltarA
          throw new Error("rollback intencional")
        },
        { maxWait: 20_000, timeout: 20_000 },
      )
      .catch((e: unknown) => e)

    await lockDeATomado

    // Chave DIFERENTE: passa de imediato, sem esperar A.
    const outraChave = await prismaB.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${CHAVE_B}))::text AS lock`
        return "livre"
      },
      { maxWait: 20_000, timeout: 20_000 },
    )
    expect(outraChave).toBe("livre")

    // MESMA chave: só conclui depois de A terminar.
    let bConcluiu = false
    const txB = prismaB
      .$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${CHAVE_A}))::text AS lock`
          bConcluiu = true
          return "entrou"
        },
        { maxWait: 20_000, timeout: 20_000 },
      )
      .catch((e: unknown) => e)

    // Janela generosa: se B entrasse aqui, o lock não estaria segurando nada.
    await new Promise((r) => setTimeout(r, 750))
    expect(bConcluiu).toBe(false)

    liberarA()
    await txA
    await expect(txB).resolves.toBe("entrou")

    await prismaA.$disconnect()
    await prismaB.$disconnect()
  }, 60_000)

  it("o SQL cru da sessão de caixa (`FOR UPDATE`) compila contra o schema real", async () => {
    const prisma = client()
    try {
      // Ids inexistentes de propósito: valida nomes físicos de tabela/coluna e o cast do
      // enum sem travar nenhuma linha real.
      const rows = await prisma.$queryRaw<Array<{ id: string; storeId: string; status: string }>>`
        SELECT "id", "storeId", "status"::text AS status
        FROM "sessoes_caixa"
        WHERE "id" = ${"__inexistente__"} AND "storeId" = ${"__inexistente__"}
        FOR UPDATE
      `
      expect(rows).toEqual([])
    } finally {
      await prisma.$disconnect()
    }
  })
})
