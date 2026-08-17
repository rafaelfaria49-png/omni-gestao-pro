import "server-only"

/**
 * Núcleo COMPARTILHADO da recuperação de vendas em quarentena
 * (GOAL PDV-VENDAS-QUARENTENA-RECOVERY-ALL-P0-006A).
 *
 * Usado pela recuperação individual (`/api/ops/vendas/recover-quarantined`) e pelo
 * lote (`/api/ops/vendas/quarantine-recovery/{preview,batch}`). Existe UM motor de
 * persistência — `persistSaleV2` — e este módulo apenas o orquestra. Nenhuma rota
 * escreve venda por conta própria.
 *
 * Invariantes:
 *  - a venda OCUPANTE do número antigo nunca é lida para escrita, alterada ou apagada;
 *  - o número antigo entra só em `payload.recovery.recoveredFromPedidoId`;
 *  - `(storeId, clientSaleId)` é a chave de idempotência: replay devolve a venda
 *    existente sem alocar número e sem repetir estoque/caixa/financeiro/CR/vale;
 *  - o gate do writer é verificado aqui também (defesa em profundidade): nenhum
 *    caller consegue recuperar com o writer v1 ativo.
 */

import { prisma } from "@/lib/prisma"
import { isVirtualSaleLine } from "@/lib/os-pdv-virtual-lines"
import {
  CaixaOriginalFechadoError,
  CaixaSessaoInvalidaError,
  ClientSaleIdReusedError,
  InsufficientStockError,
  InvalidClientSaleIdError,
  PedidoIdConflitoMesmaLojaError,
  PedidoIdDeOutraLojaError,
  UnresolvedProductError,
  VENDA_REPLAY_SELECT,
  type SalePayload,
  type VendaPersistView,
} from "@/lib/ops-upsert-venda"
import { persistSaleV2 } from "@/lib/vendas/sale-writer-v2"
import { SALE_WRITER_FLOW } from "@/lib/vendas/sale-identity-contracts"
import { resolveSaleNumberingWriter } from "@/lib/vendas/sale-numbering-runtime-gate"
import { isSaleNumberingError } from "@/lib/vendas/server-sale-numbering"
import {
  buildLegacySaleFingerprint,
  isLegacySaleFactsComparable,
} from "@/lib/vendas/legacy-sale-fingerprint"
import {
  QUARANTINE_RECOVERY_CLASS,
  classifyQuarantineCandidate,
  isExecutableClass,
  type OriginalSessionStatus,
  type QuarantineCandidate,
  type QuarantineRecoveryPlanItem,
  type QuarantineServerFacts,
  type QuarantineStockShortfall,
} from "@/lib/vendas/quarantine-recovery-planner"

export const SALE_WRITER_V1_ACTIVE_CODE = "SALE_WRITER_V1_ACTIVE"

/** `true` quando o writer server-side está ativo. Sem isto, recovery é indisponível. */
export function isRecoveryWriterEnabled(): boolean {
  return resolveSaleNumberingWriter().writer === SALE_WRITER_FLOW.V2
}

// ─────────────────────────────────────────────────────────────────────────────
// Leitura de fatos (read-only) — alimenta o planner
// ─────────────────────────────────────────────────────────────────────────────

type ReadClient = Pick<typeof prisma, "venda" | "sessaoCaixa" | "produto">

function text(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed || null
}

function quantityOf(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(2_000_000_000, Math.round(value)))
}

/**
 * Espelha a resolução de produto de `upsertVendaInTransaction` (OR por id | sku |
 * barcode) e a agregação por produto, para que o preview antecipe exatamente os
 * mesmos bloqueios que o motor aplicaria — sem escrever nada.
 */
