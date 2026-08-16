/**
 * Identidade LOCAL de venda (GOAL PDV-VENDAS-SERVER-NUMBERING-RECOVERY-P0-003).
 *
 * O cliente gera `clientSaleId` (opaco, estável entre retries). O número comercial
 * `VDA-…` só existe depois que o servidor aloca. Enquanto isso a UI usa uma
 * referência provisória `PEND-…` que NUNCA casa com `^VDA-`.
 *
 * Este módulo pode usar relógio/aleatoriedade — ao contrário de
 * `sale-identity-contracts.ts`, que é contrato puro.
 */

import {
  isValidClientSaleId,
  looksLikeSaleNumber,
  parseClientSaleId,
} from "@/lib/vendas/sale-identity-contracts"
import { isSaleIdentityConflictCode } from "@/lib/vendas/sale-identity-conflict"

export const PROVISIONAL_SALE_REF_PREFIX = "PEND-"

export type LocalSaleSyncKind = "REMOTE_CONFIRMED" | "LOCAL_PENDING" | "LOCAL_QUARANTINED"

export function assertGeneratedClientSaleId(value: string): string {
  if (!isValidClientSaleId(value)) {
    throw new Error("clientSaleId gerado localmente é inválido.")
  }
  if (looksLikeSaleNumber(value) || isProvisionalSaleRef(value)) {
    throw new Error("clientSaleId local não pode parecer número comercial.")
  }
  return value
}

export function generateClientSaleId(): string {
  const uuid = globalThis.crypto.randomUUID().replace(/-/g, "")
  return assertGeneratedClientSaleId(`cs_${uuid}`)
}

export function buildProvisionalSaleRef(clientSaleId: string): string {
  const parsed = parseClientSaleId(clientSaleId)
  const token = parsed.ok ? parsed.clientSaleId : clientSaleId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 48)
  return `${PROVISIONAL_SALE_REF_PREFIX}${token}`
}

export function isProvisionalSaleRef(raw: unknown): boolean {
  if (typeof raw !== "string") return false
  const value = raw.trim()
  if (!value.startsWith(PROVISIONAL_SALE_REF_PREFIX)) return false
  return !looksLikeSaleNumber(value)
}

export function saleLocalKey(sale: { clientSaleId?: string; id: string }): string {
  const parsed = parseClientSaleId(sale.clientSaleId)
  if (parsed.ok) return parsed.clientSaleId
  return sale.id
}

export function classifyLocalSaleSync(sale: {
  syncPending?: boolean
  syncBlockedCode?: string
}): LocalSaleSyncKind {
  if (isSaleIdentityConflictCode(sale.syncBlockedCode)) return "LOCAL_QUARANTINED"
  if (sale.syncPending === true) return "LOCAL_PENDING"
  return "REMOTE_CONFIRMED"
}

export function displaySaleNumber(saleId: string, pending?: boolean): string {
  if (pending || isProvisionalSaleRef(saleId)) return "PENDENTE — AGUARDANDO NÚMERO"
  return saleId
}
