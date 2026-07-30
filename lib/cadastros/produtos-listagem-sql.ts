/**
 * Camada ÚNICA de consulta da listagem de produtos (server-side, Node runtime).
 *
 * Existe por causa de um defeito de integração real (F-02 da readiness
 * `CADASTROS_IMPORTACAO_PRODUTOS_REVIEW_HARDENING_READINESS_001`): o caminho
 * anterior montava o `WHERE` com `Prisma.join(condicoes, " AND ")` e interpolava o
 * `Prisma.Sql` resultante dentro de outro template de `$queryRaw`. Depois do bundle
 * do Next.js o `instanceof Prisma.Sql` deixa de valer entre camadas empacotadas, o
 * fragmento é serializado como PARÂMETRO `jsonb` e o Postgres responde
 * `SQLSTATE 42804 — argument of WHERE must be type boolean, not type jsonb`.
 * O `catch` caía num fallback Prisma que descartava filtros, e três deles voltavam
 * o catálogo inteiro como se o filtro tivesse funcionado.
 *
 * Regras desta camada — o que a torna imune ao bundler:
 *  - UMA consulta ESTÁTICA, contígua, com TODAS as condições presentes;
 *  - cada filtro é ligado/desligado por uma FLAG BOOLEANA parametrizada
 *    (`${flag}::boolean = false OR <condicao>`), nunca por concatenação de texto;
 *  - nenhum `Prisma.Sql`/`Prisma.join`/`Prisma.raw` aninhado, nenhum fragmento
 *    atravessando helper ou fronteira de módulo — só valores escalares em `${}`;
 *  - nenhum `$queryRawUnsafe`, nenhuma interpolação de valor do usuário;
 *  - o template é criado NESTE módulo e executado NESTE módulo, com a MESMA
 *    instância de `prisma` — não há fronteira para o bundler quebrar;
 *  - `COUNT(*) OVER ()` na própria consulta: o total e a página compartilham
 *    literalmente o MESMO `WHERE`, então é impossível divergirem;
 *  - ordenação por enum fechado, comparado dentro do SQL (nada de coluna vinda do
 *    cliente) e sempre com desempate final por `p."id"` — sem isso a paginação
 *    repete/omite linhas quando `updatedAt` empata.
 *
 * Fail-closed: se a consulta falhar, esta camada devolve ERRO EXPLÍCITO. Não existe
 * fallback que perca filtro — devolver o catálogo inteiro para um filtro restritivo
 * é pior do que devolver erro, sobretudo num HUB que alimenta emissão fiscal.
 */

import { SKU_SINTETICO_PADROES_POSIX } from "@/lib/cadastros/importacao-produtos/sku"
import { prisma } from "@/lib/prisma"

/** Fuso do operador. "Importados hoje" é o dia LOCAL, não o dia UTC. */
export const TZ_IMPORTACAO = "America/Sao_Paulo"

/** Mensagem única exibida pela UI quando os filtros não puderam ser aplicados. */
export const MENSAGEM_ERRO_FILTROS_PRODUTOS =
  "Não foi possível aplicar os filtros. Nenhum resultado foi exibido para não induzir a decisão errada. Tente novamente."

/** Filtros de importação aceitos. Fora desta lista, o valor é ignorado. */
export const FILTROS_IMPORTACAO = [
  "ultimoLote",
  "hoje",
  "pendenteRevisao",
  "revisado",
  "semBarcode",
  "skuSintetico",
  "semNcm",
  "semCest",
] as const
export type FiltroImportacao = (typeof FILTROS_IMPORTACAO)[number]

/** Colunas ordenáveis. Allowlist fechada — nada vem interpolado do cliente. */
export const ORDENACOES_PRODUTOS = [
  "nome",
  "sku",
  "estoque",
  "preco",
  "status",
  "categoria",
  "updatedAt",
] as const
export type OrdenacaoProduto = (typeof ORDENACOES_PRODUTOS)[number]

