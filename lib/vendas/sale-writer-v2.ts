import "server-only"

import type { Prisma } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"
import {
  ClientSaleIdReusedError,
  InvalidClientSaleIdError,
  VendaClientKeyUniqueConflictError,
  classifyExistingVendaReplayByClientSaleId,
  upsertVendaInTransaction,
  VENDA_REPLAY_SELECT,
  type SalePayload,
  type UpsertVendaOptions,
  type UpsertVendaResult,
  type VendaNumberingAssignment,
} from "@/lib/ops-upsert-venda"
import {
  allocateSaleNumber,
  isRetryableSaleNumberingTransactionError,
  type SaleNumberingTransactionClient,
} from "@/lib/vendas/server-sale-numbering"

const TRANSACTION_OPTS = { maxWait: 15_000, timeout: 20_000 } as const
const MAX_RETRYABLE_ATTEMPTS = 3

export async function allocateSaleNumberForWriter(
  tx: SaleNumberingTransactionClient,
  storeId: string,
): Promise<VendaNumberingAssignment> {
  const allocated = await allocateSaleNumber(tx, { storeId })
  return {
    pedidoId: allocated.pedidoId,
    serieVendaId: allocated.serieVendaId,
    anoNumero: allocated.ano,
    numeroSequencial: allocated.numeroSequencial,
  }
}

export type PersistSaleV2Input = {
  storeId: string
  sale: SalePayload
  clientSaleId: string
  operadorLabel?: string
  options?: Omit<UpsertVendaOptions, "v2">
}

async function lookupReplayByClientSaleId(
  storeId: string,
  sale: SalePayload,
  clientSaleId: string,
): Promise<UpsertVendaResult | null> {
  const existing = await prisma.venda.findFirst({
    where: { storeId, clientSaleId },
    select: VENDA_REPLAY_SELECT,
  })
  if (!existing) return null
  return classifyExistingVendaReplayByClientSaleId(storeId, sale, existing, clientSaleId)
}

/**
 * Writer V2: o cliente manda `clientSaleId`; o servidor aloca `pedidoId` na
 * mesma transação da venda + estoque + financeiro + CR + crédito.
 *
 * Retry de transação só para conflito retryable / P2034. Replay pela chave de
 * tentativa não aloca número novo e não duplica efeitos.
 */
export async function persistSaleV2(input: PersistSaleV2Input): Promise<UpsertVendaResult> {
  const { storeId, sale, clientSaleId, operadorLabel, options } = input
  const upsertOptions: UpsertVendaOptions = {
    enforceStock: options?.enforceStock ?? true,
    requireCaixaSession: options?.requireCaixaSession ?? true,
    allowClosedOriginalSession: options?.allowClosedOriginalSession === true,
    v2: {
      clientSaleId,
      allocate: (tx) => allocateSaleNumberForWriter(tx, storeId),
    },
  }

  let lastError: unknown
  for (let attempt = 0; attempt < MAX_RETRYABLE_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx: Prisma.TransactionClient) =>
          upsertVendaInTransaction(tx, storeId, sale, operadorLabel, upsertOptions),
        TRANSACTION_OPTS,
      )
    } catch (error) {
      lastError = error
      if (error instanceof InvalidClientSaleIdError || error instanceof ClientSaleIdReusedError) {
        throw error
      }
      if (error instanceof VendaClientKeyUniqueConflictError) {
        const replay = await lookupReplayByClientSaleId(storeId, sale, error.clientSaleId)
        if (replay) return replay
        throw error
      }
      if (!isRetryableSaleNumberingTransactionError(error)) throw error
    }
  }
  throw lastError
}
