import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/require-admin"

export const runtime = "nodejs"

type StoreProfileInput = "ASSISTENCIA" | "VARIEDADES" | "SUPERMERCADO"
type SubscriptionPlanInput = "BRONZE" | "PRATA" | "OURO"

function parseProfile(raw: unknown): StoreProfileInput {
  if (raw === "VARIEDADES" || raw === "SUPERMERCADO" || raw === "ASSISTENCIA") return raw
  return "ASSISTENCIA"
}

function parseSubscriptionPlan(raw: unknown): SubscriptionPlanInput {
  if (raw === "PRATA" || raw === "OURO" || raw === "BRONZE") return raw
  return "BRONZE"
}

function normalizeStoreId(raw: string): string {
  const v = raw.trim()
  if (!v) return ""
  return v
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-]/g, "")
}

export async function GET() {
  try {
    const stores = await prisma.store.findMany({ orderBy: { id: "asc" } })
    return NextResponse.json({ stores })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Falha ao listar unidades"
    return NextResponse.json({ stores: [], error: msg }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const gate = await requireAdmin()
    if (!gate.ok) return gate.res
    const body = (await req.json()) as Partial<{
      id: string
      name: string
      cnpj: string
      phone: string
      logoUrl: string
      address: unknown
      profile: StoreProfileInput
      subscriptionPlan: SubscriptionPlanInput
    }>

    const profile = parseProfile(body.profile)
    const subscriptionPlan = parseSubscriptionPlan(body.subscriptionPlan)
    const all = await prisma.store.findMany({ select: { id: true }, orderBy: { id: "asc" } })
    const nextIdx = Math.max(
      1,
      ...all
        .map((s) => s.id.match(/^loja-(\d+)$/)?.[1])
        .filter(Boolean)
        .map((x) => parseInt(x!, 10))
        .filter((n) => Number.isFinite(n))
    ) + 1

    const wantedId = body.id ? normalizeStoreId(body.id) : ""
    const id = wantedId || `loja-${nextIdx}`

    const store = await prisma.store.create({
      data: {
        id,
        name: (body.name || "").trim(),
        cnpj: (body.cnpj || "").trim(),
        phone: (body.phone || "").trim(),
        logoUrl: (body.logoUrl || "").trim(),
        address: (body.address as any) ?? undefined,
        profile,
        subscriptionPlan,
      },
    })

    await prisma.storeSettings.upsert({
      where: { storeId: id },
      create: { storeId: id },
      update: {},
    })

    return NextResponse.json({ ok: true, store })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Falha ao criar unidade"
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

