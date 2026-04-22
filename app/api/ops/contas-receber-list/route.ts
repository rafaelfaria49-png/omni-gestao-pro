import { NextResponse } from "next/server"
import { prisma, prismaEnsureConnected } from "@/lib/prisma"
import { requireOpsSubscription, opsLojaIdFromRequest } from "@/lib/ops-api-gate"
import type { ContaReceberRow } from "@/lib/contas-receber-types"

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

export async function GET(req: Request) {
  const gate = await requireOpsSubscription()
  if (!gate.ok) {
    const dev = process.env.NODE_ENV === "development"
    if (!dev) return gate.res
  }

  const lojaId = opsLojaIdFromRequest(req)

  try {
    await prismaEnsureConnected()
    const rows = await prisma.contaReceberTitulo.findMany({
      where: { storeId: lojaId },
      orderBy: { updatedAt: "desc" },
    })

    const out: ContaReceberRow[] = []
    for (const r of rows) {
      const lk = r.localKey?.trim() || r.id
      if (!lk) continue
      const fromPayload = rowFromPayload(lk, r.payload)
      if (fromPayload) {
        out.push(fromPayload)
        continue
      }
      out.push({
        id: lk,
        descricao: r.descricao,
        cliente: r.cliente,
        valor: r.valor,
        vencimento: r.vencimento,
        status: r.status,
        tipo: "Manual",
      })
    }

    return NextResponse.json({
      rows: out,
      _lojaIdRecebido: lojaId,
      _gateBypassedInDev: !gate.ok && process.env.NODE_ENV === "development",
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
