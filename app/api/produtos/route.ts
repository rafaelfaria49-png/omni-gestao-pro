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

function normalizeSearch(s: string) {
  return s.trim()
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

function optTrim(body: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = body[k]
    if (typeof v !== "string") continue
    const t = v.trim()
    if (t) return t
  }
  return undefined
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

export async function GET(req: Request) {
  const gate = await requireCadastrosHubApi(req, "read")
  if (!gate.ok) return gate.response

  try {
    const url = new URL(req.url)
    const q = normalizeSearch(url.searchParams.get("q") ?? "")
    const activeOnly = url.searchParams.get("activeOnly") === "1" || url.searchParams.get("activeOnly") === "true"
    const storeId = gate.storeId

    await prismaEnsureConnected()
    const produtos = await prisma.produto.findMany({
      where: {
        storeId,
        ...(activeOnly ? { active: true } : {}),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" as const } },
                { sku: { contains: q, mode: "insensitive" as const } },
                { barcode: { contains: q, mode: "insensitive" as const } },
                { category: { contains: q, mode: "insensitive" as const } },
                { brand: { contains: q, mode: "insensitive" as const } },
                { supplierName: { contains: q, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      orderBy: { updatedAt: "desc" },
      select: PRODUTO_LIST_SELECT,
      take: 500,
    })

    return json({ produtos })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[api/produtos GET]", msg)
    return json(
      { error: "Falha ao listar produtos", ...(process.env.NODE_ENV === "development" ? { detail: msg } : {}) },
      { status: 503 },
    )
  }
}

export async function POST(req: Request) {
  const gate = await requireCadastrosHubApi(req, "write")
  if (!gate.ok) return gate.response
  const storeId = gate.storeId

  // Hoisted para o catch (P2002) também conseguir reconsultar o item existente.
  let sku: string | undefined
  let barcode: string | undefined

  try {
    const raw = (await req.json()) as Record<string, unknown>
    const body = raw as { name?: unknown; stock?: unknown; price?: unknown }

    const name = typeof body.name === "string" ? body.name.trim() : ""
    const stock = parseStock(body.stock)
    const price = parsePrice(body.price)
    const precoCusto = parsePrice(raw.precoCusto ?? raw.cost) ?? 0
    const category = normalizeProdutoCategory(optTrim(raw, "category", "categoria"))
    sku = optTrim(raw, "sku", "codigo")
    barcode = optTrim(raw, "barcode", "codigoBarras")
    const brand = optTrim(raw, "brand", "marca") ?? ""
    const supplierName = optTrim(raw, "supplierName", "fornecedor") ?? ""
    const warrantyDaysRaw = parseStock(raw.warrantyDays ?? raw.garantia)
    const warrantyDays = warrantyDaysRaw === null ? 0 : Math.max(0, warrantyDaysRaw)
    const active = typeof raw.active === "boolean" ? raw.active : true
    const statusStr = typeof raw.status === "string" && raw.status.trim() ? raw.status.trim() : active ? "Ativo" : "Inativo"

    let metadata: Prisma.InputJsonValue | typeof Prisma.DbNull | undefined
    if (raw.metadata !== undefined) {
      if (raw.metadata === null) metadata = Prisma.DbNull
      else if (typeof raw.metadata === "object" && raw.metadata !== null && !Array.isArray(raw.metadata)) {
        metadata = raw.metadata as Prisma.InputJsonValue
      } else {
        return badRequest("metadata deve ser objeto JSON ou null")
      }
    }

    // Identidade fiscal (GOAL_004): campos fiscais (top-level ou metadata.fiscal) passam a
    // PERSISTIR canonicamente em `metadata.fiscal` — fim do descarte no cadastro. Dormente.
    const fiscalInput = fiscalInputFromBody(raw)
    if (fiscalInput) {
      const baseMeta = metadata && metadata !== Prisma.DbNull ? metadata : {}
      metadata = mergeProdutoFiscalIntoMetadata(baseMeta, fiscalInput) as Prisma.InputJsonValue
    }

    // Catálogo de Aparelhos (MVP): grava `metadata.catalogoAparelhos` de forma ADITIVA,
    // sem tocar em SKU/EAN/estoque/preço. Ausente = não grava; null = limpa.
    const catalogoInput = catalogoInputFromBody(raw)
    if (catalogoInput !== undefined) {
      const baseMeta = metadata && metadata !== Prisma.DbNull ? metadata : {}
      metadata = mergeCatalogoAparelhosIntoMetadata(baseMeta, catalogoInput) as Prisma.InputJsonValue
    }

    if (!name) return badRequest('Campo "name" é obrigatório')
    if (stock === null) return badRequest('Campo "stock" é obrigatório (número inteiro)')
    if (stock < 0) return badRequest("Estoque não pode ser negativo")
    if (price === null) return badRequest('Campo "price" é obrigatório (número)')
    if (price < 0) return badRequest("Preço não pode ser negativo")
    if (precoCusto < 0) return badRequest("Preço de custo não pode ser negativo")

    await prismaEnsureConnected()

    // CADASTROS-PRODUTOS-DUPLICIDADE-001 — duplicidade FORTE: mesmo SKU/código ou mesmo
    // código de barras/EAN já cadastrado nesta loja. Bloqueia com aviso claro ANTES do
    // insert (antes, a colisão só aparecia como 503 genérico vindo do unique constraint).
    const dupOr: Prisma.ProdutoWhereInput[] = []
    if (sku) dupOr.push({ sku })
    if (barcode) dupOr.push({ barcode })
    if (dupOr.length > 0) {
      const existing = await prisma.produto.findFirst({
        where: { storeId, OR: dupOr },
        select: PRODUTO_DUP_SELECT,
      })
      if (existing) return duplicateProductResponse(existing, sku, barcode)
    }

    const created = await prisma.produto.create({
      data: {
        name,
        stock,
        price,
        storeId,
        precoCusto,
        category,
        sku: sku ?? null,
        barcode: barcode ?? null,
        brand,
        supplierName,
        warrantyDays,
        active,
        status: statusStr,
        ...(metadata !== undefined ? { metadata } : {}),
      },
      select: PRODUTO_LIST_SELECT,
    })

    return json({ ok: true, produto: created }, { status: 201 })
  } catch (e) {
    // Corrida: o item pode ter sido criado entre a verificação e o insert. O unique
    // constraint (P2002) também vira a MESMA mensagem amigável de duplicidade — nunca um
    // 503 cru que deixava o operador sem saber que o produto já existia.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const dupOr: Prisma.ProdutoWhereInput[] = []
      if (sku) dupOr.push({ sku })
      if (barcode) dupOr.push({ barcode })
      if (dupOr.length > 0) {
        const existing = await prisma.produto
          .findFirst({ where: { storeId, OR: dupOr }, select: PRODUTO_DUP_SELECT })
          .catch(() => null)
        if (existing) return duplicateProductResponse(existing, sku, barcode)
      }
      return json(
        {
          error: "Produto já cadastrado",
          type: "DUPLICATE_PRODUCT",
          message: "Produto já cadastrado. Já existe um item com este mesmo código/EAN/SKU nesta loja.",
        },
        { status: 409 },
      )
    }
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[api/produtos POST]", msg)
    return json(
      { error: "Falha ao criar produto", ...(process.env.NODE_ENV === "development" ? { detail: msg } : {}) },
      { status: 503 },
    )
  }
}
