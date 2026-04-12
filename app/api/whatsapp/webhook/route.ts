import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { corsHeaders, withCors } from "@/lib/api-cors"
import { extractFromEvolutionLikePayload } from "@/lib/whatsapp-webhook-parse"
import { processOwnerWhatsAppAI } from "@/lib/whatsapp-webhook-ai"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function verifyWebhookSecret(request: Request): boolean {
  const secret = process.env.ASSISTEC_WHATSAPP_WEBHOOK_SECRET
  if (!secret) return true
  const header =
    request.headers.get("x-webhook-token") ??
    request.headers.get("x-api-key") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    new URL(request.url).searchParams.get("token")
  return header === secret
}

const MAX_DETAIL = 4000

export async function GET(request: Request) {
  const res = NextResponse.json({
    ok: true,
    service: "whatsapp-webhook",
    hint: "POST JSON (Evolution/Baileys). IA/financeiro: configure ASSISTEC_WHATSAPP_OWNER_DIGITS (seu número). Opcional: ?token= ou x-webhook-token.",
  })
  return withCors(request, res)
}

export async function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) })
}

export async function POST(request: Request) {
  if (!verifyWebhookSecret(request)) {
    return withCors(
      request,
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return withCors(
      request,
      NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
    )
  }

  const extracted = extractFromEvolutionLikePayload(body)
  if (!extracted) {
    return withCors(request, NextResponse.json({ ok: true, ignored: true }))
  }

  try {
    await processOwnerWhatsAppAI(extracted)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await prisma.logsAuditoria.create({
      data: {
        action: "whatsapp_webhook_erro",
        userLabel: `wa:${extracted.fromDigits}`,
        detail: msg.slice(0, MAX_DETAIL),
        source: "webhook",
      },
    })
    return withCors(
      request,
      NextResponse.json({ ok: false, error: "handler", detail: msg.slice(0, 200) }, { status: 500 })
    )
  }

  return withCors(request, NextResponse.json({ ok: true }))
}
