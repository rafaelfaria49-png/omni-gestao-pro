import { createHash } from "node:crypto"
import { sanitizeSaleLinesPayload } from "@/lib/vendas/sanitize-sale-line-payload"

export const LEGACY_SALE_FINGERPRINT_VERSION = "legacy-sale-facts-v1" as const

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {}
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ")
  return normalized || null
}

function normalizeDocument(value: unknown): string | null {
  if (typeof value !== "string") return null
  const digits = value.replace(/\D/g, "")
  return digits || null
}

function normalizeNumber(value: unknown, precision = 6): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0
  const factor = 10 ** precision
  return Math.round(value * factor) / factor
}

function normalizeMoney(value: unknown): number {
  return normalizeNumber(value, 2)
}

function normalizeOptionalMoney(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  const normalized = normalizeMoney(value)
  return normalized === 0 ? null : normalized
}

function normalizeQuantity(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(2_000_000_000, Math.round(value)))
}

function normalizeInstant(value: unknown): string | null {
  if (!(typeof value === "string" || value instanceof Date)) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function normalizeDateBr(value: unknown): string | null {
  const text = normalizeText(value)
  if (!text) return null
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text)
  if (!match) return text
  const [, day, month, year] = match
  return `${day.padStart(2, "0")}/${month.padStart(2, "0")}/${year}`
}

function stableJsonValue(value: unknown): unknown {
  if (value === null) return null
  if (Array.isArray(value)) return value.map(stableJsonValue)
  if (typeof value === "number") return normalizeNumber(value)
  if (typeof value === "string" || typeof value === "boolean") return value
  if (typeof value !== "object") return null

  const record = value as JsonRecord
  const normalized: JsonRecord = {}
  for (const key of Object.keys(record).sort()) {
    const item = record[key]
    if (item !== undefined) normalized[key] = stableJsonValue(item)
  }
  return normalized
}

function normalizeLines(value: unknown): unknown[] {
  const { lines } = sanitizeSaleLinesPayload(value)
  return lines
    .map((line) => {
      const quantity = normalizeQuantity(line.quantity)
      const unitPrice = normalizeMoney(line.unitPrice)
      const explicitLineTotal =
        typeof line.lineTotal === "number" && Number.isFinite(line.lineTotal)
          ? line.lineTotal
          : unitPrice * quantity

      return {
        inventoryId: normalizeText(line.inventoryId),
        name: normalizeText(line.name),
        quantity,
        unitPrice,
        lineTotal: normalizeMoney(explicitLineTotal),
        isAvulso: line.isAvulso === true,
        custoUnitario:
          typeof line.custoUnitario === "number" &&
          Number.isFinite(line.custoUnitario) &&
          line.custoUnitario >= 0
            ? normalizeMoney(line.custoUnitario)
            : null,
        accessorySelection: stableJsonValue(line.accessorySelection ?? null),
      }
    })
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
}

function normalizePayments(value: unknown) {
  const payment = asRecord(value)
  const legacyCard = normalizeMoney(payment.cartao)
  return {
    dinheiro: normalizeMoney(payment.dinheiro),
    pix: normalizeMoney(payment.pix),
    cartaoDebito:
      typeof payment.cartaoDebito === "number"
        ? normalizeMoney(payment.cartaoDebito)
        : legacyCard,
    cartaoCredito: normalizeMoney(payment.cartaoCredito),
    carne: normalizeMoney(payment.carne),
    aPrazo: normalizeMoney(payment.aPrazo),
    creditoVale: normalizeMoney(payment.creditoVale),
  }
}

function normalizeInstallmentConfig(value: unknown, hasAPrazo: boolean) {
  const config = asRecord(value)
  if (!hasAPrazo && Object.keys(config).length === 0) return null

  const parcelas = Math.max(1, Math.min(24, normalizeQuantity(config.parcelas) || 1))
  const intervalDias = Math.max(1, normalizeQuantity(config.intervalDias) || 30)
  const observacao = normalizeText(config.observacao)

  return {
    parcelas,
    primeiroVencimento: normalizeDateBr(config.primeiroVencimento),
    intervalDias,
    observacao: observacao?.slice(0, 500) ?? null,
  }
}

const PAYMENT_KEYS = [
  "dinheiro",
  "pix",
  "cartao",
  "cartaoDebito",
  "cartaoCredito",
  "carne",
  "aPrazo",
  "creditoVale",
] as const

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}

function isOptionalText(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "string"
}

/**
 * Indica se há fatos estruturais suficientes para uma comparação de replay segura.
 * Campos complementares inválidos de acessório continuam descartáveis pelo sanitizer;
 * fatos centrais ausentes ou inválidos nunca são convertidos em um falso replay.
 */
