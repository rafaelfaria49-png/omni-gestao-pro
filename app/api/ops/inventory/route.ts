import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@/generated/prisma"
import { getVerifiedSubscriptionFromCookies } from "@/lib/api-auth"
import { isVencimentoExpired } from "@/lib/subscription-seal"
import { getTrustedTimeMs } from "@/lib/trusted-time"
import type { Produto } from "@/generated/prisma"
import { storeIdFromAssistecRequestForRead, storeIdFromAssistecRequestForWrite } from "@/lib/store-id-from-request"
import { auth } from "@/auth"
import { canAccessStore } from "@/lib/auth/enterprise-permissions"
import { getProdutoFiscal, isProdutoFiscalVazio, type ProdutoFiscal } from "@/lib/produto-fiscal"
import { produtoCategoryForRead } from "@/lib/produtos/produto-category"
// (sem normalizeNameForMatch — tabela `product` é minimalista)

export const runtime = "nodejs"
/** Sem cache de rota / fetch no Next — sempre dados frescos do Prisma. */
export const dynamic = "force-dynamic"
export const revalidate = 0

/** Fora de produção, leituras/escritas de estoque não exigem cookie de assinatura (dev / preview local). */
function bypassSubscriptionCheck(): boolean {
  return process.env.NODE_ENV !== "production"
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function withDbRetry<T>(label: string, fn: () => Promise<T>, attempts = 6): Promise<T> {
  let last: unknown
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn()
    } catch (e) {
      last = e
      const code = e instanceof Prisma.PrismaClientKnownRequestError ? e.code : ""
      const msg = e instanceof Error ? e.message : String(e)
      const transient =
        code === "P1001" ||
        code === "P1002" ||
        code === "P1017" ||
        code === "P2024" ||
        /P1001|P1002|P1017|timeout|ECONNRESET|ENOTFOUND|connection|Can't reach database/i.test(msg)
      if (transient && i < attempts - 1) {
        const ms = 700 * (i + 1)
        console.warn(`[ops/inventory] ${label} — retry ${i + 1}/${attempts} em ${ms}ms:`, msg.slice(0, 200))
        await sleep(ms)
        continue
      }
      throw e
    }
  }
  throw last
}

type InvPayload = {
  id: string
  name: string
  barcode?: string
  sku?: string
  dbId?: string
  codigo?: string
  codigoBarras?: string
  stock: number
  cost: number
  price: number
  category?: string
  vendaPorPeso?: boolean
  precoPorKg?: number
  atributos?: unknown[]
  /**
   * Identidade fiscal do produto (GOAL_004) — campo ADITIVO e somente-leitura.
   * Presente apenas quando há algum dado fiscal. O PDV ignora; o Cadastro usa na edição.
   */
  fiscal?: ProdutoFiscal
}

function rowToItem(row: Produto): InvPayload {
  const sku = typeof (row as unknown as { sku?: unknown }).sku === "string" ? String((row as unknown as { sku: string }).sku) : ""
  const barcode =
    typeof (row as unknown as { barcode?: unknown }).barcode === "string"
      ? String((row as unknown as { barcode: string }).barcode)
      : ""
  const skuTrim = sku.trim()
  const bcTrim = barcode.trim()
  const opId = skuTrim || row.id
  const fiscal = getProdutoFiscal(row)
  return {
    id: opId,
    name: row.name,
    barcode: bcTrim || undefined,
    sku: skuTrim || undefined,
    dbId: row.id,
    codigo: skuTrim || undefined,
    codigoBarras: bcTrim || undefined,
    stock: row.stock,
    cost: row.precoCusto,
    price: row.price,
    category: produtoCategoryForRead((row as unknown as { category?: unknown }).category),
    ...(isProdutoFiscalVazio(fiscal) ? {} : { fiscal }),
  }
}

