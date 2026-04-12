import { NextRequest, NextResponse } from "next/server"
import { analyzeProductImageFromDataUrl } from "@/lib/vision-product-openai"

export const runtime = "nodejs"
export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { imageBase64?: string }
    const raw = body.imageBase64?.trim()
    if (!raw || !raw.startsWith("data:image/")) {
      return NextResponse.json(
        { error: "Envie imageBase64 como data URL (data:image/jpeg;base64,...)" },
        { status: 400 }
      )
    }

    const result = await analyzeProductImageFromDataUrl(raw)
    return NextResponse.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao processar imagem"
    const status =
      msg.includes("OPENAI_API_KEY") || msg.includes("não configurada") ? 503 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
