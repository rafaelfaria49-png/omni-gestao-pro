import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/require-admin"

export const runtime = "nodejs"

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  try {
    const settings = await prisma.storeSettings.findUnique({ where: { storeId: id } })
    return NextResponse.json({ settings })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Falha ao carregar settings"
    return NextResponse.json({ settings: null, error: msg }, { status: 500 })
  }
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  try {
    const gate = await requireAdmin()
    if (!gate.ok) return gate.res
    const body = (await req.json()) as Partial<{
      contactEmail: string
      contactWhatsapp: string
      contactWhatsappDono: string
      receiptFooter: string
      mascotCharacterSeed: string
      mascotPromptBase: string
      printerConfig: unknown
      cardFees: unknown
    }>

    const settings = await prisma.storeSettings.upsert({
      where: { storeId: id },
      create: {
        storeId: id,
        contactEmail: (body.contactEmail || "").trim(),
        contactWhatsapp: (body.contactWhatsapp || "").trim(),
        contactWhatsappDono: (body.contactWhatsappDono || "").trim(),
        receiptFooter: (body.receiptFooter || "").trim(),
        mascotCharacterSeed: (body.mascotCharacterSeed || "").trim(),
        mascotPromptBase: (body.mascotPromptBase || "").trim(),
        printerConfig: body.printerConfig as any,
        cardFees: body.cardFees as any,
      },
      update: {
        ...(body.contactEmail != null ? { contactEmail: String(body.contactEmail).trim() } : {}),
        ...(body.contactWhatsapp != null ? { contactWhatsapp: String(body.contactWhatsapp).trim() } : {}),
        ...(body.contactWhatsappDono != null ? { contactWhatsappDono: String(body.contactWhatsappDono).trim() } : {}),
        ...(body.receiptFooter != null ? { receiptFooter: String(body.receiptFooter).trim() } : {}),
        ...(body.mascotCharacterSeed != null ? { mascotCharacterSeed: String(body.mascotCharacterSeed).trim() } : {}),
        ...(body.mascotPromptBase != null ? { mascotPromptBase: String(body.mascotPromptBase).trim() } : {}),
        ...(body.printerConfig !== undefined ? { printerConfig: body.printerConfig as any } : {}),
        ...(body.cardFees !== undefined ? { cardFees: body.cardFees as any } : {}),
      },
    })
    return NextResponse.json({ ok: true, settings })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Falha ao salvar settings"
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

