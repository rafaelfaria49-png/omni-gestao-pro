/**
 * Apenas o número do proprietário (ex.: Rafael) pode usar IA orquestrada, financeiro e visão.
 * Defina ASSISTEC_WHATSAPP_OWNER_DIGITS (só dígitos, com ou sem 55).
 */

export function normalizeBrPhoneDigits(raw: string): string {
  const d = raw.replace(/\D/g, "")
  if (d.length >= 11 && d.startsWith("55")) {
    return d.slice(-11)
  }
  if (d.length > 11) {
    return d.slice(-11)
  }
  return d
}

export function getOwnerDigitsNormalized(): string | null {
  const v = process.env.ASSISTEC_WHATSAPP_OWNER_DIGITS?.trim()
  if (!v) return null
  const n = normalizeBrPhoneDigits(v)
  return n.length >= 10 ? n : null
}

export function isWhatsAppOwner(fromDigits: string): boolean {
  const owner = getOwnerDigitsNormalized()
  if (!owner) return false
  return normalizeBrPhoneDigits(fromDigits) === owner
}
