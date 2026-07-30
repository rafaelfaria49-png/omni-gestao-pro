/**
 * Camada única de listagem de produtos — contrato puro + guarda de arquitetura (F-02).
 *
 * Estes testes não tocam banco. Provam (a) a normalização/whitelist dos filtros e da
 * ordenação, (b) que a requisição com filtro JSONB ou ranking EXIGE SQL e portanto não
 * pode cair em fallback, e (c) que o padrão que causou o `SQLSTATE 42804`
 * (`Prisma.join` montando o WHERE + fragmento `Prisma.Sql` aninhado) não voltou ao
 * código. A correção de comportamento contra Postgres real vive em
 * `produtos-listagem-sql.integration.test.ts`.
 */

import { readFileSync } from "node:fs"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/** Prisma mockado: nenhum teste deste arquivo toca banco. */
const queryRawMock = vi.fn()
vi.mock("@/lib/prisma", () => ({ prisma: { $queryRaw: (...a: unknown[]) => queryRawMock(...a) } }))

import {
  FILTROS_IMPORTACAO,
  MENSAGEM_ERRO_FILTROS_PRODUTOS,
  ORDENACOES_PRODUTOS,
  TZ_IMPORTACAO,
  consultarProdutosSql,
  dataLocalISO,
  escaparLike,
  exigeSqlProdutos,
  filtrosSolicitadosParaLog,
  normalizarFiltroImportacao,
  normalizarOrdenacaoProduto,
  resolverFlagsProdutos,
} from "./produtos-listagem-sql"

const RAIZ = path.join(__dirname, "..", "..")

/**
 * Fonte SEM comentários. A guarda proíbe o anti-padrão no CÓDIGO; a documentação
 * precisa poder citá-lo pelo nome para explicar por que ele não pode voltar — sem isso
 * a própria guarda acusaria o cabeçalho deste módulo.
 */
