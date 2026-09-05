/**
 * GOAL PDV-RECEBIMENTO-MULTITITULO-BACKEND-003 (G2) — prova do advisory lock e do
 * `SELECT ... FOR UPDATE` contra PostgreSQL REAL (não-produtivo).
 *
 * Por que existe: o harness de `recebimento-lote.test.ts` emula o lock com uma fila em
 * memória. Isso prova a ORDEM e o ESCOPO da chave no código, mas não prova que a
 * expressão roda no Postgres — a trilha Fiscal já pagou esse preço uma vez (GOAL 134/135:
 * `pg_advisory_xact_lock()` devolve `void` e o `$queryRaw` do Prisma estourou P2010 na
 * primeira invocação real). E o SQL cru da sessão usa nomes FÍSICOS de tabela/coluna, que
 * nenhum teste com banco fake valida. Os testes finais também exercitam a serialização do
 * saldo de carteira com dados isolados por UUID e limpeza explícita.
 *
 * Infraestrutura: mesma convenção de `lib/fiscal/provider/sefaz/wsdl/wsdl-advisory-lock.postgres.test.ts`
 * — a suíte é PULADA quando nenhuma URL de teste está presente (CI padrão segue verde e
 * sem banco). O banco de produção canônico é RECUSADO explicitamente. Os quatro
 * primeiros casos são read-only. Os casos de carteira criam somente uma loja
 * aleatória no banco de teste e a removem no `finally`.
 */
import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"
import { PrismaClient } from "@/generated/prisma"
import {
  executarRecebimentoLote,
  type RecebimentoLoteInput,
  type RecebimentoLoteItemNormalizado,
} from "@/lib/financeiro/services/recebimento-lote-service"
import {
  buildCarteiraSaldoLockKey,
  recalcularSaldoCarteira,
} from "@/lib/financeiro/services/carteiras-service"

const rawUrl =
  process.env.PDV_LOTE_LOCK_TEST_DATABASE_URL ?? process.env.CONTADOR_FISCAL_HOMOLOGATION_DATABASE_URL

