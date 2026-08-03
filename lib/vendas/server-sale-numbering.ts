import "server-only"

import type { Prisma } from "@/generated/prisma"

/**
 * Numeração comercial server-side de venda (GOAL 002B) — infraestrutura DORMENTE.
 *
 * O adapter reserva `VDA-{CODIGO_LOJA}-{ANO}-{NNNNNN}` em SerieVenda(storeId, ano).
 * Ele não abre transação: o futuro writer deve passar o mesmo TransactionClient usado
 * para criar Venda e seus efeitos. Se o chamador reverter, o incremento também reverte.
 *
 * Invariantes:
 * - storeId sempre explícito, sem fallback para loja-1;
 * - ano civil resolvido no servidor em America/Sao_Paulo;
 * - uma série por loja/ano, com prefixo estável;
 * - incremento em um único UPDATE atômico;
 * - sem count(), MAX()+1 ou leitura do último pedido;
 * - nenhum call site produtivo neste GOAL.
 */

/**
 * O caller deve passar exclusivamente o Prisma.TransactionClient recebido pelo
 * callback de $transaction. O helper nunca aceita o PrismaClient raiz.
 */
export type SaleNumberingTransactionClient = Prisma.TransactionClient

export const SALE_NUMBERING_ERROR_CODES = [
  "SALE_NUMBERING_NOT_CONFIGURED",
  "SALE_SEQUENCE_EXHAUSTED",
  "SALE_NUMBERING_INVARIANT_BROKEN",
] as const

export type SaleNumberingErrorCode = (typeof SALE_NUMBERING_ERROR_CODES)[number]

export type SaleNumberingErrorContext = {
  storeId?: string | null
  ano?: number | null
  serieVendaId?: string | null
}

export class SaleNumberingError extends Error {
  readonly code: SaleNumberingErrorCode
  readonly storeId: string | null
  readonly ano: number | null
  readonly serieVendaId: string | null

  constructor(code: SaleNumberingErrorCode, message: string, context: SaleNumberingErrorContext = {}) {
    super(message)
    this.name = "SaleNumberingError"
    this.code = code
    this.storeId = context.storeId ?? null
    this.ano = context.ano ?? null
    this.serieVendaId = context.serieVendaId ?? null
  }
}

export function isSaleNumberingError(error: unknown): error is SaleNumberingError {
  return error instanceof SaleNumberingError
}

export const SALE_NUMBERING_PREFIX = "VDA"
export const SALE_NUMBERING_TIMEZONE = "America/Sao_Paulo"
export const SALE_NUMBER_MIN = 1
export const SALE_NUMBER_MAX = 999_999
export const SALE_SEQUENCE_EXHAUSTED_AT = SALE_NUMBER_MAX + 1
export const SALE_NUMBER_PADDING = 6
export const SALE_NUMBERING_ANO_MIN = 2000
export const SALE_NUMBERING_ANO_MAX = 9999

const SALE_NUMBERING_CODE_PATTERN = /^[A-Z0-9]{2,8}$/

export function normalizeSaleNumberingCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const normalized = raw.trim().toUpperCase()
  return SALE_NUMBERING_CODE_PATTERN.test(normalized) ? normalized : null
}

export function isValidSaleNumberingCode(raw: unknown): boolean {
  return normalizeSaleNumberingCode(raw) !== null
}

export function isValidSaleNumberingAno(ano: unknown): ano is number {
  return (
    typeof ano === "number" &&
    Number.isSafeInteger(ano) &&
    ano >= SALE_NUMBERING_ANO_MIN &&
    ano <= SALE_NUMBERING_ANO_MAX
  )
}

export function isValidSaleNumero(numero: unknown): numero is number {
  return (
    typeof numero === "number" &&
    Number.isSafeInteger(numero) &&
    numero >= SALE_NUMBER_MIN &&
    numero <= SALE_NUMBER_MAX
  )
}

/** Ano civil de aceitação no fuso oficial; nunca usa o relógio enviado pelo cliente. */
export function resolveSaleNumberingAno(agora: Date = new Date()): number {
  if (Number.isNaN(agora.getTime())) {
    throw new SaleNumberingError(
      "SALE_NUMBERING_INVARIANT_BROKEN",
      "Data inválida ao resolver o ano da numeração de venda.",
    )
  }

  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: SALE_NUMBERING_TIMEZONE,
    year: "numeric",
  }).format(agora)
  const ano = Number.parseInt(formatted, 10)

  if (!isValidSaleNumberingAno(ano)) {
    throw new SaleNumberingError(
      "SALE_NUMBERING_INVARIANT_BROKEN",
      `Ano inválido ao resolver a numeração de venda: ${formatted}.`,
      { ano },
    )
  }
  return ano
}

