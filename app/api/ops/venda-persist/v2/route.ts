import { NextResponse } from "next/server"
import { prisma, prismaEnsureConnected } from "@/lib/prisma"
import { opsLojaIdFromRequestForWrite } from "@/lib/ops-api-gate"
import { apiGuardEnterpriseOrOps } from "@/lib/auth/api-enterprise-guard"
import { auth } from "@/auth"
import { getOperatorLabelFromSession } from "@/lib/auth/session-operator"
import {
  InsufficientStockError,
  UnresolvedProductError,
  CaixaSessaoInvalidaError,
  CaixaOriginalFechadoError,
  PedidoIdDeOutraLojaError,
  PedidoIdConflitoMesmaLojaError,
  InvalidClientSaleIdError,
  ClientSaleIdReusedError,
  type SalePayload,
} from "@/lib/ops-upsert-venda"
import { persistSaleV2 } from "@/lib/vendas/sale-writer-v2"
import {
  isSaleNumberingError,
  SALE_NUMBERING_ERROR_CODES,
} from "@/lib/vendas/server-sale-numbering"
import { resolveSaleNumberingWriter } from "@/lib/vendas/sale-numbering-runtime-gate"
import { parseClientSaleId, SALE_WRITER_FLOW } from "@/lib/vendas/sale-identity-contracts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

function jsonError(error: string, code: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, code, ...extra }, { status })
}

export async function GET(req: Request) {
  const lojaId = opsLojaIdFromRequestForWrite(req)
  if (!lojaId) {
    return NextResponse.json(
      { error: "Unidade obrigatória: envie o header x-assistec-loja-id ou query storeId / lojaId." },
      { status: 400 },
    )
  }
  const denied = await apiGuardEnterpriseOrOps(
    lojaId,
    (p) => p.hubs.vendas,
    "Sem permissão para registrar vendas.",
  )
  if (denied) return denied

  const gate = resolveSaleNumberingWriter()
  return NextResponse.json({
    ok: true,
    writer: gate.writer,
    reason: gate.reason,
  })
}

export async function POST(req: Request) {
  const lojaId = opsLojaIdFromRequestForWrite(req)
  if (!lojaId) {
    return NextResponse.json(
      { error: "Unidade obrigatória: envie o header x-assistec-loja-id ou query storeId / lojaId." },
      { status: 400 },
    )
  }

  const gate = resolveSaleNumberingWriter()
  if (gate.writer !== SALE_WRITER_FLOW.V2) {
    return jsonError(
      "Writer V1 ativo. Use /api/ops/venda-persist.",
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

  const sale = (body as { sale?: SalePayload }).sale
  if (!sale || typeof sale !== "object") {
    return NextResponse.json({ error: "sale obrigatório" }, { status: 400 })
  }

  const bodyObj = body as {
    clientSaleId?: unknown
    allowClosedOriginalSession?: unknown
    retroactiveClosedSession?: unknown
  }
  const parsedClientSaleId = parseClientSaleId(bodyObj.clientSaleId ?? sale.clientSaleId)
  if (!parsedClientSaleId.ok) {
    return jsonError("clientSaleId obrigatório.", "CLIENT_SALE_ID_REQUIRED", 400, {
      reason: parsedClientSaleId.reason,
    })
  }

  const allowClosedOriginalSession =
    bodyObj.allowClosedOriginalSession === true || bodyObj.retroactiveClosedSession === true

  const denied = await apiGuardEnterpriseOrOps(
    lojaId,
    (p) => p.hubs.vendas,
    "Sem permissão para registrar vendas.",
  )
  if (denied) return denied

  const session = await auth()
  const operadorLabel = session?.user ? getOperatorLabelFromSession(session) : undefined

  try {
    await prismaEnsureConnected()
    const result = await persistSaleV2({
      storeId: lojaId,
      sale,
      clientSaleId: parsedClientSaleId.clientSaleId,
      operadorLabel,
      options: {
        enforceStock: true,
        requireCaixaSession: true,
        allowClosedOriginalSession,
      },
    })
    return NextResponse.json({ ok: true, replayed: result.replayed, venda: result.venda })
  } catch (e) {
    if (e instanceof InvalidClientSaleIdError) {
      return jsonError(e.message, e.code, 400, { reason: e.reason })
    }
    if (e instanceof ClientSaleIdReusedError) {
      return jsonError(e.message, e.code, 409)
    }
    if (e instanceof PedidoIdDeOutraLojaError) {
      console.warn(
        "[ops/venda-persist/v2] pedido-id-de-outra-loja",
        JSON.stringify({ lojaIdSolicitante: lojaId, ownerStoreId: e.ownerStoreId }),
      )
      return jsonError(e.message, e.code, 409)
    }
    if (e instanceof PedidoIdConflitoMesmaLojaError) {
      return jsonError(e.message, e.code, 409)
    }
    if (e instanceof CaixaSessaoInvalidaError) {
      return jsonError(e.message, e.code, 409)
    }
    if (e instanceof CaixaOriginalFechadoError) {
      return jsonError(e.message, e.code, 409)
    }
    if (e instanceof UnresolvedProductError) {
      return jsonError(e.message, e.code, 409, { inventoryIds: e.inventoryIds })
    }
    if (e instanceof InsufficientStockError) {
      return NextResponse.json(
        { error: "Estoque insuficiente", detail: e.message, code: e.code },
        { status: 409 },
      )
    }
    if (isSaleNumberingError(e)) {
      const code = SALE_NUMBERING_ERROR_CODES.includes(e.code) ? e.code : "SALE_NUMBERING_INVARIANT_BROKEN"
      return jsonError(e.message, code, 409)
    }
    const msg = e instanceof Error ? e.message : String(e)
    const code =
      e && typeof e === "object" && "code" in e && typeof (e as { code: unknown }).code === "string"
        ? (e as { code: string }).code
        : undefined
    console.error("[ops/venda-persist/v2]", lojaId, msg, code ?? "")
    return NextResponse.json({ error: msg, ...(code ? { code } : {}) }, { status: 500 })
  }
}
