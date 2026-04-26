import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { storeIdFromAssistecRequestForRead } from "@/lib/store-id-from-request"
import { requireAdmin } from "@/lib/require-admin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

/**
 * Importa SOMENTE Produtos + Categorias de uma unidade para outra.
 * Não copia vendas, clientes ou financeiro.
 *
 * POST /api/stores/import-catalog
 * body: { fromStoreId: string, toStoreId: string, mode?: "merge" | "overwrite" }
 *
 * mode=merge (default): upsert por (toStoreId, sku) e cria categorias que não existem.
 */
export async function POST(req: Request) {
  const actorStore = storeIdFromAssistecRequestForRead(req)
  try {
    const gate = await requireAdmin()
    if (!gate.ok) return gate.res
    const body = (await req.json()) as {
      fromStoreId?: unknown
      toStoreId?: unknown
      mode?: unknown
    }
    const fromStoreId = typeof body.fromStoreId === "string" ? body.fromStoreId.trim() : ""
    const toStoreId = typeof body.toStoreId === "string" ? body.toStoreId.trim() : ""
    const mode = body.mode === "overwrite" ? "overwrite" : "merge"

    if (!fromStoreId || !toStoreId) {
      return NextResponse.json({ ok: false, error: "fromStoreId e toStoreId são obrigatórios" }, { status: 400 })
    }
    if (fromStoreId === toStoreId) {
      return NextResponse.json({ ok: false, error: "Origem e destino não podem ser iguais" }, { status: 400 })
    }

    const [fromExists, toExists] = await Promise.all([
      prisma.store.findUnique({ where: { id: fromStoreId }, select: { id: true } }),
      prisma.store.findUnique({ where: { id: toStoreId }, select: { id: true } }),
    ])
    if (!fromExists || !toExists) {
      return NextResponse.json({ ok: false, error: "Unidade origem/destino inválida" }, { status: 404 })
    }

    const [cats, prods] = await Promise.all([
      prisma.categoriaProduto.findMany({
        where: { lojaId: fromStoreId },
        select: { slug: true, nome: true },
      }),
      prisma.produto.findMany({
        where: { storeId: fromStoreId },
        select: { sku: true, name: true, stock: true, precoCusto: true, price: true, category: true },
      }),
    ])

    let categoriasCriadas = 0
    let produtosCriados = 0
    let produtosAtualizados = 0
    let produtosIgnoradosSemSku = 0

    await prisma.$transaction(async (tx) => {
      for (const c of cats) {
        const slug = (c.slug || "").trim()
        if (!slug) continue
        await tx.categoriaProduto.upsert({
          where: { lojaId_slug: { lojaId: toStoreId, slug } },
          update: mode === "overwrite" ? { nome: c.nome } : {},
          create: { lojaId: toStoreId, slug, nome: c.nome },
        })
        categoriasCriadas += 1
      }

      for (const p of prods) {
        const sku = (p.sku || "").trim()
        if (!sku) {
          produtosIgnoradosSemSku += 1
          continue
        }
        const existing = await tx.produto.findFirst({ where: { storeId: toStoreId, sku }, select: { id: true } })
        await tx.produto.upsert({
          where: { storeId_sku: { storeId: toStoreId, sku } },
          update:
            mode === "overwrite"
              ? {
                  name: p.name,
                  stock: p.stock,
                  precoCusto: p.precoCusto,
                  price: p.price,
                  category: p.category ?? undefined,
                }
              : {
                  // merge: atualiza dados básicos (mas não apaga nada)
                  name: p.name,
                  price: p.price,
                  category: p.category ?? undefined,
                },
          create: {
            storeId: toStoreId,
            sku,
            name: p.name,
            stock: p.stock,
            precoCusto: p.precoCusto,
            price: p.price,
            category: p.category ?? undefined,
          },
        })
        if (existing) produtosAtualizados += 1
        else produtosCriados += 1
      }
    })

    return NextResponse.json({
      ok: true,
      actorStore,
      fromStoreId,
      toStoreId,
      mode,
      categoriasCopiadas: cats.length,
      categoriasCriadas,
      produtosLidos: prods.length,
      produtosIgnoradosSemSku,
      produtosCriados,
      produtosAtualizados,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Falha ao importar"
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

