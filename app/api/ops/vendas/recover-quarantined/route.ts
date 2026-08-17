import { NextResponse } from "next/server"
import { prismaEnsureConnected } from "@/lib/prisma"
import { opsLojaIdFromRequestForWrite } from "@/lib/ops-api-gate"
import { requireAdmin } from "@/lib/require-admin"
import { canAccessStore } from "@/lib/auth/enterprise-permissions"
import { getOperatorLabelFromSession } from "@/lib/auth/session-operator"
import type { SalePayload } from "@/lib/ops-upsert-venda"
import { parseClientSaleId, SALE_WRITER_FLOW } from "@/lib/vendas/sale-identity-contracts"
import { resolveSaleNumberingWriter } from "@/lib/vendas/sale-numbering-runtime-gate"
import { isSaleIdentityConflictCode } from "@/lib/vendas/sale-identity-conflict"
import type { QuarantineCandidate } from "@/lib/vendas/quarantine-recovery-planner"
import {
  QUARANTINE_RECOVERY_STATUS,
  executeQuarantineRecovery,
} from "@/lib/vendas/quarantine-recovery-service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

function jsonError(error: string, code: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, code, ...extra }, { status })
}

/**
 * Recovery ADMINISTRADO de UMA venda em quarentena (colisão de `pedidoId`).
 *
 * A decisão e a escrita vivem no núcleo compartilhado
 * (`lib/vendas/quarantine-recovery-service.ts`), o MESMO usado pelo lote — esta rota
 * só faz gate, validação de entrada e tradução do resultado para HTTP. Gera novo
 * número server-side via Writer V2 e nunca altera a venda ocupante.
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
    return jsonError("Writer V1 ativo. Recovery V2 indisponível.", "SALE_WRITER_V1_ACTIVE", 409)
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

  // O núcleo classifica pelo `syncBlockedCode` da cópia local; a rota aceita também o
  // `conflictCode` explícito do corpo (contrato histórico deste endpoint). Ambos são
  // validados contra a lista fechada de códigos, e o conflito real continua sendo
  // confirmado contra a ocupante — o código sozinho não autoriza nada.
  const localCode =
    typeof (sale as { syncBlockedCode?: unknown }).syncBlockedCode === "string"
      ? (sale as { syncBlockedCode?: string }).syncBlockedCode
      : undefined
  const candidate: QuarantineCandidate = {
    ...(sale as unknown as Record<string, unknown>),
    id: conflictingPedidoId,
    clientSaleId: parsed.clientSaleId,
    syncBlockedCode: isSaleIdentityConflictCode(localCode) ? localCode : conflictCode,
  }

  await prismaEnsureConnected()

  const result = await executeQuarantineRecovery({
    storeId: lojaId,
    candidate,
    motivo,
    operadorLabel: getOperatorLabelFromSession(adminGate.session),
    allowClosedOriginalSession,
  })

  if (
    result.status === QUARANTINE_RECOVERY_STATUS.RECOVERED ||
    result.status === QUARANTINE_RECOVERY_STATUS.ALREADY_RECOVERED
  ) {
    return NextResponse.json({
      ok: true,
      replayed: result.replayed,
      recovered: true,
      venda: result.venda,
    })
  }

  if (result.status === QUARANTINE_RECOVERY_STATUS.FAILED) {
    console.error("[ops/vendas/recover-quarantined]", lojaId, result.reason)
    return NextResponse.json({ error: result.reason }, { status: 500 })
  }

  // BLOCKED e REQUIRES_CONFIRMATION são 409 — inclusive `CAIXA_ORIGINAL_FECHADO`,
  // que a UI usa para pedir a confirmação de lançamento retroativo.
  return jsonError(result.reason, result.code ?? "RECOVERY_BLOCKED", 409)
}
