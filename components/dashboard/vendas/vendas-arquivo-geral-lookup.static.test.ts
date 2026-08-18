/**
 * GOAL: OMNIGESTAO-PERFORMANCE-VENDAS-POLLING-BOUNDED-003B
 *
 * Arquivo Geral deixa de baixar `/api/ops/vendas-list` só para achar uma venda.
 * Listagem continua em `/api/vendas/historico`; detalhe/troca usam lookup por ID.
 */
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"

const REPO_ROOT = resolve(__dirname, "../../..")

function read(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), "utf8")
}

function between(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex + start.length)
  expect(startIndex, `marcador inicial ausente: ${start}`).toBeGreaterThanOrEqual(0)
  expect(endIndex, `marcador final ausente: ${end}`).toBeGreaterThan(startIndex)
  return source.slice(startIndex, endIndex)
}

describe("OMNIGESTAO-PERFORMANCE-VENDAS-POLLING-BOUNDED-003B — arquivo geral", () => {
  const archive = read("components/dashboard/vendas/vendas-arquivo-geral.tsx")
  const load = between(archive, "const load = useCallback(async () => {", "useEffect(() => { load() }, [load])")
  const openTroca = between(archive, "const openTroca = useCallback(", "const closeTroca = useCallback")
  const openDetalhe = between(archive, "const openDetalhe = useCallback(async (rowKeyOrId: string) => {", "const openCupom = useCallback")
  const exportar = between(archive, "const handleExportar = useCallback(async () => {", "const hasActiveFilters")

  it("A — não chama mais /api/ops/vendas-list para preencher remoteSales", () => {
    expect(archive).not.toContain("/api/ops/vendas-list")
    expect(archive).not.toContain("fetchRemoteSales")
    expect(archive).not.toContain("remoteSales")
    expect(archive).not.toContain("setRemoteSales")
  })

  it("B — a listagem principal continua usando /api/vendas/historico", () => {
    expect(load).toContain("fetch(`/api/vendas/historico?${params}`")
    expect(load).toContain("take: String(PAGE_SIZE)")
    expect(load).toContain("skip: String(page * PAGE_SIZE)")
  })

  it("C — detalhe e troca resolvem venda específica via GET /api/vendas/[id]", () => {
    expect(openDetalhe).toContain("fetch(`/api/vendas/${encodeURIComponent(vendaId)}`")
    expect(openTroca).toContain("fetch(`/api/vendas/${encodeURIComponent(vendaId)}`")
    expect(openTroca).toContain("vendaLookupToSaleRecord")
    expect(archive).toContain("function vendaLookupToSaleRecord")
  })

  it("D — lookup por ID não é N+1 por linha da listagem", () => {
    expect(load).not.toContain("/api/vendas/${")
    expect(openTroca).toContain("opsSales.find((s) => s.id === vendaId)")
    const idFetches = archive.match(/fetch\(`\/api\/vendas\/\$\{encodeURIComponent\(/g) ?? []
    // Detalhe + troca (e rotas de cancelar/corrigir pontuais). Nenhuma iteração da tabela.
    expect(idFetches.length).toBeGreaterThanOrEqual(2)
    expect(archive).not.toMatch(/mergedVendas\.map\([\s\S]{0,400}fetch\(`\/api\/vendas\//)
    expect(archive).not.toMatch(/vendas\.map\([\s\S]{0,400}fetch\(`\/api\/vendas\//)
  })

  it("E — filtros e paginação do historico permanecem no load", () => {
    expect(load).toContain("statusFiltro")
    expect(load).toContain("pagamentoFiltro")
    expect(load).toContain("operadorFiltro")
    expect(load).toContain("terminalFiltro")
    expect(load).toContain("fromDate")
    expect(load).toContain("toDate")
    expect(load).toContain("page * PAGE_SIZE")
    expect(exportar).toContain("/api/vendas/historico")
    expect(exportar).toContain("skip: String(skip)")
  })
})
