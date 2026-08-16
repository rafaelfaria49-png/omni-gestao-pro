import { NextResponse } from "next/server"
import { prisma, prismaEnsureConnected } from "@/lib/prisma"
import { opsLojaIdFromRequestForWrite } from "@/lib/ops-api-gate"
import { requireAdmin } from "@/lib/require-admin"
import { canAccessStore } from "@/lib/auth/enterprise-permissions"
import { getOperatorLabelFromSession } from "@/lib/auth/session-operator"
import {
  InsufficientStockError,
  UnresolvedProductError,
  CaixaSessaoInvalidaError,
  CaixaOriginalFechadoError,
  ClientSaleIdReusedError,
  InvalidClientSaleIdError,
  PedidoIdDeOutraLojaError,
  PedidoIdConflitoMesmaLojaError,
  VENDA_REPLAY_SELECT,
  type SalePayload,
} from "@/lib/ops-upsert-venda"
import { persistSaleV2 } from "@/lib/vendas/sale-writer-v2"
import { parseClientSaleId, SALE_WRITER_FLOW } from "@/lib/vendas/sale-identity-contracts"
import { resolveSaleNumberingWriter } from "@/lib/vendas/sale-numbering-runtime-gate"
import { isSaleNumberingError } from "@/lib/vendas/server-sale-numbering"
import { isSaleIdentityConflictCode } from "@/lib/vendas/sale-identity-conflict"
import { buildLegacySaleFingerprint, isLegacySaleFactsComparable } from "@/lib/vendas/legacy-sale-fingerprint"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

function jsonError(error: string, code: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, code, ...extra }, { status })
}

