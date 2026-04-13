import { NextRequest, NextResponse } from "next/server"
import { transcribeAudioBuffer } from "@/lib/transcribe-openai"
import { extractProductFormFromTranscript } from "@/lib/product-ncm-fiscal-ai"

export const runtime = "nodejs"
export const maxDuration = 60

function dataUrlToBuffer(dataUrl: string): { buf: Buffer; mime: string; filename: string } {
  const m = /^data:([^;]+);base64,([\s\S]+)$/.exec(dataUrl.trim())
  if (!m) {
    throw new Error("audioBase64 deve ser data URL (data:audio/...;base64,...)")
  }
  const mime = m[1] || "audio/webm"
  const buf = Buffer.from(m[2], "base64")
  const ext =
    mime.includes("webm") ? "webm" : mime.includes("mp4") ? "m4a" : mime.includes("mpeg") ? "mp3" : "audio"
  return { buf, mime, filename: `gravacao.${ext}` }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { audioBase64?: string }
    const raw = body.audioBase64?.trim()
    if (!raw) {
      return NextResponse.json({ error: "audioBase64 obrigatório" }, { status: 400 })
    }

    const { buf, mime, filename } = dataUrlToBuffer(raw)
    if (buf.length < 100) {
      return NextResponse.json({ error: "Áudio muito curto ou inválido" }, { status: 400 })
    }

    const transcript = await transcribeAudioBuffer(buf, filename, mime)
    const meta = await extractProductFormFromTranscript(transcript)
    return NextResponse.json({ ...meta, transcript: transcript.slice(0, 2000) })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao processar áudio"
    const status =
      msg.includes("OPENAI_API_KEY") || msg.includes("não configurada") ? 503 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
