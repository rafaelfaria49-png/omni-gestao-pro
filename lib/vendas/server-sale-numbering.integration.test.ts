/**
 * Concorrência real da numeração server-side (GOAL 002B) — exige PostgreSQL de TESTE.
 *
 * Fakes de `TransactionClient` não provam lock de linha, `P2002` nem rollback; por isso
 * estes casos rodam contra um banco real. A suíte é OPT-IN: sem
 * `SALE_NUMBERING_TEST_DATABASE_URL` ela é pulada, e a URL precisa ser de host local —
 * nunca um banco remoto/produtivo.
 *
 * Todos os dados são sintéticos (`002b-test-*`) e removidos no `afterAll`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { randomBytes } from "node:crypto"
import { PrismaClient } from "@/generated/prisma"
import {
  SALE_NUMBER_MAX,
  allocateSaleNumber,
  isSaleNumberingError,
} from "./server-sale-numbering"

const rawUrl = process.env.SALE_NUMBERING_TEST_DATABASE_URL
const integration = rawUrl ? describe : describe.skip

/** Sufixo de execução: isola rodadas paralelas e torna o lixo de teste reconhecível. */
const RUN = randomBytes(3).toString("hex").toUpperCase()
const STORE_PREFIX = `002b-test-${RUN.toLowerCase()}-`
const ANO = 2026

function assertLocalTestUrl(url: string): string {
  const parsed = new URL(url)
  const host = parsed.hostname.toLowerCase()
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(
      `SALE_NUMBERING_TEST_DATABASE_URL precisa apontar para um PostgreSQL local de teste (host recebido: ${host}).`,
    )
  }
  // Concorrência real precisa de pool folgado; sem isso o teste mede o pool, não o lock.
  parsed.searchParams.set("connection_limit", "32")
  parsed.searchParams.set("pool_timeout", "30")
  return parsed.toString()
}

const prisma = new PrismaClient({ datasourceUrl: rawUrl ? assertLocalTestUrl(rawUrl) : undefined })
const TX_OPTS = { timeout: 30_000, maxWait: 30_000 }

let seq = 0
function storeId(): string {
  seq += 1
  return `${STORE_PREFIX}${seq}`
}

/** Cria loja sintética já configurada com um código de numeração único. */
async function criarLoja(codigo: string): Promise<string> {
  const id = storeId()
  await prisma.store.create({
    data: { id, name: `Loja sintética ${codigo}`, codigoNumeracaoVenda: codigo },
  })
  return id
}

function codigo(sufixo: string): string {
  return `T${RUN}${sufixo}`.toUpperCase().slice(0, 8)
}

async function limpar(): Promise<void> {
  await prisma.venda.deleteMany({ where: { storeId: { startsWith: STORE_PREFIX } } })
  await prisma.serieVenda.deleteMany({ where: { storeId: { startsWith: STORE_PREFIX } } })
  await prisma.store.deleteMany({ where: { id: { startsWith: STORE_PREFIX } } })
}

