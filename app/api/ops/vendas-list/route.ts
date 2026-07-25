import { NextResponse } from "next/server"
import { prisma, prismaEnsureConnected } from "@/lib/prisma"
import { requireOpsSubscription, opsLojaIdFromRequest } from "@/lib/ops-api-gate"
import { auth } from "@/auth"
import { canAccessStore } from "@/lib/auth/enterprise-permissions"
// `saleFromDbRow` vive em `@/lib/vendas/sale-from-db-row` (helper puro e testável) — ele
// também remove os marcadores client-only (`syncPending`/`syncBlockedCode`) de payloads
// legados, para que venda vinda do banco nunca volte classificada como pendente.
import { saleFromDbRow } from "@/lib/vendas/sale-from-db-row"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET(req: Request) {
  // Autorização de loja (padrão da rota irmã `/api/ops/inventory`): sessão NextAuth →
  // resolução da loja → ACL da loja → assinatura. `storeId` de query/header/cookie é apenas
  // seleção, nunca autorização. Assinatura válida sem sessão/ACL não libera leitura (IDOR).
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 })

  const lojaId = opsLojaIdFromRequest(req)
  if (!lojaId) return NextResponse.json({ error: "storeId obrigatório" }, { status: 400 })
  if (!canAccessStore(session, lojaId)) return NextResponse.json({ error: "Sem acesso à loja" }, { status: 403 })

  const gate = await requireOpsSubscription()
  if (!gate.ok) {
    const dev = process.env.NODE_ENV === "development"
    if (!dev) return gate.res
  }

  try {
    await prismaEnsureConnected()
    const rows = await prisma.venda.findMany({
      where: { storeId: lojaId },
      include: { itens: true },
      orderBy: { at: "asc" },
    })

    const sales = rows.map((r) =>
      saleFromDbRow({
        pedidoId: r.pedidoId,
        total: r.total,
        at: r.at,
        clienteNome: r.clienteNome,
        status: r.status,
        payload: r.payload,
        itens: r.itens,
      })
    )

    return NextResponse.json({
      sales,
      _lojaIdRecebido: lojaId,
      _gateBypassedInDev: !gate.ok && process.env.NODE_ENV === "development",
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[ops/vendas-list]", msg)
    const dev = process.env.NODE_ENV === "development"
    return NextResponse.json(
      { error: "Falha ao listar vendas", sales: [], ...(dev ? { detail: msg } : {}) },
      { status: 503 }
    )
  }
}
