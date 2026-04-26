import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/require-admin"
import { ASSISTEC_LOJA_HEADER } from "@/lib/assistec-headers"
import { storeIdFromAssistecRequestForRead } from "@/lib/store-id-from-request"
import { getMarketingMediaCredits } from "@/lib/marketing-media-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function storeIdFrom(req: Request): string {
  const h = req.headers.get(ASSISTEC_LOJA_HEADER)?.trim()
  if (h) return h
  return storeIdFromAssistecRequestForRead(req)
}

type Body = {
  /** URL de imagem/foto do técnico (ex.: data URL, ou URL pública). */
  avatarImageUrl?: string
  /** Preset opcional para avatar gerado por IA. */
  avatarPreset?: string
  /** Áudio já gerado na locução (URL). */
  audioUrl?: string
  /** Sempre 9:16 por padrão. */
  format?: "9:16"
}

function isHttpUrl(s: string): boolean {
  return s.startsWith("http://") || s.startsWith("https://")
}

async function reserveCreditsAndCreateJob(opts: {
  storeId: string
  cost: number
  meta: Record<string, unknown>
}): Promise<
  | { ok: true; jobDbId: string; creditsRemaining: number }
  | { ok: false; creditsRemaining: number; res: NextResponse }
> {
  const { storeId, cost, meta } = opts
  const result = await prisma.$transaction(async (tx) => {
    const settings = await tx.storeSettings.upsert({
      where: { storeId },
      create: { storeId },
      update: {},
      select: { marketingMediaCredits: true },
    })
    const current = settings.marketingMediaCredits ?? 50
    if (current < cost) return { ok: false as const, creditsRemaining: current }
    const next = current - cost
    await tx.storeSettings.update({ where: { storeId }, data: { marketingMediaCredits: next } })
    const job = await tx.marketingMediaJob.create({
      data: {
        storeId,
        kind: "AVATAR",
        kindV2: "AVATAR",
        creditsAfter: next,
        meta: { ...meta, status: "PENDING" },
      },
      select: { id: true },
    })
    return { ok: true as const, creditsRemaining: next, jobDbId: job.id }
  })

  if (!result.ok) {
    const credits = await getMarketingMediaCredits(storeId).catch(() => 0)
    return {
      ok: false,
      creditsRemaining: credits,
      res: NextResponse.json(
        { ok: false, error: "sem_creditos", creditsRemaining: credits, message: "Saldo de créditos insuficiente." },
        { status: 402 }
      ),
    }
  }
  return result
}

async function refundCreditsAndLog(opts: { storeId: string; cost: number; meta: Record<string, unknown> }) {
  const { storeId, cost, meta } = opts
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
        data: { marketingMediaCredits: (settings.marketingMediaCredits ?? 0) + cost },
      })
      await tx.marketingMediaJob.create({
        data: {
          storeId,
          kind: "AVATAR",
          kindV2: "AVATAR",
          meta: { ...meta, status: "REFUND" },
        },
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
      where: {
        storeId,
        OR: [{ kindV2: "AVATAR" }, { kind: "AVATAR" }, { kind: "avatar" }],
      },
      orderBy: { createdAt: "desc" },
      take: 24,
      select: { id: true, meta: true, createdAt: true, creditsAfter: true },
    })
    const items = jobs.map((j) => {
      const m = (j.meta || {}) as Record<string, unknown>
      return {
        id: j.id,
        createdAt: j.createdAt.toISOString(),
        creditsAfter: j.creditsAfter,
        status: typeof m.status === "string" ? m.status : "UNKNOWN",
        stage: typeof m.stage === "string" ? m.stage : "",
        progress: typeof m.progress === "number" ? m.progress : null,
        videoUrl: typeof m.videoUrl === "string" ? m.videoUrl : null,
        avatarImageUrl: typeof m.avatarImageUrl === "string" ? m.avatarImageUrl : null,
        audioUrl: typeof m.audioUrl === "string" ? m.audioUrl : null,
      }
    })
    return NextResponse.json({ ok: true, items })
  } catch {
    return NextResponse.json({ ok: false, items: [], error: "db_error" }, { status: 500 })
  }
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

  const audioUrl = typeof body.audioUrl === "string" ? body.audioUrl.trim() : ""
  if (!audioUrl) return NextResponse.json({ error: "audioUrl obrigatório" }, { status: 400 })

  const avatarImageUrl = typeof body.avatarImageUrl === "string" ? body.avatarImageUrl.trim() : ""
  const avatarPreset = typeof body.avatarPreset === "string" ? body.avatarPreset.trim() : ""

  if (!avatarImageUrl && !avatarPreset) {
    return NextResponse.json({ error: "Informe avatarImageUrl ou avatarPreset" }, { status: 400 })
  }

  // Custo default do Avatar (pode ser ajustado depois).
  const COST = 2
  const jobId = `avatar-${Date.now()}`
  const reserved = await reserveCreditsAndCreateJob({
    storeId,
    cost: COST,
    meta: {
      jobId,
      format: "9:16",
      provider: "mock",
      avatarImageUrl: avatarImageUrl || null,
      avatarPreset: avatarPreset || null,
      audioUrl,
      stage: "preparing",
      progress: 10,
    },
  })
  if (!reserved.ok) return reserved.res

  try {
    // Mock “pipeline” com progresso e vídeo final.
    // Nesta fase, mantemos contrato estável e pluggamos Replicate depois.
    await prisma.marketingMediaJob.update({
      where: { id: reserved.jobDbId },
      data: { meta: { jobId, status: "RUNNING", stage: "lipSync", progress: 55, avatarImageUrl, avatarPreset, audioUrl } },
    })

    // Resultado final (mock): vídeo vertical sem arquivo real, usando o avatar como poster no player.
    const videoUrl = isHttpUrl(avatarImageUrl) ? avatarImageUrl : null
    await prisma.marketingMediaJob.update({
      where: { id: reserved.jobDbId },
      data: {
        meta: {
          jobId,
          status: "DONE",
          stage: "finalizing",
          progress: 100,
          format: "9:16",
          provider: "mock",
          avatarImageUrl,
          avatarPreset,
          audioUrl,
          videoUrl,
          message:
            "Mock concluído. Integração real de lip-sync (Replicate/D-ID/HeyGen) entra na próxima iteração mantendo o mesmo contrato.",
        },
      },
    })

    return NextResponse.json({
      ok: true,
      mock: true,
      jobId,
      creditsRemaining: reserved.creditsRemaining,
      videoUrl,
    })
  } catch (e) {
    await refundCreditsAndLog({
      storeId,
      cost: COST,
      meta: {
        jobId,
        error: e instanceof Error ? e.message : "avatar_error",
        avatarImageUrl,
        avatarPreset,
        audioUrl,
      },
    })
    const credits = await getMarketingMediaCredits(storeId).catch(() => 0)
    return NextResponse.json(
      { ok: false, error: "avatar_error", creditsRemaining: credits, message: "Falha ao gerar avatar. Crédito retornado." },
      { status: 502 }
    )
  }
}

