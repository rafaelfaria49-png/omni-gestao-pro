import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/require-admin"
import { ASSISTEC_LOJA_HEADER } from "@/lib/assistec-headers"
import { storeIdFromAssistecRequestForRead } from "@/lib/store-id-from-request"
import { dailyPostingSuggestion, buildGrowthPackCommand, parseGrowthPackFromAiMessage, serializePackForDb, type BrandVoiceProfile } from "@/lib/marketing-growth-pack"
import { getMarketingMediaCredits } from "@/lib/marketing-media-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function storeIdFrom(req: Request): string {
  const h = req.headers.get(ASSISTEC_LOJA_HEADER)?.trim()
  if (h) return h
  return storeIdFromAssistecRequestForRead(req)
}

type Channel = "instagram_feed" | "instagram_stories" | "tiktok" | "facebook" | "gmb" | "whatsapp_status"

type QueueItem = {
  id: string
  createdAt: string
  status: string
  channels: Channel[]
  payload: Record<string, unknown>
}

function todayKey(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function adaptCopyForChannel(base: { feed: string; reels: string; stories: string }, ch: Channel): string {
  if (ch === "gmb") {
    return [
      "Post para Google Meu Negócio (SEO local):",
      base.feed,
      "",
      "Inclua: cidade/bairro (se aplicável), tipo de serviço, chamada para rota no Google Maps.",
    ].join("\n")
  }
  if (ch === "tiktok") {
    return [
      "Texto para TikTok (entretenimento + retenção):",
      base.reels || base.feed,
      "",
      "Inclua hashtags de tendência + CTA para comentar.",
    ].join("\n")
  }
  if (ch === "instagram_stories") return base.stories || base.feed
  if (ch === "whatsapp_status") return base.feed
  if (ch === "facebook") return base.feed
  return base.feed
}

async function reserveCreditAndCreateJob(storeId: string, meta: Record<string, unknown>) {
  const result = await prisma.$transaction(async (tx) => {
    const settings = await tx.storeSettings.upsert({
      where: { storeId },
      create: { storeId },
      update: {},
      select: { marketingMediaCredits: true },
    })
    const current = settings.marketingMediaCredits ?? 50
    if (current < 1) return { ok: false as const, creditsRemaining: current }
    const next = current - 1
    await tx.storeSettings.update({ where: { storeId }, data: { marketingMediaCredits: next } })
    const job = await tx.marketingMediaJob.create({
      data: { storeId, kind: "AUTOMACAO", kindV2: "AUTOMACAO", creditsAfter: next, meta: { ...meta, status: "PENDING" } },
      select: { id: true },
    })
    return { ok: true as const, creditsRemaining: next, jobDbId: job.id }
  })
  return result
}

async function refundCredit(storeId: string, meta: Record<string, unknown>) {
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
        data: { marketingMediaCredits: (settings.marketingMediaCredits ?? 0) + 1 },
      })
      await tx.marketingMediaJob.create({
        data: { storeId, kind: "AUTOMACAO", kindV2: "AUTOMACAO", meta: { ...meta, status: "REFUND" } },
      })
    })
  } catch {
    /* ignore */
  }
}

export async function GET(req: Request) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res
  const storeId = storeIdFrom(req)
  try {
    const jobs = await prisma.marketingMediaJob.findMany({
      where: { storeId, OR: [{ kindV2: "AUTOMACAO" }, { kind: "AUTOMACAO" }, { kind: "automacao" }] },
      orderBy: { createdAt: "desc" },
      take: 36,
      select: { id: true, meta: true, createdAt: true },
    })
    const items: QueueItem[] = jobs.map((j) => {
      const m = (j.meta || {}) as Record<string, unknown>
      const channels = Array.isArray(m.channels) ? (m.channels as Channel[]) : []
      return {
        id: j.id,
        createdAt: j.createdAt.toISOString(),
        status: typeof m.status === "string" ? m.status : "UNKNOWN",
        channels,
        payload: m,
      }
    })
    return NextResponse.json({ ok: true, items })
  } catch {
    return NextResponse.json({ ok: false, items: [], error: "db_error" }, { status: 500 })
  }
}

