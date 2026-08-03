import { describe, expect, it } from "vitest"

import {
  SALE_NUMBER_MAX,
  SALE_NUMBERING_TIMEZONE,
  SaleNumberingError,
  allocateSaleNumber,
  formatSalePedidoId,
  isRetryableSaleNumberingTransactionError,
  isSaleNumberingError,
  isValidSaleNumberingCode,
  isValidSaleNumero,
  normalizeSaleNumberingCode,
  resolveSaleNumberingAno,
  saleNumberingAdvisoryKey,
  type SaleNumberingTransactionClient,
  type SerieVendaResolvida,
} from "./server-sale-numbering"

type FakeStore = { id: string; codigoNumeracaoVenda: string | null }
type FakeState = {
  stores: Map<string, FakeStore>
  series: Map<string, SerieVendaResolvida>
  nextSerieId: number
}

function cloneState(state: FakeState): FakeState {
  return {
    stores: new Map([...state.stores].map(([key, value]) => [key, { ...value }])),
    series: new Map([...state.series].map(([key, value]) => [key, { ...value }])),
    nextSerieId: state.nextSerieId,
  }
}

function serieKey(storeId: string, ano: number): string {
  return `${storeId}\u0000${ano}`
}

/**
 * Harness honesto sobre seu limite: ele simula commit/rollback e serializa transações
 * numa fila em memória. Não prova lock, P2002 ou concorrência do PostgreSQL; essa prova
 * pertence à suíte de integração opt-in.
 */
class FakeTransactionalNumberingDb {
  private state: FakeState = {
    stores: new Map(),
    series: new Map(),
    nextSerieId: 1,
  }

  private queue: Promise<void> = Promise.resolve()

  configureStore(id: string, codigoNumeracaoVenda: string | null): void {
    this.state.stores.set(id, { id, codigoNumeracaoVenda })
  }

  serie(storeId: string, ano: number): SerieVendaResolvida | undefined {
    return this.state.series.get(serieKey(storeId, ano))
  }

  setNextNumber(storeId: string, ano: number, proximoNumero: number): void {
    const serie = this.serie(storeId, ano)
    if (!serie) throw new Error("Série fake inexistente.")
    serie.proximoNumero = proximoNumero
  }

  async transaction<T>(
    work: (tx: SaleNumberingTransactionClient) => Promise<T>,
    failBeforeCommit?: unknown,
  ): Promise<T> {
    let release = () => {}
    const previous = this.queue
    this.queue = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous

    const draft = cloneState(this.state)
    try {
      const result = await work(this.client(draft))
      if (failBeforeCommit !== undefined) throw failBeforeCommit
      this.state = draft
      return result
    } finally {
      release()
    }
  }

  private client(state: FakeState): SaleNumberingTransactionClient {
    const findSerie = (where: {
      id?: string
      storeId_ano?: { storeId: string; ano: number }
    }): SerieVendaResolvida | null => {
      if (where.storeId_ano) {
        return state.series.get(serieKey(where.storeId_ano.storeId, where.storeId_ano.ano)) ?? null
      }
      if (where.id) {
        return [...state.series.values()].find((serie) => serie.id === where.id) ?? null
      }
      return null
    }

    return {
      store: {
        findUnique: async (args: { where: { id: string } }) => state.stores.get(args.where.id) ?? null,
      },
      serieVenda: {
        findUnique: async (args: {
          where: { id?: string; storeId_ano?: { storeId: string; ano: number } }
        }) => findSerie(args.where),
        create: async (args: {
          data: { storeId: string; ano: number; prefixo: string }
        }) => {
          const key = serieKey(args.data.storeId, args.data.ano)
          const prefixConflict = [...state.series.values()].some(
            (serie) => serie.prefixo === args.data.prefixo && serie.ano === args.data.ano,
          )
          if (state.series.has(key) || prefixConflict) throw { code: "P2002" }

          const created: SerieVendaResolvida = {
            id: `serie-${state.nextSerieId}`,
            storeId: args.data.storeId,
            ano: args.data.ano,
            prefixo: args.data.prefixo,
            proximoNumero: 1,
            ativo: true,
          }
          state.nextSerieId += 1
          state.series.set(key, created)
          return { ...created }
        },
        update: async (args: {
          where: {
            id: string
            storeId: string
            ano: number
            ativo: boolean
            proximoNumero: { gte: number; lte: number }
          }
          data: { proximoNumero: { increment: number } }
        }) => {
          const current = findSerie({ id: args.where.id })
          if (
            !current ||
            current.storeId !== args.where.storeId ||
            current.ano !== args.where.ano ||
            current.ativo !== args.where.ativo ||
            current.proximoNumero < args.where.proximoNumero.gte ||
            current.proximoNumero > args.where.proximoNumero.lte
          ) {
            throw { code: "P2025" }
          }
          current.proximoNumero += args.data.proximoNumero.increment
          return { ...current }
        },
      },
      $executeRaw: async () => 1,
    } as unknown as SaleNumberingTransactionClient
  }
}

