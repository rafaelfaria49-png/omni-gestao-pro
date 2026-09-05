/**
 * Service de CarteiraFinanceira — contas/carteiras do HUB Financeiro.
 *
 * Invariantes:
 *  - `storeId` obrigatório em todas as operações
 *  - `saldoAtual` é sempre recalculado a partir das MovimentacaoFinanceira vinculadas
 *  - Transferências são transacionais: saída + entrada em uma única operação atômica
 *  - Tipos aceitos: caixa | banco | pix | dinheiro | credito | debito | investimento
 */

import { prisma } from "@/lib/prisma"
import type { CarteiraFinanceira, Prisma } from "@/generated/prisma"

// ─── tipos públicos ────────────────────────────────────────────────────────────

export const TIPOS_CARTEIRA = [
  "caixa",
  "banco",
  "pix",
  "dinheiro",
  "credito",
  "debito",
  "investimento",
] as const

export type TipoCarteira = (typeof TIPOS_CARTEIRA)[number]

/** Cliente Prisma aceito: o singleton global OU um `Prisma.TransactionClient`. */
export type CarteirasDbClient = Prisma.TransactionClient

export const CARTEIRA_SALDO_LOCK_PREFIX = "financeiro:carteira-saldo"

export function buildCarteiraSaldoLockKey(storeId: string, carteiraId: string): string {
  return `${CARTEIRA_SALDO_LOCK_PREFIX}:${storeId}:${carteiraId}`
}

export type CarteiraPublica = {
  id: string
  storeId: string
  nome: string
  tipo: TipoCarteira
  saldoInicial: number
  saldoAtual: number
  ativo: boolean
  cor: string
  icone: string
  createdAt: string
  updatedAt: string
}

export type CriarCarteiraInput = {
  storeId: string
  nome: string
  tipo?: TipoCarteira
  saldoInicial?: number
  cor?: string
  icone?: string
}

export type AtualizarCarteiraInput = {
  id: string
  storeId: string
  nome?: string
  tipo?: TipoCarteira
  saldoInicial?: number
  ativo?: boolean
  cor?: string
  icone?: string
}

export type TransferenciaInput = {
  storeId: string
  origemId: string
  destinoId: string
  valor: number
  descricao?: string
}

export type TransferenciaResult = {
  ok: boolean
  saidaId?: string
  entradaId?: string
  origemSaldo?: number
  destinoSaldo?: number
  error?: string
}

// ─── helpers internos ─────────────────────────────────────────────────────────

function toPublica(c: CarteiraFinanceira): CarteiraPublica {
  return {
    id: c.id,
    storeId: c.storeId,
    nome: c.nome,
    tipo: c.tipo as TipoCarteira,
    saldoInicial: c.saldoInicial,
    saldoAtual: c.saldoAtual,
    ativo: c.ativo,
    cor: c.cor,
    icone: c.icone,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  }
}

function safeMoney(v: number): number {
  return Math.round((v ?? 0) * 100) / 100
}

// ─── listarCarteiras ──────────────────────────────────────────────────────────

export async function listarCarteiras(
  storeId: string,
  apenasAtivas = false
): Promise<CarteiraPublica[]> {
  const where: Prisma.CarteiraFinanceiraWhereInput = { storeId }
  if (apenasAtivas) where.ativo = true

  const rows = await prisma.carteiraFinanceira.findMany({
    where,
    orderBy: [{ ativo: "desc" }, { nome: "asc" }],
  })

  return rows.map(toPublica)
}

// ─── criarCarteira ────────────────────────────────────────────────────────────

export async function criarCarteira(
  input: CriarCarteiraInput
): Promise<CarteiraPublica> {
  const saldo = safeMoney(input.saldoInicial ?? 0)

  const row = await prisma.carteiraFinanceira.create({
    data: {
      storeId: input.storeId,
      nome: input.nome.trim(),
      tipo: input.tipo ?? "caixa",
      saldoInicial: saldo,
      saldoAtual: saldo,
      ativo: true,
      cor: input.cor ?? "#6366f1",
      icone: input.icone ?? "wallet",
    },
  })

  return toPublica(row)
}

// ─── atualizarCarteira ────────────────────────────────────────────────────────

export async function atualizarCarteira(
  input: AtualizarCarteiraInput
): Promise<CarteiraPublica> {
  const { id, storeId, ...fields } = input

  const data: Prisma.CarteiraFinanceiraUpdateInput = {}
  if (fields.nome !== undefined) data.nome = fields.nome.trim()
  if (fields.tipo !== undefined) data.tipo = fields.tipo
  if (fields.cor !== undefined) data.cor = fields.cor
  if (fields.icone !== undefined) data.icone = fields.icone
  if (fields.ativo !== undefined) data.ativo = fields.ativo
  if (fields.saldoInicial !== undefined) {
    data.saldoInicial = safeMoney(fields.saldoInicial)
  }

  const row = await prisma.carteiraFinanceira.update({
    where: { id, storeId },
    data,
  })

  return toPublica(row)
}

