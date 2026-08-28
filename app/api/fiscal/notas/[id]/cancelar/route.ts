/**
 * POST /api/fiscal/notas/[id]/cancelar — cancelamento FISCAL de NFC-e autorizada.
 *
 * Distinto de POST /api/vendas/[id]/cancelar (comercial). Não escreve Financeiro/Caixa.
 */
import { NextResponse } from "next/server"
import { opsLojaIdFromRequestForWrite } from "@/lib/ops-api-gate"
import { requireFiscalAdmin } from "@/lib/fiscal/guard-fiscal-admin"
import { getOperatorLabelFromSession } from "@/lib/auth/session-operator"
import { cancelarNfceAutorizadaPersistido } from "@/lib/fiscal/events/cancelamento-prisma"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const storeId = opsLojaIdFromRequestForWrite(req)
  if (!storeId) {
    return NextResponse.json(
      { ok: false, error: "storeId obrigatório (header x-assistec-loja-id)" },
      { status: 400 },
    )
  }

  const acl = await requireFiscalAdmin(storeId)
  if (!acl.ok) {
    return NextResponse.json({ ok: false, error: acl.error }, { status: acl.status })
  }

  const { id: rawId } = await params
  const notaFiscalId = rawId?.trim()
  if (!notaFiscalId) {
    return NextResponse.json({ ok: false, error: "ID da nota fiscal obrigatório" }, { status: 400 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 })
  }
  const justificativa = typeof body === "object" && body && "justificativa" in body
    ? String((body as { justificativa?: unknown }).justificativa ?? "")
    : ""

  const operador = getOperatorLabelFromSession(acl.session) || "Admin"
  const outcome = await cancelarNfceAutorizadaPersistido({
    storeId,
    notaFiscalId,
    justificativa,
    operador,
  })

  return NextResponse.json(
    {
      ok: outcome.ok,
      resultado: outcome.resultado,
      code: outcome.code,
      error: outcome.ok ? undefined : outcome.mensagem,
      mensagem: outcome.mensagem,
      idempotente: outcome.idempotente,
      sequencia: outcome.sequencia,
      notaStatus: outcome.notaStatus,
      vendaFiscalStatus: outcome.vendaFiscalStatus,
      eventoId: outcome.eventoId,
      protocolo: outcome.protocolo,
      cStat: outcome.cStat,
      xmlAutorizadoAlterado: outcome.xmlAutorizadoAlterado,
      financeWriteCount: outcome.financeWriteCount,
    },
    { status: outcome.statusHttp },
  )
}
