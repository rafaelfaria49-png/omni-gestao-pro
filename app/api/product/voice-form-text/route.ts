import { NextResponse } from "next/server"
import { extractProductFormFromTranscript } from "@/lib/product-ncm-fiscal-ai"

export const runtime = "nodejs"
export const maxDuration = 60

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { transcript?: string }
    const transcript = typeof body.transcript === "string" ? body.transcript.trim() : ""
    if (!transcript) {
      return NextResponse.json({ error: "transcript obrigatório" }, { status: 400 })
    }
    const result = await extractProductFormFromTranscript(transcript)
    return NextResponse.json({ ...result, transcript: transcript.slice(0, 2000) })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao interpretar fala"
    const status = msg.includes("Configure OPENAI") || msg.includes("GOOGLE_") ? 503 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