// ─── recalcularSaldoCarteira ─────────────────────────────────────────────────
/** Recalcula com o lock já pertencendo à MESMA transação das agregações e do update. */
async function recalcularSaldoCarteiraTransacional(
  id: string,
  storeId: string,
  client: CarteirasDbClient,
): Promise<CarteiraPublica> {
  // Duas baixas podem inserir movimentações em transações distintas e calcular o mesmo
  // saldo antes de qualquer uma commitar. O advisory xact lock serializa por loja+carteira
  // ANTES das agregações; quem esperar passa a enxergar o ledger já commitado do vencedor.
  const lockKey = buildCarteiraSaldoLockKey(storeId, id)
  await client.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))::text AS lock`

  const carteira = await client.carteiraFinanceira.findFirst({
    where: { id, storeId },
  })
  if (!carteira) throw new Error(`Carteira não encontrada: ${id}`)

  // Sequencial (não `Promise.all`): um `TransactionClient` serializa numa única conexão.
  const entradas = await client.movimentacaoFinanceira.aggregate({
    where: { carteiraId: id, storeId, tipo: "entrada" },
    _sum: { valor: true },
  })
  const saidas = await client.movimentacaoFinanceira.aggregate({
    where: { carteiraId: id, storeId, tipo: "saida" },
    _sum: { valor: true },
  })

  const totalEntradas = safeMoney(entradas._sum.valor ?? 0)
  const totalSaidas = safeMoney(saidas._sum.valor ?? 0)
  const saldoAtual = safeMoney(carteira.saldoInicial + totalEntradas - totalSaidas)

  const updated = await client.carteiraFinanceira.update({
    where: { id, storeId },
    data: { saldoAtual },
  })

  return toPublica(updated)
}

/**
 * Recalcula `saldoAtual` somando saldoInicial + entradas - saídas a partir do ledger.
 *
 * Com `db`, participa da transação do recebimento. Sem `db`, abre uma transação curta
 * própria para que o advisory lock permaneça retido até agregação + update terminarem.
 */
export async function recalcularSaldoCarteira(
  id: string,
  storeId: string,
  db?: CarteirasDbClient,
): Promise<CarteiraPublica> {
  if (db) return recalcularSaldoCarteiraTransacional(id, storeId, db)
  return prisma.$transaction((tx) => recalcularSaldoCarteiraTransacional(id, storeId, tx), {
    maxWait: 5_000,
    timeout: 15_000,
  })
}

// ─── transferirEntreCarteiras ─────────────────────────────────────────────────
/**
 * Transação atômica:
 *  1. Cria MovimentacaoFinanceira saída na carteira origem
 *  2. Cria MovimentacaoFinanceira entrada na carteira destino
 *  3. Recalcula saldoAtual de ambas
 */
export async function transferirEntreCarteiras(
  input: TransferenciaInput
): Promise<TransferenciaResult> {
  const { storeId, origemId, destinoId, valor, descricao } = input
  const valorMoney = safeMoney(valor)

  if (valorMoney <= 0) {
    return { ok: false, error: "Valor de transferência deve ser maior que zero." }
  }
  if (origemId === destinoId) {
    return { ok: false, error: "Origem e destino não podem ser iguais." }
  }

  const [origem, destino] = await Promise.all([
    prisma.carteiraFinanceira.findFirst({ where: { id: origemId, storeId } }),
    prisma.carteiraFinanceira.findFirst({ where: { id: destinoId, storeId } }),
  ])

  if (!origem) return { ok: false, error: `Carteira de origem não encontrada: ${origemId}` }
  if (!destino) return { ok: false, error: `Carteira de destino não encontrada: ${destinoId}` }

  const descricaoBase =
    descricao?.trim() ||
    `Transferência: ${origem.nome} → ${destino.nome}`

  const [saida, entrada] = await prisma.$transaction([
    prisma.movimentacaoFinanceira.create({
      data: {
        storeId,
        tipo: "saida",
        origem: "transferencia",
        descricao: `${descricaoBase} (saída)`,
        valor: valorMoney,
        carteiraId: origemId,
      },
    }),
    prisma.movimentacaoFinanceira.create({
      data: {
        storeId,
        tipo: "entrada",
        origem: "transferencia",
        descricao: `${descricaoBase} (entrada)`,
        valor: valorMoney,
        carteiraId: destinoId,
      },
    }),
  ])

  const [origemAtualizada, destinoAtualizado] = await Promise.all([
    recalcularSaldoCarteira(origemId, storeId),
    recalcularSaldoCarteira(destinoId, storeId),
  ])

  return {
    ok: true,
    saidaId: saida.id,
    entradaId: entrada.id,
    origemSaldo: origemAtualizada.saldoAtual,
    destinoSaldo: destinoAtualizado.saldoAtual,
  }
}
