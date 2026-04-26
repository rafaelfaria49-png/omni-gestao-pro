import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getVerifiedSubscriptionFromCookies } from "@/lib/api-auth"
import { isVencimentoExpired } from "@/lib/subscription-seal"
import { getTrustedTimeMs } from "@/lib/trusted-time"
import type { Prisma } from "@/generated/prisma"
import { StatusOrdemServico } from "@/generated/prisma"
import { storeIdFromAssistecRequestForRead, storeIdFromAssistecRequestForWrite } from "@/lib/store-id-from-request"
import { requireAdmin } from "@/lib/require-admin"

export const runtime = "nodejs"

async function requireSubscription() {
  const sub = await getVerifiedSubscriptionFromCookies()
  if (!sub.ok) {
    return { ok: false as const, res: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) }
  }
  const now = await getTrustedTimeMs()
  if (isVencimentoExpired(now, sub.vencimento) || sub.status !== "ativa") {
    return { ok: false as const, res: NextResponse.json({ error: "Assinatura inválida" }, { status: 403 }) }
  }
  return { ok: true as const, sub }
}

export async function GET(req: Request) {
  const gate = await requireSubscription()
  if (!gate.ok) return gate.res
  const storeId = storeIdFromAssistecRequestForRead(req)
  try {
    const rows = await prisma.ordemServico.findMany({
      where: { storeId },
      orderBy: { updatedAt: "desc" },
    })
    const ordens = rows.map((r) => (r.payload ?? {}) as Record<string, unknown>)
    return NextResponse.json({ ordens })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[ops/ordens GET]", msg)
    const dev = process.env.NODE_ENV === "development"
    return NextResponse.json(
      { error: "Falha ao carregar ordens", ...(dev ? { detail: msg } : {}) },
      { status: 503 }
    )
  }
}

export async function PUT(req: Request) {
  const gate = await requireSubscription()
  if (!gate.ok) return gate.res
  const adminGate = await requireAdmin()
  if (!adminGate.ok) return adminGate.res
  const storeId = storeIdFromAssistecRequestForWrite(req)
  if (!storeId) {
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

  const list = (body as { ordens?: unknown }).ordens
  if (!Array.isArray(list)) {
    return NextResponse.json({ error: "ordens deve ser um array" }, { status: 400 })
  }

  const rows: {
    id: string
    storeId: string
    numero: string
    payload: Prisma.InputJsonValue
    clienteId: null
    equipamento: string
    defeito: string
    valorBase: number
    valorTotal: number
    status: StatusOrdemServico
  }[] = []
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue
    const o = raw as Record<string, unknown>
    const id = typeof o.id === "string" ? o.id : ""
    const numero = typeof o.numero === "string" ? o.numero : ""
    if (!id || !numero) continue
    rows.push({
      id,
      storeId,
      numero,
      payload: o as Prisma.InputJsonValue,
      clienteId: null,
      equipamento: "",
      defeito: "",
      valorBase: 0,
      valorTotal: 0,
      status: StatusOrdemServico.Aberto,
    })
  }

  try {
    await prisma.$transaction([
      prisma.ordemServico.deleteMany({ where: { storeId } }),
      prisma.ordemServico.createMany({ data: rows }),
    ])
    return NextResponse.json({ ok: true, count: rows.length })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[ops/ordens PUT]", msg)
    const dev = process.env.NODE_ENV === "development"
    return NextResponse.json(
      { error: "Falha ao salvar ordens", ...(dev ? { detail: msg } : {}) },
      { status: 503 }
    )
  }
}
