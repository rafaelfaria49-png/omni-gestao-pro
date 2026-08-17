import { NextResponse } from "next/server"
import { prismaEnsureConnected } from "@/lib/prisma"
import { opsLojaIdFromRequestForWrite } from "@/lib/ops-api-gate"
import { requireAdmin } from "@/lib/require-admin"
import { canAccessStore } from "@/lib/auth/enterprise-permissions"
import {
  summarizeQuarantinePlan,
  type QuarantineCandidate,
  type QuarantineRecoveryPlanItem,
} from "@/lib/vendas/quarantine-recovery-planner"
import {
  isRecoveryWriterEnabled,
  planQuarantineCandidate,
} from "@/lib/vendas/quarantine-recovery-service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

/** Teto por requisição: evita varredura ilimitada num endpoint autenticado. */
export const MAX_PREVIEW_CANDIDATES = 500

/**
 * DRY-RUN da recuperação de quarentenas. ESTRITAMENTE read-only: só `findFirst`/
 * `findUnique`. Nenhuma venda é criada, alterada ou apagada — nem a ocupante.
 *
 * As candidatas vivem no `localStorage` do navegador (vendas que nunca chegaram ao
 * servidor), por isso o cliente as ENVIA e o servidor apenas as classifica com os
 * fatos reais do banco. É POST por causa do corpo, não porque mute algo.
 *
 * Funciona com o writer v1 ativo: auditar precisa ser possível antes de executar.
 * `writerEnabled: false` informa a UI de que a execução está indisponível.
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

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 })
  }

  const rawCandidates = (body as { candidates?: unknown }).candidates
  if (!Array.isArray(rawCandidates)) {
    return NextResponse.json(
      { error: "candidates obrigatório (array).", code: "CANDIDATES_REQUIRED" },
      { status: 400 },
    )
  }
  if (rawCandidates.length > MAX_PREVIEW_CANDIDATES) {
    return NextResponse.json(
      {
        error: `Máximo de ${MAX_PREVIEW_CANDIDATES} vendas por análise.`,
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

  const items: QuarantineRecoveryPlanItem[] = []
  for (const candidate of candidates) {
    items.push(await planQuarantineCandidate({ storeId: lojaId, candidate }))
  }

  return NextResponse.json({
    ok: true,
    storeId: lojaId,
    writerEnabled: isRecoveryWriterEnabled(),
    /** Nenhuma escrita ocorreu nesta rota. */
    dryRun: true,
    items,
    summary: summarizeQuarantinePlan(items),
    /** Contrato explícito para a UI: a ocupante nunca é tocada. */
    occupantUntouched: true,
  })
}