// A candidate contém o nome da produção como PREFIXO — daí a comparação exata do dbname.
const urlDbName = (() => {
  try {
    return decodeURIComponent(new URL(rawUrl ?? "").pathname.replace(/^\//, "")).toLowerCase()
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
const TX_OPTS = { maxWait: 20_000, timeout: 20_000 } as const

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

type CarteiraFixture = {
  storeId: string
  carteiraId: string
  sessoes: string[]
  localKeys: string[]
}

async function criarCarteiraFixture(prisma: PrismaClient, comTitulos: boolean): Promise<CarteiraFixture> {
  const storeId = `it-pdv-wallet-${randomUUID()}`
  await prisma.store.create({ data: { id: storeId, name: "Integração carteira PDV" } })
  const carteira = await prisma.carteiraFinanceira.create({
    data: { storeId, nome: "Carteira concorrente", tipo: "caixa", saldoInicial: 0, saldoAtual: 0 },
  })
  const sessoes: string[] = []
  const localKeys: string[] = []

  if (comTitulos) {
    for (let i = 0; i < 2; i++) {
      const sessao = await prisma.sessaoCaixa.create({
        data: { storeId, operador: `Teste ${i + 1}`, status: "ABERTA" },
      })
      sessoes.push(sessao.id)
      const localKey = `titulo-${i + 1}`
      await prisma.contaReceberTitulo.create({
        data: {
          storeId,
          localKey,
          descricao: `Título ${i + 1}`,
          cliente: "Cliente integração",
          valor: 100,
          vencimento: "2026-09-04",
          status: "pendente",
          payload: { id: localKey, carteiraId: carteira.id },
        },
      })
      localKeys.push(localKey)
    }
  }

  return { storeId, carteiraId: carteira.id, sessoes, localKeys }
}

async function limparCarteiraFixture(prisma: PrismaClient, storeId: string): Promise<void> {
  await prisma.caixaOperacao.deleteMany({ where: { storeId } })
  await prisma.movimentacaoFinanceira.deleteMany({ where: { storeId } })
  await prisma.contaReceberTitulo.deleteMany({ where: { storeId } })
  await prisma.carteiraFinanceira.deleteMany({ where: { storeId } })
  await prisma.sessaoCaixa.deleteMany({ where: { storeId } })
  await prisma.store.deleteMany({ where: { id: storeId } })
}

function loteInput(storeId: string, sessaoId: string, key: string): RecebimentoLoteInput {
  return {
    storeId,
    sessaoId,
    formaPagamento: "dinheiro",
    idempotencyKey: key,
    userLabel: "Teste PostgreSQL",
  }
}

function loteItem(localKey: string): RecebimentoLoteItemNormalizado {
  return { localKey, saldoEsperado: 100, valorReceber: 100 }
}

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

integration("saldo de carteira contra PostgreSQL real", () => {
  it("o segundo recálculo espera o lock e enxerga o ledger commitado pelo primeiro", async () => {
    const prismaA = client()
    const prismaB = client()
    let fixture: CarteiraFixture | null = null
    const aTomouLock = deferred()
    const liberarA = deferred()
    let bTerminou = false

    try {
      fixture = await criarCarteiraFixture(prismaA, false)
      const lockKey = buildCarteiraSaldoLockKey(fixture.storeId, fixture.carteiraId)
      const txA = prismaA.$transaction(async (tx) => {
        await tx.movimentacaoFinanceira.create({
          data: {
            storeId: fixture!.storeId,
            tipo: "entrada",
            origem: "teste_wallet_a",
            valor: 70,
            carteiraId: fixture!.carteiraId,
          },
        })
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))::text AS lock`
        aTomouLock.resolve()
        await liberarA.promise
        await recalcularSaldoCarteira(fixture!.carteiraId, fixture!.storeId, tx)
      }, TX_OPTS)

      await aTomouLock.promise
      const txB = prismaB.$transaction(async (tx) => {
        await tx.movimentacaoFinanceira.create({
          data: {
            storeId: fixture!.storeId,
            tipo: "entrada",
            origem: "teste_wallet_b",
            valor: 30,
            carteiraId: fixture!.carteiraId,
          },
        })
        await recalcularSaldoCarteira(fixture!.carteiraId, fixture!.storeId, tx)
        bTerminou = true
      }, TX_OPTS)

      await new Promise((r) => setTimeout(r, 250))
      const bEsperou = !bTerminou
      liberarA.resolve()
      await Promise.all([txA, txB])
      expect(bEsperou).toBe(true)

      const [carteira, ledger] = await Promise.all([
        prismaA.carteiraFinanceira.findUnique({ where: { id: fixture.carteiraId } }),
        prismaA.movimentacaoFinanceira.aggregate({
          where: { storeId: fixture.storeId, carteiraId: fixture.carteiraId },
          _sum: { valor: true },
        }),
      ])
      expect(ledger._sum.valor).toBe(100)
      expect(carteira!.saldoAtual).toBe(100)
    } finally {
      liberarA.resolve()
      if (fixture) await limparCarteiraFixture(prismaA, fixture.storeId)
      await prismaA.$disconnect()
      await prismaB.$disconnect()
    }
  }, 60_000)

  it("dois batches de sessões diferentes na mesma carteira terminam com saldo igual ao ledger", async () => {
    const prismaA = client()
    const prismaB = client()
    let fixture: CarteiraFixture | null = null

    try {
      fixture = await criarCarteiraFixture(prismaA, true)
      const [resultadoA, resultadoB] = await Promise.all([
        prismaA.$transaction(
          (tx) => executarRecebimentoLote(
            tx,
            loteInput(fixture!.storeId, fixture!.sessoes[0]!, "postgres-wallet-batch-a"),
            [loteItem(fixture!.localKeys[0]!)],
          ),
          TX_OPTS,
        ),
        prismaB.$transaction(
          (tx) => executarRecebimentoLote(
            tx,
            loteInput(fixture!.storeId, fixture!.sessoes[1]!, "postgres-wallet-batch-b"),
            [loteItem(fixture!.localKeys[1]!)],
          ),
          TX_OPTS,
        ),
      ])

      expect(resultadoA.jaRegistrado).toBe(false)
      expect(resultadoB.jaRegistrado).toBe(false)
      const [carteira, ledger, movs, caixas] = await Promise.all([
        prismaA.carteiraFinanceira.findUnique({ where: { id: fixture.carteiraId } }),
        prismaA.movimentacaoFinanceira.aggregate({
          where: { storeId: fixture.storeId, carteiraId: fixture.carteiraId },
          _sum: { valor: true },
        }),
        prismaA.movimentacaoFinanceira.count({ where: { storeId: fixture.storeId } }),
        prismaA.caixaOperacao.count({ where: { storeId: fixture.storeId } }),
      ])
      expect(ledger._sum.valor).toBe(200)
      expect(carteira!.saldoAtual).toBe(200)
      expect(movs).toBe(2)
      expect(caixas).toBe(2)
    } finally {
      if (fixture) await limparCarteiraFixture(prismaA, fixture.storeId)
      await prismaA.$disconnect()
      await prismaB.$disconnect()
    }
  }, 60_000)
})
