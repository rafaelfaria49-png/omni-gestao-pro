/**
 * Camada de listagem contra PostgreSQL REAL (F-02).
 *
 * O `SQLSTATE 42804` não aparece em teste puro: ele só existe quando a consulta chega
 * ao Postgres. Este arquivo executa a consulta de verdade e cruza cada filtro com um
 * SQL INDEPENDENTE, escrito à mão aqui — se os dois divergirem, o filtro está errado.
 *
 * Pulado por padrão. Para rodar, aponte um banco DESCARTÁVEL já semeado e ligue a flag:
 *
 *   PRODUTOS_LISTAGEM_SQL_IT=1 DATABASE_URL=postgresql://…@127.0.0.1:55434/… \
 *     npx vitest run lib/cadastros/produtos-listagem-sql.integration.test.ts
 *
 * NUNCA apontar para Neon/Supabase: o guard abaixo recusa host remoto.
 */

import { describe, expect, it } from "vitest"

import { prisma } from "@/lib/prisma"
import { isSyntheticImportSku } from "./importacao-produtos/sku"
import { consultarProdutosSql, dataLocalISO, resolverUltimoBatchProdutos } from "./produtos-listagem-sql"

const URL_BANCO = process.env.DATABASE_URL ?? ""
const REMOTO = /neon\.tech|supabase\.(co|com)|:6543/.test(URL_BANCO)
const LIGADO = process.env.PRODUTOS_LISTAGEM_SQL_IT === "1" && URL_BANCO.includes("127.0.0.1") && !REMOTO

const STORE = "loja-2"
const OUTRA = "loja-1"

