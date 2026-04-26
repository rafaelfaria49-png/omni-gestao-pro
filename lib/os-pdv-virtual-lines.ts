/** Linhas de venda ligadas à O.S. sem SKU de estoque (serviço / peças avulsas). */

export const OS_SERVICO_PREFIX = "__os_servico__"
export const OS_PECAS_PREFIX = "__os_pecas__"

export function isOsVirtualSaleLine(inventoryId: string): boolean {
  return (
    typeof inventoryId === "string" &&
    (inventoryId.startsWith(OS_SERVICO_PREFIX) || inventoryId.startsWith(OS_PECAS_PREFIX))
  )
}

export function osServicoInventoryId(osId: string): string {
  return `${OS_SERVICO_PREFIX}${osId}`
}

export function osPecasInventoryId(osId: string): string {
  return `${OS_PECAS_PREFIX}${osId}`
}
