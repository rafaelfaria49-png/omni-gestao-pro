/** Apenas dígitos (máx. 11 para telefone BR). */
export function phoneDigitsOnly(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 11)
}

/**
 * Máscara dinâmica estilo loja: (XX) XXXXX-XXXX (celular) ou (XX) XXXX-XXXX (fixo).
 */
export function formatPhoneBrInput(raw: string): string {
  const d = phoneDigitsOnly(raw)
  if (d.length === 0) return ""
  if (d.length <= 2) return `(${d}`
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) {
    return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  }
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

export function isValidPhoneBr(raw: string): boolean {
  const n = phoneDigitsOnly(raw).length
  return n >= 10 && n <= 11
}
