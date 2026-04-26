import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/require-admin"
import { ASSISTEC_LOJA_HEADER } from "@/lib/assistec-headers"
import { storeIdFromAssistecRequestForRead } from "@/lib/store-id-from-request"
import { buildGoogleReviewReplyCommand, type BrandVoiceProfile } from "@/lib/marketing-growth-pack"
import { getMarketingMediaCredits } from "@/lib/marketing-media-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function storeIdFrom(req: Request): string {
  const h = req.headers.get(ASSISTEC_LOJA_HEADER)?.trim()
  if (h) return h
  return storeIdFromAssistecRequestForRead(req)
}

type Body = {
  kind?: "review_reply" | "seo_adapt"
  brandVoice?: BrandVoiceProfile
  reviewText?: string
}

export async function POST(req: Request) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res
  const storeId = storeIdFrom(req)
  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 })
  }

  const kind = body.kind === "seo_adapt" ? "seo_adapt" : "review_reply"
  const bv = (body.brandVoice as BrandVoiceProfile) || "varejo"

  // Custo base (texto/SEO)
  const COST = 1
  const reserved = await prisma.$transaction(async (tx) => {
    const settings = await tx.storeSettings.upsert({
      where: { storeId },
      create: { storeId },
      update: {},
      select: { marketingMediaCredits: true },
    })
    const current = settings.marketingMediaCredits ?? 50
    if (current < COST) return { ok: false as const, creditsRemaining: current }
    const next = current - COST
    await tx.storeSettings.update({ where: { storeId }, data: { marketingMediaCredits: next } })
    const job = await tx.marketingMediaJob.create({
      data: {
        storeId,
        kind: "TEXT",
        creditsAfter: next,
        meta: { status: "PENDING", kind, brandVoice: bv },
      },
      select: { id: true },
    })
    return { ok: true as const, creditsRemaining: next, jobDbId: job.id }
  })

  if (!reserved.ok) {
    const credits = await getMarketingMediaCredits(storeId).catch(() => 0)
    return NextResponse.json(
      { ok: false, error: "sem_creditos", creditsRemaining: credits, message: "Saldo de créditos insuficiente." },
      { status: 402 }
    )
  }

  try {
    if (kind === "review_reply") {
      const review = typeof body.reviewText === "string" ? body.reviewText.trim() : ""
      if (!review) return NextResponse.json({ error: "reviewText obrigatório" }, { status: 400 })

      const command = buildGoogleReviewReplyCommand({ brandVoice: bv, reviewText: review })
      const ai = await fetch(new URL("/api/ai/orchestrate", req.url), {
        method: "POST",
        headers: { "Content-Type": "application/json", [ASSISTEC_LOJA_HEADER]: storeId },
        body: JSON.stringify({ command, model: "auto", lojaId: storeId }),
      })
      const j = (await ai.json().catch(() => ({}))) as { message?: string; error?: string }
      if (!ai.ok) throw new Error(j.error || `HTTP ${ai.status}`)
      const message = String(j.message || "").trim()
      if (!message) throw new Error("Sem resposta da IA.")

      await prisma.marketingMediaJob.update({
        where: { id: reserved.jobDbId },
        data: { meta: { status: "DONE", kind, brandVoice: bv, reply: message, reviewPreview: review.slice(0, 240) } },
      })

      return NextResponse.json({ ok: true, creditsRemaining: reserved.creditsRemaining, reply: message })
    }

    // seo_adapt (placeholder para evolução)
    await prisma.marketingMediaJob.update({
      where: { id: reserved.jobDbId },
      data: { meta: { status: "DONE", kind, brandVoice: bv } },
    })
    return NextResponse.json({ ok: true, creditsRemaining: reserved.creditsRemaining })
  } catch (e) {
    // Reembolso best-effort
    try {
      await prisma.$transaction(async (tx) => {
        const settings = await tx.storeSettings.upsert({
          where: { storeId },
          create: { storeId },
          update: {},
          select: { marketingMediaCredits: true },
        })
        await tx.storeSettings.update({
          where: { storeId },
          data: { marketingMediaCredits: (settings.marketingMediaCredits ?? 0) + COST },
        })
        await tx.marketingMediaJob.create({
          data: {
            storeId,
            kind: "TEXT",
            meta: { status: "REFUND", kind, error: e instanceof Error ? e.message : "text_error" },
          },
        })
      })
    } catch {
      /* ignore */
    }
    const credits = await getMarketingMediaCredits(storeId).catch(() => 0)
    return NextResponse.json(
      { ok: false, error: "text_error", creditsRemaining: credits, message: "Falha ao gerar texto. Crédito retornado." },
      { status: 502 }
    )
  }
}