type RunDailyBody = { brandVoice?: BrandVoiceProfile; tone?: string; product?: string }

export async function POST(req: Request) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res
  const storeId = storeIdFrom(req)
  let body: RunDailyBody
  try {
    body = (await req.json().catch(() => ({}))) as RunDailyBody
  } catch {
    body = {}
  }

  // “Cron-like”: enfileira se ainda não houver item de hoje.
  const day = todayKey()
  const existing = await prisma.marketingMediaJob.findFirst({
    where: { storeId, OR: [{ kindV2: "AUTOMACAO" }, { kind: "AUTOMACAO" }], meta: { path: ["dailyKey"], equals: day } as any },
    select: { id: true },
  }).catch(() => null)
  if (existing?.id) {
    return NextResponse.json({ ok: true, alreadyQueued: true, dailyKey: day })
  }

  const tip = dailyPostingSuggestion()
  const command = buildGrowthPackCommand({
    brandVoice: (body.brandVoice as any) || "varejo",
    toneEmotional: body.tone || "pro",
    product: body.product || "Assistência técnica",
    brief: `Rotina de abertura 09:00. Criar conteúdo de \"Bom dia\" para a loja.\nDica do dia: ${tip}`,
  })

  const reserved = await reserveCreditAndCreateJob(storeId, { dailyKey: day, stage: "generating_pack", progress: 15 })
  if (!reserved.ok) {
    const credits = await getMarketingMediaCredits(storeId).catch(() => 0)
    return NextResponse.json(
      { ok: false, error: "sem_creditos", creditsRemaining: credits, message: "Saldo de créditos insuficiente." },
      { status: 402 }
    )
  }

  try {
    const ai = await fetch(new URL("/api/ai/orchestrate", req.url), {
      method: "POST",
      headers: { "Content-Type": "application/json", [ASSISTEC_LOJA_HEADER]: storeId },
      body: JSON.stringify({ command, model: "auto", lojaId: storeId }),
    })
    const j = (await ai.json().catch(() => ({}))) as { message?: string; error?: string }
    if (!ai.ok) throw new Error(j.error || `HTTP ${ai.status}`)
    const msg = String(j.message || "").trim()
    if (!msg) throw new Error("Sem resposta da IA.")

    const pack = parseGrowthPackFromAiMessage(msg)
    const serialized = serializePackForDb(pack)

    await prisma.marketingMediaJob.update({
      where: { id: reserved.jobDbId },
      data: {
        meta: {
          dailyKey: day,
          status: "QUEUED",
          progress: 100,
          stage: "queued",
          channels: ["instagram_feed", "instagram_stories", "tiktok", "facebook", "gmb", "whatsapp_status"],
          pack,
          packSerialized: serialized,
          adapted: {
            instagram_feed: adaptCopyForChannel(pack, "instagram_feed"),
            instagram_stories: adaptCopyForChannel(pack, "instagram_stories"),
            tiktok: adaptCopyForChannel(pack, "tiktok"),
            facebook: adaptCopyForChannel(pack, "facebook"),
            gmb: adaptCopyForChannel(pack, "gmb"),
            whatsapp_status: adaptCopyForChannel(pack, "whatsapp_status"),
          },
        },
      },
    })

    return NextResponse.json({ ok: true, queued: true, dailyKey: day, jobId: reserved.jobDbId, creditsRemaining: reserved.creditsRemaining })
  } catch (e) {
    await refundCredit(storeId, { dailyKey: day, error: e instanceof Error ? e.message : "schedule_error" })
    const credits = await getMarketingMediaCredits(storeId).catch(() => 0)
    return NextResponse.json(
      { ok: false, error: "schedule_error", creditsRemaining: credits, message: "Falha ao enfileirar rotina. Crédito retornado." },
      { status: 502 }
    )
  }
}

