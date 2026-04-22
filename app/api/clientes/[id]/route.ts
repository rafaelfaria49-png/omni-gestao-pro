import { NextResponse } from "next/server"
import { Prisma } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"
import { isValidPhoneBr } from "@/lib/phone-br"
import { storeIdFromAssistecRequestForWrite } from "@/lib/store-id-from-request"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init)
}

function badRequest(message: string) {
  return json({ error: message }, { status: 400 })
}

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  if (!id?.trim()) return badRequest("ID inválido")

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

    const upd = await prisma.cliente.updateMany({
      where: { id, storeId },
      data: {
        name,
        phone,
        email: email || null,
      },
    })
    if (upd.count === 0) {
      return json({ error: "Cliente não encontrado" }, { status: 404 })
    }

    const updated = await prisma.cliente.findFirst({
      where: { id, storeId },
      select: { id: true, name: true, phone: true, email: true, createdAt: true },
    })

    return json({ ok: true, cliente: updated })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return json({ error: "Cliente não encontrado" }, { status: 404 })
    }
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[api/clientes PATCH]", msg)
    return json(
      { error: "Falha ao atualizar cliente", ...(process.env.NODE_ENV === "development" ? { detail: msg } : {}) },
      { status: 503 }
    )
  }
}

export async function DELETE(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  if (!id?.trim()) return badRequest("ID inválido")

  try {
    const storeId = storeIdFromAssistecRequestForWrite(req)
    if (!storeId) {
      return badRequest("Unidade obrigatória: envie o header x-assistec-loja-id ou query storeId.")
    }
    const del = await prisma.cliente.deleteMany({ where: { id, storeId } })
    if (del.count === 0) {
      return json({ error: "Cliente não encontrado" }, { status: 404 })
    }
    return json({ ok: true })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return json({ error: "Cliente não encontrado" }, { status: 404 })
    }
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[api/clientes DELETE]", msg)
    return json(
      { error: "Falha ao excluir cliente", ...(process.env.NODE_ENV === "development" ? { detail: msg } : {}) },
      { status: 503 }
    )
  }
}