export function formatSalePedidoId(input: {
  prefixo: string
  ano: number
  numero: number
}): string {
  const prefixo = normalizeSaleNumberingCode(input.prefixo)
  if (!prefixo) {
    throw new SaleNumberingError(
      "SALE_NUMBERING_INVARIANT_BROKEN",
      `Prefixo inválido para numeração de venda: ${String(input.prefixo)}.`,
    )
  }
  if (!isValidSaleNumberingAno(input.ano)) {
    throw new SaleNumberingError(
      "SALE_NUMBERING_INVARIANT_BROKEN",
      `Ano inválido para numeração de venda: ${String(input.ano)}.`,
      { ano: typeof input.ano === "number" ? input.ano : null },
    )
  }
  if (!isValidSaleNumero(input.numero)) {
    throw new SaleNumberingError(
      "SALE_NUMBERING_INVARIANT_BROKEN",
      `Número sequencial fora da faixa 1..${SALE_NUMBER_MAX}: ${String(input.numero)}.`,
      { ano: input.ano },
    )
  }

  return `${SALE_NUMBERING_PREFIX}-${prefixo}-${input.ano}-${String(input.numero).padStart(
    SALE_NUMBER_PADDING,
    "0",
  )}`
}

export type SerieVendaResolvida = {
  id: string
  storeId: string
  ano: number
  prefixo: string
  proximoNumero: number
  ativo: boolean
}

export type SaleNumberAllocation = {
  serieVendaId: string
  storeId: string
  ano: number
  prefixo: string
  numeroSequencial: number
  pedidoId: string
}

const SERIE_SELECT = {
  id: true,
  storeId: true,
  ano: true,
  prefixo: true,
  proximoNumero: true,
  ativo: true,
} as const

function prismaErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined
  return typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : undefined
}

/**
 * Só P2034 autoriza o futuro caller a repetir a transação inteira, com limite.
 * P2002 não é retry genérico: pode significar reuso real de clientSaleId/pedidoId.
 */
export function isRetryableSaleNumberingTransactionError(error: unknown): boolean {
  return prismaErrorCode(error) === "P2034"
}

function normalizeStoreId(storeId: unknown): string {
  const normalized = typeof storeId === "string" ? storeId.trim() : ""
  if (!normalized) {
    throw new SaleNumberingError(
      "SALE_NUMBERING_NOT_CONFIGURED",
      "storeId é obrigatório para numerar uma venda; não há loja padrão.",
    )
  }
  return normalized
}

export async function resolveStoreSaleNumberingCode(
  tx: SaleNumberingTransactionClient,
  storeId: string,
): Promise<string> {
  const id = normalizeStoreId(storeId)
  const store = await tx.store.findUnique({
    where: { id },
    select: { id: true, codigoNumeracaoVenda: true },
  })

  if (!store) {
    throw new SaleNumberingError("SALE_NUMBERING_NOT_CONFIGURED", `Loja ${id} não encontrada.`, {
      storeId: id,
    })
  }

  const codigo = normalizeSaleNumberingCode(store.codigoNumeracaoVenda)
  if (!codigo) {
    throw new SaleNumberingError(
      "SALE_NUMBERING_NOT_CONFIGURED",
      `Loja ${id} não possui código de numeração de venda configurado.`,
      { storeId: id },
    )
  }
  return codigo
}

/**
 * Chave int4 FNV-1a do lock consultivo. Colisão de hash só aumenta espera; não altera
 * a unicidade real de (storeId, ano), garantida pelo banco.
 */
export function saleNumberingAdvisoryKey(storeId: string): number {
  let hash = 0x811c9dc5
  const value = `sale-numbering:${storeId}`
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash | 0
}

function assertSerieUsavel(
  serie: SerieVendaResolvida,
  expected: { storeId: string; ano: number; prefixo: string },
): SerieVendaResolvida {
  const context = {
    storeId: expected.storeId,
    ano: expected.ano,
    serieVendaId: serie.id,
  }

  if (serie.storeId !== expected.storeId || serie.ano !== expected.ano) {
    throw new SaleNumberingError(
      "SALE_NUMBERING_INVARIANT_BROKEN",
      "A série resolvida pertence a outra loja ou a outro ano.",
      context,
    )
  }
  if (serie.prefixo !== expected.prefixo) {
    throw new SaleNumberingError(
      "SALE_NUMBERING_INVARIANT_BROKEN",
      `A série ${expected.ano} da loja ${expected.storeId} usa ${serie.prefixo}, diferente do código configurado ${expected.prefixo}.`,
      context,
    )
  }
  if (!serie.ativo) {
    throw new SaleNumberingError(
      "SALE_NUMBERING_NOT_CONFIGURED",
      `A série ${expected.ano} da loja ${expected.storeId} está inativa.`,
      context,
    )
  }
  if (!Number.isSafeInteger(serie.proximoNumero) || serie.proximoNumero < SALE_NUMBER_MIN) {
    throw new SaleNumberingError(
      "SALE_NUMBERING_INVARIANT_BROKEN",
      `Contador inválido na série ${expected.ano} da loja ${expected.storeId}: ${String(
        serie.proximoNumero,
      )}.`,
      context,
    )
  }
  if (serie.proximoNumero > SALE_NUMBER_MAX) {
    throw new SaleNumberingError(
      "SALE_SEQUENCE_EXHAUSTED",
      `A série ${expected.ano} da loja ${expected.storeId} atingiu ${SALE_NUMBER_MAX} vendas.`,
      context,
    )
  }
  return serie
}

