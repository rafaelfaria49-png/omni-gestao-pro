/** Importação de comanda/mesa no PDV (sessionStorage, mesma origem). */
export const PDV_IMPORT_COMANDA_KEY = "assistec-pdv-import-comanda"

export type PdvImportComandaLine = {
  inventoryId: string
  name: string
  price: number
  quantity: number
  vendaPorPeso?: boolean
  atributosLabel?: string
}

export type PdvImportComandaPayload = {
  mesaLabel: string
  lines: PdvImportComandaLine[]
}
