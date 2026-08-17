import { NextResponse } from "next/server"
import { prismaEnsureConnected } from "@/lib/prisma"
import { opsLojaIdFromRequestForWrite } from "@/lib/ops-api-gate"
import { requireAdmin } from "@/lib/require-admin"
import { canAccessStore } from "@/lib/auth/enterprise-permissions"
import { getOperatorLabelFromSession } from "@/lib/auth/session-operator"
import type { QuarantineCandidate } from "@/lib/vendas/quarantine-recovery-planner"
import {
  SALE_WRITER_V1_ACTIVE_CODE,
  executeQuarantineRecoveryBatch,
  isRecoveryWriterEnabled,
} from "@/lib/vendas/quarantine-recovery-service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

/** Teto por requisição — mesmo do preview. */
export const MAX_BATCH_CANDIDATES = 500

/**
 * Recuperação ADMINISTRADA EM LOTE de vendas em quarentena.
 *
 * Reutiliza o núcleo compartilhado (`executeQuarantineRecovery` → `persistSaleV2`):
 * não existe segundo motor de persistência. Uma transação POR VENDA — um item
 * bloqueado ou com falha não invalida os demais, e o resultado é parcial por
 * construção.
 *
 * `allowClosedOriginalSession` só vale para sessões ORIGINAIS fechadas e existentes
 * desta loja: a receita é lançada na PRÓPRIA sessão original, nunca no caixa de hoje.
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
    return NextResponse.json({ error: "Sem acesso à loja.", code: "STORE_FORBIDDEN" }, { status: 403 })
  }

  // Gate do writer ANTES de qualquer leitura de negócio. O núcleo revalida.
  if (!isRecoveryWriterEnabled()) {
    return NextResponse.json(
      { error: "Writer V1 ativo. Recovery V2 indisponível.", code: SALE_WRITER_V1_ACTIVE_CODE },
      { status: 409 },
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 })
  }

  const bodyObj = body as {
    candidates?: unknown
    motivo?: unknown
    allowClosedOriginalSession?: unknown
  }

  const motivo = typeof bodyObj.motivo === "string" ? bodyObj.motivo.trim() : ""
  if (motivo.length < 5) {
    return NextResponse.json(
      { error: "Motivo obrigatório (mínimo 5 caracteres).", code: "MOTIVO_REQUIRED" },
      { status: 400 },
    )
  }

  const rawCandidates = bodyObj.candidates
  if (!Array.isArray(rawCandidates)) {
    return NextResponse.json(
      { error: "candidates obrigatório (array).", code: "CANDIDATES_REQUIRED" },
      { status: 400 },
    )
  }
  if (rawCandidates.length === 0) {
    return NextResponse.json(
      { error: "Nenhuma venda enviada.", code: "CANDIDATES_REQUIRED" },
      { status: 400 },
    )
  }
  if (rawCandidates.length > MAX_BATCH_CANDIDATES) {
    return NextResponse.json(
      {
        error: `Máximo de ${MAX_BATCH_CANDIDATES} vendas por lote.`,
        code: "TOO_MANY_CANDIDATES",
      },
      { status: 400 },
    )
  }

  const candidates = rawCandidates.filter(
    (item): item is QuarantineCandidate =>
      item !== null && typeof item === "object" && !Array.isArray(item),
  )

  await prismaEnsureConnected()

  const { results, summary } = await executeQuarantineRecoveryBatch({
    storeId: lojaId,
    candidates,
    motivo,
    operadorLabel: getOperatorLabelFromSession(adminGate.session),
    allowClosedOriginalSession: bodyObj.allowClosedOriginalSession === true,
  })

  // 200 mesmo com itens bloqueados: o lote é parcial por contrato, e o cliente
  // reconcilia por item. Falha de transporte é o único caso não-200.
  return NextResponse.json({ ok: true, storeId: lojaId, results, summary })
}
