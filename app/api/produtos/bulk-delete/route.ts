import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { storeIdFromAssistecRequestForWrite } from "@/lib/store-id-from-request"
import { requireAdmin } from "@/lib/require-admin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init)
}

function badRequest(message: string) {
  return json({ error: message }, { status: 400 })
}

function storeIdFromRequest(req: Request): string | null {
  const h = req.headers.get("x-assistec-loja-id")?.trim()
  if (h) return h
  const url = new URL(req.url)
  const q = url.searchParams.get("storeId")?.trim() || url.searchParams.get("lojaId")?.trim()
  return q || null
}

export async function POST(req: Request) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return badRequest("JSON inválido")
  }

  const ids = (body as { ids?: unknown }).ids
  if (!Array.isArray(ids)) return badRequest("ids deve ser um array")
  const normalized = Array.from(new Set(ids.filter((x) => typeof x === "string").map((s) => s.trim()).filter(Boolean)))
  if (normalized.length === 0) return badRequest("Nenhum id válido")

  const storeId = storeIdFromAssistecRequestForWrite(req)
  if (!storeId) {
    return badRequest("Unidade obrigatória: envie o header x-assistec-loja-id ou query storeId / lojaId.")
  }

  const res = await prisma.produto.deleteMany({ where: { id: { in: normalized }, storeId } })
  return json({ ok: true, deleted: res.count })
}