/** Contagem independente — SQL cru, sem passar pelo construtor da aplicação. */
async function contar(where: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT COUNT(*)::int AS n FROM estoque_produtos p WHERE p."storeId" = '${STORE}' AND (${where})`,
  )
  return Number(rows[0]?.n ?? 0)
}

type EntradaConsulta = Parameters<typeof consultarProdutosSql>[0]

/** Roda a camada de produção e devolve o total (falha explícita vira erro do teste). */
async function totalPelaCamada(
  input: Omit<EntradaConsulta, "page" | "pageSize"> & { page?: number; pageSize?: number },
): Promise<number> {
  const r = await consultarProdutosSql({ page: 1, pageSize: 10, ...input })
  if (!r.ok) throw new Error(`consulta falhou: ${r.erro.codigo} sqlState=${r.erro.sqlState}`)
  return r.total
}

describe.skipIf(!LIGADO)("listagem de produtos contra PostgreSQL real", () => {
  const HOJE = dataLocalISO()
  const LOTE = "p.\"metadata\"->'importacao'->'ultimoLote'"

  it("nenhum filtro dispara SQLSTATE 42804 (o defeito original)", async () => {
    for (const importacao of [
      "hoje",
      "pendenteRevisao",
      "revisado",
      "semBarcode",
      "skuSintetico",
      "semNcm",
      "semCest",
    ]) {
      const r = await consultarProdutosSql({
        storeId: STORE,
        page: 1,
        pageSize: 5,
        filters: { importacao },
      })
      expect(r.ok, `filtro ${importacao} falhou`).toBe(true)
    }
  })

  it('"importados hoje" bate com o SQL independente (fuso do operador)', async () => {
    const esperado = await contar(
      `((${LOTE}->>'importadoEm')::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date = DATE '${HOJE}'`,
    )
    expect(await totalPelaCamada({ storeId: STORE, filters: { importacao: "hoje" } })).toBe(esperado)
    expect(esperado).toBeGreaterThan(0)
  })

  it('"pendentes" e "revisados" batem e são disjuntos', async () => {
    const pend = await contar(`${LOTE}->>'statusRevisao' = 'pendente'`)
    const rev = await contar(`${LOTE}->>'statusRevisao' = 'revisado'`)
    expect(await totalPelaCamada({ storeId: STORE, filters: { importacao: "pendenteRevisao" } })).toBe(pend)
    expect(await totalPelaCamada({ storeId: STORE, filters: { importacao: "revisado" } })).toBe(rev)
    expect(await contar(`${LOTE}->>'statusRevisao' IN ('pendente','revisado')`)).toBe(pend + rev)
  })

  it('"NCM ausente" e "CEST ausente" batem — inclusive metadata legado e nulo', async () => {
    const semNcm = await contar(
      `COALESCE(NULLIF(p."metadata"->'fiscal'->>'ncm',''), NULLIF(p."metadata"->>'ncm','')) IS NULL`,
    )
    const semCest = await contar(
      `COALESCE(NULLIF(p."metadata"->'fiscal'->>'cest',''), NULLIF(p."metadata"->>'cest','')) IS NULL`,
    )
    expect(await totalPelaCamada({ storeId: STORE, filters: { importacao: "semNcm" } })).toBe(semNcm)
    expect(await totalPelaCamada({ storeId: STORE, filters: { importacao: "semCest" } })).toBe(semCest)
  })

  it('"sem código de barras" bate', async () => {
    const esperado = await contar(`p."barcode" IS NULL OR p."barcode" = ''`)
    expect(await totalPelaCamada({ storeId: STORE, filters: { importacao: "semBarcode" } })).toBe(esperado)
  })

  /**
   * A prova de que a tradução POSIX em `sku.ts` é fiel ao predicado TypeScript.
   * Sem isto, "SKU sintético" voltaria a marcar `IMP-4471` como resíduo do parser.
   */
  it('"SKU sintético" é IDÊNTICO a isSyntheticImportSku sobre o catálogo inteiro', async () => {
    const todos = await prisma.produto.findMany({
      where: { storeId: STORE },
      select: { id: true, sku: true },
    })
    const esperados = new Set(todos.filter((p) => isSyntheticImportSku(p.sku)).map((p) => p.id))

    const r = await consultarProdutosSql({
      storeId: STORE,
      page: 1,
      pageSize: 200,
      filters: { importacao: "skuSintetico" },
    })
    if (!r.ok) throw new Error("consulta falhou")
    const obtidos = new Set(r.rows.map((p) => p.id))

    expect(r.total).toBe(esperados.size)
    expect([...obtidos].sort()).toEqual([...esperados].sort())
  })

  it("códigos legítimos IMP-4471 e IMP-9902 NÃO são classificados como sintéticos", async () => {
    const r = await consultarProdutosSql({
      storeId: STORE,
      page: 1,
      pageSize: 200,
      filters: { importacao: "skuSintetico" },
    })
    if (!r.ok) throw new Error("consulta falhou")
    const skus = r.rows.map((p) => (p.sku ?? "").toUpperCase())
    expect(skus).not.toContain("IMP-4471")
    expect(skus).not.toContain("IMP-9902")
    // …e continuam existindo no catálogo, só que fora do filtro.
    const existentes = await prisma.produto.count({
      where: { storeId: STORE, sku: { in: ["IMP-4471", "IMP-9902"] } },
    })
    expect(existentes).toBe(2)
  })

  it("filtro por batchId e por fornecedor batem com o SQL independente", async () => {
    const batchId = await resolverUltimoBatchProdutos(STORE)
    expect(batchId).toBeTruthy()
    const esperado = await contar(`${LOTE}->>'batchId' = '${batchId}'`)
    expect(await totalPelaCamada({ storeId: STORE, filters: { batchId: batchId! } })).toBe(esperado)

    const fornecedor = "FORNECEDOR ALFA CORR001"
    const esperadoForn = await contar(`lower(p."supplierName") = lower('${fornecedor}')`)
    expect(
      await totalPelaCamada({ storeId: STORE, filters: { fornecedorNome: fornecedor } }),
    ).toBe(esperadoForn)
  })

  it("combinação de filtros é interseção, não união", async () => {
    const semCestSemPreco = await contar(
      `COALESCE(NULLIF(p."metadata"->'fiscal'->>'cest',''), NULLIF(p."metadata"->>'cest','')) IS NULL AND p."price" <= 0`,
    )
    const total = await totalPelaCamada({
      storeId: STORE,
      filters: { importacao: "semCest", preco: "semPreco" },
    })
    expect(total).toBe(semCestSemPreco)
    // Interseção é estritamente menor que cada parcela isolada.
    expect(total).toBeLessThan(await totalPelaCamada({ storeId: STORE, filters: { importacao: "semCest" } }))
  })

  it("count e página nascem do MESMO where: total estável e sem linha repetida", async () => {
    const base = { storeId: STORE, filters: { importacao: "pendenteRevisao" }, pageSize: 25 }
    const p1 = await consultarProdutosSql({ ...base, page: 1 })
    const p2 = await consultarProdutosSql({ ...base, page: 2 })
    if (!p1.ok || !p2.ok) throw new Error("consulta falhou")
    expect(p1.total).toBe(p2.total)
    expect(p1.rows).toHaveLength(25)
    const ids1 = new Set(p1.rows.map((r) => r.id))
    expect(p2.rows.some((r) => ids1.has(r.id))).toBe(false)
  })

  it("isolamento multi-loja: lote de uma loja nunca aparece na outra", async () => {
    const batchId = await resolverUltimoBatchProdutos(STORE)
    expect(await totalPelaCamada({ storeId: OUTRA, filters: { batchId: batchId! } })).toBe(0)

    const loteDaOutra = await resolverUltimoBatchProdutos(OUTRA)
    expect(loteDaOutra).toBeTruthy()
    expect(loteDaOutra).not.toBe(batchId)
    expect(await totalPelaCamada({ storeId: STORE, filters: { batchId: loteDaOutra! } })).toBe(0)
  })

  it("mesmo EAN em lojas diferentes não vaza entre lojas", async () => {
    const ean = "7892840819170"
    const r1 = await consultarProdutosSql({ storeId: OUTRA, page: 1, pageSize: 50, q: ean })
    const r2 = await consultarProdutosSql({ storeId: STORE, page: 1, pageSize: 50, q: ean })
    if (!r1.ok || !r2.ok) throw new Error("consulta falhou")
    for (const row of [...r1.rows, ...r2.rows]) expect(row.id).toBeTruthy()
    // Cada loja só vê o próprio registro.
    const idsL1 = new Set(r1.rows.map((r) => r.id))
    expect(r2.rows.some((r) => idsL1.has(r.id))).toBe(false)
  })

  it("storeId vazio nunca devolve produto de loja alguma", async () => {
    const r = await consultarProdutosSql({ storeId: "", page: 1, pageSize: 50 })
    expect(r).toEqual({ ok: true, rows: [], total: 0 })
  })

  /** Entradas hostis: zero injeção, zero erro de sintaxe, catálogo intacto. */
  it("entradas hostis não injetam nem derrubam a consulta", async () => {
    const hostis: EntradaConsulta[] = [
      { storeId: STORE, page: 1, pageSize: 10, filters: { batchId: "lote' OR 1=1 --" } },
      { storeId: STORE, page: 1, pageSize: 10, filters: { batchId: "'; DROP TABLE estoque_produtos; --" } },
      { storeId: STORE, page: 1, pageSize: 10, filters: { batchId: "lote-a' UNION SELECT NULL --" } },
      { storeId: STORE, page: 1, pageSize: 10, filters: { fornecedorNome: "%" } },
      { storeId: STORE, page: 1, pageSize: 10, filters: { fornecedorNome: "' OR '1'='1" } },
      { storeId: STORE, page: 1, pageSize: 10, filters: { categoria: "'; DROP TABLE estoque_produtos; --" } },
      { storeId: STORE, page: 1, pageSize: 10, filters: { marca: "' OR 1=1 --" } },
      { storeId: STORE, page: 1, pageSize: 10, filters: { batchId: "x".repeat(5000) } },
      { storeId: STORE, page: 1, pageSize: 10, q: "%", filters: { importacao: "semNcm" } },
      { storeId: STORE, page: 1, pageSize: 10, q: "\\_", filters: { importacao: "semNcm" } },
      { storeId: STORE, page: 1, pageSize: 10, q: "aspa'simples e /* comentario */" },
    ]
    for (const entrada of hostis) {
      const r = await consultarProdutosSql(entrada)
      expect(r.ok, JSON.stringify(entrada.filters ?? entrada.q)).toBe(true)
      if (r.ok) expect(r.total).toBe(0)
    }
    // A tabela continua inteira depois de todas as tentativas.
    const total = await prisma.produto.count({ where: { storeId: STORE } })
    expect(total).toBeGreaterThan(5000)
  })

  it("busca ranqueada põe o match por NOME na frente do match por marca/categoria", async () => {
    const r = await consultarProdutosSql({ storeId: STORE, page: 1, pageSize: 10, q: "PILH" })
    if (!r.ok) throw new Error("consulta falhou")
    expect(r.rows.length).toBeGreaterThan(0)
    expect(r.rows[0]!.name.toUpperCase().startsWith("PILH")).toBe(true)
  })

  it("ordenação manual usa a coluna pedida e ignora coluna fora da allowlist", async () => {
    const asc = await consultarProdutosSql({
      storeId: STORE,
      page: 1,
      pageSize: 5,
      orderBy: { field: "preco", direction: "asc" },
    })
    if (!asc.ok) throw new Error("consulta falhou")
    const precos = asc.rows.map((r) => Number(r.price ?? 0))
    expect([...precos].sort((a, b) => a - b)).toEqual(precos)

    const invalida = await consultarProdutosSql({
      storeId: STORE,
      page: 1,
      pageSize: 5,
      orderBy: { field: 'name"; DROP TABLE estoque_produtos --', direction: "asc" },
    })
    expect(invalida.ok).toBe(true)
    expect(await prisma.produto.count({ where: { storeId: STORE } })).toBeGreaterThan(5000)
  })
})
