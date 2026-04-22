import { NextResponse } from "next/server"
import { prisma, prismaEnsureConnected } from "@/lib/prisma"
import { Prisma } from "@/generated/prisma"
import { requireOpsSubscription, opsLojaIdFromRequestForWrite } from "@/lib/ops-api-gate"
import type { ContaReceberRow } from "@/lib/contas-receber-types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

const MAX_ROWS = 8000

function rowToScalar(r: ContaReceberRow) {
  return {
    descricao: typeof r.descricao === "string" ? r.descricao : "",
    cliente: typeof r.cliente === "string" ? r.cliente : "",
    valor: typeof r.valor === "number" && Number.isFinite(r.valor) ? r.valor : 0,
    vencimento: typeof r.vencimento === "string" ? r.vencimento : "",
    status: typeof r.status === "string" ? r.status : "pendente",
  }
}

export async function POST(req: Request) {
  const gate = await requireOpsSubscription()
  if (!gate.ok) return gate.res

  const lojaId = opsLojaIdFromRequestForWrite(req)
  if (!lojaId) {
    return NextResponse.json(
      { error: "Unidade obrigatória: envie o header x-assistec-loja-id ou query storeId / lojaId." },
      { status: 400 }
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 })
  }

  const rows = (body as { rows?: unknown }).rows
  if (!Array.isArray(rows)) {
    return NextResponse.json({ error: "rows deve ser um array" }, { status: 400 })
  }

  const slice = rows.slice(0, MAX_ROWS) as ContaReceberRow[]

  try {
    await prismaEnsureConnected()
    let applied = 0
    for (const raw of slice) {
      if (!raw || typeof raw !== "object") continue
      const r = raw as ContaReceberRow
      const localKey = String(r.id ?? "").trim()
      if (!localKey) continue

      const scal = rowToScalar(r)
      const payload = r as unknown as Prisma.InputJsonValue

      await prisma.contaReceberTitulo.upsert({
        where: { storeId_localKey: { storeId: lojaId, localKey } },
        create: {
          storeId: lojaId,
          localKey,
          payload,
          descricao: scal.descricao,
          cliente: scal.cliente,
          valor: scal.valor,
          vencimento: scal.vencimento,
          status: scal.status,
        },
        update: {
          storeId: lojaId,
          payload,
          descricao: scal.descricao,
          cliente: scal.cliente,
          valor: scal.valor,
          vencimento: scal.vencimento,
          status: scal.status,
        },
      })
      applied += 1
    }

    return NextResponse.json({ ok: true, count: applied })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[ops/contas-receber-persist]", msg)
    const dev = process.env.NODE_ENV === "development"
    return NextResponse.json(
      { error: "Falha ao salvar contas a receber no servidor", ...(dev ? { detail: msg } : {}) },
      { status: 503 }
    )
  }
}
