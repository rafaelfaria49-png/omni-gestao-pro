/**
 * Service de MovimentacaoFinanceira — persistência real no Prisma.
 *
 * Invariantes:
 *  - `tipo`  ∈ {"entrada", "saida"}
 *  - `valor` sempre > 0 (o sentido financeiro fica em `tipo`)
 *  - `storeId` obrigatório; falha explícita se ausente
 *  - Idempotência via (storeId, referenciaId, tipo, origem) para ops derivadas
 */

import { prisma } from "@/lib/prisma"
import type { MovimentacaoFinanceira, Prisma } from "@/generated/prisma"
import { recalcularSaldoCarteira } from "@/lib/financeiro/services/carteiras-service"

// ─── tipos públicos ───────────────────────────────────────────────────────────

export type MovTipo = "entrada" | "saida"

/**
 * Cliente Prisma aceito: o singleton global OU um `Prisma.TransactionClient`. Sem `db`,
 * o comportamento é o de sempre — chamadores existentes não mudam.
 */
export type MovimentacoesDbClient = Prisma.TransactionClient

function dbOf(db?: MovimentacoesDbClient): MovimentacoesDbClient {
  return db ?? prisma
}

export const MOV_ORIGENS = ["os", "venda", "manual", "pagar", "receber", "estorno_receber", "estorno_pagar"] as const
export type MovOrigem = (typeof MOV_ORIGENS)[number] | string

export type CreateMovimentacaoInput = {
  storeId: string
  tipo: MovTipo
  descricao: string
  valor: number
  origem?: MovOrigem
  referenciaId?: string
  /** Quando informado, atualiza saldo da carteira após o lançamento. */
  carteiraId?: string | null
  /** Data contábil do lançamento (sobrescreve `createdAt` na criação). */
  createdAt?: Date
}

export type CreateFromTituloMeta = {
  /** Se fornecido, usa como id de referência ao invés do .id */
  referenciaId?: string
}

export type MovimentacaoResult =
  | { ok: true; action: "created"; movimentacao: MovimentacaoFinanceira }
  | { ok: true; action: "skipped_idempotent" }
  | { ok: false; reason: string }

export type ListMovimentacoesFilters = {
  tipo?: MovTipo
  origem?: string
  referenciaId?: string
  dataInicial?: Date | string
  dataFinal?: Date | string
  q?: string
  take?: number
  skip?: number
}

export type ResumoMovimentacoes = {
  totalEntradas: number
  totalSaidas: number
  saldo: number
  count: number
}

// ─── helpers internos ─────────────────────────────────────────────────────────

function safeStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : ""
}

function safeMoney(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "0"))
  return Number.isFinite(n) ? Math.abs(Math.round(n * 100) / 100) : 0
}

function assertStoreId(storeId: string | undefined | null): string {
  const sid = safeStr(storeId)
  if (!sid) throw new Error("movimentacoes-service: storeId é obrigatório")
  return sid
}

function assertTipo(tipo: string | undefined | null): MovTipo {
  if (tipo !== "entrada" && tipo !== "saida") {
    throw new Error(`movimentacoes-service: tipo inválido "${tipo}". Use "entrada" ou "saida".`)
  }
  return tipo
}

function toDate(d: Date | string | undefined): Date | undefined {
  if (!d) return undefined
  const dt = typeof d === "string" ? new Date(d) : d
  return Number.isNaN(dt.getTime()) ? undefined : dt
}

/**
 * Verifica idempotência: existe movimentação com (storeId, referenciaId, tipo, origem)?
 */
async function existeMovimentacao(
  storeId: string,
  referenciaId: string,
  tipo: MovTipo,
  origem: string,
  db?: MovimentacoesDbClient,
): Promise<boolean> {
  const found = await dbOf(db).movimentacaoFinanceira.findFirst({
    where: { storeId, referenciaId, tipo, origem },
    select: { id: true },
  })
  return found !== null
}

// ─── funções genéricas ────────────────────────────────────────────────────────

