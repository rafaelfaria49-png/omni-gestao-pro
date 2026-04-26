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
  prompt?: string
  style?: string
  format?: string
  /** Se true, usa seed/promptBase fixos do mascote da loja (StoreSettings). */
  useMascot?: boolean
  /** Seed opcional (preferencialmente para Replicate/Flux). */
  seed?: string | number
}

function sizeFromFormat(format: string): { aspect: "1:1" | "9:16" | "16:9"; openaiSize: "1024x1024" | "1024x1792" | "1792x1024" } {
  if (format === "vertical") return { aspect: "9:16", openaiSize: "1024x1792" }
  if (format === "wide") return { aspect: "16:9", openaiSize: "1792x1024" }
  return { aspect: "1:1", openaiSize: "1024x1024" }
}

async function generateWithOpenAI(opts: { prompt: string; size: string }): Promise<string> {
  const key = String(process.env.OPENAI_API_KEY || "").trim()
  if (!key) throw new Error("openai_key_missing")

  const r = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "dall-e-3",
      prompt: opts.prompt,
      size: opts.size,
      quality: "hd",
      n: 1,
      response_format: "url",
    }),
  })
  const j = (await r.json().catch(() => ({}))) as any
  if (!r.ok) throw new Error(String(j?.error?.message || `OpenAI HTTP ${r.status}`))
  const url = String(j?.data?.[0]?.url || "").trim()
  if (!url || !(url.startsWith("http://") || url.startsWith("https://"))) throw new Error("openai_no_url")
  return url
}

async function generateWithReplicate(opts: {
  prompt: string
  aspect: "1:1" | "9:16" | "16:9"
  seed?: number
}): Promise<{ url: string; seedUsed: number | null }> {
  const token = String(process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY || "").trim()
  if (!token) throw new Error("replicate_token_missing")
  const model = String(process.env.REPLICATE_FLUX_MODEL || "black-forest-labs/flux-1.1-pro").trim()
  const endpoint = `https://api.replicate.com/v1/models/${model}/predictions`

  const r = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "wait",
    },
    body: JSON.stringify({
      input: {
        prompt: opts.prompt,
        aspect_ratio: opts.aspect,
        ...(Number.isFinite(opts.seed as number) ? { seed: opts.seed } : {}),
        output_format: "png",
        output_quality: 95,
      },
    }),
  })
  const j = (await r.json().catch(() => ({}))) as any
  if (!r.ok) throw new Error(String(j?.detail || j?.error || `Replicate HTTP ${r.status}`))
  const out = j?.output
  const url = typeof out === "string" ? out.trim() : ""
  if (!url || !(url.startsWith("http://") || url.startsWith("https://"))) throw new Error("replicate_no_url")
  return { url, seedUsed: Number.isFinite(opts.seed as number) ? (opts.seed as number) : null }
}

