import { NextResponse } from "next/server"
import { prisma, prismaEnsureConnected } from "@/lib/prisma"
import { opsLojaIdFromRequest } from "@/lib/ops-api-gate"
import { apiGuardFinanceiroViewOrOps } from "@/lib/auth/api-enterprise-guard"
import type { ContaReceberRow } from "@/lib/contas-receber-types"
import { buildContaReceberAuditTrail, buildContaReceberSummary } from "@/lib/financeiro/services"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

function rowFromPayload(localKey: string, payload: unknown): ContaReceberRow | null {
  if (payload && typeof payload === "object") {
    const o = payload as Partial<ContaReceberRow>
    if (o.id !== undefined && String(o.id) === localKey) {
      return o as ContaReceberRow
    }
  }
  return null
}

/**
 * Canonicalidade da listagem (GOAL PDV-RECEBIMENTO-CANONICALIDADE-HARDENING-002 · §2).
 *
 * O `payload` acumula dois papéis: snapshot de apresentação do painel legado E livro-razão
 * do servidor. Devolver o snapshot cru fazia a tela exibir "pendente / valor bruto" para
 * títulos já quitados no servidor. Aqui a metadata visual do snapshot é preservada, mas os
 * campos ESCALARES do registro server-side (que `upsertContaReceber` grava) sobrescrevem o
 * snapshot, e o saldo em aberto canônico é exposto explicitamente em `saldoAberto`.
 */
function canonicalizeRow(
  snapshot: ContaReceberRow | null,
  titulo: { localKey: string | null; id: string; descricao: string; cliente: string; valor: number; vencimento: string; status: string },
  saldoAberto: number,
): ContaReceberRow {
  const lk = titulo.localKey?.trim() || titulo.id
  const base: ContaReceberRow = snapshot ?? {
    id: lk,
    descricao: titulo.descricao,
    cliente: titulo.cliente,
    valor: titulo.valor,
    vencimento: titulo.vencimento,
    status: titulo.status,
    tipo: "Manual",
  }
  return {
    ...base,
    id: lk,
    descricao: titulo.descricao,
    cliente: titulo.cliente,
    valor: titulo.valor,
    vencimento: titulo.vencimento,
    status: titulo.status,
    saldoAberto,
  }
}

export async function GET(req: Request) {
  const lojaId = opsLojaIdFromRequest(req)
  if (!lojaId) return NextResponse.json({ error: "storeId obrigatório" }, { status: 400 })
  const denied = await apiGuardFinanceiroViewOrOps(lojaId, { skipOpsInDev: true })
  if (denied) return denied

  try {
    await prismaEnsureConnected()
    const titulos = await prisma.contaReceberTitulo.findMany({
      where: { storeId: lojaId },
      orderBy: { updatedAt: "desc" },
    })

    const summary = buildContaReceberSummary(titulos)
    const audit = buildContaReceberAuditTrail(titulos)
    const saldoPorId = new Map(audit.map((a) => [a.id, a.saldoAberto]))

    const out: ContaReceberRow[] = []
    for (const r of titulos) {
      const lk = r.localKey?.trim() || r.id
      if (!lk) continue
      out.push(canonicalizeRow(rowFromPayload(lk, r.payload), r, saldoPorId.get(r.id) ?? 0))
    }

    const generatedAt = new Date().toISOString()

    return NextResponse.json({
      ok: true,
      rows: out,
      summary,
      audit,
      metadata: {
        source: "server",
        storeId: lojaId,
        generatedAt,
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[ops/contas-receber-list]", msg)
    const dev = process.env.NODE_ENV === "development"
    return NextResponse.json(
      { error: "Falha ao listar títulos", rows: [], ...(dev ? { detail: msg } : {}) },
      { status: 503 }
    )
  }
}