export async function listMovimentacoes(
  storeId: string,
  filters: ListMovimentacoesFilters = {},
): Promise<MovimentacaoFinanceira[]> {
  const sid = assertStoreId(storeId)
  const where: Prisma.MovimentacaoFinanceiraWhereInput = { storeId: sid }

  if (filters.tipo) where.tipo = assertTipo(filters.tipo)
  if (filters.origem) where.origem = safeStr(filters.origem)
  if (filters.referenciaId) where.referenciaId = safeStr(filters.referenciaId)
  if (filters.q) where.descricao = { contains: safeStr(filters.q), mode: "insensitive" }
  if (filters.dataInicial || filters.dataFinal) {
    const gte = toDate(filters.dataInicial)
    const lte = toDate(filters.dataFinal)
    where.createdAt = { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) }
  }

  return prisma.movimentacaoFinanceira.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: typeof filters.take === "number" ? Math.min(filters.take, 1000) : 200,
    skip: typeof filters.skip === "number" ? Math.max(0, filters.skip) : 0,
  })
}

export async function createMovimentacao(
  input: CreateMovimentacaoInput,
): Promise<MovimentacaoFinanceira> {
  const storeId = assertStoreId(input.storeId)
  const tipo = assertTipo(input.tipo)
  const valor = safeMoney(input.valor)
  if (!(valor > 0)) throw new Error("movimentacoes-service: valor deve ser > 0")
  const descricao = safeStr(input.descricao)
  if (!descricao) throw new Error("movimentacoes-service: descricao é obrigatória")
  const carteiraId = safeStr(input.carteiraId) || null

  const row = await prisma.movimentacaoFinanceira.create({
    data: {
      storeId,
      tipo,
      valor,
      descricao,
      origem: safeStr(input.origem) || "manual",
      referenciaId: safeStr(input.referenciaId) || null,
      carteiraId,
      ...(input.createdAt && !Number.isNaN(input.createdAt.getTime())
        ? { createdAt: input.createdAt }
        : {}),
    },
  })

  if (carteiraId) {
    await recalcularSaldoCarteira(carteiraId, storeId)
  }

  return row
}

export async function createEntrada(
  input: Omit<CreateMovimentacaoInput, "tipo">,
): Promise<MovimentacaoFinanceira> {
  return createMovimentacao({ ...input, tipo: "entrada" })
}

export async function createSaida(
  input: Omit<CreateMovimentacaoInput, "tipo">,
): Promise<MovimentacaoFinanceira> {
  return createMovimentacao({ ...input, tipo: "saida" })
}

export async function deleteMovimentacao(id: string, storeId: string): Promise<void> {
  const sid = assertStoreId(storeId)
  const tid = safeStr(id)
  if (!tid) throw new Error("movimentacoes-service: id é obrigatório")

  const existing = await prisma.movimentacaoFinanceira.findFirst({
    where: { id: tid, storeId: sid },
    select: { id: true },
  })
  if (!existing) throw new Error(`movimentacoes-service: movimentação "${tid}" não encontrada`)
  await prisma.movimentacaoFinanceira.delete({ where: { id: tid } })
}

export async function getResumoMovimentacoes(
  storeId: string,
  range?: { dataInicial?: Date | string; dataFinal?: Date | string },
): Promise<ResumoMovimentacoes> {
  const sid = assertStoreId(storeId)
  const gte = toDate(range?.dataInicial)
  const lte = toDate(range?.dataFinal)
  const dateFilter: Prisma.MovimentacaoFinanceiraWhereInput["createdAt"] = {
    ...(gte ? { gte } : {}),
    ...(lte ? { lte } : {}),
  }
  const baseWhere: Prisma.MovimentacaoFinanceiraWhereInput = {
    storeId: sid,
    ...(gte || lte ? { createdAt: dateFilter } : {}),
  }

  const [entradas, saidas, count] = await prisma.$transaction([
    prisma.movimentacaoFinanceira.aggregate({ where: { ...baseWhere, tipo: "entrada" }, _sum: { valor: true } }),
    prisma.movimentacaoFinanceira.aggregate({ where: { ...baseWhere, tipo: "saida" }, _sum: { valor: true } }),
    prisma.movimentacaoFinanceira.count({ where: baseWhere }),
  ])

  const totalEntradas = Math.round((entradas._sum.valor ?? 0) * 100) / 100
  const totalSaidas = Math.round((saidas._sum.valor ?? 0) * 100) / 100
  return {
    totalEntradas,
    totalSaidas,
    saldo: Math.round((totalEntradas - totalSaidas) * 100) / 100,
    count,
  }
}

