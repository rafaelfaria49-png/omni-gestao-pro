/**
 * Indexação dos candidatos do lote (pura).
 *
 * O persistidor faz as consultas Prisma escopadas por `storeId` e entrega as linhas
 * cruas aqui; toda a decisão de "quem casa com quem" acontece sem I/O, o que permite
 * testar a política de matching com um banco simulado.
 */

import { chaveNomeProduto, chaveSku } from "./sku"
import type { ContextoMatchProduto, ProdutoCandidato, ProdutoImportLinha } from "./types"

/** Candidato + o `metadata` cru, de onde sai o código do fornecedor. */
export type ProdutoCandidatoRow = ProdutoCandidato & { metadata?: unknown }

export type IndiceCandidatos = {
  porBarcode: Map<string, ProdutoCandidatoRow>
  porSku: Map<string, ProdutoCandidatoRow>
  porNome: Map<string, ProdutoCandidatoRow[]>
  porFornecedor: Map<string, ProdutoCandidatoRow[]>
  categorias: string[]
}

/** Código do fornecedor gravado em `metadata.fornecedor.codigo` (não existe coluna). */
export function codigoFornecedorDoProduto(metadata: unknown): string {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return ""
  const forn = (metadata as Record<string, unknown>).fornecedor
  if (!forn || typeof forn !== "object" || Array.isArray(forn)) return ""
  return String((forn as Record<string, unknown>).codigo ?? "").trim()
}

export function indexarCandidatos(
  rows: ReadonlyArray<ProdutoCandidatoRow>,
  categorias: ReadonlyArray<string> = [],
): IndiceCandidatos {
  const porBarcode = new Map<string, ProdutoCandidatoRow>()
  const porSku = new Map<string, ProdutoCandidatoRow>()
  const porNome = new Map<string, ProdutoCandidatoRow[]>()
  const porFornecedor = new Map<string, ProdutoCandidatoRow[]>()

  for (const r of rows) {
    const barcode = String(r.barcode ?? "").replace(/\D/g, "")
    if (barcode && !porBarcode.has(barcode)) porBarcode.set(barcode, r)

    const kSku = chaveSku(r.sku)
    if (kSku && !porSku.has(kSku)) porSku.set(kSku, r)

    const kNome = chaveNomeProduto(r.name)
    if (kNome) {
      const lista = porNome.get(kNome)
      if (lista) lista.push(r)
      else porNome.set(kNome, [r])
    }

    const kForn = chaveNomeProduto(r.supplierName)
    if (kForn) {
      const lista = porFornecedor.get(kForn)
      if (lista) lista.push(r)
      else porFornecedor.set(kForn, [r])
    }
  }

  return { porBarcode, porSku, porNome, porFornecedor, categorias: [...categorias] }
}

/**
 * Monta o contexto de match de UMA linha.
 * `consumidos` impede que duas linhas do mesmo arquivo caiam no mesmo produto.
 */
export function contextoDeMatch(
  linha: ProdutoImportLinha,
  indice: IndiceCandidatos,
  consumidos: ReadonlySet<string> = new Set(),
): ContextoMatchProduto {
  const porBarcode = linha.barcode ? (indice.porBarcode.get(linha.barcode) ?? null) : null
  const porSku = linha.sku ? (indice.porSku.get(chaveSku(linha.sku)) ?? null) : null
  const porNomeExato = (indice.porNome.get(chaveNomeProduto(linha.nome)) ?? []).filter(
    (c) => !consumidos.has(c.id),
  )
  const porCodigoFornecedor = linha.codigoFornecedor
    ? (indice.porFornecedor.get(chaveNomeProduto(linha.fornecedorNome)) ?? []).filter(
        (c) => codigoFornecedorDoProduto(c.metadata) === linha.codigoFornecedor,
      )
    : []

  return { porBarcode, porSku, porCodigoFornecedor, porNomeExato }
}

/** Resolve o candidato escolhido pelo plano dentro do contexto usado. */
export function candidatoDoPlano(
  ctx: ContextoMatchProduto,
  produtoId: string | null,
): ProdutoCandidatoRow | null {
  if (!produtoId) return null
  const todos = [ctx.porBarcode, ctx.porSku, ...ctx.porCodigoFornecedor, ...ctx.porNomeExato]
  return (todos.find((c) => c?.id === produtoId) as ProdutoCandidatoRow | undefined) ?? null
}
