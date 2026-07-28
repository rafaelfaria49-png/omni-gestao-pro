/**
 * Numeração comercial server-side de venda (GOAL 002B) — infraestrutura DORMENTE.
 *
 * Aloca o número de `VDA-{CODIGO_LOJA}-{ANO}-{NNNNNN}` a partir do contador
 * `SerieVenda(storeId, ano)`. Desenho aprovado em
 * `docs/audits/PDV_PEDIDO_ID_NUMERACAO_SERVER_SAFE_AUDIT_002A.md` §9.
 *
 * Invariantes preservadas aqui:
 *  - `storeId` é SEMPRE explícito; não existe fallback para `loja-1`;
 *  - loja sem `codigoNumeracaoVenda` falha fechada (`SALE_NUMBERING_NOT_CONFIGURED`);
 *  - o prefixo da série é imutável: quem numera é a série, não o código atual da loja;
 *  - o incremento é um ÚNICO `UPDATE` atômico condicionado à chave completa e à faixa;
 *  - nunca há `max + 1`, nunca há salto silencioso de número;
 *  - terminal e nome da loja não participam do contador.
 *
 * DORMENTE: nenhum PDV, O.S., importador ou rota chama este módulo. A transação é
 * SEMPRE do chamador (`TransactionClient`) — este adapter nunca abre `$transaction`,
 * então o rollback do chamador desfaz o incremento e não consome número.
 */
import type { Prisma } from "@/generated/prisma"

/** Cliente transacional do chamador. `Prisma.TransactionClient` e o client base satisfazem. */
export type SaleNumberingClient = Pick<Prisma.TransactionClient, "store" | "serieVenda" | "$executeRaw">

export const SALE_NUMBERING_ERROR_CODES = [
  /** Loja inexistente, sem código de numeração ou com série inativa. */
  "SALE_NUMBERING_NOT_CONFIGURED",
  /** A série (loja, ano) chegou ao teto de 999999. */
  "SALE_SEQUENCE_EXHAUSTED",
  /** Estado impossível (série de outra loja, prefixo divergente, contador corrompido). */
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

export function isSaleNumberingError(e: unknown): e is SaleNumberingError {
  return e instanceof SaleNumberingError
}

/** Prefixo da string comercial. Fixo — não é configurável por loja. */
export const SALE_NUMBERING_PREFIX = "VDA"
/** Fuso oficial que define o ano civil de aceitação da venda no servidor. */
export const SALE_NUMBERING_TIMEZONE = "America/Sao_Paulo"
/** Primeiro número emitível de uma série. */
export const SALE_NUMBER_MIN = 1
/** Último número emitível (padding de 6 dígitos). */
export const SALE_NUMBER_MAX = 999_999
/** `proximoNumero` = SALE_NUMBER_MAX + 1 significa série esgotada (nada mais a emitir). */
export const SALE_SEQUENCE_EXHAUSTED_AT = SALE_NUMBER_MAX + 1
export const SALE_NUMBER_PADDING = 6
/** Faixa de anos aceita — barra ano de relógio corrompido sem depender do banco. */
export const SALE_NUMBERING_ANO_MIN = 2000
export const SALE_NUMBERING_ANO_MAX = 9999

const CODIGO_NUMERACAO_PATTERN = /^[A-Z0-9]{2,8}$/

/**
 * Normaliza o código de numeração da loja (trim + maiúsculas). Retorna `null` quando o
 * valor não é um código válido — o chamador decide o erro, sem "consertar" o dado.
 */
export function normalizeSaleNumberingCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const normalized = raw.trim().toUpperCase()
  return CODIGO_NUMERACAO_PATTERN.test(normalized) ? normalized : null
}

export function isValidSaleNumberingCode(raw: unknown): boolean {
  return normalizeSaleNumberingCode(raw) !== null
}

/** Ano civil de aceitação no fuso oficial. Não usa o relógio do cliente. */
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
  return Number.parseInt(formatted, 10)
}

export function isValidSaleNumberingAno(ano: unknown): ano is number {
  return (
    typeof ano === "number" &&
    Number.isSafeInteger(ano) &&
    ano >= SALE_NUMBERING_ANO_MIN &&
    ano <= SALE_NUMBERING_ANO_MAX
  )
}

/** `VDA-{PREFIXO}-{ANO}-{NNNNNN}`. Não valida regra de negócio, só formata o já validado. */
export function formatSalePedidoId(input: { prefixo: string; ano: number; numero: number }): string {
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
    )
  }
  const numero = String(input.numero).padStart(SALE_NUMBER_PADDING, "0")
  return `${SALE_NUMBERING_PREFIX}-${prefixo}-${input.ano}-${numero}`
}

