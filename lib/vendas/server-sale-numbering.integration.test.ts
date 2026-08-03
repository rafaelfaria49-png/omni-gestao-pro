/**
 * Prova opt-in contra PostgreSQL real. Sem SALE_NUMBERING_TEST_DATABASE_URL, a suíte
 * é pulada. A URL é recusada se não apontar para localhost, evitando banco remoto.
 *
 * Fakes não provam lock de linha, P2002 nem rollback do PostgreSQL; por isso esta suíte
 * é separada e o relatório deve dizer explicitamente quando ela não puder ser executada.
 */
import { randomBytes } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { Prisma, PrismaClient } from "@/generated/prisma"

import {
  SALE_NUMBER_MAX,
  allocateSaleNumber,
  isSaleNumberingError,
  saleNumberingAdvisoryKey,
} from "./server-sale-numbering"

const rawUrl = process.env.SALE_NUMBERING_TEST_DATABASE_URL
const integration = rawUrl ? describe : describe.skip
const RUN = randomBytes(3).toString("hex").toUpperCase()
const STORE_PREFIX = `002b-test-${RUN.toLowerCase()}-`
const ANO = 2026

function assertLocalTestUrl(url: string): string {
  const parsed = new URL(url)
  const host = parsed.hostname.toLowerCase()
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error(
      `SALE_NUMBERING_TEST_DATABASE_URL deve apontar para PostgreSQL local (recebido: ${host}).`,
    )
  }
  parsed.searchParams.set("connection_limit", "64")
  parsed.searchParams.set("pool_timeout", "30")
  return parsed.toString()
}

const prisma = new PrismaClient({
  datasourceUrl: rawUrl ? assertLocalTestUrl(rawUrl) : undefined,
})
const transactionOptions = (
  isolationLevel: Prisma.TransactionIsolationLevel = Prisma.TransactionIsolationLevel.ReadCommitted,
) => ({ timeout: 30_000, maxWait: 30_000, isolationLevel })
const TX_OPTIONS = transactionOptions()

let sequence = 0
let outsideSalesBefore = 0
let outsideSeriesBefore = 0

function nextStoreId(): string {
  sequence += 1
  return `${STORE_PREFIX}${sequence}`
}

function code(suffix: string): string {
  return `T${RUN}${suffix}`.toUpperCase().slice(0, 8)
}

function errorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code)
    : error instanceof Error
      ? error.name
      : typeof error
}

async function createStore(codigo: string | null): Promise<string> {
  const id = nextStoreId()
  await prisma.store.create({
    data: {
      id,
      name: `Loja sintética ${codigo ?? "sem-codigo"}`,
      codigoNumeracaoVenda: codigo,
    },
  })
  return id
}

async function cleanup(): Promise<void> {
  await prisma.venda.deleteMany({ where: { storeId: { startsWith: STORE_PREFIX } } })
  await prisma.serieVenda.deleteMany({ where: { storeId: { startsWith: STORE_PREFIX } } })
  await prisma.store.deleteMany({ where: { id: { startsWith: STORE_PREFIX } } })
}

