/** Armazenamento local de títulos a receber (por loja). */
export function contasReceberStorageKey(lojaId: string): string {
  return `assistec-pro-contas-receber-v2-${lojaId}`
}

export function contasReceberLegacyImportKey(lojaId: string): string {
  return `assistec-pro-contas-receber-import-v1-${lojaId}`
}
