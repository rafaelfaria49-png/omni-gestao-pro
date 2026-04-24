const STORAGE_KEY = "assistec-pdv-operator-id-v1"

function randomId(): string {
  try {
    // browsers modernos
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = (globalThis as any)?.crypto
    if (c?.randomUUID) return String(c.randomUUID())
  } catch {
    /* ignore */
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function getOrCreatePdvOperatorId(): string {
  try {
    const raw = String(localStorage.getItem(STORAGE_KEY) || "").trim()
    if (raw) return raw
    const next = randomId()
    localStorage.setItem(STORAGE_KEY, next)
    return next
  } catch {
    return randomId()
  }
}