integration("numeração server-side em PostgreSQL real", () => {
  beforeAll(async () => {
    await cleanup()
    outsideSalesBefore = await prisma.venda.count({
      where: { NOT: { storeId: { startsWith: STORE_PREFIX } } },
    })
    outsideSeriesBefore = await prisma.serieVenda.count({
      where: { NOT: { storeId: { startsWith: STORE_PREFIX } } },
    })
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  it("primeira alocação, incremento, lojas e anos são independentes", async () => {
    const storeA = await createStore(code("A"))
    const storeB = await createStore(code("B"))

    const firstA = await prisma.$transaction(
      (tx) => allocateSaleNumber(tx, { storeId: storeA, ano: ANO }),
      TX_OPTIONS,
    )
    const secondA = await prisma.$transaction(
      (tx) => allocateSaleNumber(tx, { storeId: storeA, ano: ANO }),
      TX_OPTIONS,
    )
    const firstB = await prisma.$transaction(
      (tx) => allocateSaleNumber(tx, { storeId: storeB, ano: ANO }),
      TX_OPTIONS,
    )
    const nextYearA = await prisma.$transaction(
      (tx) => allocateSaleNumber(tx, { storeId: storeA, ano: ANO + 1 }),
      TX_OPTIONS,
    )

    expect(firstA.numeroSequencial).toBe(1)
    expect(secondA.numeroSequencial).toBe(2)
    expect(firstB.numeroSequencial).toBe(1)
    expect(nextYearA.numeroSequencial).toBe(1)
    expect(firstA.serieVendaId).not.toBe(firstB.serieVendaId)
    expect(firstA.serieVendaId).not.toBe(nextYearA.serieVendaId)
  })

  it("executa explicitamente em READ COMMITTED", async () => {
    const storeId = await createStore(code("M"))

    const isolation = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ transaction_isolation: string }>>
        `SHOW transaction_isolation`
      const allocation = await allocateSaleNumber(tx, { storeId, ano: ANO })
      expect(allocation.numeroSequencial).toBe(1)
      return rows[0]?.transaction_isolation
    }, TX_OPTIONS)

    expect(isolation).toBe("read committed")
  })

  it("três terminais concorrentes recebem números únicos e consecutivos", async () => {
    const storeId = await createStore(code("C"))

    const allocations = await Promise.all(
      [1, 2, 3].map(() =>
        prisma.$transaction(
          (tx) => allocateSaleNumber(tx, { storeId, ano: ANO }),
          TX_OPTIONS,
        ),
      ),
    )

    expect(allocations.map((item) => item.numeroSequencial).sort((a, b) => a - b)).toEqual([
      1, 2, 3,
    ])
    expect(new Set(allocations.map((item) => item.pedidoId)).size).toBe(3)
    expect(new Set(allocations.map((item) => item.serieVendaId)).size).toBe(1)
  })

  it("50 alocações concorrentes não duplicam nem deixam lacuna", async () => {
    const storeId = await createStore(code("D"))
    const total = 50

    const allocations = await Promise.all(
      Array.from({ length: total }, () =>
        prisma.$transaction(async (tx) => {
          const allocation = await allocateSaleNumber(tx, { storeId, ano: ANO })
          await tx.venda.create({
            data: {
              storeId,
              pedidoId: allocation.pedidoId,
              serieVendaId: allocation.serieVendaId,
              anoNumero: allocation.ano,
              numeroSequencial: allocation.numeroSequencial,
              numeradaEm: new Date(),
              numeracaoOrigem: "SERVER_V1",
            },
          })
          return allocation
        }, TX_OPTIONS),
      ),
    )

    const numbers = allocations.map((item) => item.numeroSequencial).sort((a, b) => a - b)
    const [persisted] = await prisma.$queryRaw<
      Array<{ total: number; distinct_numbers: number; min_number: number; max_number: number }>
    >`SELECT
        COUNT(*)::int AS total,
        COUNT(DISTINCT "numeroSequencial")::int AS distinct_numbers,
        MIN("numeroSequencial")::int AS min_number,
        MAX("numeroSequencial")::int AS max_number
      FROM "vendas"
      WHERE "storeId" = ${storeId} AND "anoNumero" = ${ANO}`

    expect(new Set(numbers).size).toBe(total)
    expect(numbers).toEqual(Array.from({ length: total }, (_, index) => index + 1))
    expect(persisted).toEqual({
      total,
      distinct_numbers: total,
      min_number: 1,
      max_number: total,
    })
    expect(
      (
        await prisma.serieVenda.findUniqueOrThrow({
          where: { storeId_ano: { storeId, ano: ANO } },
        })
      ).proximoNumero,
    ).toBe(total + 1)
  })

  it("duas lojas suportam 20 transações concorrentes cada sem cruzar séries", async () => {
    const storeA = await createStore(code("N"))
    const storeB = await createStore(code("O"))
    const totalPerStore = 20

    const allocations = await Promise.all(
      [storeA, storeB].flatMap((storeId) =>
        Array.from({ length: totalPerStore }, () =>
          prisma.$transaction(async (tx) => {
            const allocation = await allocateSaleNumber(tx, { storeId, ano: ANO + 4 })
            await tx.venda.create({
              data: {
                storeId,
                pedidoId: allocation.pedidoId,
                serieVendaId: allocation.serieVendaId,
                anoNumero: allocation.ano,
                numeroSequencial: allocation.numeroSequencial,
                numeradaEm: new Date(),
                numeracaoOrigem: "SERVER_V1",
              },
            })
            return allocation
          }, TX_OPTIONS),
        ),
      ),
    )

    const persisted = await prisma.$queryRaw<
      Array<{
        store_id: string
        total: number
        distinct_numbers: number
        min_number: number
        max_number: number
        distinct_series: number
      }>
    >`SELECT
        "storeId" AS store_id,
        COUNT(*)::int AS total,
        COUNT(DISTINCT "numeroSequencial")::int AS distinct_numbers,
        MIN("numeroSequencial")::int AS min_number,
        MAX("numeroSequencial")::int AS max_number,
        COUNT(DISTINCT "serieVendaId")::int AS distinct_series
      FROM "vendas"
      WHERE "storeId" IN (${storeA}, ${storeB}) AND "anoNumero" = ${ANO + 4}
      GROUP BY "storeId"
      ORDER BY "storeId"`
    const persistedByStore = new Map(persisted.map((item) => [item.store_id, item]))

    expect(allocations).toHaveLength(totalPerStore * 2)
    expect(new Set(allocations.map((item) => item.pedidoId)).size).toBe(totalPerStore * 2)
    expect(persistedByStore.get(storeA)).toEqual({
      store_id: storeA,
      total: totalPerStore,
      distinct_numbers: totalPerStore,
      min_number: 1,
      max_number: totalPerStore,
      distinct_series: 1,
    })
    expect(persistedByStore.get(storeB)).toEqual({
      store_id: storeB,
      total: totalPerStore,
      distinct_numbers: totalPerStore,
      min_number: 1,
      max_number: totalPerStore,
      distinct_series: 1,
    })
    expect(persisted).toHaveLength(2)
    expect(new Set(allocations.filter((item) => item.storeId === storeA).map((item) => item.serieVendaId)).size).toBe(1)
    expect(new Set(allocations.filter((item) => item.storeId === storeB).map((item) => item.serieVendaId)).size).toBe(1)
    expect(allocations.find((item) => item.storeId === storeA)?.serieVendaId).not.toBe(
      allocations.find((item) => item.storeId === storeB)?.serieVendaId,
    )
  })

  it("rollback após o incremento não consome número", async () => {
    const storeId = await createStore(code("E"))
    const first = await prisma.$transaction(
      (tx) => allocateSaleNumber(tx, { storeId, ano: ANO }),
      TX_OPTIONS,
    )
    expect(first.numeroSequencial).toBe(1)

    await expect(
      prisma.$transaction(async (tx) => {
        const allocation = await allocateSaleNumber(tx, { storeId, ano: ANO })
        expect(allocation.numeroSequencial).toBe(2)
        throw new Error("rollback proposital")
      }, TX_OPTIONS),
    ).rejects.toThrow("rollback proposital")

    const afterRollback = await prisma.$transaction(
      (tx) => allocateSaleNumber(tx, { storeId, ano: ANO }),
      TX_OPTIONS,
    )
    expect(afterRollback.numeroSequencial).toBe(2)
  })

  it("falha ao persistir Venda reverte contador e não deixa Venda parcial", async () => {
    const existingStore = await createStore(code("P"))
    const targetStore = await createStore(code("Q"))
    const duplicatePedidoId = `VDA-${RUN}-ROLLBACK-P2002`
    await prisma.venda.create({ data: { storeId: existingStore, pedidoId: duplicatePedidoId } })

    await expect(
      prisma.$transaction(async (tx) => {
        const allocation = await allocateSaleNumber(tx, { storeId: targetStore, ano: ANO + 5 })
        await tx.venda.create({
          data: {
            storeId: targetStore,
            pedidoId: duplicatePedidoId,
            serieVendaId: allocation.serieVendaId,
            anoNumero: allocation.ano,
            numeroSequencial: allocation.numeroSequencial,
            numeracaoOrigem: "SERVER_V1",
          },
        })
      }, TX_OPTIONS),
    ).rejects.toMatchObject({ code: "P2002" })

    expect(await prisma.venda.count({ where: { storeId: targetStore } })).toBe(0)
    expect(
      await prisma.serieVenda.count({ where: { storeId: targetStore, ano: ANO + 5 } }),
    ).toBe(0)
  })

  it("duas criações concorrentes da série convergem sob conflito de unique", async () => {
    const storeId = await createStore(code("F"))
    const year = ANO + 2

    const [first, second] = await Promise.all([
      prisma.$transaction(
        (tx) => allocateSaleNumber(tx, { storeId, ano: year }),
        TX_OPTIONS,
      ),
      prisma.$transaction(
        (tx) => allocateSaleNumber(tx, { storeId, ano: year }),
        TX_OPTIONS,
      ),
    ])

    expect(first.serieVendaId).toBe(second.serieVendaId)
    expect([first.numeroSequencial, second.numeroSequencial].sort((a, b) => a - b)).toEqual([
      1, 2,
    ])
    expect(await prisma.serieVenda.count({ where: { storeId, ano: year } })).toBe(1)
  })

  it("lock consultivo é escopado por loja e ano", async () => {
    const storeA = await createStore(code("G"))
    const storeB = await createStore(code("H"))
    const year = ANO + 3
    let finishedB = 0
    let releaseA = 0
    let observed:
      | { classid: bigint; objid: bigint; objsubid: number }
      | undefined

    await prisma.$transaction(async (txA) => {
      const allocationA = await allocateSaleNumber(txA, { storeId: storeA, ano: year })
      expect(allocationA.numeroSequencial).toBe(1)

      const locks = await prisma.$queryRaw<
        Array<{ classid: bigint; objid: bigint; objsubid: number }>
      >`SELECT classid::bigint, objid::bigint, objsubid::int
        FROM pg_locks WHERE locktype = 'advisory'`
      observed = locks.find(
        (lock) =>
          Number(lock.classid) === (saleNumberingAdvisoryKey(storeA) >>> 0) &&
          Number(lock.objid) === year,
      )

      const allocationB = await prisma.$transaction(
        (txB) => allocateSaleNumber(txB, { storeId: storeB, ano: year }),
        TX_OPTIONS,
      )
      finishedB = Date.now()
      expect(allocationB.numeroSequencial).toBe(1)

      await new Promise((resolve) => setTimeout(resolve, 200))
      releaseA = Date.now()
    }, TX_OPTIONS)

    expect(finishedB).toBeLessThan(releaseA)
    expect(observed?.objsubid).toBe(2)
  })

  it("constraints protegem clientSaleId, número da série, pedidoId e loja da série", async () => {
    const storeA = await createStore(code("I"))
    const storeB = await createStore(code("J"))
    const clientSaleId = `client-${RUN}`

    await prisma.venda.create({
      data: { storeId: storeA, pedidoId: `VDA-${RUN}-CLIENT-A`, clientSaleId },
    })
    await expect(
      prisma.venda.create({
        data: { storeId: storeA, pedidoId: `VDA-${RUN}-CLIENT-B`, clientSaleId },
      }),
    ).rejects.toMatchObject({ code: "P2002" })
    await expect(
      prisma.venda.create({
        data: { storeId: storeB, pedidoId: `VDA-${RUN}-CLIENT-A`, clientSaleId },
      }),
    ).rejects.toMatchObject({ code: "P2002" })

    const otherStoreSameClientKey = await prisma.venda.create({
      data: { storeId: storeB, pedidoId: `VDA-${RUN}-CLIENT-C`, clientSaleId },
    })
    expect(otherStoreSameClientKey.clientSaleId).toBe(clientSaleId)

    const allocation = await prisma.$transaction(
      (tx) => allocateSaleNumber(tx, { storeId: storeA, ano: ANO }),
      TX_OPTIONS,
    )
    await expect(
      prisma.venda.create({
        data: {
          storeId: storeB,
          pedidoId: `VDA-${RUN}-CROSS-SERIE`,
          serieVendaId: allocation.serieVendaId,
          anoNumero: ANO,
          numeroSequencial: allocation.numeroSequencial,
          numeracaoOrigem: "SERVER_V1",
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" })

    await prisma.venda.create({
      data: {
        storeId: storeA,
        pedidoId: allocation.pedidoId,
        serieVendaId: allocation.serieVendaId,
        anoNumero: ANO,
        numeroSequencial: allocation.numeroSequencial,
        numeracaoOrigem: "SERVER_V1",
      },
    })
    await expect(
      prisma.venda.create({
        data: {
          storeId: storeA,
          pedidoId: `VDA-${RUN}-DUP-NUMBER`,
          serieVendaId: allocation.serieVendaId,
          anoNumero: ANO,
          numeroSequencial: allocation.numeroSequencial,
          numeracaoOrigem: "SERVER_V1",
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" })
  })

  it("vendas históricas continuam válidas com todos os novos campos NULL", async () => {
    const storeId = await createStore(code("K"))
    const historical = await Promise.all(
      [1, 2, 3].map((index) =>
        prisma.venda.create({
          data: { storeId, pedidoId: `VDA-${RUN}-HIST-${index}` },
        }),
      ),
    )

    for (const sale of historical) {
      expect(sale.clientSaleId).toBeNull()
      expect(sale.idempotencyHash).toBeNull()
      expect(sale.idempotencyHashVersion).toBeNull()
      expect(sale.serieVendaId).toBeNull()
      expect(sale.anoNumero).toBeNull()
      expect(sale.numeroSequencial).toBeNull()
      expect(sale.numeradaEm).toBeNull()
      expect(sale.numeracaoOrigem).toBeNull()
    }
  })

  it("overflow, série inativa e loja sem código falham fechados", async () => {
    const withoutCode = await createStore(null)
    await expect(
      prisma.$transaction(
        (tx) => allocateSaleNumber(tx, { storeId: withoutCode, ano: ANO }),
        TX_OPTIONS,
      ),
    ).rejects.toMatchObject({ code: "SALE_NUMBERING_NOT_CONFIGURED" })

    const storeId = await createStore(code("L"))
    await prisma.$transaction(
      (tx) => allocateSaleNumber(tx, { storeId, ano: ANO }),
      TX_OPTIONS,
    )
    await prisma.serieVenda.update({
      where: { storeId_ano: { storeId, ano: ANO } },
      data: { proximoNumero: SALE_NUMBER_MAX },
    })

    const last = await prisma.$transaction(
      (tx) => allocateSaleNumber(tx, { storeId, ano: ANO }),
      TX_OPTIONS,
    )
    expect(last.numeroSequencial).toBe(SALE_NUMBER_MAX)

    let overflowCode = "NO_ERROR"
    try {
      await prisma.$transaction(
        (tx) => allocateSaleNumber(tx, { storeId, ano: ANO }),
        TX_OPTIONS,
      )
    } catch (error) {
      overflowCode = isSaleNumberingError(error) ? error.code : "UNTYPED"
    }
    expect(overflowCode).toBe("SALE_SEQUENCE_EXHAUSTED")

    await prisma.serieVenda.update({
      where: { storeId_ano: { storeId, ano: ANO } },
      data: { ativo: false },
    })
    await expect(
      prisma.$transaction(
        (tx) => allocateSaleNumber(tx, { storeId, ano: ANO }),
        TX_OPTIONS,
      ),
    ).rejects.toMatchObject({ code: "SALE_NUMBERING_NOT_CONFIGURED" })
  })

  it("loja inexistente e ano inválido falham sem criar série", async () => {
    const missingStoreId = `${STORE_PREFIX}missing`
    await expect(
      prisma.$transaction(
        (tx) => allocateSaleNumber(tx, { storeId: missingStoreId, ano: ANO }),
        TX_OPTIONS,
      ),
    ).rejects.toMatchObject({ code: "SALE_NUMBERING_NOT_CONFIGURED" })

    const storeId = await createStore(code("R"))
    await expect(
      prisma.$transaction(
        (tx) => allocateSaleNumber(tx, { storeId, ano: 1999 }),
        TX_OPTIONS,
      ),
    ).rejects.toMatchObject({ code: "SALE_NUMBERING_INVARIANT_BROKEN" })

    expect(
      await prisma.serieVenda.count({
        where: { storeId: { in: [missingStoreId, storeId] } },
      }),
    ).toBe(0)
  })

  for (const isolationLevel of [
    Prisma.TransactionIsolationLevel.RepeatableRead,
    Prisma.TransactionIsolationLevel.Serializable,
  ]) {
    it(`propaga conflitos reais em ${isolationLevel} sem retry global`, async () => {
      const storeId = await createStore(code(isolationLevel === "Serializable" ? "S" : "T"))
      const year = isolationLevel === "Serializable" ? ANO + 7 : ANO + 6
      const workers = 4
      let ready = 0
      let release!: () => void
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })

      const attempts = Array.from({ length: workers }, () =>
        prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM "stores" WHERE id = ${storeId}`
          ready += 1
          if (ready === workers) release()
          await gate
          return allocateSaleNumber(tx, { storeId, ano: year })
        }, transactionOptions(isolationLevel)),
      )
      const settled = await Promise.allSettled(attempts)
      const fulfilled = settled.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      )
      const rejectedCodes = settled.flatMap((result) =>
        result.status === "rejected" ? [errorCode(result.reason)] : [],
      )

      console.info(
        `[sale-numbering isolation=${isolationLevel}] fulfilled=${fulfilled.length} rejected=${rejectedCodes.join(",") || "none"}`,
      )

      expect(fulfilled.length).toBeGreaterThanOrEqual(1)
      expect(new Set(fulfilled.map((item) => item.numeroSequencial)).size).toBe(fulfilled.length)
      expect(rejectedCodes.every((value) => ["P2002", "P2034"].includes(value))).toBe(true)
      expect(
        (
          await prisma.serieVenda.findUniqueOrThrow({
            where: { storeId_ano: { storeId, ano: year } },
          })
        ).proximoNumero,
      ).toBe(fulfilled.length + 1)
    })
  }

  it("limpeza e suíte não alteram dados fora do prefixo sintético", async () => {
    expect(
      await prisma.venda.count({
        where: { NOT: { storeId: { startsWith: STORE_PREFIX } } },
      }),
    ).toBe(outsideSalesBefore)
    expect(
      await prisma.serieVenda.count({
        where: { NOT: { storeId: { startsWith: STORE_PREFIX } } },
      }),
    ).toBe(outsideSeriesBefore)
  })
})
