import { LEGACY_PRIMARY_STORE_ID } from "@/lib/store-defaults"

/**
 * Chave de loja (na UI/API costuma ir no header `x-assistec-loja-id`; no banco → coluna `storeId` em `clientes_importados`).
 */
export const LOJA_CLIENTES_PADRAO_DB = LEGACY_PRIMARY_STORE_ID

/** Id efetivo para consulta: loja ativa na UI ou padrão do banco. */
export function resolveLojaIdParaConsultaClientes(lojaAtivaId: string | null | undefined): string {
  const s = lojaAtivaId?.trim()
  return s || LOJA_CLIENTES_PADRAO_DB
}

/**
 * Ordem de tentativa nas leituras: **apenas** o storeId solicitado.
 * Em modo Multi-Lojas, clientes devem ficar isolados por unidade (sem fallback).
 */
export function lojaIdsParaConsultaEmCadeia(lojaSolicitada: string): string[] {
  const t = lojaSolicitada.trim()
  return t ? [t] : [LOJA_CLIENTES_PADRAO_DB]
}
