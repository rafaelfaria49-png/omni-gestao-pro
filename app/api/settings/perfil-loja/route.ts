import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { parsePerfilLoja, type PerfilLojaId } from "@/lib/perfil-loja-types"

export const runtime = "nodejs"

export async function GET() {
  try {
    const row = await prisma.appLojaSettings.findUnique({ where: { id: "default" } })
    const perfilLoja = parsePerfilLoja(row?.perfilLoja)
    return NextResponse.json({ perfilLoja })
  } catch {
    return NextResponse.json({ perfilLoja: parsePerfilLoja(undefined) })
  }
}

export async function PUT(req: Request) {
  try {
    const body = (await req.json()) as { perfilLoja?: string }
    const perfilLoja = parsePerfilLoja(body.perfilLoja) as PerfilLojaId
    await prisma.appLojaSettings.upsert({
      where: { id: "default" },
      create: { id: "default", perfilLoja },
      update: { perfilLoja },
    })
    return NextResponse.json({ ok: true, perfilLoja })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao salvar"
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
