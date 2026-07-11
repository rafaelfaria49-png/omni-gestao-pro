import { NextResponse } from "next/server"
import { Prisma } from "@/generated/prisma"
import { prisma, prismaEnsureConnected } from "@/lib/prisma"
import { requireCadastrosHubApi } from "@/lib/cadastros/hub-api-gate"
import { fiscalInputFromBody, mergeProdutoFiscalIntoMetadata } from "@/lib/produto-fiscal"
import { catalogoInputFromBody, mergeCatalogoAparelhosIntoMetadata } from "@/lib/catalogo-aparelhos/produto-metadata"
import { duplicateProductResponse, PRODUTO_DUP_SELECT } from "@/lib/produtos/duplicate-product"
import { normalizeProdutoCategory } from "@/lib/produtos/produto-category"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init)
}

function badRequest(message: string) {
  return json({ error: message }, { status: 400 })
}

function parseStockValue(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.floor(v)
  if (typeof v === "string" && v.trim() !== "") {
    const n = parseInt(v, 10)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function parsePriceValue(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string") return Number.isFinite(Number(v)) ? Number(v) : null
  return null
}

const PRODUTO_LIST_SELECT = {
  id: true,
  name: true,
  stock: true,
  price: true,
  precoCusto: true,
  sku: true,
  barcode: true,
  category: true,
  brand: true,
  supplierName: true,
  warrantyDays: true,
  active: true,
  status: true,
  metadata: true,
  storeId: true,
  createdAt: true,
  updatedAt: true,
} as const

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requireCadastrosHubApi(req, "write")
  if (!gate.ok) return gate.response
  const storeId = gate.storeId

  const { id } = await context.params
  if (!id?.trim()) return badRequest("ID inválido")

  // Hoisted p/ o catch (P2002) também conseguir reconsultar o item colidente.
  // Só recebem valor quando o PATCH realmente define um SKU/EAN não-vazio.
  let nextSku: string | undefined
  let nextBarcode: string | undefined

  try {
    const raw = (await req.json()) as Record<string, unknown>

    const data: Prisma.ProdutoUpdateManyMutationInput = {}

    if (typeof raw.name === "string") data.name = raw.name.trim()
    if (raw.stock !== undefined) {
      const stock = parseStockValue(raw.stock)
      if (stock === null) return badRequest('Campo "stock" inválido')
      if (stock < 0) return badRequest("Estoque não pode ser negativo")
      data.stock = stock
    }
    if (raw.price !== undefined) {
      const price = parsePriceValue(raw.price)
      if (price === null) return badRequest('Campo "price" inválido')
      if (price < 0) return badRequest("Preço não pode ser negativo")
      data.price = price
    }
    if (raw.precoCusto !== undefined || raw.cost !== undefined) {
      const precoCusto = parsePriceValue(raw.precoCusto ?? raw.cost)
      if (precoCusto === null) return badRequest("preço de custo inválido")
      if (precoCusto < 0) return badRequest("Preço de custo não pode ser negativo")
      data.precoCusto = precoCusto
    }
    if ("category" in raw || "categoria" in raw) {
      const c =
        typeof raw.category === "string"
          ? raw.category.trim()
          : typeof raw.categoria === "string"
            ? raw.categoria.trim()
            : ""
      data.category = normalizeProdutoCategory(c)
    }
    if ("sku" in raw || "codigo" in raw) {
      const s = typeof raw.sku === "string" ? raw.sku.trim() : typeof raw.codigo === "string" ? raw.codigo.trim() : ""
      data.sku = s ? s : null
    }
    if ("barcode" in raw || "codigoBarras" in raw) {
      const b =
        typeof raw.barcode === "string"
          ? raw.barcode.trim()
          : typeof raw.codigoBarras === "string"
            ? raw.codigoBarras.trim()
            : ""
      data.barcode = b ? b : null
    }
    if ("brand" in raw || "marca" in raw) {
      const b = typeof raw.brand === "string" ? raw.brand.trim() : typeof raw.marca === "string" ? raw.marca.trim() : ""
      data.brand = b
    }
    if ("supplierName" in raw || "fornecedor" in raw) {
      const s =
        typeof raw.supplierName === "string"
          ? raw.supplierName.trim()
          : typeof raw.fornecedor === "string"
            ? raw.fornecedor.trim()
            : ""
      data.supplierName = s
    }
    if (raw.warrantyDays !== undefined || raw.garantia !== undefined) {
      const w = parseStockValue(raw.warrantyDays ?? raw.garantia)
      if (w === null) return badRequest("garantia inválida")
      data.warrantyDays = Math.max(0, w)
    }
    if (typeof raw.active === "boolean") {
      data.active = raw.active
      if (raw.status === undefined) {
        data.status = raw.active ? "Ativo" : "Inativo"
      }
    }
    if (typeof raw.status === "string" && raw.status.trim()) {
      data.status = raw.status.trim()
    }
    if (raw.metadata !== undefined) {
      if (raw.metadata === null) {
        data.metadata = Prisma.DbNull
      } else if (typeof raw.metadata === "object" && !Array.isArray(raw.metadata)) {
        data.metadata = raw.metadata as Prisma.InputJsonValue
      } else {
        return badRequest("metadata deve ser objeto JSON ou null")
      }
    }

    await prismaEnsureConnected()

    // Identidade fiscal (GOAL_004): persiste canonicamente em `metadata.fiscal`, fazendo
    // MERGE não-destrutivo no metadata atual do produto (nunca apaga outras chaves).
    const fiscalInput = fiscalInputFromBody(raw)
    if (fiscalInput) {
      let baseMeta: unknown = {}
      if (data.metadata !== undefined && data.metadata !== Prisma.DbNull) {
        baseMeta = data.metadata
      } else {
        const current = await prisma.produto.findFirst({ where: { id, storeId }, select: { metadata: true } })
        baseMeta = current?.metadata ?? {}
      }
      data.metadata = mergeProdutoFiscalIntoMetadata(baseMeta, fiscalInput) as Prisma.InputJsonValue
    }

    // Catálogo de Aparelhos (MVP): merge ADITIVO em `metadata.catalogoAparelhos`, reusando o
    // metadata já resolvido (fiscal) ou buscando o atual. Ausente = preserva; null = limpa.
    const catalogoInput = catalogoInputFromBody(raw)
    if (catalogoInput !== undefined) {
      let baseMeta: unknown = {}
      if (data.metadata !== undefined && data.metadata !== Prisma.DbNull) {
        baseMeta = data.metadata
      } else {
        const current = await prisma.produto.findFirst({ where: { id, storeId }, select: { metadata: true } })
        baseMeta = current?.metadata ?? {}
      }
      data.metadata = mergeCatalogoAparelhosIntoMetadata(baseMeta, catalogoInput) as Prisma.InputJsonValue
    }

    if (Object.keys(data).length === 0) {
      return badRequest("Nada para atualizar")
    }

    // CADASTROS-PRODUTOS-DUPLICIDADE-002 — duplicidade FORTE na edição: o novo SKU/código ou
    // código de barras/EAN já pertence a OUTRO produto da mesma loja (`id: { not: id }` ignora
    // o próprio produto). Bloqueia com aviso claro ANTES do update — antes, a colisão só
    // aparecia como 503 genérico vindo do unique constraint. Só valores NÃO-VAZIOS entram na
    // checagem: manter o próprio código, limpar (null) ou não tocar no campo nunca dispara.
    if (typeof data.sku === "string" && data.sku) nextSku = data.sku
    if (typeof data.barcode === "string" && data.barcode) nextBarcode = data.barcode
    const dupOr: Prisma.ProdutoWhereInput[] = []
    if (nextSku) dupOr.push({ sku: nextSku })
    if (nextBarcode) dupOr.push({ barcode: nextBarcode })
    if (dupOr.length > 0) {
      const existing = await prisma.produto.findFirst({
        where: { storeId, id: { not: id }, OR: dupOr },
        select: PRODUTO_DUP_SELECT,
      })
      if (existing) return duplicateProductResponse(existing, nextSku, nextBarcode, { context: "update" })
    }

    const upd = await prisma.produto.updateMany({
      where: { id, storeId },
      data,
    })
    if (upd.count === 0) {
      return json({ error: "Produto não encontrado" }, { status: 404 })
    }

    const updated = await prisma.produto.findFirst({
      where: { id, storeId },
      select: PRODUTO_LIST_SELECT,
    })

    return json({ ok: true, produto: updated })
  } catch (e) {
    // Corrida: o SKU/EAN pode ter sido tomado por outro produto entre a verificação e o
    // update. O unique constraint (P2002) também vira a MESMA mensagem amigável de
    // duplicidade — nunca um 503 cru que deixava o operador sem entender o motivo.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const dupOr: Prisma.ProdutoWhereInput[] = []
      if (nextSku) dupOr.push({ sku: nextSku })
      if (nextBarcode) dupOr.push({ barcode: nextBarcode })
      if (dupOr.length > 0) {
        const existing = await prisma.produto
          .findFirst({ where: { storeId, id: { not: id }, OR: dupOr }, select: PRODUTO_DUP_SELECT })
          .catch(() => null)
        if (existing) return duplicateProductResponse(existing, nextSku, nextBarcode, { context: "update" })
      }
      return json(
        {
          error: "Produto já cadastrado",
          type: "DUPLICATE_PRODUCT",
          message: "Produto já cadastrado. Outro item já usa este mesmo código/EAN/SKU nesta loja.",
        },
        { status: 409 },
      )
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return json({ error: "Produto não encontrado" }, { status: 404 })
    }
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[api/produtos PATCH]", msg)
    return json(
      { error: "Falha ao atualizar produto", ...(process.env.NODE_ENV === "development" ? { detail: msg } : {}) },
      { status: 503 },
    )
  }
}

export async function DELETE(req: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requireCadastrosHubApi(req, "write")
  if (!gate.ok) return gate.response
  const storeId = gate.storeId

  const { id } = await context.params
  if (!id?.trim()) return badRequest("ID inválido")

  try {
    await prismaEnsureConnected()
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
      { status: 503 },
    )
  }
}