export function isValidSaleNumero(numero: unknown): numero is number {
  return (
    typeof numero === "number" &&
    Number.isSafeInteger(numero) &&
    numero >= SALE_NUMBER_MIN &&
    numero <= SALE_NUMBER_MAX
  )
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

function prismaErrorCode(e: unknown): string | undefined {
  return (e as { code?: string } | null)?.code
}

function normalizeStoreId(storeId: unknown): string {
  const value = typeof storeId === "string" ? storeId.trim() : ""
  if (!value) {
    // Sem loja explícita NÃO existe numeração: nada de `loja-1` implícito (ADR-0003).
    throw new SaleNumberingError(
      "SALE_NUMBERING_NOT_CONFIGURED",
      "storeId é obrigatório para numerar uma venda; não há loja padrão.",
    )
  }
  return value
}

/**
 * Lê o código de numeração configurado da loja. Falha fechada quando a loja não existe,
 * não tem código ou tem código fora do formato — nenhuma inferência a partir de
 * `Store.id`, `name` ou `cnpj`.
 */
export async function resolveStoreSaleNumberingCode(
  client: SaleNumberingClient,
  storeId: string,
): Promise<string> {
  const id = normalizeStoreId(storeId)
  const store = await client.store.findUnique({
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
 * Chave de 32 bits (FNV-1a) do lock consultivo da criação da série. Determinística e
 * independente de funções internas do PostgreSQL (`hashtext`). Colisão entre lojas só
 * causa espera, nunca número errado — a unicidade real continua sendo `(storeId, ano)`.
 */
export function saleNumberingAdvisoryKey(storeId: string): number {
  let hash = 0x811c9dc5
  const chave = `sale-numbering:${storeId}`
  for (let i = 0; i < chave.length; i++) {
    hash ^= chave.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash | 0
}

/**
 * Obtém (ou cria) a série anual da loja de forma idempotente. O `prefixo` só é gravado na
 * CRIAÇÃO — série existente nunca é reescrita aqui.
 *
 * A criação é serializada por um lock consultivo de transação. `INSERT ... ON CONFLICT`
 * NÃO resolve este caso: o Postgres arbitra apenas UM índice, e a linha também disputa a
 * unique `(prefixo, ano)` — comprovado em teste, o insert concorrente estourava 23505 no
 * segundo índice e abortava a transação do chamador. Com o lock, o segundo a chegar espera
 * o commit do primeiro e apenas relê a série.
 *
 * EXIGE `READ COMMITTED` (padrão do Prisma/PostgreSQL): a releitura pós-lock só enxerga a
 * série do vencedor porque cada statement abre um snapshot novo. Medido em PostgreSQL 17
 * com o chamador em `RepeatableRead`/`Serializable`, o snapshot da transação é anterior ao
 * commit do vencedor, o perdedor tenta criar de novo e o erro que escapa é `P2002`/`P2034`
 * CRU — não um `SaleNumberingError`. Quem for ligar o writer (GOAL 002C) não pode elevar o
 * isolamento desta transação sem antes tratar esse contrato de erro.
 *
 * O lock é transacional: fora de uma transação ele é liberado no fim do próprio SELECT e
 * não protege nada — o provisionamento avulso da série deve ser feito por um chamador único.
 */
export async function ensureSerieVenda(
  client: SaleNumberingClient,
  input: { storeId: string; ano: number; prefixo: string },
): Promise<SerieVendaResolvida> {
  const storeId = normalizeStoreId(input.storeId)
  const { ano } = input
  if (!isValidSaleNumberingAno(ano)) {
    throw new SaleNumberingError(
      "SALE_NUMBERING_INVARIANT_BROKEN",
      `Ano inválido para a série de venda: ${String(ano)}.`,
      { storeId },
    )
  }
  const prefixo = normalizeSaleNumberingCode(input.prefixo)
  if (!prefixo) {
    throw new SaleNumberingError(
      "SALE_NUMBERING_NOT_CONFIGURED",
      `Prefixo de numeração inválido para a loja ${storeId}.`,
      { storeId, ano },
    )
  }

  const chave = { storeId_ano: { storeId, ano } }
  const existente = await client.serieVenda.findUnique({ where: chave, select: SERIE_SELECT })
  if (existente) return assertSerieUsavel(existente, { storeId, ano, prefixo })

  // `$executeRaw` (e não `$queryRaw`) porque `pg_advisory_xact_lock` devolve `void`, tipo que
  // o Prisma não sabe desserializar como coluna.
  const lock = saleNumberingAdvisoryKey(storeId)
  await client.$executeRaw`SELECT pg_advisory_xact_lock(${lock}::int4, ${ano}::int4)`

  const aposLock = await client.serieVenda.findUnique({ where: chave, select: SERIE_SELECT })
  if (aposLock) return assertSerieUsavel(aposLock, { storeId, ano, prefixo })

  const criada = await client.serieVenda.create({
    data: { storeId, ano, prefixo },
    select: SERIE_SELECT,
  })
  return assertSerieUsavel(criada, { storeId, ano, prefixo })
}

function assertSerieUsavel(
  serie: SerieVendaResolvida,
  esperado: { storeId: string; ano: number; prefixo: string },
): SerieVendaResolvida {
  const context = { storeId: esperado.storeId, ano: esperado.ano, serieVendaId: serie.id }
  if (serie.storeId !== esperado.storeId || serie.ano !== esperado.ano) {
    throw new SaleNumberingError(
      "SALE_NUMBERING_INVARIANT_BROKEN",
      "A série resolvida pertence a outra loja ou a outro ano.",
      context,
    )
  }
  // Prefixo é write-once: a série manda. Divergência = configuração alterada após emissão,
  // situação que exige GOAL administrado — aqui falha fechada, nunca renumera sob outro código.
  if (serie.prefixo !== esperado.prefixo) {
    throw new SaleNumberingError(
      "SALE_NUMBERING_INVARIANT_BROKEN",
      `A série ${esperado.ano} da loja ${esperado.storeId} usa o prefixo ${serie.prefixo}, divergente do código configurado ${esperado.prefixo}.`,
      context,
    )
  }
  if (!serie.ativo) {
    throw new SaleNumberingError(
      "SALE_NUMBERING_NOT_CONFIGURED",
      `A série ${esperado.ano} da loja ${esperado.storeId} está inativa.`,
      context,
    )
  }
  if (!Number.isSafeInteger(serie.proximoNumero) || serie.proximoNumero < SALE_NUMBER_MIN) {
    throw new SaleNumberingError(
      "SALE_NUMBERING_INVARIANT_BROKEN",
      `Contador inválido na série ${esperado.ano} da loja ${esperado.storeId}: ${String(serie.proximoNumero)}.`,
      context,
    )
  }
  if (serie.proximoNumero > SALE_NUMBER_MAX) {
    throw new SaleNumberingError(
      "SALE_SEQUENCE_EXHAUSTED",
      `A série ${esperado.ano} da loja ${esperado.storeId} atingiu o limite de ${SALE_NUMBER_MAX} vendas.`,
      context,
    )
  }
  return serie
}

/**
 * Aloca o próximo número comercial da loja no ano corrente do servidor.
 *
 * `tx` é a transação do CHAMADOR: o incremento vive na mesma transação da venda e dos
 * efeitos. Rollback do chamador ⇒ o contador volta e nenhum número é consumido.
 */
export async function allocateSaleNumber(
  tx: SaleNumberingClient,
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

  // UPDATE único e atômico: o Postgres serializa concorrentes NA MESMA linha (loja, ano).
  // A faixa e a chave completa são revalidadas dentro do próprio UPDATE — não há
  // read-modify-write, não há `max + 1`.
  let reservado: SerieVendaResolvida
  try {
    reservado = await tx.serieVenda.update({
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
  } catch (e) {
    // P2025 = nenhuma linha casou o filtro. Reler classifica o motivo real e falha fechada;
    // o SELECT é seguro porque o UPDATE não abortou a transação.
    if (prismaErrorCode(e) !== "P2025") throw e
    const atual = await tx.serieVenda.findUnique({ where: { id: serie.id }, select: SERIE_SELECT })
    if (!atual) {
      throw new SaleNumberingError(
        "SALE_NUMBERING_INVARIANT_BROKEN",
        `Série ${ano} da loja ${storeId} desapareceu durante a alocação.`,
        { storeId, ano, serieVendaId: serie.id },
      )
    }
    // Reaproveita a classificação canônica (inativa / esgotada / contador corrompido).
    assertSerieUsavel(atual, { storeId, ano, prefixo })
    throw new SaleNumberingError(
      "SALE_NUMBERING_INVARIANT_BROKEN",
      `A reserva atômica da série ${ano} da loja ${storeId} foi rejeitada sem motivo classificável.`,
      { storeId, ano, serieVendaId: serie.id },
    )
  }

  const numeroSequencial = reservado.proximoNumero - 1
  if (
    reservado.id !== serie.id ||
    reservado.storeId !== storeId ||
    reservado.ano !== ano ||
    reservado.prefixo !== prefixo ||
    !isValidSaleNumero(numeroSequencial)
  ) {
    throw new SaleNumberingError(
      "SALE_NUMBERING_INVARIANT_BROKEN",
      `A reserva devolveu contexto inconsistente para a loja ${storeId}/${ano}.`,
      { storeId, ano, serieVendaId: reservado.id },
    )
  }

  return {
    serieVendaId: reservado.id,
    storeId,
    ano,
    prefixo,
    numeroSequencial,
    pedidoId: formatSalePedidoId({ prefixo, ano, numero: numeroSequencial }),
  }
}
