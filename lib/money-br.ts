/**
 * Máscara BRL no input (centavos como dígitos) e conversão para número (Float) para o Postgres.
 * Ex.: dígitos "12345" → exibição "R$ 123,45" → float 123.45
 */

export function digitsToMoneyBrString(digits: string): string {
  const d = digits.replace(/\D/g, "").slice(0, 14)
  if (!d) return ""
  const cents = parseInt(d, 10)
  if (!Number.isFinite(cents)) return ""
  const value = cents / 100
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

/** Interpreta string mascarada ou dígitos e retorna o valor em reais (número). */
export function parseMoneyBrToNumber(raw: string): number {
  const d = raw.replace(/\D/g, "")
  if (!d) return 0
  const cents = parseInt(d, 10)
  if (!Number.isFinite(cents)) return 0
  return cents / 100
}

export function formatFloatToMoneyBr(value: number): string {
  if (!Number.isFinite(value)) return ""
  const cents = Math.round(value * 100)
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}
