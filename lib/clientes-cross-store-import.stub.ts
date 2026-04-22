/**
 * Reservado para importação **explícita** e auditada de clientes entre unidades (opt-in).
 * Por padrão, cada `storeId` permanece isolado; não há cópia automática entre lojas.
 *
 * Futuro (exemplo): `POST /api/stores/import-clientes` com `{ fromStoreId, toStoreId, mode }`.
 */
export type ClientesCrossStoreImportMode = "merge" | "skip_duplicates"

export type ClientesCrossStoreImportPayload = {
  fromStoreId: string
  toStoreId: string
  mode: ClientesCrossStoreImportMode
}

/** Quando existir endpoint dedicado, passar a `true` na UI/feature flag. */
export const CLIENTES_CROSS_STORE_IMPORT_UI_ENABLED = false
