import { NextResponse } from "next/server"
import { classifyProductFiscal } from "@/lib/product-ncm-fiscal-ai"

export const runtime = "nodejs"
export const maxDuration = 60

type Body = {
  nome?: string
  descricao?: string
  categoria?: "peca" | "acessorio" | "servico"
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body
    const nome = typeof body.nome === "string" ? body.nome.trim() : ""
    const categoria = body.categoria
    if (!nome) {
      return NextResponse.json({ error: "nome obrigatório" }, { status: 400 })
    }
    if (categoria !== "peca" && categoria !== "acessorio" && categoria !== "servico") {
      return NextResponse.json({ error: "categoria inválida" }, { status: 400 })
    }
    const result = await classifyProductFiscal({
      nome,
      descricao: typeof body.descricao === "string" ? body.descricao : undefined,
      categoria,
    })
    return NextResponse.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro na classificação fiscal"
    const status = msg.includes("Configure OPENAI") || msg.includes("GOOGLE_") ? 503 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
