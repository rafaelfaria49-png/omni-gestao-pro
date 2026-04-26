import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/require-admin"
import { ASSISTEC_LOJA_HEADER } from "@/lib/assistec-headers"
import { storeIdFromAssistecRequestForRead } from "@/lib/store-id-from-request"
import { consumeMediaCreditAndLog, getMarketingMediaCredits } from "@/lib/marketing-media-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function storeIdFrom(req: Request): string {
  const h = req.headers.get(ASSISTEC_LOJA_HEADER)?.trim()
  if (h) return h
  return storeIdFromAssistecRequestForRead(req)
}

type Body = {
  text?: string
  voice?: string
  sourceTab?: string
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
  const text = typeof body.text === "string" ? body.text.trim() : ""
  if (!text) return NextResponse.json({ error: "texto obrigatório" }, { status: 400 })
  if (text.length > 8000) return NextResponse.json({ error: "texto muito longo" }, { status: 400 })

  const voice = typeof body.voice === "string" ? body.voice.slice(0, 32) : "especialista"
  const sourceTab = typeof body.sourceTab === "string" ? body.sourceTab.slice(0, 16) : ""

  const spent = await consumeMediaCreditAndLog({
    storeId,
    kind: "voice",
    meta: { voice, sourceTab, textPreview: text.slice(0, 120) },
  })
  if (!spent.ok) {
    const credits = await getMarketingMediaCredits(storeId)
    return NextResponse.json(
      { ok: false, error: "sem_creditos", creditsRemaining: credits, message: "Saldo de créditos esgotado." },
      { status: 402 }
    )
  }

  return NextResponse.json({
    ok: true,
    mock: true,
    creditsRemaining: spent.creditsRemaining,
    /** Prévia fixa (mock) — substituir por URL assinada do provedor TTS. */
    audioUrl: "/api/marketing/voice/demo",
    jobId: `voice-mock-${Date.now()}`,
  })
}
