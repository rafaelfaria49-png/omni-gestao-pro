import "server-only"

import type { Prisma } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"

import {
  planStoreSaleNumberingCodes,
  type StoreSaleNumberingCodeRejectionReason,
} from "./store-sale-numbering-code"

/**
 * Serviço canônico de provisionamento de `Store.codigoNumeracaoVenda` (GOAL 002C-0b).
 *
 * Fecha o gate G1 do readiness (`docs/audits/PDV_NUMERACAO_SERVER_WRITER_002C_READINESS_001.md`):
 * até aqui nenhuma superfície versionada conseguia configurar o código da loja.
 *
 * O que este módulo NÃO faz — e não pode passar a fazer sem novo GOAL:
 * - não chama o allocator do 002B nem qualquer writer de venda;
 * - não lê a flag de ambiente do writer v2 nem o gate de runtime;
 * - não cria `SerieVenda`, não numera venda alguma e não ativa o writer v2;
 * - não gera código automaticamente (sem MAX, count, nome da loja ou aleatoriedade):
 *   o código vem exclusivamente do operador e passa por
 *   {@link planStoreSaleNumberingCodes}, a porta única de validação.
 *
 * A unique global `stores."codigoNumeracaoVenda"` (migration 0016) permanece como
 * proteção final: a leitura dos códigos ocupados acontece na MESMA transação da
 * escrita, mas só o banco decide a corrida — P2002 é traduzido em conflito.
 */

/** Cliente transacional recebido do callback de `$transaction`; nunca o PrismaClient raiz. */
type ProvisionTransactionClient = Prisma.TransactionClient

const STORE_SELECT = {
  id: true,
  name: true,
  codigoNumeracaoVenda: true,
} as const

type StoreRow = {
  id: string
  name: string
  codigoNumeracaoVenda: string | null
}

/**
 * Evidência de consumo da série pela loja.
 *
 * `series` é o marcador canônico e suficiente: `SerieVenda.prefixo` é um snapshot
 * write-once de `Store.codigoNumeracaoVenda` (schema, GOAL 002B) e a FK composta
 * `(serieVendaId, storeId)` de `Venda` é `onDelete: Restrict`. Trocar o código depois
 * que existe série faria a série divergir do código configurado — exatamente o que
 * `assertSerieUsavel` do allocator recusa.
 *
 * `vendas` é reforço de exibição, não critério adicional: toda venda numerada aponta
 * para uma série, logo `vendas > 0` implica `series > 0`. Nenhuma inferência é feita
 * sobre o formato de `pedidoId` das vendas históricas do writer v1.
 */
export type StoreSaleNumberingUsage = {
  readonly series: number
  readonly vendas: number
  readonly consumido: boolean
}

export type StoreSaleNumberingStatus = {
  readonly storeId: string
  readonly name: string
  readonly codigo: string | null
  readonly configurado: boolean
  /** `true` quando a série já foi consumida: o código vira imutável. */
  readonly imutavel: boolean
  readonly uso: StoreSaleNumberingUsage
}

export type StoreSaleNumberingProvisionResult =
  | {
      readonly status: "SAVED"
      readonly store: StoreSaleNumberingStatus
      readonly codigoAnterior: string | null
    }
  /** Mesmo valor já persistido: idempotente, sem escrita e sem auditoria. */
  | { readonly status: "UNCHANGED"; readonly store: StoreSaleNumberingStatus }
  | { readonly status: "INVALID"; readonly reason: StoreSaleNumberingCodeRejectionReason }
  /** `conflitoStoreId` é `null` quando a corrida foi decidida pelo banco (P2002). */
  | {
      readonly status: "CONFLICT"
      readonly codigo: string | null
      readonly conflitoStoreId: string | null
    }
  | { readonly status: "IMMUTABLE"; readonly store: StoreSaleNumberingStatus }
  | { readonly status: "STORE_NOT_FOUND"; readonly storeId: string }

function normalizeStoreId(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : ""
}

function prismaErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === "string" ? code : undefined
}

/** `true` só para a unique global do código — nunca para outra constraint de `stores`. */
function isCodigoUniqueViolation(error: unknown): boolean {
  if (prismaErrorCode(error) !== "P2002") return false
  const target = (error as { meta?: { target?: unknown } }).meta?.target
  if (target === undefined) return true
  const fields = Array.isArray(target) ? target.map(String) : [String(target)]
  return fields.some((field) => field.includes("codigoNumeracaoVenda"))
}

async function readUsage(
  client: ProvisionTransactionClient,
  storeId: string,
): Promise<StoreSaleNumberingUsage> {
  const series = await client.serieVenda.count({ where: { storeId } })
  if (series === 0) return { series: 0, vendas: 0, consumido: false }
  // Só consulta vendas para loja que já tem série — no estado dormente, nunca.
  const vendas = await client.venda.count({
    where: { storeId, serieVendaId: { not: null } },
  })
  return { series, vendas, consumido: true }
}

