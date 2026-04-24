import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"

type StoreProfileInput = "ASSISTENCIA" | "VARIEDADES" | "SUPERMERCADO"
type SubscriptionPlanInput = "BRONZE" | "PRATA" | "OURO"

function parseProfile(raw: unknown): StoreProfileInput {
  if (raw === "VARIEDADES" || raw === "SUPERMERCADO" || raw === "ASSISTENCIA") return raw
  return "ASSISTENCIA"
}

function parseSubscriptionPlan(raw: unknown): SubscriptionPlanInput | undefined {
  if (raw === "PRATA" || raw === "OURO" || raw === "BRONZE") return raw
  return undefined
}

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  try {
    const store = await prisma.store.findUnique({ where: { id } })
    return NextResponse.json({ store })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Falha ao carregar unidade"
    return NextResponse.json({ store: null, error: msg }, { status: 500 })
  }
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  try {
    const body = (await req.json()) as Partial<{
      name: string
      cnpj: string
      phone: string
      logoUrl: string
      address: unknown
      profile: StoreProfileInput
      subscriptionPlan: SubscriptionPlanInput
    }>

    const profile = body.profile != null ? parseProfile(body.profile) : undefined
    const subscriptionPlan = body.subscriptionPlan != null ? parseSubscriptionPlan(body.subscriptionPlan) : undefined

    const store = await prisma.store.update({
      where: { id },
      data: {
        ...(body.name != null ? { name: String(body.name).trim() } : {}),
        ...(body.cnpj != null ? { cnpj: String(body.cnpj).trim() } : {}),
        ...(body.phone != null ? { phone: String(body.phone).trim() } : {}),
        ...(body.logoUrl != null ? { logoUrl: String(body.logoUrl).trim() } : {}),
        ...(body.address !== undefined ? { address: body.address as any } : {}),
        ...(profile ? { profile } : {}),
        ...(subscriptionPlan ? { subscriptionPlan } : {}),
      },
    })
    return NextResponse.json({ ok: true, store })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Falha ao salvar unidade"
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