async function requireSubscription() {
  const sub = await getVerifiedSubscriptionFromCookies()
  if (!sub.ok) {
    return { ok: false as const, res: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) }
  }
  const now = await getTrustedTimeMs()
  if (isVencimentoExpired(now, sub.vencimento) || sub.status !== "ativa") {
    return { ok: false as const, res: NextResponse.json({ error: "Assinatura inválida" }, { status: 403 }) }
  }
  return { ok: true as const, sub }
}

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 })
  const lojaIdRecebido = storeIdFromAssistecRequestForRead(req)
  if (!lojaIdRecebido) return NextResponse.json({ error: "storeId obrigatório" }, { status: 400 })
  if (!canAccessStore(session, lojaIdRecebido)) return NextResponse.json({ error: "Sem acesso à loja" }, { status: 403 })
  try {
    const gate = await requireSubscription()
    if (!gate.ok) {
      if (!bypassSubscriptionCheck()) return gate.res
      console.warn("[ops/inventory] bypass subscription check (dev mode)")
    }

    console.log(`[ops/inventory GET] lojaId recebido=${lojaIdRecebido}`)

    // Leitura do estoque por loja.
    await withDbRetry("$connect", () => prisma.$connect())
    const rows = await withDbRetry("findMany", () =>
      prisma.produto.findMany({ where: { storeId: lojaIdRecebido }, orderBy: { name: "asc" } })
    )
    console.log("Dados encontrados no banco (por loja):", rows.length)
    return NextResponse.json({
      items: rows.map(rowToItem),
      _lojaIdRecebido: lojaIdRecebido,
      _gateBypassedInDev: !gate.ok && bypassSubscriptionCheck(),
    })
  } catch (e) {
    const dev = process.env.NODE_ENV === "development"
    const msg = e instanceof Error ? e.message : String(e)
    const stack = e instanceof Error ? e.stack : undefined
    const prismaCode = e instanceof Prisma.PrismaClientKnownRequestError ? e.code : undefined
    console.error("[ops/inventory GET] erro completo:", e)
    if (stack) console.error("[ops/inventory GET] stack:\n", stack)
    return NextResponse.json(
      { error: "Falha ao carregar estoque", ...(dev ? { detail: msg, stack, prismaCode } : {}) },
      { status: 503 }
    )
  }
}

/**
 * LEGACY_INVENTORY_SYNC_DISABLED — escrita ampla de inventário QUARENTENADA
 * (GOAL OPS-INVENTORY-SYNC-SAFETY-001 · auditoria PDV-WHATSAPP-SALE-AUDIT-001).
 *
 * Este PUT recebia o INVENTÁRIO INTEIRO do client (`{ items: [...] }`) e fazia
 * `produto.upsert` por SKU, SOBRESCREVENDO o estoque REAL (`stock`/`price`/`precoCusto`)
 * com o estado local/desatualizado do navegador. Mesmo admin-gated, isso violava
 * "servidor é fonte da verdade": uma sessão admin, um cache de outra loja ou um
 * snapshot antigo do localStorage podia regravar o estoque inteiro sem intenção.
 *
 * O sync automático do `operations-store` foi removido. A escrita de estoque deve usar
 * fluxos GRANULARES do servidor: venda → `/api/ops/venda-persist`; cadastro/edição →
 * `/api/produtos`; inventário assistido → `app/actions/inventario.ts`. A leitura (GET)
 * permanece ativa. Este endpoint de escrita ampla está desativado (410 Gone).
 */
export async function PUT(req: Request) {
  const storeId = storeIdFromAssistecRequestForWrite(req)
  console.warn(
    "[ops/inventory PUT] bloqueado — sincronização ampla de inventário desativada",
    JSON.stringify({ storeId: storeId ?? null }),
  )
  return NextResponse.json(
    {
      error:
        "Sincronização ampla de inventário desativada. Use ajustes granulares — o servidor é a fonte da verdade do estoque.",
      code: "INVENTORY_BULK_SYNC_DISABLED",
    },
    { status: 410 },
  )
}
