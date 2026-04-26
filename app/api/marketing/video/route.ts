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
  style?: string
  imageName?: string
  imageSize?: number
  /** Opcional: id do mascote/imagem no ledger (job id). */
  image_id?: string
  /** Opcional: id do áudio/locução no ledger (job id). */
  audio_id?: string
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

  const style = typeof body.style === "string" ? body.style.slice(0, 48) : "cinematic"
  const imageName = typeof body.imageName === "string" ? body.imageName.slice(0, 240) : ""
  const imageId = typeof body.image_id === "string" ? body.image_id.slice(0, 64) : ""
  const audioId = typeof body.audio_id === "string" ? body.audio_id.slice(0, 64) : ""

  // Custo premium (vídeo + avatar/lip-sync).
  const COST = 5
  const jobId = `video-${Date.now()}`

  try {
    // Reserva créditos + cria job.
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
          kind: "VIDEO",
          kindV2: "VIDEO",
          creditsAfter: next,
          meta: {
            status: "PENDING",
            stage: "preparing",
            progress: 10,
            jobId,
            style,
            imageName,
            imageSize: body.imageSize,
            image_id: imageId || null,
            audio_id: audioId || null,
            hint: "Lip-sync será integrado via LivePortrait/Hedra; por enquanto mock mantém contrato e progresso.",
          },
        },
        select: { id: true },
      })
      return { ok: true as const, creditsRemaining: next, jobDbId: job.id }
    })

    if (!reserved.ok) {
      const credits = await getMarketingMediaCredits(storeId)
      return NextResponse.json(
        { ok: false, error: "sem_creditos", creditsRemaining: credits, message: "Saldo de créditos insuficiente." },
        { status: 402 }
      )
    }

    // Mock pipeline com progresso (pontos de estágio exigidos).
    await prisma.marketingMediaJob.update({
      where: { id: reserved.jobDbId },
      data: { meta: { status: "RUNNING", stage: "lipSync", progress: 55, jobId, style, image_id: imageId, audio_id: audioId } },
    })

    await prisma.marketingMediaJob.update({
      where: { id: reserved.jobDbId },
      data: {
        meta: {
          status: "DONE",
          stage: "finalizing",
          progress: 100,
          jobId,
          style,
          image_id: imageId || null,
          audio_id: audioId || null,
          previewVideoUrl: null,
          message: "Job premium concluído (mock). Integração lip-sync real entra na próxima iteração.",
        },
      },
    })

  return NextResponse.json({
    ok: true,
    mock: true,
    beta: true,
    premiumCost: COST,
    creditsRemaining: reserved.creditsRemaining,
    jobId,
    /** Sem URL real no mock — o cliente usa poster local + estado “gerado”. */
    previewVideoUrl: null as string | null,
    message: "Job premium de vídeo/lip-sync registrado (mock).",
  })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "video_error"
    // Reembolso best-effort.
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
          data: { storeId, kind: "VIDEO", kindV2: "VIDEO", meta: { status: "REFUND", error: msg, jobId } },
        })
      })
    } catch {
      /* ignore */
    }
    const credits = await getMarketingMediaCredits(storeId).catch(() => 0)
    return NextResponse.json(
      { ok: false, error: "video_error", creditsRemaining: credits, message: "Falha ao gerar vídeo. Crédito retornado." },
      { status: 502 }
    )
  }
}