// ─── funções de integração CR/CP ──────────────────────────────────────────────

/**
 * Cria movimentação de ENTRADA a partir de um ContaReceberTitulo liquidado/parcial.
 * Idempotente: (storeId, referenciaId=titulo.id, tipo="entrada", origem="receber").
 * Para parciais sucessivos, usa origem="receber_parcial_<suffix>" para não colidir.
 *
 * `carteiraId` (opcional): quando o título traz `payload.carteiraId`, a baixa é
 * registrada na carteira indicada e o saldo é recalculado. Sem `carteiraId`, a
 * movimentação fica sem carteira (entra no saldo agregado de caixa, não em uma
 * carteira específica).
 */
export async function createMovimentacaoEntradaFromReceber(
  titulo: { id: string; storeId: string; descricao: string; cliente: string },
  valor: number,
  opts: {
    parcial?: boolean
    meta?: CreateFromTituloMeta
    carteiraId?: string | null
    /** Quando informado, o lançamento participa da transação do chamador. */
    db?: MovimentacoesDbClient
  } = {},
): Promise<MovimentacaoResult> {
  const storeId = assertStoreId(titulo.storeId)
  const referenciaId = safeStr(opts.meta?.referenciaId) || titulo.id
  const valorMoney = safeMoney(valor)
  if (!(valorMoney > 0)) return { ok: false, reason: "valor_invalido" }

  const client = dbOf(opts.db)
  const origem = opts.parcial ? "receber_parcial" : "receber"
  const carteiraId = safeStr(opts.carteiraId) || null

  // Para liquidação total: idempotência estrita (skipa se já existe)
  // Para parcial: permite múltiplos APENAS se valor diferente já gravado (melhor esforço)
  if (!opts.parcial) {
    if (await existeMovimentacao(storeId, referenciaId, "entrada", origem, opts.db)) {
      return { ok: true, action: "skipped_idempotent" }
    }
  } else {
    // Para parcial: verifica se o total já gravado para esta referência ≥ valor recebido agora
    const agg = await client.movimentacaoFinanceira.aggregate({
      where: { storeId, referenciaId, tipo: "entrada", origem: { startsWith: "receber" } },
      _sum: { valor: true },
    })
    const totalGravado = safeMoney(agg._sum.valor ?? 0)
    // Se total gravado já é >= o novo valor, provavelmente retry; pula
    if (totalGravado >= valorMoney) {
      return { ok: true, action: "skipped_idempotent" }
    }
  }

  const descricao = `Recebimento — ${titulo.cliente || titulo.descricao}`
  const movimentacao = await client.movimentacaoFinanceira.create({
    data: { storeId, tipo: "entrada", valor: valorMoney, descricao, origem, referenciaId, carteiraId },
  })
  if (carteiraId) {
    // Dentro de `$transaction`, o recálculo usa o MESMO cliente: enxerga o lançamento
    // ainda não commitado e o saldo da carteira volta atrás junto no rollback. Nesse modo
    // a falha PROPAGA — engoli-la deixaria a transação abortada sem ninguém saber.
    if (opts.db) {
      await recalcularSaldoCarteira(carteiraId, storeId, opts.db)
    } else {
      await recalcularSaldoCarteira(carteiraId, storeId).catch((e) =>
        console.error("[movimentacoes-service] recalcularSaldoCarteira receber falhou:", e),
      )
    }
  }
  return { ok: true, action: "created", movimentacao }
}

