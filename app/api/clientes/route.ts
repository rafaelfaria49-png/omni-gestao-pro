import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { isValidPhoneBr } from "@/lib/phone-br"
import { storeIdFromAssistecRequestForRead, storeIdFromAssistecRequestForWrite } from "@/lib/store-id-from-request"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init)
}

function badRequest(message: string) {
  return json({ error: message }, { status: 400 })
}

function normalizeSearch(s: string) {
  return s.trim()
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const q = normalizeSearch(url.searchParams.get("q") ?? "")
    const storeId = storeIdFromAssistecRequestForRead(req)

    const clientes = await prisma.cliente.findMany({
      where: {
        storeId,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" as const } },
                { phone: { contains: q, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, phone: true, email: true, createdAt: true },
      take: 200,
    })

    return json({ clientes })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[api/clientes GET]", msg)
    return json(
      { error: "Falha ao listar clientes", ...(process.env.NODE_ENV === "development" ? { detail: msg } : {}) },
      { status: 503 }
    )
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { name?: unknown; phone?: unknown; email?: unknown }

    const name = typeof body.name === "string" ? body.name.trim() : ""
    const phone = typeof body.phone === "string" ? body.phone.trim() : ""
    const email = typeof body.email === "string" ? body.email.trim() : ""
    const storeId = storeIdFromAssistecRequestForWrite(req)
    if (!storeId) {
      return badRequest("Unidade obrigatória: envie o header x-assistec-loja-id ou query storeId.")
    }

    if (!name) return badRequest('Campo "name" é obrigatório')
    if (!phone) return badRequest('Campo "phone" é obrigatório')
    if (!isValidPhoneBr(phone)) return badRequest("Telefone inválido (use DDD + número, 10 ou 11 dígitos)")

    const created = await prisma.cliente.create({
      data: {
        name,
        phone,
        email: email || null,
        storeId,
      },
      select: { id: true, name: true, phone: true, email: true, createdAt: true },
    })

    return json({ ok: true, cliente: created }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[api/clientes POST]", msg)
    return json(
      { error: "Falha ao criar cliente", ...(process.env.NODE_ENV === "development" ? { detail: msg } : {}) },
      { status: 503 }
    )
  }
}
