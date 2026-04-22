import { NextResponse } from "next/server"
import { Prisma } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"
import { getVerifiedSubscriptionFromCookies } from "@/lib/api-auth"
import { isVencimentoExpired } from "@/lib/subscription-seal"
import { getTrustedTimeMs } from "@/lib/trusted-time"
import { storeIdFromAssistecRequestForWrite } from "@/lib/store-id-from-request"

export const runtime = "nodejs"

type InvPayload = {
  id: string
  name: string
  stock: number
  cost: number
  price: number
  category: string
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

export async function PUT(req: Request) {
  const gate = await requireSubscription()
  if (!gate.ok) return gate.res

  const storeId = storeIdFromAssistecRequestForWrite(req)
  if (!storeId) {
    return NextResponse.json(
      { error: "Unidade obrigatória: envie o header x-assistec-loja-id ou query storeId." },
      { status: 400 }
    )
  }

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
    const category =
      typeof o.category === "string" && o.category.trim() ? o.category.trim() : ""
    normalized.push({
      id,
      name,
      stock: typeof o.stock === "number" && Number.isFinite(o.stock) ? o.stock : 0,
      cost: typeof o.cost === "number" && Number.isFinite(o.cost) ? o.cost : 0,
      price: typeof o.price === "number" && Number.isFinite(o.price) ? o.price : 0,
      category,
    })
  }
  if (normalized.length === 0) {
    return NextResponse.json({ error: "Nenhum item válido para importar" }, { status: 400 })
  }

  // Modo mesclagem (segurança): não apaga nem sobrescreve itens antigos.
  // Só cria itens que ainda não existem para esta loja.
  let created = 0
  let updated = 0

  for (const it of normalized) {
    // eslint-disable-next-line no-console
    console.log("IMPORT ESTOQUE (merge):", it.name, "->", it.category)
    const existing = await prisma.produto.findFirst({ where: { storeId, sku: it.id } })
    await prisma.produto.upsert({
      where: { storeId_sku: { storeId, sku: it.id } },
      update: {
        name: it.name,
        stock: Math.max(0, Math.floor(it.stock)),
        precoCusto: it.cost,
        price: it.price,
        category: it.category && it.category.length > 0 ? it.category : undefined,
        storeId,
        sku: it.id,
      },
      create: {
        storeId,
        sku: it.id,
        name: it.name,
        stock: Math.max(0, Math.floor(it.stock)),
        precoCusto: it.cost,
        price: it.price,
        category: it.category && it.category.length > 0 ? it.category : undefined,
      },
    })
    if (existing) updated += 1
    else created += 1
  }

  return NextResponse.json({
    ok: true,
    received: normalized.length,
    created,
    updated,
  })
}