function toStatus(store: StoreRow, uso: StoreSaleNumberingUsage): StoreSaleNumberingStatus {
  return {
    storeId: store.id,
    name: store.name,
    codigo: store.codigoNumeracaoVenda,
    configurado: store.codigoNumeracaoVenda !== null,
    imutavel: uso.consumido,
    uso,
  }
}

/**
 * Estado de provisionamento das lojas informadas. O chamador é responsável por
 * recortar a lista pela permissão da sessão: este serviço não descobre lojas sozinho
 * e não tem loja padrão.
 */
export async function readStoreSaleNumberingStatuses(
  storeIds: readonly string[],
): Promise<StoreSaleNumberingStatus[]> {
  const ids = Array.from(new Set(storeIds.map(normalizeStoreId).filter(Boolean)))
  if (ids.length === 0) return []

  const stores = (await prisma.store.findMany({
    where: { id: { in: ids } },
    select: STORE_SELECT,
    orderBy: { id: "asc" },
  })) as StoreRow[]

  const series = await prisma.serieVenda.findMany({
    where: { storeId: { in: ids } },
    select: { storeId: true },
  })
  const seriesPorLoja = new Map<string, number>()
  for (const row of series) {
    seriesPorLoja.set(row.storeId, (seriesPorLoja.get(row.storeId) ?? 0) + 1)
  }

  const statuses: StoreSaleNumberingStatus[] = []
  for (const store of stores) {
    const totalSeries = seriesPorLoja.get(store.id) ?? 0
    if (totalSeries === 0) {
      statuses.push(toStatus(store, { series: 0, vendas: 0, consumido: false }))
      continue
    }
    const vendas = await prisma.venda.count({
      where: { storeId: store.id, serieVendaId: { not: null } },
    })
    statuses.push(toStatus(store, { series: totalSeries, vendas, consumido: true }))
  }
  return statuses
}

/**
 * Única escrita versionada de `Store.codigoNumeracaoVenda`.
 *
 * Resolve a loja no servidor, valida pelo contrato puro, confere os códigos ocupados
 * na mesma transação, bloqueia a troca quando a série já foi consumida e atualiza
 * exclusivamente a coluna do código. Autenticação e permissão são responsabilidade do
 * chamador (rota), que também registra a auditoria do módulo.
 */
export async function provisionStoreSaleNumberingCode(input: {
  storeId: unknown
  codigo: unknown
}): Promise<StoreSaleNumberingProvisionResult> {
  const storeId = normalizeStoreId(input.storeId)
  if (!storeId) return { status: "STORE_NOT_FOUND", storeId: "" }

  try {
    return await prisma.$transaction(
      async (tx): Promise<StoreSaleNumberingProvisionResult> => {
        const store = (await tx.store.findUnique({
          where: { id: storeId },
          select: STORE_SELECT,
        })) as StoreRow | null
        if (!store) return { status: "STORE_NOT_FOUND", storeId }

        const ocupados = (await tx.store.findMany({
          where: { codigoNumeracaoVenda: { not: null } },
          select: { id: true, codigoNumeracaoVenda: true },
        })) as { id: string; codigoNumeracaoVenda: string | null }[]

        const taken = new Map<string, string>()
        for (const row of ocupados) {
          if (row.codigoNumeracaoVenda) taken.set(row.codigoNumeracaoVenda, row.id)
        }

        const plan = planStoreSaleNumberingCodes(
          [{ storeId: store.id, codigo: input.codigo }],
          taken,
        )
        const rejection = plan.rejections[0]
        if (rejection) {
          if (rejection.reason === "DUPLICATE") {
            return {
              status: "CONFLICT",
              codigo: typeof input.codigo === "string" ? input.codigo.trim().toUpperCase() : null,
              conflitoStoreId: rejection.conflictsWithStoreId ?? null,
            }
          }
          return { status: "INVALID", reason: rejection.reason }
        }

        const assignment = plan.assignments[0]
        if (!assignment) return { status: "INVALID", reason: "MISSING" }

        const uso = await readUsage(tx, store.id)

        // Repetir o valor já persistido não é troca: é idempotente mesmo com série consumida.
        if (assignment.codigo === store.codigoNumeracaoVenda) {
          return { status: "UNCHANGED", store: toStatus(store, uso) }
        }

        if (uso.consumido) {
          return { status: "IMMUTABLE", store: toStatus(store, uso) }
        }

        const updated = (await tx.store.update({
          where: { id: store.id },
          data: { codigoNumeracaoVenda: assignment.codigo },
          select: STORE_SELECT,
        })) as StoreRow

        return {
          status: "SAVED",
          store: toStatus(updated, uso),
          codigoAnterior: store.codigoNumeracaoVenda,
        }
      },
    )
  } catch (error) {
    // A unique global do banco é a proteção final contra corrida: a transação abortada
    // vira conflito, sem revelar a loja ocupante (desconhecida neste caminho).
    if (isCodigoUniqueViolation(error)) {
      return {
        status: "CONFLICT",
        codigo: typeof input.codigo === "string" ? input.codigo.trim().toUpperCase() : null,
        conflitoStoreId: null,
      }
    }
    throw error
  }
}
