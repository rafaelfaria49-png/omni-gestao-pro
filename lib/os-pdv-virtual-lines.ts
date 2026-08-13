/**
 * Linhas de venda PDV sem SKU de estoque real.
 *
 * Hoje cobrimos 3 famílias:
 *  - O.S. (`__os_servico__` / `__os_pecas__`): faturamento da Ordem de Serviço
 *    pelo PDV sem produto no catálogo.
 *  - Item Avulso (`__avulso__`): venda balcão rápida (INSERT) de um item não
 *    cadastrado — descrição/preço/qtd informados na hora.
 *  - Serviço (`__servico__`): serviço real do cadastro vendido diretamente
 *    pelo PDV, sem baixa de produto/estoque e sem ser classificado como avulso.
 *
 * Todas elas **não** tocam estoque (`MovimentacaoEstoque`), não exigem produto
 * resolvido em `Produto`, e preservam o `inventoryId` virtual em `ItemVenda`.
 * A baixa de estoque (Step 3 do `upsertVendaInTransaction`) e a checagem de
 * saldo em `finalizeSaleTransaction` consultam `isVirtualSaleLine` e pulam.
 */

export const OS_SERVICO_PREFIX = "__os_servico__"
export const OS_PECAS_PREFIX = "__os_pecas__"
export const AVULSO_PREFIX = "__avulso__"
export const SERVICO_PREFIX = "__servico__"
/** Prefixo usado brevemente pelo PDV Assistência antes da classificação explícita. */
export const LEGACY_SERVICO_AVULSO_PREFIX = `${AVULSO_PREFIX}svc-`

export function isOsVirtualSaleLine(inventoryId: string | null | undefined): boolean {
  return (
    typeof inventoryId === "string" &&
    (inventoryId.startsWith(OS_SERVICO_PREFIX) || inventoryId.startsWith(OS_PECAS_PREFIX))
  )
}

export function isAvulsoSaleLine(inventoryId: string | null | undefined): boolean {
  return (
    typeof inventoryId === "string" &&
    inventoryId.startsWith(AVULSO_PREFIX) &&
    !inventoryId.startsWith(LEGACY_SERVICO_AVULSO_PREFIX)
  )
}

/** Serviço real vendido sem O.S.; inclui a leitura compatível do prefixo legado. */
export function isServicoSaleLine(inventoryId: string | null | undefined): boolean {
  return (
    typeof inventoryId === "string" &&
    (inventoryId.startsWith(SERVICO_PREFIX) || inventoryId.startsWith(LEGACY_SERVICO_AVULSO_PREFIX))
  )
}

/**
 * Predicate unificado: qualquer linha que NÃO deve tocar estoque/Produto.
 * Use este em todos os pontos que decidem "pular ledger" (upsert venda, finalize,
 * devolução, cancelamento). `isOsVirtualSaleLine` permanece exportado por
 * compatibilidade quando o caller precisa diferenciar O.S., serviço e avulso.
 */
export function isVirtualSaleLine(inventoryId: string | null | undefined): boolean {
  return isOsVirtualSaleLine(inventoryId) || isAvulsoSaleLine(inventoryId) || isServicoSaleLine(inventoryId)
}

export function osServicoInventoryId(osId: string): string {
  return `${OS_SERVICO_PREFIX}${osId}`
}

export function osPecasInventoryId(osId: string): string {
  return `${OS_PECAS_PREFIX}${osId}`
}

export function servicoInventoryId(serviceId: string): string {
  return `${SERVICO_PREFIX}${serviceId.trim()}`
}

/** Recupera a identidade do Serviço tanto do formato atual quanto do legado. */
export function serviceIdFromVirtualInventoryId(inventoryId: string | null | undefined): string | null {
  if (typeof inventoryId !== "string") return null
  if (inventoryId.startsWith(SERVICO_PREFIX)) return inventoryId.slice(SERVICO_PREFIX.length) || null
  if (inventoryId.startsWith(LEGACY_SERVICO_AVULSO_PREFIX)) {
    return inventoryId.slice(LEGACY_SERVICO_AVULSO_PREFIX.length) || null
  }
  return null
}

/**
 * Gera um inventoryId único para um Item Avulso. O `localId` (opcional) permite
 * estabilidade entre re-renders (use o `lineId` do carrinho). Sem `localId`,
 * usa timestamp + random — adequado para o ato de adicionar ao carrinho.
 */
export function avulsoInventoryId(localId?: string): string {
  const stable = typeof localId === "string" && localId.trim() ? localId.trim() : null
  const id = stable ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return `${AVULSO_PREFIX}${id}`
}