export async function GET(req: Request) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res
  const storeId = storeIdFrom(req)
  try {
    const jobs = await prisma.marketingMediaJob.findMany({
      where: { storeId, OR: [{ kindV2: "IMAGE" }, { kind: "IMAGE" }, { kind: "image" }] },
      orderBy: { createdAt: "desc" },
      take: 24,
      select: { id: true, meta: true, createdAt: true },
    })
    const images = jobs
      .map((j) => {
        const m = (j.meta || {}) as Record<string, unknown>
        const url = typeof m.imageUrl === "string" ? m.imageUrl : ""
        if (!url) return null
        return {
          id: j.id,
          url,
          prompt: typeof m.prompt === "string" ? m.prompt : "",
          style: typeof m.style === "string" ? m.style : "realismo",
          format: typeof m.format === "string" ? m.format : "square",
          createdAt: j.createdAt.toISOString(),
        }
      })
      .filter(Boolean)
    return NextResponse.json({ ok: true, images })
  } catch {
    return NextResponse.json({ ok: false, images: [], error: "db_error" }, { status: 500 })
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

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : ""
  if (!prompt) return NextResponse.json({ error: "prompt obrigatório" }, { status: 400 })
  if (prompt.length > 4000) return NextResponse.json({ error: "prompt muito longo" }, { status: 400 })

  const style = typeof body.style === "string" ? body.style.slice(0, 48) : "realismo"
  const format = typeof body.format === "string" ? body.format.slice(0, 24) : "square"
  const useMascot = !!body.useMascot
  const seedRaw = body.seed
  let seedFromBody: number | null = null
  if (typeof seedRaw === "number" && Number.isFinite(seedRaw)) seedFromBody = Math.floor(seedRaw)
  else if (typeof seedRaw === "string" && seedRaw.trim()) {
    const n = parseInt(seedRaw.trim(), 10)
    if (Number.isFinite(n)) seedFromBody = n
  }

  const { aspect, openaiSize } = sizeFromFormat(format)
  const jobId = `image-${Date.now()}`

  // Pré-validação: não reservar crédito se não há provider configurado.
  const hasOpenAI = String(process.env.OPENAI_API_KEY || "").trim().length > 0
  const hasReplicate = String(process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY || "").trim().length > 0
  if (!hasOpenAI && !hasReplicate) {
    return NextResponse.json(
      {
        ok: false,
        error: "missing_provider_key",
        message: "Configure OPENAI_API_KEY ou REPLICATE_API_TOKEN para gerar imagens.",
      },
      { status: 400 }
    )
  }

  /** Com chave oficial OpenAI, o dono paga direto à API — não debitar `marketingMediaCredits`. */
  const skipMediaCredits = hasOpenAI
  let jobDbId: string | null = null
  let creditsRemaining = 0
  let didDebitCredits = false

  try {
    if (skipMediaCredits) {
      const job = await prisma.marketingMediaJob.create({
        data: {
          storeId,
          kind: "IMAGE",
          kindV2: "IMAGE",
          meta: { prompt, style, format, jobId, status: "PENDING", billing: "openai_direct" },
        },
        select: { id: true },
      })
      jobDbId = job.id
      creditsRemaining = await getMarketingMediaCredits(storeId)
    } else {
      const reservation = await prisma.$transaction(async (tx) => {
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
          data: {
            storeId,
            kind: "IMAGE",
            kindV2: "IMAGE",
            creditsAfter: next,
            meta: { prompt, style, format, jobId, status: "PENDING" },
          },
          select: { id: true },
        })
        return { ok: true as const, creditsRemaining: next, jobDbId: job.id }
      })

      if (!reservation.ok) {
        const credits = await getMarketingMediaCredits(storeId)
        return NextResponse.json(
          { ok: false, error: "sem_creditos", creditsRemaining: credits, message: "Saldo de créditos esgotado." },
          { status: 402 }
        )
      }
      jobDbId = reservation.jobDbId
      creditsRemaining = reservation.creditsRemaining
      didDebitCredits = true
    }

    if (!jobDbId) throw new Error("job_missing")

    // Mascote fixo (consistência): seed + promptBase do StoreSettings.
    let mascotSeed: string | null = null
    let mascotPromptBase: string | null = null
    if (useMascot) {
      try {
        const st = await prisma.storeSettings.findUnique({
          where: { storeId },
          select: { mascotCharacterSeed: true, mascotPromptBase: true },
        })
        mascotSeed = String(st?.mascotCharacterSeed || "").trim() || null
        mascotPromptBase = String(st?.mascotPromptBase || "").trim() || null
      } catch {
        mascotSeed = null
        mascotPromptBase = null
      }
    }

    const promptFinal = [mascotPromptBase, prompt].filter(Boolean).join("\n\n")

    // Geração real (OpenAI primeiro; fallback Replicate).
    let imageUrl = ""
    let provider: "openai" | "replicate" = "openai"
    let seedUsed: number | null = null
    if (hasOpenAI) {
      provider = "openai"
      imageUrl = await generateWithOpenAI({ prompt: promptFinal, size: openaiSize })
    } else if (hasReplicate) {
      provider = "replicate"
      const seedCandidate =
        seedFromBody ??
        (mascotSeed && Number.isFinite(parseInt(mascotSeed, 10)) ? parseInt(mascotSeed, 10) : null) ??
        null
      const out = await generateWithReplicate({
        prompt: promptFinal,
        aspect,
        seed: seedCandidate ?? undefined,
      })
      imageUrl = out.url
      seedUsed = out.seedUsed ?? seedCandidate
    } else {
      throw new Error("missing_provider_key")
    }

    // Confirma o job com URL válida.
    await prisma.marketingMediaJob.update({
      where: { id: jobDbId },
      data: {
        kind: "IMAGE",
        kindV2: "IMAGE",
        characterSeed: seedUsed != null ? String(seedUsed) : mascotSeed,
        promptBase: mascotPromptBase,
        meta: {
          prompt,
          style,
          format,
          jobId,
          status: "DONE",
          provider,
          aspectRatio: aspect,
          size: provider === "openai" ? openaiSize : undefined,
          imageUrl,
          characterSeed: seedUsed != null ? String(seedUsed) : mascotSeed,
          promptBase: mascotPromptBase,
        },
      },
    })

    return NextResponse.json({
      ok: true,
      mock: false,
      creditsRemaining,
      imageUrl,
      jobId,
      seed: seedUsed != null ? String(seedUsed) : mascotSeed,
    })
  } catch (e) {
    if (didDebitCredits) {
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
            data: {
              storeId,
              kind: "IMAGE",
              kindV2: "IMAGE",
              meta: {
                prompt: prompt.slice(0, 500),
                style,
                format,
                jobId,
                status: "REFUND",
                error: e instanceof Error ? e.message : "image_api_error",
              },
            },
          })
        })
      } catch {
        /* ignore */
      }
    } else if (jobDbId) {
      try {
        await prisma.marketingMediaJob.update({
          where: { id: jobDbId },
          data: {
            meta: {
              prompt: prompt.slice(0, 500),
              style,
              format,
              jobId,
              status: "ERROR",
              error: e instanceof Error ? e.message : "image_api_error",
            },
          },
        })
      } catch {
        /* ignore */
      }
    }
    const credits = await getMarketingMediaCredits(storeId).catch(() => 0)
    return NextResponse.json(
      {
        ok: false,
        error: "image_api_error",
        creditsRemaining: credits,
        message: didDebitCredits
          ? "Falha ao gerar imagem. Seu crédito foi retornado."
          : "Falha ao gerar imagem.",
      },
      { status: 502 }
    )
  }
}

