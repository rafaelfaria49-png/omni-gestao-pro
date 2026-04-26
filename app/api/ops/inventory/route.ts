import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@/generated/prisma"
import { getVerifiedSubscriptionFromCookies } from "@/lib/api-auth"
import { isVencimentoExpired } from "@/lib/subscription-seal"
import { getTrustedTimeMs } from "@/lib/trusted-time"
import type { Produto } from "@/generated/prisma"
import { storeIdFromAssistecRequestForRead, storeIdFromAssistecRequestForWrite } from "@/lib/store-id-from-request"
import { requireAdmin } from "@/lib/require-admin"
// (sem normalizeNameForMatch — tabela `product` é minimalista)

export const runtime = "nodejs"
/** Sem cache de rota / fetch no Next — sempre dados frescos do Prisma. */
export const dynamic = "force-dynamic"
export const revalidate = 0

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function withDbRetry<T>(label: string, fn: () => Promise<T>, attempts = 6): Promise<T> {
  let last: unknown
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn()
    } catch (e) {
      last = e
      const code = e instanceof Prisma.PrismaClientKnownRequestError ? e.code : ""
      const msg = e instanceof Error ? e.message : String(e)
      const transient =
        code === "P1001" ||
        code === "P1002" ||
        code === "P1017" ||
        code === "P2024" ||
        /P1001|P1002|P1017|timeout|ECONNRESET|ENOTFOUND|connection|Can't reach database/i.test(msg)
      if (transient && i < attempts - 1) {
        const ms = 700 * (i + 1)
        console.warn(`[ops/inventory] ${label} — retry ${i + 1}/${attempts} em ${ms}ms:`, msg.slice(0, 200))
        await sleep(ms)
        continue
      }
      throw e
    }
  }
  throw last
}

type InvPayload = {
  id: string
  name: string
  barcode?: string
  stock: number
  cost: number
  price: number
  category?: string
  vendaPorPeso?: boolean
  precoPorKg?: number
  atributos?: unknown[]
}

function rowToItem(row: Produto): InvPayload {
  const sku = typeof (row as unknown as { sku?: unknown }).sku === "string" ? String((row as unknown as { sku: string }).sku) : ""
  const barcode =
    typeof (row as unknown as { barcode?: unknown }).barcode === "string"
      ? String((row as unknown as { barcode: string }).barcode)
      : ""
  return {
    id: sku.trim() || row.id,
    name: row.name,
    barcode: barcode.trim() || undefined,
    stock: row.stock,
    cost: row.precoCusto,
    price: row.price,
    category: typeof (row as unknown as { category?: unknown }).category === "string" ? (row as unknown as { category: string }).category : "",
  }
}

function itemToCreate(lojaId: string, item: InvPayload) {
  return {
    storeId: lojaId,
    sku: item.id,
    name: item.name,
    barcode: typeof item.barcode === "string" && item.barcode.trim() ? item.barcode.trim() : undefined,
    stock: Math.max(0, Math.floor(item.stock)),
    precoCusto: Number.isFinite(item.cost) ? item.cost : 0,
    price: item.price,
    category: typeof item.category === "string" && item.category.trim() ? item.category.trim() : undefined,
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

export async function GET(req: Request) {
  try {
    const gate = await requireSubscription()
    if (!gate.ok) {
      const dev = process.env.NODE_ENV === "development"
      console.warn("[ops/inventory GET] gate negado —", gate.res.status)
      // Em dev, não bloqueia listagem: isso evita UI vazia quando cookie de sessão não está presente.
      if (!dev) return gate.res
    }

    const lojaIdRecebido = storeIdFromAssistecRequestForRead(req)
    console.log(`[ops/inventory GET] lojaId recebido=${lojaIdRecebido}`)

    // Leitura do estoque por loja.
    await withDbRetry("$connect", () => prisma.$connect())
    const rows = await withDbRetry("findMany", () =>
      prisma.produto.findMany({ where: { storeId: lojaIdRecebido }, orderBy: { name: "asc" } })
    )
    console.log("Dados encontrados no banco (por loja):", rows.length)
    return NextResponse.json({
      items: rows.map(rowToItem),
      _lojaIdRecebido: lojaIdRecebido,
      _gateBypassedInDev: !gate.ok && process.env.NODE_ENV === "development",
    })
  } catch (e) {
    const dev = process.env.NODE_ENV === "development"
    const msg = e instanceof Error ? e.message : String(e)
    const stack = e instanceof Error ? e.stack : undefined
    const prismaCode = e instanceof Prisma.PrismaClientKnownRequestError ? e.code : undefined
    console.error("[ops/inventory GET] erro completo:", e)
    if (stack) console.error("[ops/inventory GET] stack:\n", stack)
    return NextResponse.json(
      { error: "Falha ao carregar estoque", ...(dev ? { detail: msg, stack, prismaCode } : {}) },
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

  const items = (body as { items?: unknown }).items
  if (!Array.isArray(items)) {
    return NextResponse.json({ error: "items deve ser um array" }, { status: 400 })
  }

  const normalized: InvPayload[] = []
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue
    const o = raw as Record<string, unknown>
    const id = typeof o.id === "string" ? o.id : ""
    const name = typeof o.name === "string" ? o.name : ""
    if (!id || !name) continue
    normalized.push({
      id,
      name,
      barcode: typeof o.barcode === "string" ? o.barcode : typeof (o as { codigoBarras?: unknown }).codigoBarras === "string" ? String((o as any).codigoBarras) : "",
      stock: typeof o.stock === "number" && Number.isFinite(o.stock) ? o.stock : 0,
      cost: typeof o.cost === "number" && Number.isFinite(o.cost) ? o.cost : 0,
      price: typeof o.price === "number" && Number.isFinite(o.price) ? o.price : 0,
      category:
        typeof o.category === "string"
          ? o.category
          : typeof (o as { categoria?: unknown }).categoria === "string"
            ? String((o as { categoria?: unknown }).categoria)
            : "",
      vendaPorPeso: Boolean(o.vendaPorPeso),
      precoPorKg: typeof o.precoPorKg === "number" && Number.isFinite(o.precoPorKg) ? o.precoPorKg : undefined,
      atributos: Array.isArray(o.atributos) ? o.atributos : undefined,
    })
  }

  try {
    // Mesclagem segura: não apaga itens antigos da loja; apenas cria/atualiza os ids enviados.
    let applied = 0
    await prisma.$transaction(async (tx) => {
      for (const it of normalized) {
        await tx.produto.upsert({
          where: { storeId_sku: { storeId, sku: it.id } },
          update: itemToCreate(storeId, it),
          create: itemToCreate(storeId, it),
        })
        applied += 1
      }
    })
    return NextResponse.json({ ok: true, count: applied })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[ops/inventory PUT]", msg)
    const dev = process.env.NODE_ENV === "development"
    return NextResponse.json(
      { error: "Falha ao salvar estoque", ...(dev ? { detail: msg } : {}) },
      { status: 503 }
    )
  }
}