async function readProductFacts(
  db: ReadClient,
  storeId: string,
  candidate: QuarantineCandidate,
): Promise<{ unresolvedInventoryIds: string[]; stockShortfalls: QuarantineStockShortfall[] }> {
  const lines = Array.isArray(candidate.lines) ? candidate.lines : []
  const unresolvedInventoryIds: string[] = []
  const qtyByRawId = new Map<string, number>()

  for (const rawLine of lines) {
    const line = rawLine as { inventoryId?: unknown; quantity?: unknown }
    const rawInvId = text(line?.inventoryId)
    if (!rawInvId || isVirtualSaleLine(rawInvId)) continue
    const qty = quantityOf(line?.quantity)
    if (qty === 0) continue
    qtyByRawId.set(rawInvId, (qtyByRawId.get(rawInvId) ?? 0) + qty)
  }

  const qtyByProdutoId = new Map<string, { nome: string; stock: number; necessario: number }>()
  for (const [rawInvId, qty] of qtyByRawId) {
    const produto = await db.produto.findFirst({
      where: {
        storeId,
        OR: [{ id: rawInvId }, { sku: rawInvId }, { barcode: rawInvId }],
      },
      select: { id: true, name: true, stock: true },
    })
    if (!produto) {
      unresolvedInventoryIds.push(rawInvId)
      continue
    }
    // Duas linhas podem resolver para o MESMO produto (id + sku): agrega, como o motor.
    const acc = qtyByProdutoId.get(produto.id)
    if (acc) {
      acc.necessario += qty
    } else {
      qtyByProdutoId.set(produto.id, { nome: produto.name, stock: produto.stock, necessario: qty })
    }
  }

  const stockShortfalls: QuarantineStockShortfall[] = []
  for (const [produtoId, info] of qtyByProdutoId) {
    if (info.stock < info.necessario) {
      stockShortfalls.push({
        produtoId,
        nome: info.nome,
        disponivel: info.stock,
        necessario: info.necessario,
      })
    }
  }

  return { unresolvedInventoryIds, stockShortfalls }
}

async function readOriginalSessionStatus(
  db: ReadClient,
  storeId: string,
  candidate: QuarantineCandidate,
): Promise<OriginalSessionStatus> {
  const sessaoId = text(candidate.sessaoId)
  if (!sessaoId) return "NO_SESSION_ID"
  const sessao = await db.sessaoCaixa.findFirst({
    where: { id: sessaoId, storeId },
    select: { status: true },
  })
  if (!sessao) return "NOT_FOUND"
  return sessao.status === "ABERTA" ? "ABERTA" : "FECHADA"
}

/**
 * Lê todos os fatos server-side de UMA candidata. Estritamente read-only:
 * `findFirst`/`findUnique` apenas. Chamado tanto pelo preview quanto pelo lote.
 */
export async function readQuarantineServerFacts(input: {
  storeId: string
  candidate: QuarantineCandidate
  db?: ReadClient
}): Promise<QuarantineServerFacts> {
  const { storeId, candidate } = input
  const db = input.db ?? prisma

  const clientSaleId = text(candidate.clientSaleId)
  const conflictingPedidoId = text(candidate.id)

  const already = clientSaleId
    ? await db.venda.findFirst({
        where: { storeId, clientSaleId },
        select: { id: true, pedidoId: true },
      })
    : null

  const occupant = conflictingPedidoId
    ? await db.venda.findUnique({
        where: { pedidoId: conflictingPedidoId },
        select: { id: true, storeId: true },
      })
    : null

  // Produto/estoque e sessão só importam quando ainda há algo a criar.
  if (already) {
    return {
      alreadyRecoveredPedidoId: already.pedidoId,
      alreadyRecoveredVendaId: already.id,
      occupantExists: Boolean(occupant),
      occupantStoreId: occupant?.storeId ?? null,
      originalSessionStatus: "NO_SESSION_ID",
      unresolvedInventoryIds: [],
      stockShortfalls: [],
    }
  }

  const [originalSessionStatus, productFacts] = await Promise.all([
    readOriginalSessionStatus(db, storeId, candidate),
    readProductFacts(db, storeId, candidate),
  ])

  return {
    alreadyRecoveredPedidoId: null,
    alreadyRecoveredVendaId: null,
    occupantExists: Boolean(occupant),
    occupantStoreId: occupant?.storeId ?? null,
    originalSessionStatus,
    unresolvedInventoryIds: productFacts.unresolvedInventoryIds,
    stockShortfalls: productFacts.stockShortfalls,
  }
}

