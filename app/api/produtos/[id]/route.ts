import { NextResponse } from "next/server"
import { Prisma } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"
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

function parseStock(body: unknown): number | null {
  if (typeof body === "number" && Number.isFinite(body)) return Math.floor(body)
  if (typeof body === "string" && body.trim() !== "") {
    const n = parseInt(body, 10)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function parsePrice(body: unknown): number | null {
  if (typeof body === "number" && Number.isFinite(body)) return body
  if (typeof body === "string") return Number.isFinite(Number(body)) ? Number(body) : null
  return null
}

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  if (!id?.trim()) return badRequest("ID inválido")

  try {
    const body = (await req.json()) as { name?: unknown; stock?: unknown; price?: unknown }

    const name = typeof body.name === "string" ? body.name.trim() : ""
    const stock = parseStock(body.stock)
    const price = parsePrice(body.price)
    const storeId = storeIdFromAssistecRequestForWrite(req)
    if (!storeId) return badRequest("Unidade obrigatória: envie o header x-assistec-loja-id ou query storeId.")

    if (!name) return badRequest('Campo "name" é obrigatório')
    if (stock === null) return badRequest('Campo "stock" é obrigatório (número inteiro)')
    if (stock < 0) return badRequest("Estoque não pode ser negativo")
    if (price === null) return badRequest('Campo "price" é obrigatório (número)')
    if (price < 0) return badRequest("Preço não pode ser negativo")

    const upd = await prisma.produto.updateMany({
      where: { id, storeId },
      data: {
        name,
        stock,
        price,
      },
    })
    if (upd.count === 0) {
      return json({ error: "Produto não encontrado" }, { status: 404 })
    }

    const updated = await prisma.produto.findFirst({
      where: { id, storeId },
      select: { id: true, name: true, stock: true, price: true, storeId: true, createdAt: true, updatedAt: true },
    })

    return json({ ok: true, produto: updated })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return json({ error: "Produto não encontrado" }, { status: 404 })
    }
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[api/produtos PATCH]", msg)
    return json(
      { error: "Falha ao atualizar produto", ...(process.env.NODE_ENV === "development" ? { detail: msg } : {}) },
      { status: 503 }
    )
  }
}

export async function DELETE(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  if (!id?.trim()) return badRequest("ID inválido")

  try {
    const storeId = storeIdFromAssistecRequestForWrite(req)
    if (!storeId) return badRequest("Unidade obrigatória: envie o header x-assistec-loja-id ou query storeId.")
    const del = await prisma.produto.deleteMany({ where: { id, storeId } })
    if (del.count === 0) {
      return json({ error: "Produto não encontrado" }, { status: 404 })
    }
    return json({ ok: true })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return json({ error: "Produto não encontrado" }, { status: 404 })
    }
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[api/produtos DELETE]", msg)
    return json(
      { error: "Falha ao excluir produto", ...(process.env.NODE_ENV === "development" ? { detail: msg } : {}) },
      { status: 503 }
    )
  }
}