async function errorCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    return isSaleNumberingError(error) ? error.code : `UNTYPED:${String(error)}`
  }
  return "NO_ERROR"
}

describe("código, formato e ano da numeração", () => {
  it.each([
    ["L001", "L001"],
    ["  l001  ", "L001"],
    ["ab", "AB"],
    ["abcdefgh", "ABCDEFGH"],
    ["12", "12"],
  ])("normaliza %s para %s", (raw, expected) => {
    expect(normalizeSaleNumberingCode(raw)).toBe(expected)
    expect(isValidSaleNumberingCode(raw)).toBe(true)
  })

  it.each(["a", "abcdefghi", "L-01", "L 01", "LÇ01", "", "   "])(
    "recusa código inválido %s",
    (raw) => {
      expect(normalizeSaleNumberingCode(raw)).toBeNull()
      expect(isValidSaleNumberingCode(raw)).toBe(false)
    },
  )

  it("formata VDA com loja, ano e padding de seis dígitos", () => {
    expect(formatSalePedidoId({ prefixo: "L001", ano: 2026, numero: 1 })).toBe(
      "VDA-L001-2026-000001",
    )
    expect(formatSalePedidoId({ prefixo: "ab", ano: 2026, numero: 42 })).toBe(
      "VDA-AB-2026-000042",
    )
    expect(formatSalePedidoId({ prefixo: "L001", ano: 2026, numero: SALE_NUMBER_MAX })).toBe(
      "VDA-L001-2026-999999",
    )
  })

  it.each([
    { prefixo: "X", ano: 2026, numero: 1 },
    { prefixo: "L001", ano: 1999, numero: 1 },
    { prefixo: "L001", ano: 2026, numero: 0 },
    { prefixo: "L001", ano: 2026, numero: SALE_NUMBER_MAX + 1 },
    { prefixo: "L001", ano: 2026, numero: 1.5 },
  ])("falha fechada para formato fora do contrato: %o", (input) => {
    expect(() => formatSalePedidoId(input)).toThrow(SaleNumberingError)
  })

  it("resolve a virada do ano em America/Sao_Paulo, não em UTC", () => {
    expect(SALE_NUMBERING_TIMEZONE).toBe("America/Sao_Paulo")
    expect(resolveSaleNumberingAno(new Date("2027-01-01T00:30:00.000Z"))).toBe(2026)
    expect(resolveSaleNumberingAno(new Date("2027-01-01T03:30:00.000Z"))).toBe(2027)
  })

  it("recusa data inválida e número fora da faixa", () => {
    expect(() => resolveSaleNumberingAno(new Date("invalid"))).toThrow(SaleNumberingError)
    expect(isValidSaleNumero(1)).toBe(true)
    expect(isValidSaleNumero(SALE_NUMBER_MAX)).toBe(true)
    expect(isValidSaleNumero(0)).toBe(false)
    expect(isValidSaleNumero(SALE_NUMBER_MAX + 1)).toBe(false)
  })
})

