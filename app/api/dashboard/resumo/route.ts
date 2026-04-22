import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { storeIdFromAssistecRequestForRead } from "@/lib/store-id-from-request"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET(req: Request) {
  try {
    const storeId = storeIdFromAssistecRequestForRead(req)
    const [totalClientes, produtosEsgotados] = await Promise.all([
      prisma.cliente.count({ where: { storeId } }),
      prisma.produto.count({ where: { storeId, stock: 0 } }),
    ])
    return NextResponse.json({ ok: true, storeId, totalClientes, produtosEsgotados })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[api/dashboard/resumo]", msg)
    return NextResponse.json(
      { ok: false, error: "Falha ao carregar resumo", ...(process.env.NODE_ENV === "development" ? { detail: msg } : {}) },
      { status: 503 }
    )
  }
}
