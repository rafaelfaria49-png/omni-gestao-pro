/**
 * Formatação puramente visual do DANFC-e a partir de valores já persistidos.
 * Não recalcula tributo, QR ou totais.
 */

const TPAG_LABEL: Record<string, string> = {
  "01": "Dinheiro",
  "02": "Cheque",
  "03": "Cartão de Crédito",
  "04": "Cartão de Débito",
  "05": "Crédito Loja",
  "10": "Vale Alimentação",
  "11": "Vale Refeição",
  "12": "Vale Presente",
  "13": "Vale Combustível",
  "15": "Boleto Bancário",
  "16": "Depósito Bancário",
  "17": "PIX",
  "18": "Transferência bancária",
  "19": "Programa de fidelidade",
  "90": "Sem pagamento",
  "99": "Outros",
}

export function labelTPag(tPag: string): string {
  const key = String(tPag ?? "").trim().padStart(2, "0")
  return TPAG_LABEL[key] ?? `Forma ${key}`
}

export function formatChaveAcesso(chave: string): string {
  const digits = String(chave ?? "").replace(/\s+/g, "")
  return digits.replace(/(.{4})/g, "$1 ").trim()
}

export function formatCnpj(cnpj: string): string {
  const d = String(cnpj ?? "").replace(/\D+/g, "")
  if (d.length !== 14) return String(cnpj ?? "")
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
}

export function formatCpf(cpf: string): string {
  const d = String(cpf ?? "").replace(/\D+/g, "")
  if (d.length !== 11) return String(cpf ?? "")
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
}

export function formatMoedaXml(value: string | null | undefined): string {
  const raw = String(value ?? "").trim()
  if (!raw) return "R$ 0,00"
  const n = Number(raw)
  if (!Number.isFinite(n)) return `R$ ${raw.replace(".", ",")}`
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n)
}

export function formatDhEmi(dhEmi: string): string {
  const raw = String(dhEmi ?? "").trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(raw)
  if (!match) return raw
  return `${match[3]}/${match[2]}/${match[1]} ${match[4]}:${match[5]}:${match[6]}`
}

export function formatQuantidade(qCom: string): string {
  const raw = String(qCom ?? "").trim()
  if (!raw) return "0"
  const n = Number(raw)
  if (!Number.isFinite(n)) return raw
  return Number.isInteger(n) ? String(n) : raw.replace(/0+$/, "").replace(/\.$/, "")
}