/**
 * Cria movimentação de SAÍDA a partir de um ContaPagarTitulo liquidado/parcial.
 * Idempotente: (storeId, referenciaId=titulo.id, tipo="saida", origem="pagar").
 *
 * `carteiraId` (opcional): mesmo contrato de `createMovimentacaoEntradaFromReceber`.
 */
export async function createMovimentacaoSaidaFromPagar(
  titulo: { id: string; storeId: string; descricao: string },
  valor: number,
  opts: { parcial?: boolean; meta?: CreateFromTituloMeta; carteiraId?: string | null } = {},
): Promise<MovimentacaoResult> {
  const storeId = assertStoreId(titulo.storeId)
  const referenciaId = safeStr(opts.meta?.referenciaId) || titulo.id
  const valorMoney = safeMoney(valor)
  if (!(valorMoney > 0)) return { ok: false, reason: "valor_invalido" }

  const origem = opts.parcial ? "pagar_parcial" : "pagar"
  const carteiraId = safeStr(opts.carteiraId) || null

  if (!opts.parcial) {
    if (await existeMovimentacao(storeId, referenciaId, "saida", origem)) {
      return { ok: true, action: "skipped_idempotent" }
    }
  } else {
    const agg = await prisma.movimentacaoFinanceira.aggregate({
      where: { storeId, referenciaId, tipo: "saida", origem: { startsWith: "pagar" } },
      _sum: { valor: true },
    })
    const totalGravado = safeMoney(agg._sum.valor ?? 0)
    if (totalGravado >= valorMoney) {
      return { ok: true, action: "skipped_idempotent" }
    }
  }

  const descricao = `Pagamento — ${titulo.descricao}`
  const movimentacao = await prisma.movimentacaoFinanceira.create({
    data: { storeId, tipo: "saida", valor: valorMoney, descricao, origem, referenciaId, carteiraId },
  })
  if (carteiraId) {
    await recalcularSaldoCarteira(carteiraId, storeId).catch((e) =>
      console.error("[movimentacoes-service] recalcularSaldoCarteira pagar falhou:", e),
    )
  }
  return { ok: true, action: "created", movimentacao }
}

/**
 * Cria movimentação de estorno: lança entrada reversa (para saída) ou saída reversa (para entrada).
 * Idempotente via origem="estorno_receber" / "estorno_pagar".
 *
 * Reaproveita a `carteiraId` da movimentação original — para que o saldo da
 * carteira que recebeu o pagamento volte ao estado anterior à baixa.
 */
export async function estornarMovimentacaoPorReferencia(
  storeId: string,
  referenciaId: string,
  origemOriginal: "receber" | "pagar",
): Promise<MovimentacaoResult> {
  const sid = assertStoreId(storeId)
  const rid = safeStr(referenciaId)
  if (!rid) return { ok: false, reason: "referenciaId_invalida" }

  const origemEstorno = origemOriginal === "receber" ? "estorno_receber" : "estorno_pagar"
  const tipoEstorno: MovTipo = origemOriginal === "receber" ? "saida" : "entrada"
  const tipoOriginal: MovTipo = origemOriginal === "receber" ? "entrada" : "saida"

  if (await existeMovimentacao(sid, rid, tipoEstorno, origemEstorno)) {
    return { ok: true, action: "skipped_idempotent" }
  }

  // Busca movimentações originais para somar valor e descobrir a carteira usada.
  // Quando há múltiplas (parciais em datas diferentes), todas devem ter sido
  // gravadas na mesma carteira; pegamos a mais recente como referência.
  const originais = await prisma.movimentacaoFinanceira.findMany({
    where: { storeId: sid, referenciaId: rid, tipo: tipoOriginal },
    orderBy: { createdAt: "desc" },
    select: { valor: true, carteiraId: true },
  })
  if (originais.length === 0) {
    // Nenhuma movimentação original — nada a estornar
    return { ok: true, action: "skipped_idempotent" }
  }
  const valorOriginal = safeMoney(originais.reduce((s, m) => s + (m.valor ?? 0), 0))
  if (!(valorOriginal > 0)) return { ok: true, action: "skipped_idempotent" }
  const carteiraId = originais.find((m) => m.carteiraId)?.carteiraId ?? null

  const descricao = `Estorno de ${origemOriginal === "receber" ? "recebimento" : "pagamento"}`
  const movimentacao = await prisma.movimentacaoFinanceira.create({
    data: { storeId: sid, tipo: tipoEstorno, valor: valorOriginal, descricao, origem: origemEstorno, referenciaId: rid, carteiraId },
  })
  if (carteiraId) {
    await recalcularSaldoCarteira(carteiraId, sid).catch((e) =>
      console.error("[movimentacoes-service] recalcularSaldoCarteira estorno falhou:", e),
    )
  }
  return { ok: true, action: "created", movimentacao }
}