integration("numeração server-side em PostgreSQL real", () => {
  beforeAll(async () => {
    await limpar()
  })

  afterAll(async () => {
    await limpar()
    await prisma.$disconnect()
  })

  it("duas lojas emitem a primeira venda do ano com sequência 1 e prefixos distintos", async () => {
    const codigoA = codigo("A")
    const codigoB = codigo("B")
    const lojaA = await criarLoja(codigoA)
    const lojaB = await criarLoja(codigoB)

    const a = await prisma.$transaction((tx) => allocateSaleNumber(tx, { storeId: lojaA, ano: ANO }), TX_OPTS)
    const b = await prisma.$transaction((tx) => allocateSaleNumber(tx, { storeId: lojaB, ano: ANO }), TX_OPTS)

    expect(a.numeroSequencial).toBe(1)
    expect(b.numeroSequencial).toBe(1)
    expect(a.pedidoId).toBe(`VDA-${codigoA}-${ANO}-000001`)
    expect(b.pedidoId).toBe(`VDA-${codigoB}-${ANO}-000001`)
    expect(a.serieVendaId).not.toBe(b.serieVendaId)
  })

  it("três terminais simultâneos da mesma loja recebem números únicos e consecutivos", async () => {
    const loja = await criarLoja(codigo("C"))

    const resultados = await Promise.all(
      [1, 2, 3].map(() =>
        prisma.$transaction((tx) => allocateSaleNumber(tx, { storeId: loja, ano: ANO }), TX_OPTS),
      ),
    )

    const numeros = resultados.map((r) => r.numeroSequencial).sort((x, y) => x - y)
    expect(numeros).toEqual([1, 2, 3])
    expect(new Set(resultados.map((r) => r.pedidoId)).size).toBe(3)
    expect(new Set(resultados.map((r) => r.serieVendaId)).size).toBe(1)
  })

  it("24 alocações concorrentes não duplicam número e não deixam lacuna", async () => {
    const loja = await criarLoja(codigo("D"))
    const total = 24

    const resultados = await Promise.all(
      Array.from({ length: total }, () =>
        prisma.$transaction((tx) => allocateSaleNumber(tx, { storeId: loja, ano: ANO }), TX_OPTS),
      ),
    )

    const numeros = resultados.map((r) => r.numeroSequencial).sort((x, y) => x - y)
    expect(new Set(numeros).size).toBe(total)
    expect(numeros).toEqual(Array.from({ length: total }, (_, i) => i + 1))

    const serie = await prisma.serieVenda.findUniqueOrThrow({ where: { storeId_ano: { storeId: loja, ano: ANO } } })
    expect(serie.proximoNumero).toBe(total + 1)
  })

  it("rollback depois do incremento não consome número", async () => {
    const loja = await criarLoja(codigo("E"))

    const primeira = await prisma.$transaction(
      (tx) => allocateSaleNumber(tx, { storeId: loja, ano: ANO }),
      TX_OPTS,
    )
    expect(primeira.numeroSequencial).toBe(1)

    await expect(
      prisma.$transaction(async (tx) => {
        const alocado = await allocateSaleNumber(tx, { storeId: loja, ano: ANO })
        expect(alocado.numeroSequencial).toBe(2)
        throw new Error("rollback proposital do chamador")
      }, TX_OPTS),
    ).rejects.toThrow("rollback proposital do chamador")

    const serie = await prisma.serieVenda.findUniqueOrThrow({ where: { storeId_ano: { storeId: loja, ano: ANO } } })
    expect(serie.proximoNumero).toBe(2)

    const terceira = await prisma.$transaction(
      (tx) => allocateSaleNumber(tx, { storeId: loja, ano: ANO }),
      TX_OPTS,
    )
    expect(terceira.numeroSequencial).toBe(2)
  })

  it("duas criações concorrentes da série anual convergem para a mesma série", async () => {
    const loja = await criarLoja(codigo("F"))
    const anoNovo = ANO + 1
    expect(await prisma.serieVenda.findUnique({ where: { storeId_ano: { storeId: loja, ano: anoNovo } } })).toBeNull()

    const [a, b] = await Promise.all([
      prisma.$transaction((tx) => allocateSaleNumber(tx, { storeId: loja, ano: anoNovo }), TX_OPTS),
      prisma.$transaction((tx) => allocateSaleNumber(tx, { storeId: loja, ano: anoNovo }), TX_OPTS),
    ])

    expect(a.serieVendaId).toBe(b.serieVendaId)
    expect([a.numeroSequencial, b.numeroSequencial].sort((x, y) => x - y)).toEqual([1, 2])
    expect(await prisma.serieVenda.count({ where: { storeId: loja, ano: anoNovo } })).toBe(1)
  })

  it("o mesmo clientSaleId não se repete na mesma loja, mas existe em lojas diferentes", async () => {
    const lojaA = await criarLoja(codigo("G"))
    const lojaB = await criarLoja(codigo("H"))
    const chave = `client-${RUN}-1`

    await prisma.venda.create({
      data: { storeId: lojaA, pedidoId: `VDA-${RUN}-A1`, clientSaleId: chave },
    })
    await expect(
      prisma.venda.create({ data: { storeId: lojaA, pedidoId: `VDA-${RUN}-A2`, clientSaleId: chave } }),
    ).rejects.toMatchObject({ code: "P2002" })

    const outraLoja = await prisma.venda.create({
      data: { storeId: lojaB, pedidoId: `VDA-${RUN}-B1`, clientSaleId: chave },
    })
    expect(outraLoja.clientSaleId).toBe(chave)
  })

  it("uma venda não pode usar a série de outra loja (FK composta)", async () => {
    const lojaA = await criarLoja(codigo("I"))
    const lojaB = await criarLoja(codigo("J"))
    const daLojaA = await prisma.$transaction(
      (tx) => allocateSaleNumber(tx, { storeId: lojaA, ano: ANO }),
      TX_OPTS,
    )

    await expect(
      prisma.venda.create({
        data: {
          storeId: lojaB,
          pedidoId: `VDA-${RUN}-CROSS`,
          serieVendaId: daLojaA.serieVendaId,
          anoNumero: ANO,
          numeroSequencial: 1,
          numeracaoOrigem: "SERVER_V1",
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" })

    // A mesma linha é aceita na loja dona da série.
    const aceita = await prisma.venda.create({
      data: {
        storeId: lojaA,
        pedidoId: daLojaA.pedidoId,
        serieVendaId: daLojaA.serieVendaId,
        anoNumero: ANO,
        numeroSequencial: daLojaA.numeroSequencial,
        numeracaoOrigem: "SERVER_V1",
        numeradaEm: new Date(),
      },
    })
    expect(aceita.numeroSequencial).toBe(1)

    // E o número não se repete dentro da série.
    await expect(
      prisma.venda.create({
        data: {
          storeId: lojaA,
          pedidoId: `VDA-${RUN}-DUP`,
          serieVendaId: daLojaA.serieVendaId,
          anoNumero: ANO,
          numeroSequencial: daLojaA.numeroSequencial,
          numeracaoOrigem: "SERVER_V1",
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" })
  })

  it("pedidoId continua globalmente único entre lojas", async () => {
    const lojaA = await criarLoja(codigo("K"))
    const lojaB = await criarLoja(codigo("L"))
    const pedidoId = `VDA-${RUN}-GLOBAL`

    await prisma.venda.create({ data: { storeId: lojaA, pedidoId } })
    await expect(prisma.venda.create({ data: { storeId: lojaB, pedidoId } })).rejects.toMatchObject({
      code: "P2002",
    })
  })

  it("histórico sem numeração continua válido com múltiplos NULL", async () => {
    const loja = await criarLoja(codigo("M"))

    const historicas = await Promise.all(
      [1, 2, 3].map((i) =>
        prisma.venda.create({ data: { storeId: loja, pedidoId: `VDA-${RUN}-HIST-${i}` } }),
      ),
    )

    for (const venda of historicas) {
      expect(venda.clientSaleId).toBeNull()
      expect(venda.serieVendaId).toBeNull()
      expect(venda.numeroSequencial).toBeNull()
      expect(venda.anoNumero).toBeNull()
      expect(venda.numeradaEm).toBeNull()
      expect(venda.idempotencyHash).toBeNull()
      expect(venda.idempotencyHashVersion).toBeNull()
      // Toda venda existente continua classificada como numeração de cliente.
      expect(venda.numeracaoOrigem).toBe("LEGACY_CLIENT")
    }
  })

  it("a série falha fechada ao atingir 999999 sem pular número", async () => {
    const loja = await criarLoja(codigo("N"))
    await prisma.$transaction((tx) => allocateSaleNumber(tx, { storeId: loja, ano: ANO }), TX_OPTS)
    await prisma.serieVenda.update({
      where: { storeId_ano: { storeId: loja, ano: ANO } },
      data: { proximoNumero: SALE_NUMBER_MAX },
    })

    const ultima = await prisma.$transaction(
      (tx) => allocateSaleNumber(tx, { storeId: loja, ano: ANO }),
      TX_OPTS,
    )
    expect(ultima.numeroSequencial).toBe(SALE_NUMBER_MAX)
    expect(ultima.pedidoId.endsWith(`-${SALE_NUMBER_MAX}`)).toBe(true)

    let code = "SEM_ERRO"
    try {
      await prisma.$transaction((tx) => allocateSaleNumber(tx, { storeId: loja, ano: ANO }), TX_OPTS)
    } catch (e) {
      code = isSaleNumberingError(e) ? e.code : `NAO_TIPADO:${String(e)}`
    }
    expect(code).toBe("SALE_SEQUENCE_EXHAUSTED")

    const serie = await prisma.serieVenda.findUniqueOrThrow({ where: { storeId_ano: { storeId: loja, ano: ANO } } })
    expect(serie.proximoNumero).toBe(SALE_NUMBER_MAX + 1)
  })

  it("a série inativa e a loja sem código falham fechadas contra o banco real", async () => {
    const lojaSemCodigo = storeId()
    await prisma.store.create({ data: { id: lojaSemCodigo, name: "Loja sintética sem código" } })
    let semCodigo = "SEM_ERRO"
    try {
      await prisma.$transaction(
        (tx) => allocateSaleNumber(tx, { storeId: lojaSemCodigo, ano: ANO }),
        TX_OPTS,
      )
    } catch (e) {
      semCodigo = isSaleNumberingError(e) ? e.code : `NAO_TIPADO:${String(e)}`
    }
    expect(semCodigo).toBe("SALE_NUMBERING_NOT_CONFIGURED")
    expect(await prisma.serieVenda.count({ where: { storeId: lojaSemCodigo } })).toBe(0)

    const loja = await criarLoja(codigo("O"))
    await prisma.$transaction((tx) => allocateSaleNumber(tx, { storeId: loja, ano: ANO }), TX_OPTS)
    await prisma.serieVenda.update({
      where: { storeId_ano: { storeId: loja, ano: ANO } },
      data: { ativo: false },
    })

    let inativa = "SEM_ERRO"
    try {
      await prisma.$transaction((tx) => allocateSaleNumber(tx, { storeId: loja, ano: ANO }), TX_OPTS)
    } catch (e) {
      inativa = isSaleNumberingError(e) ? e.code : `NAO_TIPADO:${String(e)}`
    }
    expect(inativa).toBe("SALE_NUMBERING_NOT_CONFIGURED")
    const serie = await prisma.serieVenda.findUniqueOrThrow({ where: { storeId_ano: { storeId: loja, ano: ANO } } })
    expect(serie.proximoNumero).toBe(2)
  })

  it("o prefixo da série é imutável: trocar o código da loja não renumera nem silencia", async () => {
    const original = codigo("P")
    const loja = await criarLoja(original)
    const primeira = await prisma.$transaction(
      (tx) => allocateSaleNumber(tx, { storeId: loja, ano: ANO }),
      TX_OPTS,
    )
    expect(primeira.pedidoId).toBe(`VDA-${original}-${ANO}-000001`)

    await prisma.store.update({ where: { id: loja }, data: { codigoNumeracaoVenda: codigo("Q") } })

    let code = "SEM_ERRO"
    try {
      await prisma.$transaction((tx) => allocateSaleNumber(tx, { storeId: loja, ano: ANO }), TX_OPTS)
    } catch (e) {
      code = isSaleNumberingError(e) ? e.code : `NAO_TIPADO:${String(e)}`
    }
    expect(code).toBe("SALE_NUMBERING_INVARIANT_BROKEN")

    const serie = await prisma.serieVenda.findUniqueOrThrow({ where: { storeId_ano: { storeId: loja, ano: ANO } } })
    expect(serie.prefixo).toBe(original)
    expect(serie.proximoNumero).toBe(2)
  })

  it("nenhuma venda fora do escopo sintético é criada pela suíte", async () => {
    const foraDoEscopo = await prisma.venda.count({ where: { NOT: { storeId: { startsWith: STORE_PREFIX } } } })
    expect(foraDoEscopo).toBe(0)
    const seriesForaDoEscopo = await prisma.serieVenda.count({
      where: { NOT: { storeId: { startsWith: STORE_PREFIX } } },
    })
    expect(seriesForaDoEscopo).toBe(0)
  })
})
