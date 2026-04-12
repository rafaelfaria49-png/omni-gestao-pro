/** Envia evento de auditoria ao SQLite via API (assinatura ativa). */

export async function syncAuditEntryToServer(payload: {
  action: string
  userLabel: string
  detail: string
  metadata?: unknown
}): Promise<void> {
  try {
    await fetch("/api/audit/log", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
  } catch {
    /* offline ou sessão expirada */
  }
}