describe("alocação sob harness transacional simulado", () => {
  it("faz a primeira alocação e incrementa sequencialmente", async () => {
    const db = new FakeTransactionalNumberingDb()
    db.configureStore("loja-a", "L001")

    const first = await db.transaction((tx) =>
      allocateSaleNumber(tx, { storeId: "loja-a", ano: 2026 }),
    )
    const second = await db.transaction((tx) =>
      allocateSaleNumber(tx, { storeId: "loja-a", ano: 2026 }),
    )

    expect(first.numeroSequencial).toBe(1)
    expect(first.pedidoId).toBe("VDA-L001-2026-000001")
    expect(second.numeroSequencial).toBe(2)
    expect(db.serie("loja-a", 2026)?.proximoNumero).toBe(3)
  })

  it("isola lojas e anos", async () => {
    const db = new FakeTransactionalNumberingDb()
    db.configureStore("loja-a", "L001")
    db.configureStore("loja-b", "L002")

    const a2026 = await db.transaction((tx) =>
      allocateSaleNumber(tx, { storeId: "loja-a", ano: 2026 }),
    )
    const b2026 = await db.transaction((tx) =>
      allocateSaleNumber(tx, { storeId: "loja-b", ano: 2026 }),
    )
    const a2027 = await db.transaction((tx) =>
      allocateSaleNumber(tx, { storeId: "loja-a", ano: 2027 }),
    )

    expect([a2026.numeroSequencial, b2026.numeroSequencial, a2027.numeroSequencial]).toEqual([
      1, 1, 1,
    ])
    expect(new Set([a2026.serieVendaId, b2026.serieVendaId, a2027.serieVendaId]).size).toBe(3)
  })

  it("simula chamadas simultâneas sem alegar concorrência real de banco", async () => {
    const db = new FakeTransactionalNumberingDb()
    db.configureStore("loja-a", "L001")

    const allocations = await Promise.all(
      Array.from({ length: 12 }, () =>
        db.transaction((tx) => allocateSaleNumber(tx, { storeId: "loja-a", ano: 2026 })),
      ),
    )

    expect(allocations.map((item) => item.numeroSequencial).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 12 }, (_, index) => index + 1),
    )
  })

  it("rollback após incremento não consome número", async () => {
    const db = new FakeTransactionalNumberingDb()
    db.configureStore("loja-a", "L001")

    await expect(
      db.transaction(
        (tx) => allocateSaleNumber(tx, { storeId: "loja-a", ano: 2026 }),
        new Error("rollback"),
      ),
    ).rejects.toThrow("rollback")

    expect(db.serie("loja-a", 2026)).toBeUndefined()
    const next = await db.transaction((tx) =>
      allocateSaleNumber(tx, { storeId: "loja-a", ano: 2026 }),
    )
    expect(next.numeroSequencial).toBe(1)
  })

  it("retry controlado repete a transação inteira e preserva a sequência", async () => {
    const db = new FakeTransactionalNumberingDb()
    db.configureStore("loja-a", "L001")
    let attempts = 0

    async function runWithOneRetry() {
      while (attempts < 2) {
        attempts += 1
        try {
          return await db.transaction(
            (tx) => allocateSaleNumber(tx, { storeId: "loja-a", ano: 2026 }),
            attempts === 1 ? { code: "P2034" } : undefined,
          )
        } catch (error) {
          if (!isRetryableSaleNumberingTransactionError(error) || attempts >= 2) throw error
        }
      }
      throw new Error("Limite de tentativas esgotado.")
    }

    const allocation = await runWithOneRetry()
    expect(attempts).toBe(2)
    expect(allocation.numeroSequencial).toBe(1)
    expect(db.serie("loja-a", 2026)?.proximoNumero).toBe(2)
  })

  it("falha fechada para storeId/ano/configuração inválidos", async () => {
    const db = new FakeTransactionalNumberingDb()
    db.configureStore("sem-codigo", null)

    expect(
      await errorCode(db.transaction((tx) => allocateSaleNumber(tx, { storeId: "", ano: 2026 }))),
    ).toBe("SALE_NUMBERING_NOT_CONFIGURED")
    expect(
      await errorCode(
        db.transaction((tx) => allocateSaleNumber(tx, { storeId: "inexistente", ano: 2026 })),
      ),
    ).toBe("SALE_NUMBERING_NOT_CONFIGURED")
    expect(
      await errorCode(
        db.transaction((tx) => allocateSaleNumber(tx, { storeId: "sem-codigo", ano: 2026 })),
      ),
    ).toBe("SALE_NUMBERING_NOT_CONFIGURED")
    expect(
      await errorCode(
        db.transaction((tx) => allocateSaleNumber(tx, { storeId: "sem-codigo", ano: 1999 })),
      ),
    ).toBe("SALE_NUMBERING_INVARIANT_BROKEN")
  })

  it("falha fechada no overflow sem avançar o contador", async () => {
    const db = new FakeTransactionalNumberingDb()
    db.configureStore("loja-a", "L001")
    await db.transaction((tx) => allocateSaleNumber(tx, { storeId: "loja-a", ano: 2026 }))
    db.setNextNumber("loja-a", 2026, SALE_NUMBER_MAX)

    const last = await db.transaction((tx) =>
      allocateSaleNumber(tx, { storeId: "loja-a", ano: 2026 }),
    )
    expect(last.numeroSequencial).toBe(SALE_NUMBER_MAX)
    expect(
      await errorCode(
        db.transaction((tx) => allocateSaleNumber(tx, { storeId: "loja-a", ano: 2026 })),
      ),
    ).toBe("SALE_SEQUENCE_EXHAUSTED")
    expect(db.serie("loja-a", 2026)?.proximoNumero).toBe(SALE_NUMBER_MAX + 1)
  })
})

describe("contratos auxiliares", () => {
  it("deriva lock int4 determinístico e distinto por loja", () => {
    const a = saleNumberingAdvisoryKey("loja-a")
    const b = saleNumberingAdvisoryKey("loja-b")
    expect(a).toBe(saleNumberingAdvisoryKey("loja-a"))
    expect(a).not.toBe(b)
    expect(a).toBeGreaterThanOrEqual(-2_147_483_648)
    expect(a).toBeLessThanOrEqual(2_147_483_647)
  })

  it("só classifica P2034 como retry transacional genérico", () => {
    expect(isRetryableSaleNumberingTransactionError({ code: "P2034" })).toBe(true)
    expect(isRetryableSaleNumberingTransactionError({ code: "P2002" })).toBe(false)
    expect(isRetryableSaleNumberingTransactionError(new Error("x"))).toBe(false)
  })
})
