import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/require-admin"
import { ASSISTEC_LOJA_HEADER } from "@/lib/assistec-headers"
import { storeIdFromAssistecRequestForRead } from "@/lib/store-id-from-request"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function storeIdFrom(req: Request): string {
  const h = req.headers.get(ASSISTEC_LOJA_HEADER)?.trim()
  if (h) return h
  return storeIdFromAssistecRequestForRead(req)
}

export async function GET(req: Request) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res
  const storeId = storeIdFrom(req)
  try {
    const posts = await prisma.marketingIaPost.findMany({
      where: { storeId },
      orderBy: { createdAt: "desc" },
      take: 36,
      select: {
        id: true,
        caption: true,
        productName: true,
        tone: true,
        status: true,
        scheduledFor: true,
        createdAt: true,
      },
    })
    const lastCaption = posts[0]?.caption?.trim() || null
    return NextResponse.json({ posts, lastCaption })
  } catch {
    return NextResponse.json({ posts: [], lastCaption: null, error: "db_error" }, { status: 500 })
  }
}

type PostBody = {
  caption?: string
  productName?: string
  tone?: string
  status?: string
  scheduledFor?: string | null
}

export async function POST(req: Request) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res
  const storeId = storeIdFrom(req)
  let body: PostBody
  try {
    body = (await req.json()) as PostBody
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 })
  }
  const caption = typeof body.caption === "string" ? body.caption.trim() : ""
  if (!caption) return NextResponse.json({ error: "caption obrigatório" }, { status: 400 })
  if (caption.length > 12_000) return NextResponse.json({ error: "caption muito longo" }, { status: 400 })

  const statusRaw = typeof body.status === "string" ? body.status.trim().toUpperCase() : "GENERATED"
  const status = statusRaw === "SCHEDULED" ? "SCHEDULED" : "GENERATED"
  let scheduledFor: Date | null = null
  if (status === "SCHEDULED") {
    if (typeof body.scheduledFor === "string" && body.scheduledFor.trim()) {
      const d = new Date(body.scheduledFor)
      if (!Number.isNaN(d.getTime())) scheduledFor = d
    }
    if (!scheduledFor) {
      const d = new Date()
      d.setDate(d.getDate() + 1)
      d.setHours(18, 0, 0, 0)
      scheduledFor = d
    }
  }

  try {
    const post = await prisma.marketingIaPost.create({
      data: {
        storeId,
        caption,
        productName: typeof body.productName === "string" ? body.productName.slice(0, 240) : "",
        tone: typeof body.tone === "string" ? body.tone.slice(0, 48) : "",
        status,
        scheduledFor,
      },
    })
    return NextResponse.json({ ok: true, post })
  } catch {
    return NextResponse.json({ error: "db_error" }, { status: 500 })
  }
}
