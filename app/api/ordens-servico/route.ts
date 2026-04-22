import { NextResponse } from "next/server"
import { StatusOrdemServico as StatusOSEnum } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"
import { storeIdFromAssistecRequestForRead, storeIdFromAssistecRequestForWrite } from "@/lib/store-id-from-request"
import { parseStatusOS } from "@/lib/os-status"
import type { ItemInput } from "@/lib/os-itens-stock"
import { baixarEstoqueECriarItens, somaPecasEValidaEstoque } from "@/lib/os-itens-stock"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init)
}

function badRequest(message: string) {
  return json({ error: message }, { status: 400 })
}

function parsePrice(body: unknown): number | null {
  if (typeof body === "number" && Number.isFinite(body)) return body
  if (typeof body === "string") return Number.isFinite(Number(body)) ? Number(body) : null
  return null
}

function parseValorBase(body: unknown): number {
  const v = parsePrice(body)
  if (v === null) return 0
  return v < 0 ? 0 : v
}

function parseItens(body: unknown): ItemInput[] {
  if (!Array.isArray(body)) return []
  const out: ItemInput[] = []
  for (const x of body) {
    if (!x || typeof x !== "object") continue
    const o = x as Record<string, unknown>
    const produtoId = typeof o.produtoId === "string" ? o.produtoId.trim() : ""
    const rawQ = o.quantidade
    const q = typeof rawQ === "number" ? rawQ : parseInt(String(rawQ ?? ""), 10)
    if (!produtoId || !Number.isFinite(q)) continue
    out.push({ produtoId, quantidade: Math.floor(q) })
  }
  return out
}

const ordemInclude = {
  cliente: { select: { id: true, name: true, phone: true, email: true } },
  itens: {
    include: {
      produto: { select: { id: true, name: true, price: true, stock: true } },
    },
  },
} as const

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const q = url.searchParams.get("q")?.trim() ?? ""
    const storeId = storeIdFromAssistecRequestForRead(req)

    const ordens = await prisma.ordemServico.findMany({
      where: {
        storeId,
        ...(q
          ? {
              OR: [
                { equipamento: { contains: q, mode: "insensitive" } },
                { defeito: { contains: q, mode: "insensitive" } },
                { cliente: { name: { contains: q, mode: "insensitive" } } },
              ],
            }
          : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: 300,
      include: ordemInclude,
    })

    return json({ ordens })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[api/ordens-servico GET]", msg)
    return json(
      { error: "Falha ao listar ordens de serviço", ...(process.env.NODE_ENV === "development" ? { detail: msg } : {}) },
      { status: 503 }
    )
  }
}

export async function POST(req: Request) {
  try {
    const storeId = storeIdFromAssistecRequestForWrite(req)
    if (!storeId) {
      return badRequest('Unidade obrigatória: envie o header x-assistec-loja-id ou query storeId / lojaId.')
    }

    const body = (await req.json()) as {
      clienteId?: unknown
      equipamento?: unknown
      defeito?: unknown
      laudoTecnico?: unknown
      valorBase?: unknown
      itens?: unknown
      status?: unknown
      payload?: unknown
    }

    const clienteId = typeof body.clienteId === "string" ? body.clienteId.trim() : ""
    const equipamento = typeof body.equipamento === "string" ? body.equipamento.trim() : ""
    const defeito = typeof body.defeito === "string" ? body.defeito.trim() : ""
    const laudoTecnico = typeof body.laudoTecnico === "string" ? body.laudoTecnico.trim() : ""
    const valorBase = parseValorBase(body.valorBase)
    const itens = parseItens(body.itens)
    const statusParsed = body.status != null ? parseStatusOS(body.status) : null
    const status = statusParsed ?? StatusOSEnum.Aberto
    const payload = body.payload && typeof body.payload === "object" ? body.payload : undefined

    if (!clienteId) return badRequest('Campo "clienteId" é obrigatório')
    if (!equipamento) return badRequest('Campo "equipamento" é obrigatório')
    if (!defeito) return badRequest('Campo "defeito" é obrigatório')
    if (body.status != null && !statusParsed) return badRequest("status inválido")

    const clienteOk = await prisma.cliente.findFirst({ where: { id: clienteId, storeId } })
    if (!clienteOk) {
      return badRequest("Cliente inválido ou não pertence à unidade selecionada.")
    }

    const created = await prisma.$transaction(async (tx) => {
      const { sumPecas, rows } = await somaPecasEValidaEstoque(tx, itens, storeId)
      const valorTotal = valorBase + sumPecas

      const ordem = await tx.ordemServico.create({
        data: {
          storeId,
          clienteId,
          payload: payload as any,
          equipamento,
          defeito,
          laudoTecnico: laudoTecnico || null,
          valorBase,
          valorTotal,
          status,
        },
      })

      await baixarEstoqueECriarItens(tx, ordem.id, rows)

      return tx.ordemServico.findUniqueOrThrow({
        where: { id: ordem.id },
        include: ordemInclude,
      })
    })

    return json({ ok: true, ordem: created }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[api/ordens-servico POST]", msg)
    const isBiz = /Estoque insuficiente|Produto não encontrado/.test(msg)
    return json(
      {
        error: isBiz ? msg : "Falha ao criar ordem de serviço",
        ...(process.env.NODE_ENV === "development" && !isBiz ? { detail: msg } : {}),
      },
      { status: isBiz ? 400 : 503 }
    )
  }
}
