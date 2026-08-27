/**
 * Busca textual do histórico de vendas (GET /api/vendas/historico —
 * /dashboard/vendas-arquivo-geral).
 *
 * `q` localiza a venda por:
 *  - cupom (`Venda.pedidoId`) — parcial, case-insensitive;
 *  - cliente (`Venda.clienteNome`) — parcial, case-insensitive;
 *  - item vendido (`ItemVenda.nome`, snapshot gravado na venda) — parcial,
 *    case-insensitive — resolve o caso "cliente perdeu o cupom e só lembra
 *    do produto";
 *  - código do produto (`Produto.sku` / `Produto.barcode` EAN) — correspondência
 *    exata, case-insensitive; os ids resolvidos filtram via
 *    `itens: { some: { inventoryId: { in } } }` (uma query indexada por loja,
 *    sem N+1 e sem carregar histórico no browser).
 *
 * `Produto` não tem coluna canônica de código interno/aliases (apenas `sku`,
 * `barcode` e `metadata Json` não-consultável em SQL) — quando passarem a
 * existir, entram aqui. Extraído como módulo puro para testar a forma do
 * `where` sem banco.
 */
import type { Prisma } from "@/generated/prisma"

/** Cláusulas OR da busca textual. Sempre inclui cupom + cliente + item. */
export function buildHistoricoBuscaOr({
  q,
  productIds,
}: {
  q: string
  productIds: string[]
}): Prisma.VendaWhereInput[] {
  const clausulas: Prisma.VendaWhereInput[] = [
    { pedidoId: { contains: q, mode: "insensitive" } },
    { clienteNome: { contains: q, mode: "insensitive" } },
    { itens: { some: { nome: { contains: q, mode: "insensitive" } } } },
  ]
  if (productIds.length > 0) {
    clausulas.push({ itens: { some: { inventoryId: { in: productIds } } } })
  }
  return clausulas
}

/**
 * Resolução de códigos de produto para a busca — sku e barcode/EAN com
 * correspondência exata (código incompleto não deve casar), sempre presa ao
 * storeId para não vazar produto entre lojas.
 */
export function buildProdutoCodigoWhere({
  storeId,
  q,
}: {
  storeId: string
  q: string
}): Prisma.ProdutoWhereInput {
  return {
    storeId,
    OR: [
      { sku: { equals: q, mode: "insensitive" } },
      { barcode: { equals: q, mode: "insensitive" } },
    ],
  }
}
