import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getVerifiedSubscriptionFromCookies } from "@/lib/api-auth"
import { isVencimentoExpired } from "@/lib/subscription-seal"
import { getTrustedTimeMs } from "@/lib/trusted-time"
import type { Prisma } from "@/generated/prisma"

export const runtime = "nodejs"

type InvPayload = {
  id: string
  name: string
  stock: number
  cost: number
  price: number
  category: string
  vendaPorPeso?: boolean
  precoPorKg?: number
  atributos?: unknown
}

function itemToCreate(lojaId: string, item: InvPayload) {
  return {
    id: item.id,
    lojaId,
    name: item.name,
    stock: Math.max(0, Math.floor(item.stock)),
    cost: item.cost,
    price: item.price,
    category: item.category ?? "",
    vendaPorPeso: item.vendaPorPeso ?? false,
    precoPorKg: item.precoPorKg ?? null,
    atributos: (item.atributos ?? null) as Prisma.InputJsonValue,
  }
}

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

function lojaIdFromRequest(req: Request): string {
  const h = req.headers.get("x-assistec-loja-id")?.trim()
  if (h) return h
  const url = new URL(req.url)
  const q = url.searchParams.get("lojaId")?.trim()
  return q || "loja-1"
}

export async function PUT(req: Request) {
  const gate = await requireSubscription()
  if (!gate.ok) return gate.res
  const lojaId = lojaIdFromRequest(req)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 })
  }

  const items = (body as { items?: unknown }).items
  const replace = Boolean((body as { replace?: unknown }).replace)
  const batchIndex = typeof (body as { batchIndex?: unknown }).batchIndex === "number" ? (body as { batchIndex: number }).batchIndex : 0

  if (!Array.isArray(items)) {
    return NextResponse.json({ error: "items deve ser um array" }, { status: 400 })
  }

  const normalized: InvPayload[] = []
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue
    const o = raw as Record<string, unknown>
    const id = typeof o.id === "string" ? o.id.trim() : ""
    const name = typeof o.name === "string" ? o.name.trim() : ""
    if (!id || !name) continue
    normalized.push({
      id,
      name,
      stock: typeof o.stock === "number" && Number.isFinite(o.stock) ? o.stock : 0,
      cost: typeof o.cost === "number" && Number.isFinite(o.cost) ? o.cost : 0,
      price: typeof o.price === "number" && Number.isFinite(o.price) ? o.price : 0,
      category: typeof o.category === "string" ? o.category : "",
      vendaPorPeso: Boolean(o.vendaPorPeso),
      precoPorKg: typeof o.precoPorKg === "number" && Number.isFinite(o.precoPorKg) ? o.precoPorKg : undefined,
      atributos: Array.isArray(o.atributos) ? o.atributos : undefined,
    })
  }

  try {
    if (replace && batchIndex === 0) {
      await prisma.estoqueProduto.deleteMany({ where: { lojaId } })
    }
    await prisma.estoqueProduto.createMany({
      data: normalized.map((it) => itemToCreate(lojaId, it)),
      skipDuplicates: true,
    })
    return NextResponse.json({ ok: true, count: normalized.length })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[ops/inventory/import PUT]", msg)
    const dev = process.env.NODE_ENV === "development"
    return NextResponse.json(
      { error: "Falha ao importar estoque", ...(dev ? { detail: msg } : {}) },
      { status: 503 }
    )
  }
}