function factsFromPayload(existing: { pedidoId: string; payload: unknown; total: number; clienteNome: string | null; clienteId: string | null; terminalId: string | null }) {
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
 * Recovery ADMINISTRADO de venda em quarentena (colisão de pedidoId).
 * Gera novo número server-side via Writer V2. Nunca altera a venda ocupante.
 */
export async function POST(req: Request) {
  const lojaId = opsLojaIdFromRequestForWrite(req)
  if (!lojaId) {
    return NextResponse.json(
      { error: "Unidade obrigatória: envie o header x-assistec-loja-id ou query storeId / lojaId." },
      { status: 400 },
    )
  }

  const adminGate = await requireAdmin()
  if (!adminGate.ok) return adminGate.res
  if (!canAccessStore(adminGate.session, lojaId)) {
    return jsonError("Sem acesso à loja.", "STORE_FORBIDDEN", 403)
  }

  const gate = resolveSaleNumberingWriter()
  if (gate.writer !== SALE_WRITER_FLOW.V2) {
    return jsonError(
      "Writer V1 ativo. Recovery V2 indisponível.",
      "SALE_WRITER_V1_ACTIVE",
      409,
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 })
  }

  const bodyObj = body as {
    sale?: SalePayload
    clientSaleId?: unknown
    motivo?: unknown
    conflictingPedidoId?: unknown
    conflictCode?: unknown
    allowClosedOriginalSession?: unknown
    retroactiveClosedSession?: unknown
  }

  const motivo = typeof bodyObj.motivo === "string" ? bodyObj.motivo.trim() : ""
  if (motivo.length < 5) {
    return jsonError("Motivo obrigatório (mínimo 5 caracteres).", "MOTIVO_REQUIRED", 400)
  }

  const parsed = parseClientSaleId(bodyObj.clientSaleId ?? bodyObj.sale?.clientSaleId)
  if (!parsed.ok) {
    return jsonError("clientSaleId obrigatório.", "CLIENT_SALE_ID_REQUIRED", 400, {
      reason: parsed.reason,
    })
  }

  const sale = bodyObj.sale
  if (!sale || typeof sale !== "object") {
    return NextResponse.json({ error: "sale obrigatório" }, { status: 400 })
  }

  const conflictCode =
    typeof bodyObj.conflictCode === "string" ? bodyObj.conflictCode.trim() : undefined
  if (conflictCode && !isSaleIdentityConflictCode(conflictCode)) {
    return jsonError("Código de conflito inválido.", "INVALID_CONFLICT_CODE", 400)
  }

  const conflictingPedidoId =
    typeof bodyObj.conflictingPedidoId === "string" && bodyObj.conflictingPedidoId.trim()
      ? bodyObj.conflictingPedidoId.trim()
      : typeof sale.id === "string"
        ? sale.id.trim()
        : ""
  if (!conflictingPedidoId) {
    return jsonError("Número conflitante obrigatório.", "CONFLICTING_PEDIDO_ID_REQUIRED", 400)
  }

  const allowClosedOriginalSession =
    bodyObj.allowClosedOriginalSession === true || bodyObj.retroactiveClosedSession === true

  await prismaEnsureConnected()

  const already = await prisma.venda.findFirst({
    where: { storeId: lojaId, clientSaleId: parsed.clientSaleId },
    select: VENDA_REPLAY_SELECT,
  })
  if (already) {
    return NextResponse.json({
      ok: true,
      replayed: true,
      recovered: true,
      venda: {
        id: already.id,
        storeId: already.storeId,
        pedidoId: already.pedidoId,
        clientSaleId: already.clientSaleId,
        total: already.total,
        at: already.at.toISOString(),
        clienteNome: already.clienteNome,
        clienteId: already.clienteId,
        terminalId: already.terminalId,
        status: already.status,
      },
    })
  }

  const occupant = await prisma.venda.findUnique({
    where: { pedidoId: conflictingPedidoId },
    select: VENDA_REPLAY_SELECT,
  })
  if (!occupant) {
    return jsonError(
      "Não há conflito confirmado para este número. Use o reenvio normal.",
      "CONFLICT_NOT_CONFIRMED",
      409,
    )
  }
  if (occupant.clientSaleId === parsed.clientSaleId && occupant.storeId === lojaId) {
    return jsonError(
      "Esta tentativa já está gravada com o número informado.",
      "CONFLICT_NOT_CONFIRMED",
      409,
    )
  }

  const occupantOtherStore = occupant.storeId !== lojaId
  const occupantSameStoreDifferentFacts = occupant.storeId === lojaId && (
    occupant.clientSaleId !== parsed.clientSaleId ||
    !isLegacySaleFactsComparable(sale) ||
    !isLegacySaleFactsComparable(factsFromPayload(occupant)) ||
    buildLegacySaleFingerprint(sale) !== buildLegacySaleFingerprint(factsFromPayload(occupant))
  )
  if (!occupantOtherStore && !occupantSameStoreDifferentFacts) {
    return jsonError(
      "Não há conflito confirmado para este número. Use o reenvio normal.",
      "CONFLICT_NOT_CONFIRMED",
      409,
    )
  }

  const recoverySale: SalePayload = {
    ...sale,
    clientSaleId: parsed.clientSaleId,
    recovery: {
      recoveredFromPedidoId: conflictingPedidoId,
      recoveredAt: new Date().toISOString(),
      motivo,
      conflictCode: conflictCode ?? (occupantOtherStore ? "PEDIDO_ID_DE_OUTRA_LOJA" : "PEDIDO_ID_CONFLITO_MESMA_LOJA"),
      occupantStoreId: occupantOtherStore ? "other" : lojaId,
    },
  } as SalePayload & { recovery?: unknown }

  try {
    const result = await persistSaleV2({
      storeId: lojaId,
      sale: recoverySale,
      clientSaleId: parsed.clientSaleId,
      operadorLabel: getOperatorLabelFromSession(adminGate.session),
      options: {
        enforceStock: true,
        requireCaixaSession: true,
        allowClosedOriginalSession,
      },
    })
    return NextResponse.json({
      ok: true,
      replayed: result.replayed,
      recovered: true,
      venda: result.venda,
    })
  } catch (e) {
    if (e instanceof InvalidClientSaleIdError) {
      return jsonError(e.message, e.code, 400)
    }
    if (e instanceof ClientSaleIdReusedError) {
      return jsonError(e.message, e.code, 409)
    }
    if (e instanceof PedidoIdDeOutraLojaError || e instanceof PedidoIdConflitoMesmaLojaError) {
      return jsonError(e.message, e.code, 409)
    }
    if (e instanceof CaixaSessaoInvalidaError || e instanceof CaixaOriginalFechadoError) {
      return jsonError(e.message, e.code, 409)
    }
    if (e instanceof UnresolvedProductError) {
      return jsonError(e.message, e.code, 409)
    }
    if (e instanceof InsufficientStockError) {
      return NextResponse.json(
        { error: "Estoque insuficiente", detail: e.message, code: e.code },
        { status: 409 },
      )
    }
    if (isSaleNumberingError(e)) {
      return jsonError(e.message, e.code, 409)
    }
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[ops/vendas/recover-quarantined]", lojaId, msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
