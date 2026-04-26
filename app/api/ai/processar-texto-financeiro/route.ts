import { NextResponse } from "next/server"
import { processarTextoFinanceiro } from "@/lib/ai/processar-texto-financeiro"
import { requireAdmin } from "@/lib/require-admin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function POST(req: Request) {
  // Segurança: em produção, restringir a admin. Em dev, liberar para testes locais.
  if (process.env.NODE_ENV === "production") {
    const gate = await requireAdmin()
    if (!gate.ok) return gate.res
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: "JSON inválido" }, { status: 400 })
  }

  const texto = typeof (body as any)?.texto === "string" ? String((body as any).texto).trim() : ""
  if (!texto) {
    return NextResponse.json({ success: false, error: "Campo texto obrigatório" }, { status: 400 })
  }

  try {
    const resultado = await processarTextoFinanceiro(texto)
    return NextResponse.json({ success: true, data: resultado })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ success: false, error: msg || "Falha ao processar texto" }, { status: 400 })
  }
}