/** Classifica uma candidata lendo os fatos do banco. Read-only. */
export async function planQuarantineCandidate(input: {
  storeId: string
  candidate: QuarantineCandidate
  db?: ReadClient
}): Promise<QuarantineRecoveryPlanItem> {
  const facts = await readQuarantineServerFacts(input)
  return classifyQuarantineCandidate({
    storeId: input.storeId,
    candidate: input.candidate,
    facts,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Execução
// ─────────────────────────────────────────────────────────────────────────────

export const QUARANTINE_RECOVERY_STATUS = Object.freeze({
  RECOVERED: "RECOVERED",
  ALREADY_RECOVERED: "ALREADY_RECOVERED",
  REQUIRES_CONFIRMATION: "REQUIRES_CONFIRMATION",
  BLOCKED: "BLOCKED",
  FAILED: "FAILED",
} as const)

export type QuarantineRecoveryStatus =
  (typeof QUARANTINE_RECOVERY_STATUS)[keyof typeof QUARANTINE_RECOVERY_STATUS]

export type QuarantineRecoveryResult = {
  /** Número antigo — chave de correlação com a cópia local. */
  readonly conflictingPedidoId: string
  readonly clientSaleId: string | null
  readonly status: QuarantineRecoveryStatus
  readonly code: string | null
  readonly reason: string
  /** Presente em `RECOVERED` e `ALREADY_RECOVERED` — evidência server-side. */
  readonly venda: VendaPersistView | null
  /** `true` quando nada foi criado porque a venda já existia. */
  readonly replayed: boolean
}

export type ExecuteQuarantineRecoveryInput = {
  storeId: string
  candidate: QuarantineCandidate
  motivo: string
  operadorLabel?: string
  /** Autorização explícita para lançamento retroativo em sessão original FECHADA. */
  allowClosedOriginalSession?: boolean
  /** Fatos já lidos (o lote reaproveita os do preview); relidos quando ausentes. */
  facts?: QuarantineServerFacts
  db?: ReadClient
}

function resultFrom(
  item: Pick<QuarantineRecoveryPlanItem, "conflictingPedidoId" | "clientSaleId">,
  status: QuarantineRecoveryStatus,
  code: string | null,
  reason: string,
  extra?: { venda?: VendaPersistView | null; replayed?: boolean },
): QuarantineRecoveryResult {
  return {
    conflictingPedidoId: item.conflictingPedidoId,
    clientSaleId: item.clientSaleId,
    status,
    code,
    reason,
    venda: extra?.venda ?? null,
    replayed: extra?.replayed ?? false,
  }
}

function factsFromOccupantPayload(existing: {
  pedidoId: string
  payload: unknown
  total: number
  clienteNome: string | null
  clienteId: string | null
  terminalId: string | null
}) {
  const payload =
    existing.payload !== null && typeof existing.payload === "object" && !Array.isArray(existing.payload)
      ? (existing.payload as Record<string, unknown>)
      : {}
  return {
    ...payload,
    id: existing.pedidoId,
    total: "total" in payload ? payload.total : existing.total,
    customerName: payload.customerName ?? existing.clienteNome,
    clienteId: payload.clienteId ?? existing.clienteId,
    terminalId: payload.terminalId ?? existing.terminalId,
  }
}

/**
 * Confirma que o conflito é REAL comparando a candidata com a ocupante.
 *
 * Preserva o contrato da rota individual: ocupante de outra loja é sempre conflito;
 * na mesma loja, só é conflito quando a identidade técnica difere ou os fatos
 * canônicos não batem. Fatos idênticos + mesma identidade = a própria venda já
 * gravada, e o caminho correto é reconciliar, não renumerar.
 */
async function confirmConflict(
  db: ReadClient,
  storeId: string,
  conflictingPedidoId: string,
  clientSaleId: string,
  candidate: QuarantineCandidate,
): Promise<
  | { ok: true; occupantOtherStore: boolean; occupantStoreId: string }
  | { ok: false; code: string; reason: string }
> {
  const occupant = await db.venda.findUnique({
    where: { pedidoId: conflictingPedidoId },
    select: VENDA_REPLAY_SELECT,
  })
  if (!occupant) {
    return {
      ok: false,
      code: "CONFLICT_NOT_CONFIRMED",
      reason: "Não há conflito confirmado para este número. Use o reenvio normal.",
    }
  }
  if (occupant.clientSaleId === clientSaleId && occupant.storeId === storeId) {
    return {
      ok: false,
      code: "CONFLICT_NOT_CONFIRMED",
      reason: "Esta tentativa já está gravada com o número informado.",
    }
  }

  const occupantOtherStore = occupant.storeId !== storeId
  const occupantFacts = factsFromOccupantPayload(occupant)
  const occupantSameStoreDifferentFacts =
    occupant.storeId === storeId &&
    (occupant.clientSaleId !== clientSaleId ||
      !isLegacySaleFactsComparable(candidate) ||
      !isLegacySaleFactsComparable(occupantFacts) ||
      buildLegacySaleFingerprint(candidate) !== buildLegacySaleFingerprint(occupantFacts))

  if (!occupantOtherStore && !occupantSameStoreDifferentFacts) {
    return {
      ok: false,
      code: "CONFLICT_NOT_CONFIRMED",
      reason: "Não há conflito confirmado para este número. Use o reenvio normal.",
    }
  }
  return { ok: true, occupantOtherStore, occupantStoreId: occupant.storeId }
}

/**
 * Recupera UMA venda em quarentena. Nunca lança: devolve sempre um resultado
 * classificado, para que o lote isole falha por item (um erro não invalida as demais).
 *
 * Sem transação abrangente: cada venda usa a própria transação de `persistSaleV2`.
 */
export async function executeQuarantineRecovery(
  input: ExecuteQuarantineRecoveryInput,
): Promise<QuarantineRecoveryResult> {
  const { storeId, candidate, motivo, operadorLabel } = input
  const db = input.db ?? prisma
  const allowClosedOriginalSession = input.allowClosedOriginalSession === true

  const facts = input.facts ?? (await readQuarantineServerFacts({ storeId, candidate, db }))
  const item = classifyQuarantineCandidate({ storeId, candidate, facts })
  const ref = { conflictingPedidoId: item.conflictingPedidoId, clientSaleId: item.clientSaleId }

  // Gate do writer — defesa em profundidade, sem bypass.
  if (!isRecoveryWriterEnabled()) {
    return resultFrom(
      ref,
      QUARANTINE_RECOVERY_STATUS.BLOCKED,
      SALE_WRITER_V1_ACTIVE_CODE,
      "Writer V1 ativo. Recovery V2 indisponível.",
    )
  }

  if (item.klass === QUARANTINE_RECOVERY_CLASS.ALREADY_RECOVERED) {
    const existing = item.clientSaleId
      ? await db.venda.findFirst({
          where: { storeId, clientSaleId: item.clientSaleId },
          select: VENDA_REPLAY_SELECT,
        })
      : null
    return resultFrom(
      ref,
      QUARANTINE_RECOVERY_STATUS.ALREADY_RECOVERED,
      null,
      item.reason,
      {
        replayed: true,
        venda: existing
          ? {
              id: existing.id,
              storeId: existing.storeId,
              pedidoId: existing.pedidoId,
              clientSaleId: existing.clientSaleId ?? null,
              total: existing.total,
              at: existing.at.toISOString(),
              clienteNome: existing.clienteNome,
              clienteId: existing.clienteId,
              terminalId: existing.terminalId,
              status: existing.status,
            }
          : null,
      },
    )
  }

  if (!isExecutableClass(item.klass)) {
    return resultFrom(ref, QUARANTINE_RECOVERY_STATUS.BLOCKED, item.klass, item.reason)
  }

  // Sessão original fechada exige autorização EXPLÍCITA por execução.
  if (
    item.klass === QUARANTINE_RECOVERY_CLASS.REQUIRES_CLOSED_SESSION_CONFIRM &&
    !allowClosedOriginalSession
  ) {
    return resultFrom(
      ref,
      QUARANTINE_RECOVERY_STATUS.REQUIRES_CONFIRMATION,
      "CAIXA_ORIGINAL_FECHADO",
      item.reason,
    )
  }

  const clientSaleId = item.clientSaleId
  if (!clientSaleId) {
    return resultFrom(
      ref,
      QUARANTINE_RECOVERY_STATUS.BLOCKED,
      QUARANTINE_RECOVERY_CLASS.MISSING_CLIENT_SALE_ID,
      "Sem identidade técnica utilizável.",
    )
  }

  const confirmed = await confirmConflict(
    db,
    storeId,
    item.conflictingPedidoId,
    clientSaleId,
    candidate,
  )
  if (!confirmed.ok) {
    return resultFrom(
      ref,
      QUARANTINE_RECOVERY_STATUS.BLOCKED,
      confirmed.code,
      confirmed.reason,
    )
  }

  const recoverySale = {
    ...(candidate as unknown as SalePayload),
    clientSaleId,
    recovery: {
      recoveredFromPedidoId: item.conflictingPedidoId,
      recoveredAt: new Date().toISOString(),
      motivo,
      conflictCode:
        item.conflictCode ??
        (confirmed.occupantOtherStore
          ? "PEDIDO_ID_DE_OUTRA_LOJA"
          : "PEDIDO_ID_CONFLITO_MESMA_LOJA"),
      occupantStoreId: confirmed.occupantStoreId,
    },
  } as SalePayload

  try {
    const result = await persistSaleV2({
      storeId,
      sale: recoverySale,
      clientSaleId,
      operadorLabel,
      options: {
        enforceStock: true,
        requireCaixaSession: true,
        allowClosedOriginalSession,
      },
    })
    return resultFrom(
      ref,
      result.replayed
        ? QUARANTINE_RECOVERY_STATUS.ALREADY_RECOVERED
        : QUARANTINE_RECOVERY_STATUS.RECOVERED,
      null,
      result.replayed
        ? "Venda já existia no servidor com esta identidade técnica."
        : "Venda recuperada com novo número server-side.",
      { venda: result.venda, replayed: result.replayed },
    )
  } catch (error) {
    return classifyRecoveryFailure(ref, error)
  }
}

/** Mapeia as exceções do motor para status/código estáveis. */
export function classifyRecoveryFailure(
  ref: Pick<QuarantineRecoveryPlanItem, "conflictingPedidoId" | "clientSaleId">,
  error: unknown,
): QuarantineRecoveryResult {
  if (error instanceof CaixaOriginalFechadoError) {
    return resultFrom(
      ref,
      QUARANTINE_RECOVERY_STATUS.REQUIRES_CONFIRMATION,
      error.code,
      error.message,
    )
  }
  if (
    error instanceof InvalidClientSaleIdError ||
    error instanceof ClientSaleIdReusedError ||
    error instanceof PedidoIdDeOutraLojaError ||
    error instanceof PedidoIdConflitoMesmaLojaError ||
    error instanceof CaixaSessaoInvalidaError ||
    error instanceof UnresolvedProductError ||
    error instanceof InsufficientStockError
  ) {
    return resultFrom(ref, QUARANTINE_RECOVERY_STATUS.BLOCKED, error.code, error.message)
  }
  if (isSaleNumberingError(error)) {
    return resultFrom(ref, QUARANTINE_RECOVERY_STATUS.BLOCKED, error.code, error.message)
  }
  const message = error instanceof Error ? error.message : String(error)
  return resultFrom(ref, QUARANTINE_RECOVERY_STATUS.FAILED, null, message)
}

// ─────────────────────────────────────────────────────────────────────────────
// Lote
// ─────────────────────────────────────────────────────────────────────────────

export type BatchQuarantineRecoveryInput = {
  storeId: string
  candidates: readonly QuarantineCandidate[]
  motivo: string
  operadorLabel?: string
  /** Autoriza lançamento retroativo nas sessões ORIGINAIS fechadas do lote. */
  allowClosedOriginalSession?: boolean
  db?: ReadClient
}

export type BatchQuarantineRecoverySummary = {
  readonly total: number
  readonly recovered: number
  readonly alreadyRecovered: number
  readonly requiresConfirmation: number
  readonly blocked: number
  readonly failed: number
}

export function summarizeBatchResults(
  results: readonly QuarantineRecoveryResult[],
): BatchQuarantineRecoverySummary {
  let recovered = 0
  let alreadyRecovered = 0
  let requiresConfirmation = 0
  let blocked = 0
  let failed = 0
  for (const result of results) {
    switch (result.status) {
      case QUARANTINE_RECOVERY_STATUS.RECOVERED:
        recovered += 1
        break
      case QUARANTINE_RECOVERY_STATUS.ALREADY_RECOVERED:
        alreadyRecovered += 1
        break
      case QUARANTINE_RECOVERY_STATUS.REQUIRES_CONFIRMATION:
        requiresConfirmation += 1
        break
      case QUARANTINE_RECOVERY_STATUS.BLOCKED:
        blocked += 1
        break
      default:
        failed += 1
    }
  }
  return {
    total: results.length,
    recovered,
    alreadyRecovered,
    requiresConfirmation,
    blocked,
    failed,
  }
}

/**
 * Executa o lote SEQUENCIALMENTE, uma transação por venda.
 *
 * Isolamento é requisito, não detalhe: uma venda bloqueada ou com falha de
 * infraestrutura não impede as demais, e nenhuma transação abrange dezenas de
 * vendas (um `InsufficientStockError` no item 40 não pode desfazer os 39 anteriores).
 */
export async function executeQuarantineRecoveryBatch(
  input: BatchQuarantineRecoveryInput,
): Promise<{
  results: QuarantineRecoveryResult[]
  summary: BatchQuarantineRecoverySummary
}> {
  const results: QuarantineRecoveryResult[] = []
  for (const candidate of input.candidates) {
    try {
      results.push(
        await executeQuarantineRecovery({
          storeId: input.storeId,
          candidate,
          motivo: input.motivo,
          operadorLabel: input.operadorLabel,
          allowClosedOriginalSession: input.allowClosedOriginalSession,
          db: input.db,
        }),
      )
    } catch (error) {
      // `executeQuarantineRecovery` não deveria lançar; se lançar, o lote continua.
      results.push(
        classifyRecoveryFailure(
          {
            conflictingPedidoId: text(candidate.id) ?? "",
            clientSaleId: text(candidate.clientSaleId),
          },
          error,
        ),
      )
    }
  }
  return { results, summary: summarizeBatchResults(results) }
}