const lerFonte = (rel: string) =>
  readFileSync(path.join(RAIZ, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")

/** Fonte crua — usada só quando a guarda precisa ver o texto do template SQL. */
const lerFonteBruta = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8")

describe("guarda de arquitetura — o padrão do 42804 não pode voltar", () => {
  const CAMADA = "lib/cadastros/produtos-listagem-sql.ts"
  const ACTION = "app/actions/cadastros.ts"

  it("a camada de listagem não usa Prisma.join", () => {
    expect(lerFonte(CAMADA)).not.toMatch(/Prisma\.join\s*\(/)
  })

  it("a camada de listagem não aninha fragmentos Prisma.sql / Prisma.raw", () => {
    const fonte = lerFonte(CAMADA)
    expect(fonte).not.toMatch(/Prisma\.sql`/)
    expect(fonte).not.toMatch(/Prisma\.raw\s*\(/)
  })

  it("a camada de listagem não usa $queryRawUnsafe", () => {
    expect(lerFonte(CAMADA)).not.toMatch(/\$queryRawUnsafe/)
  })

  it("a Server Action de cadastros não monta mais WHERE com Prisma.join nem SQL cru", () => {
    const fonte = lerFonte(ACTION)
    expect(fonte).not.toMatch(/Prisma\.join\s*\(/)
    expect(fonte).not.toMatch(/\$queryRawUnsafe/)
  })

  it("a Server Action não tem mais fallback que descarta filtro", () => {
    const fonte = lerFonte(ACTION)
    expect(fonte).not.toMatch(/filtrosImportacaoDescartadosNoFallback/)
    expect(fonte).not.toMatch(/descartados no fallback/)
  })

  it("o count nasce do mesmo WHERE da página (COUNT(*) OVER ())", () => {
    const fonte = lerFonteBruta(CAMADA)
    expect(fonte).toContain('COUNT(*) OVER () AS "__total"')
    // Uma única consulta: não existe segundo $queryRaw de contagem para divergir.
    expect(fonte.match(/\$queryRaw</g)?.length).toBe(2) // listagem + resolverUltimoBatchProdutos
  })

  it("o padrão de SKU sintético vem de sku.ts e viaja como parâmetro, não como literal", () => {
    const fonte = lerFonteBruta(CAMADA)
    expect(fonte).toContain("SKU_SINTETICO_PADROES_POSIX")
    expect(fonte).toMatch(/~\*\s*\$\{f\.skuPadrao/)
    // Nenhuma cópia do padrão escrita à mão dentro do SQL.
    expect(fonte).not.toMatch(/~\*\s*'\^/)
  })

  it("toda condição de filtro é neutralizada por flag booleana parametrizada", () => {
    const fonte = lerFonteBruta(CAMADA)
    const flags = fonte.match(/\$\{f\.\w+\}::boolean = false/g) ?? []
    // 20 filtros gated (status×3, estoque×3, preço, fornecedor, categoria, marca,
    // batchId, fornecedorNome, pendente, revisado, hoje, semBarcode, skuSintetico,
    // semNcm, semCest, busca).
    expect(flags.length).toBeGreaterThanOrEqual(18)
  })

  it("ORDER BY termina com desempate único por id (paginação estável)", () => {
    expect(lerFonteBruta(CAMADA)).toMatch(/p\."updatedAt" DESC,\s*\n\s*p\."id" ASC/)
  })

  it("storeId é a primeira condição do WHERE", () => {
    const fonte = lerFonteBruta(CAMADA)
    const where = fonte.indexOf("WHERE p.\"storeId\" = ${f.storeId}")
    expect(where).toBeGreaterThan(0)
  })
})

describe("whitelist de filtros e ordenação", () => {
  it("aceita os 8 filtros de importação documentados", () => {
    expect([...FILTROS_IMPORTACAO]).toEqual([
      "ultimoLote",
      "hoje",
      "pendenteRevisao",
      "revisado",
      "semBarcode",
      "skuSintetico",
      "semNcm",
      "semCest",
    ])
  })

  it("rejeita filtro de importação desconhecido", () => {
    expect(normalizarFiltroImportacao("semNcm")).toBe("semNcm")
    expect(normalizarFiltroImportacao("dropTable")).toBeNull()
    expect(normalizarFiltroImportacao("")).toBeNull()
    expect(normalizarFiltroImportacao(undefined)).toBeNull()
  })

  it("rejeita coluna de ordenação fora da allowlist", () => {
    for (const c of ORDENACOES_PRODUTOS) expect(normalizarOrdenacaoProduto(c)).toBe(c)
    expect(normalizarOrdenacaoProduto('name"; DROP TABLE x --')).toBeNull()
    expect(normalizarOrdenacaoProduto("price_cost")).toBeNull()
  })

  it("ordenação inválida cai no default updatedAt desc", () => {
    const f = resolverFlagsProdutos({
      storeId: "loja-2",
      page: 1,
      pageSize: 100,
      orderBy: { field: "coluna_inexistente", direction: "asc" },
    })
    expect(f.ordCampo).toBe("updatedAt")
    // Campo inválido = nenhuma ordenação manual ativa; o default do ORDER BY assume.
    expect(f.ordAsc).toBe(false)
    expect(f.ordDesc).toBe(false)
  })
})

describe("exigeSqlProdutos — quando o SQL é obrigatório (proíbe fallback)", () => {
  it("sem filtro de importação e sem busca: SQL não é obrigatório", () => {
    expect(exigeSqlProdutos({ filters: { status: "Ativo", estoque: "com" } })).toBe(false)
  })

  for (const filtro of FILTROS_IMPORTACAO) {
    it(`filtro "${filtro}" exige SQL`, () => {
      expect(exigeSqlProdutos({ filters: { importacao: filtro } })).toBe(true)
    })
  }

  it("batchId e fornecedorNome exigem SQL", () => {
    expect(exigeSqlProdutos({ filters: { batchId: "lote-a" } })).toBe(true)
    expect(exigeSqlProdutos({ filters: { fornecedorNome: "MARTINS" } })).toBe(true)
  })

  it("busca sem ordenação manual exige SQL (ranking de relevância)", () => {
    expect(exigeSqlProdutos({ q: "toddy" })).toBe(true)
  })

  it("busca COM ordenação manual não exige ranking", () => {
    expect(exigeSqlProdutos({ q: "toddy", orderBy: { field: "nome", direction: "asc" } })).toBe(false)
  })

  it("filtro de importação desconhecido não liga o caminho SQL", () => {
    expect(exigeSqlProdutos({ filters: { importacao: "inexistente" } })).toBe(false)
  })
})

describe("resolverFlagsProdutos", () => {
  const base = { storeId: "loja-2", page: 1, pageSize: 100 }

  it("uma flag por filtro, mutuamente exclusivas entre os filtros de importação", () => {
    const f = resolverFlagsProdutos({ ...base, filters: { importacao: "semNcm" } })
    expect(f.semNcm).toBe(true)
    expect(f.semCest).toBe(false)
    expect(f.hoje).toBe(false)
    expect(f.skuSintetico).toBe(false)
  })

  it("batchId resolvido pelo caller vence o batchId cru", () => {
    const f = resolverFlagsProdutos({
      ...base,
      filters: { batchId: "cru" },
      batchIdResolvido: "resolvido",
    })
    expect(f.usarBatchId).toBe(true)
    expect(f.batchId).toBe("resolvido")
  })

  it('categoria/marca "todos" não ligam o filtro', () => {
    const f = resolverFlagsProdutos({ ...base, filters: { categoria: "todos", marca: "todos" } })
    expect(f.usarCategoria).toBe(false)
    expect(f.usarMarca).toBe(false)
  })

  it("pageSize é limitado entre 10 e 200 e o offset acompanha a página", () => {
    expect(resolverFlagsProdutos({ ...base, pageSize: 5 }).limit).toBe(10)
    expect(resolverFlagsProdutos({ ...base, pageSize: 5000 }).limit).toBe(200)
    expect(resolverFlagsProdutos({ ...base, page: 3, pageSize: 100 }).offset).toBe(200)
    expect(resolverFlagsProdutos({ ...base, page: -7, pageSize: 100 }).offset).toBe(0)
  })

  it("storeId em branco é preservado como vazio (a consulta é fail-closed)", () => {
    expect(resolverFlagsProdutos({ ...base, storeId: "   " }).storeId).toBe("")
  })

  it("termos de busca são escapados antes de virar padrão LIKE", () => {
    const f = resolverFlagsProdutos({ ...base, q: "100%" })
    expect(f.termoContains).toBe("%100\\%%")
    expect(f.termoStarts).toBe("100\\%%")
  })
})

describe("escaparLike", () => {
  it("escapa curinga, underscore e barra invertida", () => {
    expect(escaparLike("%")).toBe("\\%")
    expect(escaparLike("_")).toBe("\\_")
    expect(escaparLike("\\")).toBe("\\\\")
    expect(escaparLike("a'b\"c")).toBe("a'b\"c")
  })
})

describe('dataLocalISO — "hoje" é o dia do operador, não o UTC (F-03)', () => {
  it("usa America/Sao_Paulo por padrão", () => {
    expect(TZ_IMPORTACAO).toBe("America/Sao_Paulo")
  })

  it("23:30 UTC de 30/07 ainda é 30/07 em São Paulo (UTC−3)", () => {
    expect(dataLocalISO(new Date("2026-07-30T23:30:00.000Z"))).toBe("2026-07-30")
  })

  it("02:30 UTC de 31/07 é 30/07 em São Paulo — janela que o UTC errava", () => {
    expect(dataLocalISO(new Date("2026-07-31T02:30:00.000Z"))).toBe("2026-07-30")
    // Prova a divergência que o filtro antigo tinha:
    expect(new Date("2026-07-31T02:30:00.000Z").toISOString().slice(0, 10)).toBe("2026-07-31")
  })

  it("formato sempre YYYY-MM-DD", () => {
    expect(dataLocalISO(new Date("2026-01-05T12:00:00.000Z"))).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe("filtrosSolicitadosParaLog — observabilidade sem vazar dados", () => {
  it("registra apenas as CHAVES dos filtros, nunca os valores digitados", () => {
    const chaves = filtrosSolicitadosParaLog({
      storeId: "loja-2",
      page: 1,
      pageSize: 100,
      q: "TODDY SEGREDO",
      filters: {
        importacao: "semNcm",
        batchId: "lote-secreto-123",
        fornecedorNome: "MARTINS COM SERV DISTR SA",
        categoria: "Mercearia",
      },
    })
    expect(chaves).toContain("importacao:semNcm")
    expect(chaves).toContain("batchId")
    expect(chaves).toContain("fornecedorNome")
    expect(chaves).toContain("busca")
    const serializado = JSON.stringify(chaves)
    expect(serializado).not.toContain("lote-secreto-123")
    expect(serializado).not.toContain("TODDY SEGREDO")
    expect(serializado).not.toContain("MARTINS")
  })

  it('filtros em "todos" não entram no log', () => {
    expect(
      filtrosSolicitadosParaLog({
        storeId: "loja-2",
        page: 1,
        pageSize: 100,
        filters: { status: "todos", categoria: "todos" },
      }),
    ).toEqual([])
  })
})

describe("mensagem de erro dos filtros", () => {
  it("é objetiva e diz que nada foi exibido", () => {
    expect(MENSAGEM_ERRO_FILTROS_PRODUTOS).toContain("Não foi possível aplicar os filtros")
  })
})

/**
 * Injeção de falha — o coração do F-02. Antes, a consulta falhava com 42804 e o `catch`
 * devolvia o catálogo inteiro pelo Prisma, com `hoje`/`semNcm`/`semCest` descartados.
 * Aqui a consulta é forçada a falhar e provamos que NADA de produto chega à UI.
 */
describe("falha da consulta: erro explícito, nunca catálogo inteiro", () => {
  let erroLogado: unknown[] = []
  let spyConsole: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    queryRawMock.mockReset()
    erroLogado = []
    spyConsole = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      erroLogado.push(args)
    })
  })
  afterEach(() => spyConsole.mockRestore())

  /** Reproduz o erro real do Postgres, com o SQLSTATE no formato que o Prisma emite. */
  function erro42804(): Error {
    return new Error(
      "Invalid `prisma.$queryRaw()` invocation:\n\nRaw query failed. " +
        "Code: `42804`. Message: `ERROR: argument of WHERE must be type boolean, not type jsonb`",
    )
  }

  it("consulta que falha devolve ok:false — zero produto, zero total", async () => {
    queryRawMock.mockRejectedValueOnce(erro42804())
    const r = await consultarProdutosSql({
      storeId: "loja-2",
      page: 1,
      pageSize: 100,
      filters: { importacao: "semNcm" },
    })
    expect(r.ok).toBe(false)
    // O tipo do resultado não tem `rows` no ramo de erro: é impossível a UI receber linhas.
    expect(r).not.toHaveProperty("rows")
    expect(r).not.toHaveProperty("total")
  })

  it("o erro carrega código estável, SQLSTATE e mensagem para o operador", async () => {
    queryRawMock.mockRejectedValueOnce(erro42804())
    const r = await consultarProdutosSql({
      storeId: "loja-2",
      page: 1,
      pageSize: 100,
      filters: { importacao: "hoje" },
    })
    if (r.ok) throw new Error("esperava falha")
    expect(r.erro.codigo).toBe("FILTROS_PRODUTOS_SQL_FALHOU")
    expect(r.erro.sqlState).toBe("42804")
    expect(r.erro.mensagem).toBe(MENSAGEM_ERRO_FILTROS_PRODUTOS)
    expect(r.erro.filtrosSolicitados).toEqual(["importacao:hoje"])
  })

  it("a consulta NÃO é repetida sem filtro depois da falha (sem fallback)", async () => {
    queryRawMock.mockRejectedValueOnce(erro42804())
    await consultarProdutosSql({
      storeId: "loja-2",
      page: 1,
      pageSize: 100,
      filters: { importacao: "semCest" },
    })
    expect(queryRawMock).toHaveBeenCalledTimes(1)
  })

  it("o log traz SQLSTATE e chaves de filtro, nunca valores digitados nem produto", async () => {
    queryRawMock.mockRejectedValueOnce(erro42804())
    await consultarProdutosSql({
      storeId: "loja-2",
      page: 1,
      pageSize: 100,
      q: "TODDY SEGREDO",
      filters: { batchId: "lote-secreto-123", fornecedorNome: "MARTINS COM SERV DISTR SA" },
    })
    const texto = JSON.stringify(erroLogado)
    expect(texto).toContain("FILTROS_PRODUTOS_SQL_FALHOU")
    expect(texto).toContain("42804")
    expect(texto).toContain("batchId")
    expect(texto).not.toContain("lote-secreto-123")
    expect(texto).not.toContain("TODDY SEGREDO")
    expect(texto).not.toContain("MARTINS")
  })

  it("storeId vazio é fail-closed: zero linha SEM nem tocar o banco", async () => {
    const r = await consultarProdutosSql({ storeId: "  ", page: 1, pageSize: 100 })
    expect(r).toEqual({ ok: true, rows: [], total: 0 })
    expect(queryRawMock).not.toHaveBeenCalled()
  })

  it("sucesso: total vem do COUNT(*) OVER () e a página é mapeada", async () => {
    queryRawMock.mockResolvedValueOnce([
      { id: "p1", name: "A", sku: null, barcode: null, category: "X", brand: "", supplierName: "", stock: 1, price: 2, precoCusto: 1, warrantyDays: 0, active: true, metadata: null, __total: BigInt(137) },
    ])
    const r = await consultarProdutosSql({ storeId: "loja-2", page: 1, pageSize: 100 })
    if (!r.ok) throw new Error("esperava sucesso")
    expect(r.total).toBe(137)
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]!.id).toBe("p1")
  })

  it("página vazia devolve total 0 sem estourar", async () => {
    queryRawMock.mockResolvedValueOnce([])
    const r = await consultarProdutosSql({ storeId: "loja-2", page: 9, pageSize: 100 })
    expect(r).toEqual({ ok: true, rows: [], total: 0 })
  })
})
