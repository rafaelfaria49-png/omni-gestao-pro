/** Nome para comparação/dedupe (lowercase, sem acento, espaços colapsados). */
export function normalizeNameForMatch(s: string): string {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
}

export function digitsOnly(s: unknown): string {
  return String(s ?? "").replace(/\D/g, "")
}

/** CPF (11) ou CNPJ (14) — retorna null se não houver documento válido para dedupe. */
export function docDigitsForDedupe(raw: unknown): string | null {
  const d = digitsOnly(raw)
  if (d.length === 11 || d.length === 14) return d
  return null
}

/** Exibição de CPF/CNPJ a partir dos dígitos armazenados. */
export function formatCpfCnpjFromDigits(d: string | null | undefined): string {
  if (!d) return "—"
  const only = String(d).replace(/\D/g, "")
  if (only.length === 11) return only.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4")
  if (only.length === 14) return only.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5")
  return d
}