/**
 * Obtém/cria a série anual sob advisory lock transacional.
 *
 * Exige READ COMMITTED (padrão Prisma/PostgreSQL): após esperar o vencedor do lock,
 * o segundo findUnique precisa abrir snapshot novo e enxergar a série criada. Em
 * RepeatableRead/Serializable, a disputa inicial pode propagar P2002/P2034. O futuro
 * writer só pode repetir a transação inteira em P2034, com limite; nunca continuar
 * numa transação abortada nem fazer retry cego de P2002.
 */
export async function ensureSerieVenda(
  tx: SaleNumberingTransactionClient,
  input: { storeId: string; ano: number; prefixo: string },
): Promise<SerieVendaResolvida> {
  const storeId = normalizeStoreId(input.storeId)
  if (!isValidSaleNumberingAno(input.ano)) {
    throw new SaleNumberingError(
      "SALE_NUMBERING_INVARIANT_BROKEN",
      `Ano inválido para a série de venda: ${String(input.ano)}.`,
      { storeId },
    )
  }
  const prefixo = normalizeSaleNumberingCode(input.prefixo)
  if (!prefixo) {
    throw new SaleNumberingError(
      "SALE_NUMBERING_NOT_CONFIGURED",
      `Prefixo de numeração inválido para a loja ${storeId}.`,
      { storeId, ano: input.ano },
    )
  }

  const key = { storeId_ano: { storeId, ano: input.ano } }
  const existing = await tx.serieVenda.findUnique({ where: key, select: SERIE_SELECT })
  if (existing) return assertSerieUsavel(existing, { storeId, ano: input.ano, prefixo })

  const advisoryKey = saleNumberingAdvisoryKey(storeId)
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${advisoryKey}::int4, ${input.ano}::int4)`

  const afterLock = await tx.serieVenda.findUnique({ where: key, select: SERIE_SELECT })
  if (afterLock) return assertSerieUsavel(afterLock, { storeId, ano: input.ano, prefixo })

  const created = await tx.serieVenda.create({
    data: { storeId, ano: input.ano, prefixo },
    select: SERIE_SELECT,
  })
  return assertSerieUsavel(created, { storeId, ano: input.ano, prefixo })
}

export async function allocateSaleNumber(
  tx: SaleNumberingTransactionClient,
  input: { storeId: string; ano?: number; agora?: Date },
): Promise<SaleNumberAllocation> {
  const storeId = normalizeStoreId(input.storeId)
  const ano = input.ano ?? resolveSaleNumberingAno(input.agora ?? new Date())

  if (!isValidSaleNumberingAno(ano)) {
    throw new SaleNumberingError(
      "SALE_NUMBERING_INVARIANT_BROKEN",
      `Ano inválido para numeração de venda: ${String(ano)}.`,
      { storeId },
    )
  }

  const prefixo = await resolveStoreSaleNumberingCode(tx, storeId)
  const serie = await ensureSerieVenda(tx, { storeId, ano, prefixo })

  let reserved: SerieVendaResolvida
  try {
    reserved = await tx.serieVenda.update({
      where: {
        id: serie.id,
        storeId,
        ano,
        ativo: true,
        proximoNumero: { gte: SALE_NUMBER_MIN, lte: SALE_NUMBER_MAX },
      },
      data: { proximoNumero: { increment: 1 } },
      select: SERIE_SELECT,
    })
  } catch (error) {
    if (prismaErrorCode(error) !== "P2025") throw error

    const current = await tx.serieVenda.findUnique({
      where: { id: serie.id },
      select: SERIE_SELECT,
    })
    if (!current) {
      throw new SaleNumberingError(
        "SALE_NUMBERING_INVARIANT_BROKEN",
        `Série ${ano} da loja ${storeId} desapareceu durante a alocação.`,
        { storeId, ano, serieVendaId: serie.id },
      )
    }

    assertSerieUsavel(current, { storeId, ano, prefixo })
    throw new SaleNumberingError(
      "SALE_NUMBERING_INVARIANT_BROKEN",
      `A reserva atômica da série ${ano} da loja ${storeId} foi rejeitada sem motivo classificável.`,
      { storeId, ano, serieVendaId: serie.id },
    )
  }

  const numeroSequencial = reserved.proximoNumero - 1
  if (
    reserved.id !== serie.id ||
    reserved.storeId !== storeId ||
    reserved.ano !== ano ||
    reserved.prefixo !== prefixo ||
    !isValidSaleNumero(numeroSequencial)
  ) {
    throw new SaleNumberingError(
      "SALE_NUMBERING_INVARIANT_BROKEN",
      `A reserva devolveu contexto inconsistente para a loja ${storeId}/${ano}.`,
      { storeId, ano, serieVendaId: reserved.id },
    )
  }

  return {
    serieVendaId: reserved.id,
    storeId,
    ano,
    prefixo,
    numeroSequencial,
    pedidoId: formatSalePedidoId({ prefixo, ano, numero: numeroSequencial }),
  }
}