/**
 * Saída manual via Omni Agent HUB — idempotente por comando confirmado.
 * Chave: (storeId, referenciaId=commandId, tipo=saida, origem=omni_agent).
 */
export async function createMovimentacaoSaidaFromOmniAgent(input: {
  storeId: string
  commandId: string
  valor: number
  descricao: string
  categoria?: string
}): Promise<MovimentacaoResult> {
  const storeId = assertStoreId(input.storeId)
  const referenciaId = safeStr(input.commandId)
  if (!referenciaId) return { ok: false, reason: "commandId_obrigatorio" }

  const valorMoney = safeMoney(input.valor)
  if (!(valorMoney > 0)) return { ok: false, reason: "valor_invalido" }

  const origem = "omni_agent"
  if (await existeMovimentacao(storeId, referenciaId, "saida", origem)) {
    return { ok: true, action: "skipped_idempotent" }
  }

  const cat = safeStr(input.categoria)
  const base = safeStr(input.descricao) || "Despesa"
  const descricao = cat ? `Despesa — ${base} (${cat})` : `Despesa — ${base}`

  const movimentacao = await prisma.movimentacaoFinanceira.create({
    data: {
      storeId,
      tipo: "saida",
      valor: valorMoney,
      descricao: descricao.slice(0, 500),
      origem,
      referenciaId,
      carteiraId: null,
    },
  })

  return { ok: true, action: "created", movimentacao }
}

/**
 * Entrada manual via Omni Agent HUB — idempotente por comando confirmado.
 * Chave: (storeId, referenciaId=commandId, tipo=entrada, origem=omni_agent).
 */
export async function createMovimentacaoEntradaFromOmniAgent(input: {
  storeId: string
  commandId: string
  valor: number
  descricao: string
  pagador?: string
  formaPagamento?: string
}): Promise<MovimentacaoResult> {
  const storeId = assertStoreId(input.storeId)
  const referenciaId = safeStr(input.commandId)
  if (!referenciaId) return { ok: false, reason: "commandId_obrigatorio" }

  const valorMoney = safeMoney(input.valor)
  if (!(valorMoney > 0)) return { ok: false, reason: "valor_invalido" }

  const origem = "omni_agent"
  if (await existeMovimentacao(storeId, referenciaId, "entrada", origem)) {
    return { ok: true, action: "skipped_idempotent" }
  }

  const pagador = safeStr(input.pagador)
  const forma = safeStr(input.formaPagamento)
  const base = safeStr(input.descricao) || "Recebimento avulso"
  let descricao = `Recebimento — ${base}`
  if (pagador) descricao += ` (${pagador})`
  if (forma) descricao += ` [${forma}]`

  const movimentacao = await prisma.movimentacaoFinanceira.create({
    data: {
      storeId,
      tipo: "entrada",
      valor: valorMoney,
      descricao: descricao.slice(0, 500),
      origem,
      referenciaId,
      carteiraId: null,
    },
  })

  return { ok: true, action: "created", movimentacao }
}
