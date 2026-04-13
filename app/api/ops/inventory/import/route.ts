import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getVerifiedSubscriptionFromCookies } from "@/lib/api-auth"
import { isVencimentoExpired } from "@/lib/subscription-seal"
import { getTrustedTimeMs } from "@/lib/trusted-time"
import type { Prisma } from "@/generated/prisma"
import { normalizeNameForMatch } from "@/lib/import-normalize"

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
    nameNorm: normalizeNameForMatch(item.name),
    stock: Math.max(0, Math.floor(item.stock)),
    cost: item.cost,
    price: item.price,
    category: item.category ?? "",
    vendaPorPeso: item.vendaPorPeso ?? false,
    precoPorKg: item.precoPorKg ?? null,
    atributos: (item.atributos ?? null) as Prisma.InputJsonValue,
  }
}

function omitId<T extends { id: string }>(data: T): Omit<T, "id"> {
  const { id: _id, ...rest } = data
  return rest
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
    const ids = [...new Set(normalized.map((it) => it.id))]
    const nameNorms = [...new Set(normalized.map((it) => normalizeNameForMatch(it.name)))]

    const existingById = await prisma.estoqueProduto.findMany({
      where: { lojaId, id: { in: ids } },
    })
    const byIdMap = new Map(existingById.map((r) => [r.id, r]))

    const existingByName = await prisma.estoqueProduto.findMany({
      where: { lojaId, nameNorm: { in: nameNorms } },
    })
    const nameNormToId = new Map<string, string>()
    for (const r of existingByName) {
      if (!nameNormToId.has(r.nameNorm)) nameNormToId.set(r.nameNorm, r.id)
    }

    let updated = 0
    let created = 0
    for (const it of normalized) {
      const data = itemToCreate(lojaId, it)
      let targetId: string | null = null
      if (byIdMap.has(it.id)) {
        targetId = it.id
      } else if (nameNormToId.has(data.nameNorm)) {
        targetId = nameNormToId.get(data.nameNorm)!
      }
      if (targetId) {
        await prisma.estoqueProduto.update({
          where: { id: targetId },
          data: omitId(data),
        })
        updated += 1
        nameNormToId.set(data.nameNorm, targetId)
        continue
      }
      await prisma.estoqueProduto.create({ data })
      created += 1
      nameNormToId.set(data.nameNorm, data.id)
    }
    return NextResponse.json({ ok: true, count: normalized.length, created, updated })
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