export function normalizarFiltroImportacao(valor?: string | null): FiltroImportacao | null {
  const v = (valor ?? "").trim()
  return (FILTROS_IMPORTACAO as readonly string[]).includes(v) ? (v as FiltroImportacao) : null
}

export function normalizarOrdenacaoProduto(campo?: string | null): OrdenacaoProduto | null {
  const v = (campo ?? "").trim()
  return (ORDENACOES_PRODUTOS as readonly string[]).includes(v) ? (v as OrdenacaoProduto) : null
}

/**
 * Data de "hoje" no fuso do operador, em `YYYY-MM-DD`.
 * `new Date().toISOString().slice(0,10)` devolve a data UTC e erra a janela
 * 21:00–00:00 de Brasília — o produto importado hoje sai de "Importados hoje".
 */
export function dataLocalISO(agora: Date = new Date(), timeZone: string = TZ_IMPORTACAO): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(agora)
  const get = (t: string) => partes.find((p) => p.type === t)?.value ?? ""
  return `${get("year")}-${get("month")}-${get("day")}`
}

/** Escapa curingas de LIKE. Sem isto, `%` digitado na busca "casa tudo". */
export function escaparLike(valor: string): string {
  return valor.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

export type ProdutosListagemFiltros = {
  status?: string
  estoque?: string
  preco?: string
  fornecedor?: string
  categoria?: string
  marca?: string
  importacao?: string
  batchId?: string
  fornecedorNome?: string
}

export type ProdutosListagemInput = {
  storeId: string
  q?: string
  page: number
  pageSize: number
  filters?: ProdutosListagemFiltros
  orderBy?: { field: string; direction: "asc" | "desc" }
  /** Injetável para teste determinístico do filtro "hoje". */
  agora?: Date
}

/**
 * Flags e valores já normalizados que vão para os binds da consulta.
 * Puro e exportado para teste — dá para provar a semântica dos filtros sem banco.
 */
export type FlagsProdutosSql = {
  storeId: string
  statusAtivo: boolean
  statusInativo: boolean
  statusIncompleto: boolean
  estoqueCom: boolean
  estoqueSem: boolean
  estoqueBaixo: boolean
  semPreco: boolean
  semFornecedor: boolean
  usarCategoria: boolean
  categoria: string
  usarMarca: boolean
  marca: string
  usarBatchId: boolean
  batchId: string
  usarFornecedorNome: boolean
  fornecedorNome: string
  pendenteRevisao: boolean
  revisado: boolean
  hoje: boolean
  dataHoje: string
  semBarcode: boolean
  skuSintetico: boolean
  semNcm: boolean
  semCest: boolean
  /** Padrões POSIX de SKU sintético — vêm de `sku.ts` e viajam como PARÂMETRO. */
  skuPadraoLinhaN: string
  skuPadraoImpGerado: string
  usarBusca: boolean
  termoStarts: string
  termoWordStarts: string
  termoContains: string
  usarRelevancia: boolean
  ordCampo: OrdenacaoProduto
  ordAsc: boolean
  ordDesc: boolean
  limit: number
  offset: number
}

/**
 * `true` quando a requisição depende de filtro JSONB ou de ranking de relevância.
 * Nesses casos a consulta SQL é OBRIGATÓRIA: não existe equivalente Prisma fiel
 * para `hoje`, `semNcm`, `semCest`, `skuSintetico` nem para a ordenação por
 * relevância, então uma falha aqui NUNCA pode virar fallback.
 */
export function exigeSqlProdutos(input: {
  q?: string
  filters?: ProdutosListagemFiltros
  orderBy?: { field: string; direction: "asc" | "desc" } | null
}): boolean {
  const f = input.filters
  const temImportacao =
    Boolean(normalizarFiltroImportacao(f?.importacao)) ||
    Boolean((f?.batchId ?? "").trim()) ||
    Boolean((f?.fornecedorNome ?? "").trim())
  const usarRelevancia = Boolean((input.q ?? "").trim()) && !input.orderBy
  return temImportacao || usarRelevancia
}

export function resolverFlagsProdutos(
  input: ProdutosListagemInput & { batchIdResolvido?: string | null },
): FlagsProdutosSql {
  const f = input.filters ?? {}
  const importacao = normalizarFiltroImportacao(f.importacao)
  const q = (input.q ?? "").trim()
  const termo = escaparLike(q)
  const ordCampo = normalizarOrdenacaoProduto(input.orderBy?.field)
  const usarRelevancia = Boolean(q) && !input.orderBy
  const pageSize = Math.min(200, Math.max(10, input.pageSize))
  const page = Math.max(1, input.page)

  // "Última importação" já vem resolvida para um batchId exato pelo caller.
  const batchId = (input.batchIdResolvido ?? f.batchId ?? "").trim()
  const categoria = (f.categoria ?? "").trim()
  const marca = (f.marca ?? "").trim()
  const fornecedorNome = (f.fornecedorNome ?? "").trim()

  return {
    storeId: (input.storeId ?? "").trim(),
    statusAtivo: f.status === "Ativo",
    statusInativo: f.status === "Inativo",
    statusIncompleto: f.status === "Incompleto",
    estoqueCom: f.estoque === "com",
    estoqueSem: f.estoque === "sem",
    estoqueBaixo: f.estoque === "baixo",
    semPreco: f.preco === "semPreco",
    semFornecedor: f.fornecedor === "semFornecedor",
    usarCategoria: Boolean(categoria) && categoria !== "todos",
    categoria,
    usarMarca: Boolean(marca) && marca !== "todos",
    marca,
    usarBatchId: Boolean(batchId),
    batchId,
    usarFornecedorNome: Boolean(fornecedorNome),
    fornecedorNome,
    pendenteRevisao: importacao === "pendenteRevisao",
    revisado: importacao === "revisado",
    hoje: importacao === "hoje",
    dataHoje: dataLocalISO(input.agora ?? new Date()),
    semBarcode: importacao === "semBarcode",
    skuSintetico: importacao === "skuSintetico",
    semNcm: importacao === "semNcm",
    semCest: importacao === "semCest",
    skuPadraoLinhaN: SKU_SINTETICO_PADROES_POSIX[0]!,
    skuPadraoImpGerado: SKU_SINTETICO_PADROES_POSIX[1]!,
    usarBusca: Boolean(q),
    termoStarts: `${termo}%`,
    termoWordStarts: `% ${termo}%`,
    termoContains: `%${termo}%`,
    usarRelevancia,
    ordCampo: ordCampo ?? "updatedAt",
    ordAsc: ordCampo != null && input.orderBy?.direction === "asc",
    ordDesc: ordCampo != null && input.orderBy?.direction !== "asc",
    limit: pageSize,
    offset: (page - 1) * pageSize,
  }
}

/** Linha crua devolvida pela consulta. Projeção única — definida só aqui. */
export type ProdutoListagemRow = {
  id: string
  name: string
  sku: string | null
  barcode: string | null
  category: string | null
  brand: string
  supplierName: string
  stock: number | null
  price: number | null
  precoCusto: number | null
  warrantyDays: number | null
  active: boolean
  metadata: unknown
}

export type ErroFiltrosProdutos = {
  codigo: "FILTROS_PRODUTOS_SQL_FALHOU"
  /** Chaves dos filtros pedidos — nunca os valores digitados. */
  filtrosSolicitados: string[]
  sqlState: string | null
  mensagem: string
}

export type ProdutosListagemResultado =
  | { ok: true; rows: ProdutoListagemRow[]; total: number }
  | { ok: false; erro: ErroFiltrosProdutos }

/** Só as CHAVES dos filtros pedidos — o log não recebe valor digitado nem metadata. */
export function filtrosSolicitadosParaLog(input: ProdutosListagemInput): string[] {
  const f = input.filters ?? {}
  const out: string[] = []
  if (f.status && f.status !== "todos") out.push("status")
  if (f.estoque && f.estoque !== "todos") out.push("estoque")
  if (f.preco && f.preco !== "todos") out.push("preco")
  if (f.fornecedor && f.fornecedor !== "todos") out.push("fornecedor")
  if (f.categoria && f.categoria !== "todos") out.push("categoria")
  if (f.marca && f.marca !== "todos") out.push("marca")
  const imp = normalizarFiltroImportacao(f.importacao)
  if (imp) out.push(`importacao:${imp}`)
  if ((f.batchId ?? "").trim()) out.push("batchId")
  if ((f.fornecedorNome ?? "").trim()) out.push("fornecedorNome")
  if ((input.q ?? "").trim()) out.push("busca")
  return out
}

function sqlStateDoErro(e: unknown): string | null {
  const meta = (e as { meta?: { code?: unknown } } | null)?.meta
  if (meta && typeof meta.code === "string") return meta.code
  const code = (e as { code?: unknown } | null)?.code
  if (typeof code === "string") return code
  const msg = e instanceof Error ? e.message : String(e)
  const m = /Code:\s*`?([0-9A-Z]{5})`?/.exec(msg)
  return m?.[1] ?? null
}

/**
 * `batchId` do lote de produtos mais recente da loja — base de "Última importação".
 * Consulta contígua (nenhum fragmento aninhado). `null` quando a loja nunca importou.
 * Erro aqui é propagado: sem o lote resolvido o filtro não pode ser aplicado.
 */
export async function resolverUltimoBatchProdutos(storeId: string): Promise<string | null> {
  const sid = (storeId ?? "").trim()
  if (!sid) return null
  const rows = await prisma.$queryRaw<Array<{ batchId: string | null }>>`
    SELECT p."metadata" #>> '{importacao,ultimoLote,batchId}' AS "batchId"
    FROM "estoque_produtos" p
    WHERE p."storeId" = ${sid}
      AND p."metadata" #>> '{importacao,ultimoLote,batchId}' IS NOT NULL
    ORDER BY p."metadata" #>> '{importacao,ultimoLote,importadoEm}' DESC
    LIMIT 1
  `
  return rows[0]?.batchId ?? null
}

/**
 * Consulta paginada + total, numa única query estática.
 *
 * Toda condição está sempre presente e é neutralizada por uma flag booleana
 * parametrizada. `COUNT(*) OVER ()` garante que o total e a página nascem do mesmo
 * `WHERE`. `CASE` (não `AND`) protege o cast de `importadoEm`: o Postgres garante a
 * ordem de avaliação do `CASE`, então metadata com lixo não derruba a consulta.
 */
export async function consultarProdutosSql(
  input: ProdutosListagemInput & { batchIdResolvido?: string | null },
): Promise<ProdutosListagemResultado> {
  const f = resolverFlagsProdutos(input)

  // `storeId` vazio é fail-closed: nunca "todas as lojas".
  if (!f.storeId) return { ok: true, rows: [], total: 0 }

  try {
    const rows = await prisma.$queryRaw<Array<ProdutoListagemRow & { __total: bigint | number }>>`
      SELECT p."id", p."name", p."sku", p."barcode", p."category", p."brand",
             p."supplierName", p."stock", p."price", p."price_cost" AS "precoCusto",
             p."warrantyDays", p."active", p."metadata",
             COUNT(*) OVER () AS "__total"
      FROM "estoque_produtos" p
      WHERE p."storeId" = ${f.storeId}
        AND (${f.statusAtivo}::boolean = false
             OR (p."active" = true AND p."name" <> '' AND p."price" > 0 AND p."category" IS NOT NULL))
        AND (${f.statusInativo}::boolean = false
             OR (p."active" = false AND p."name" <> '' AND p."price" > 0 AND p."category" IS NOT NULL))
        AND (${f.statusIncompleto}::boolean = false
             OR (p."name" = '' OR p."category" = '' OR p."category" IS NULL OR p."price" <= 0))
        AND (${f.estoqueCom}::boolean = false OR p."stock" > 0)
        AND (${f.estoqueSem}::boolean = false OR p."stock" <= 0)
        AND (${f.estoqueBaixo}::boolean = false OR (p."stock" > 0 AND p."stock" < 6))
        AND (${f.semPreco}::boolean = false OR p."price" <= 0)
        AND (${f.semFornecedor}::boolean = false OR p."supplierName" = '')
        AND (${f.usarCategoria}::boolean = false OR p."category" = ${f.categoria})
        AND (${f.usarMarca}::boolean = false OR p."brand" = ${f.marca})
        AND (${f.usarBatchId}::boolean = false
             OR p."metadata" #>> '{importacao,ultimoLote,batchId}' = ${f.batchId})
        AND (${f.usarFornecedorNome}::boolean = false
             OR lower(p."supplierName") = lower(${f.fornecedorNome}))
        AND (${f.pendenteRevisao}::boolean = false
             OR p."metadata" #>> '{importacao,ultimoLote,statusRevisao}' = 'pendente')
        AND (${f.revisado}::boolean = false
             OR p."metadata" #>> '{importacao,ultimoLote,statusRevisao}' = 'revisado')
        AND (${f.hoje}::boolean = false
             OR (CASE
                   WHEN (p."metadata" #>> '{importacao,ultimoLote,importadoEm}') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}'
                     THEN (((p."metadata" #>> '{importacao,ultimoLote,importadoEm}')::timestamptz)
                            AT TIME ZONE ${TZ_IMPORTACAO})::date
                   WHEN (p."metadata" #>> '{importacao,ultimoLote,importadoEm}') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                     THEN (p."metadata" #>> '{importacao,ultimoLote,importadoEm}')::date
                   ELSE NULL
                 END) = ${f.dataHoje}::date)
        AND (${f.semBarcode}::boolean = false OR (p."barcode" IS NULL OR p."barcode" = ''))
        AND (${f.skuSintetico}::boolean = false
             OR btrim(p."sku") ~* ${f.skuPadraoLinhaN}
             OR btrim(p."sku") ~* ${f.skuPadraoImpGerado})
        AND (${f.semNcm}::boolean = false
             OR COALESCE(NULLIF(p."metadata" #>> '{fiscal,ncm}', ''),
                         NULLIF(p."metadata" #>> '{ncm}', '')) IS NULL)
        AND (${f.semCest}::boolean = false
             OR COALESCE(NULLIF(p."metadata" #>> '{fiscal,cest}', ''),
                         NULLIF(p."metadata" #>> '{cest}', '')) IS NULL)
        AND (${f.usarBusca}::boolean = false
             OR p."name" ILIKE ${f.termoContains}
             OR p."sku" ILIKE ${f.termoContains}
             OR p."barcode" ILIKE ${f.termoContains}
             OR p."category" ILIKE ${f.termoContains}
             OR p."brand" ILIKE ${f.termoContains}
             OR p."supplierName" ILIKE ${f.termoContains})
      ORDER BY
        CASE WHEN ${f.usarRelevancia}::boolean THEN
          CASE
            WHEN p."name" ILIKE ${f.termoStarts} THEN 0
            WHEN p."name" ILIKE ${f.termoWordStarts} THEN 1
            WHEN p."name" ILIKE ${f.termoContains} THEN 2
            WHEN p."sku" ILIKE ${f.termoStarts} THEN 3
            WHEN p."sku" ILIKE ${f.termoContains} THEN 4
            WHEN p."barcode" ILIKE ${f.termoContains} THEN 5
            WHEN p."brand" ILIKE ${f.termoContains} THEN 6
            WHEN p."category" ILIKE ${f.termoContains} THEN 7
            ELSE 8
          END
        ELSE 0 END ASC,
        CASE WHEN ${f.usarRelevancia}::boolean THEN p."name" END ASC,
        CASE WHEN ${f.ordAsc}::boolean  AND ${f.ordCampo}::text = 'nome'      THEN p."name"      END ASC,
        CASE WHEN ${f.ordDesc}::boolean AND ${f.ordCampo}::text = 'nome'      THEN p."name"      END DESC,
        CASE WHEN ${f.ordAsc}::boolean  AND ${f.ordCampo}::text = 'sku'       THEN p."sku"       END ASC,
        CASE WHEN ${f.ordDesc}::boolean AND ${f.ordCampo}::text = 'sku'       THEN p."sku"       END DESC,
        CASE WHEN ${f.ordAsc}::boolean  AND ${f.ordCampo}::text = 'categoria' THEN p."category"  END ASC,
        CASE WHEN ${f.ordDesc}::boolean AND ${f.ordCampo}::text = 'categoria' THEN p."category"  END DESC,
        CASE WHEN ${f.ordAsc}::boolean  AND ${f.ordCampo}::text = 'estoque'   THEN p."stock"     END ASC,
        CASE WHEN ${f.ordDesc}::boolean AND ${f.ordCampo}::text = 'estoque'   THEN p."stock"     END DESC,
        CASE WHEN ${f.ordAsc}::boolean  AND ${f.ordCampo}::text = 'preco'     THEN p."price"     END ASC,
        CASE WHEN ${f.ordDesc}::boolean AND ${f.ordCampo}::text = 'preco'     THEN p."price"     END DESC,
        CASE WHEN ${f.ordAsc}::boolean  AND ${f.ordCampo}::text = 'status'    THEN p."active"    END ASC,
        CASE WHEN ${f.ordDesc}::boolean AND ${f.ordCampo}::text = 'status'    THEN p."active"    END DESC,
        CASE WHEN ${f.ordAsc}::boolean  AND ${f.ordCampo}::text = 'updatedAt' THEN p."updatedAt" END ASC,
        CASE WHEN ${f.ordDesc}::boolean AND ${f.ordCampo}::text = 'updatedAt' THEN p."updatedAt" END DESC,
        p."updatedAt" DESC,
        p."id" ASC
      LIMIT ${f.limit} OFFSET ${f.offset}
    `

    const total = rows.length > 0 ? Number(rows[0]!.__total) : 0
    return {
      ok: true,
      total,
      rows: rows.map((r) => ({
        id: r.id,
        name: r.name,
        sku: r.sku,
        barcode: r.barcode,
        category: r.category,
        brand: r.brand,
        supplierName: r.supplierName,
        stock: r.stock,
        price: r.price,
        precoCusto: r.precoCusto,
        warrantyDays: r.warrantyDays,
        active: r.active,
        metadata: r.metadata,
      })),
    }
  } catch (e) {
    const sqlState = sqlStateDoErro(e)
    const filtrosSolicitados = filtrosSolicitadosParaLog(input)
    // Código estável + filtro solicitado + SQLSTATE. Sem valores digitados,
    // sem metadata e sem dados de produto no log.
    console.error(
      "[cadastros:produtos-listagem-sql] FILTROS_PRODUTOS_SQL_FALHOU",
      JSON.stringify({ filtrosSolicitados, sqlState }),
    )
    return {
      ok: false,
      erro: {
        codigo: "FILTROS_PRODUTOS_SQL_FALHOU",
        filtrosSolicitados,
        sqlState,
        mensagem: MENSAGEM_ERRO_FILTROS_PRODUTOS,
      },
    }
  }
}
