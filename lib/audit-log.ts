/**
 * Trilha de auditoria: cópia local (localStorage) + sincronização com API `/api/audit/log` (SQLite).
 */

import { syncAuditEntryToServer } from "@/lib/audit-sync"

const STORAGE_KEY = "assistec-audit-v1"
const MAX_ENTRIES = 500

export type AuditAction =
  | "os_created"
  | "sale_finalized"
  | "stock_manual"
  | "sangria_caixa"
  | "caixa_aberto"
  | "desconto_elevado"
  | "os_status_alterado"
  | "registro_excluido"
  | "devolucao_vale"
  | "quebra_caixa"

export interface AuditEntry {
  id: string
  at: string
  action: AuditAction
  userLabel: string
  detail: string
}

function loadRaw(): AuditEntry[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as AuditEntry[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveRaw(entries: AuditEntry[]) {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)))
  } catch {
    /* ignore quota */
  }
}

export function getAuditLogs(): AuditEntry[] {
  return loadRaw().sort((a, b) => b.at.localeCompare(a.at))
}

export function appendAuditLog(entry: Omit<AuditEntry, "id" | "at"> & { at?: string }): void {
  const row: AuditEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    at: entry.at ?? new Date().toISOString(),
    action: entry.action,
    userLabel: entry.userLabel,
    detail: entry.detail,
  }
  const next = [...loadRaw(), row]
  saveRaw(next)
  void syncAuditEntryToServer({
    action: row.action,
    userLabel: row.userLabel,
    detail: row.detail,
  })
}

export function clearAuditLogs(): void {
  if (typeof window === "undefined") return
  localStorage.removeItem(STORAGE_KEY)
}