export function isLegacySaleFactsComparable(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const sale = value as JsonRecord

  if (
    (sale.at !== undefined && sale.at !== null && normalizeInstant(sale.at) === null) ||
    !isFiniteNonNegative(sale.total)
  ) {
    return false
  }
  if (!isOptionalText(sale.sessaoId) || !isOptionalText(sale.terminalId)) return false
  if (
    !isOptionalText(sale.clienteId) ||
    !isOptionalText(sale.customerCpf) ||
    !isOptionalText(sale.customerName)
  ) {
    return false
  }

  if (!Array.isArray(sale.lines) || sale.lines.length === 0) return false
  for (const rawLine of sale.lines) {
    if (rawLine === null || typeof rawLine !== "object" || Array.isArray(rawLine)) return false
    const line = rawLine as JsonRecord
    if (!normalizeText(line.inventoryId) || !normalizeText(line.name)) return false
    if (!isFiniteNonNegative(line.quantity) || line.quantity <= 0) return false
    if (!isFiniteNonNegative(line.unitPrice)) return false
    if (line.lineTotal !== undefined && !isFiniteNonNegative(line.lineTotal)) return false
    if (
      line.custoUnitario !== undefined &&
      line.custoUnitario !== null &&
      !isFiniteNonNegative(line.custoUnitario)
    ) {
      return false
    }
    if (line.isAvulso !== undefined && typeof line.isAvulso !== "boolean") return false
  }

  if (sale.paymentBreakdown !== undefined && sale.paymentBreakdown !== null) {
    if (typeof sale.paymentBreakdown !== "object" || Array.isArray(sale.paymentBreakdown)) {
      return false
    }
    const payments = sale.paymentBreakdown as JsonRecord
    if (Object.keys(payments).some((key) => !PAYMENT_KEYS.includes(key as (typeof PAYMENT_KEYS)[number]))) {
      return false
    }
    for (const key of PAYMENT_KEYS) {
      if (payments[key] !== undefined && !isFiniteNonNegative(payments[key])) return false
    }
  }

  for (const field of ["discountTotal", "discountReais", "discountPercent"] as const) {
    if (sale[field] !== undefined && !isFiniteNonNegative(sale[field])) return false
  }
  if (!isOptionalText(sale.discountAuthorizedByAdminId)) return false

  if (sale.aPrazoConfig !== undefined && sale.aPrazoConfig !== null) {
    if (typeof sale.aPrazoConfig !== "object" || Array.isArray(sale.aPrazoConfig)) return false
    const config = sale.aPrazoConfig as JsonRecord
    if (
      config.parcelas !== undefined &&
      (!Number.isInteger(config.parcelas) ||
        !isFiniteNonNegative(config.parcelas) ||
        config.parcelas < 1)
    ) {
      return false
    }
    if (
      config.intervalDias !== undefined &&
      (!Number.isInteger(config.intervalDias) ||
        !isFiniteNonNegative(config.intervalDias) ||
        config.intervalDias < 1)
    ) {
      return false
    }
    if (!isOptionalText(config.primeiroVencimento) || !isOptionalText(config.observacao)) return false
  }

  return true
}

/**
 * Representação canônica dos fatos de uma venda legada.
 *
 * Não inclui número comercial, flags de sync, operador resolvido pelo servidor,
 * autorização de transporte ou metadados retroativos. A função é pura: não muta a
 * entrada, não lê relógio/ambiente e não executa I/O.
 */
export function canonicalizeLegacySaleFacts(value: unknown) {
  const sale = asRecord(value)
  const payments = normalizePayments(sale.paymentBreakdown)
  const discountTotal = normalizeOptionalMoney(sale.discountTotal)
  const discountReais = normalizeOptionalMoney(sale.discountReais)
  const discountPercent =
    typeof sale.discountPercent === "number" && Number.isFinite(sale.discountPercent)
      ? normalizeNumber(sale.discountPercent, 4) || null
      : null
  const hasDiscount =
    discountTotal !== null || discountReais !== null || discountPercent !== null

  return {
    version: LEGACY_SALE_FINGERPRINT_VERSION,
    occurredAt: normalizeInstant(sale.at),
    sessionId: normalizeText(sale.sessaoId),
    terminalId: normalizeText(sale.terminalId),
    customer: {
      id: normalizeText(sale.clienteId),
      document: normalizeDocument(sale.customerCpf),
      name: normalizeText(sale.customerName),
    },
    lines: normalizeLines(sale.lines),
    total: normalizeMoney(sale.total),
    payments,
    discounts: {
      total: discountTotal,
      reais: discountReais,
      percent: discountPercent,
      authorizedBy: hasDiscount ? normalizeText(sale.discountAuthorizedByAdminId) : null,
    },
    installments: normalizeInstallmentConfig(sale.aPrazoConfig, payments.aPrazo > 0),
    operationalLink: {
      linkedOsId: normalizeText(sale.linkedOsId),
      osId: normalizeText(sale.osId),
      ordemServicoId: normalizeText(sale.ordemServicoId),
    },
  }
}

/** SHA-256 versionado da representação canônica. */
export function buildLegacySaleFingerprint(value: unknown): string {
  const canonical = JSON.stringify(canonicalizeLegacySaleFacts(value))
  const digest = createHash("sha256").update(canonical, "utf8").digest("hex")
  return `${LEGACY_SALE_FINGERPRINT_VERSION}:sha256:${digest}`
}
