import { NextResponse } from "next/server"
import { prisma, prismaEnsureConnected } from "@/lib/prisma"
import { opsLojaIdFromRequest } from "@/lib/ops-api-gate"
import { apiGuardEnterpriseOrOps } from "@/lib/auth/api-enterprise-guard"
import { parseClientSaleId } from "@/lib/vendas/sale-identity-contracts"
import { VENDA_REPLAY_SELECT } from "@/lib/ops-upsert-venda"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

/**
 * Reconciliação segura por `(storeId, clientSaleId)`.
 * Nunca revela existência de venda de outra loja — 404 idêntico.
 */
export async function GET(req: Request) {
  const lojaId = opsLojaIdFromRequest(req)
  if (!lojaId) {
    return NextResponse.json({ error: "storeId obrigatório" }, { status: 400 })
  }

  const denied = await apiGuardEnterpriseOrOps(
    lojaId,
    (p) => p.hubs.vendas,
    "Sem permissão para consultar vendas.",
  )
  if (denied) return denied

  const url = new URL(req.url)
  const parsed = parseClientSaleId(url.searchParams.get("clientSaleId"))
  if (!parsed.ok) {
    return NextResponse.json(
      { error: "clientSaleId inválido", code: "CLIENT_SALE_ID_REQUIRED", reason: parsed.reason },
      { status: 400 },
    )
  }

  await prismaEnsureConnected()
  const venda = await prisma.venda.findFirst({
    where: { storeId: lojaId, clientSaleId: parsed.clientSaleId },
    select: VENDA_REPLAY_SELECT,
  })
  if (!venda) {
    return NextResponse.json({ error: "Venda não encontrada" }, { status: 404 })
  }

  return NextResponse.json({
    ok: true,
    venda: {
      id: venda.id,
      storeId: venda.storeId,
      pedidoId: venda.pedidoId,
      clientSaleId: venda.clientSaleId,
      total: venda.total,
      at: venda.at.toISOString(),
      clienteNome: venda.clienteNome,
      clienteId: venda.clienteId,
      terminalId: venda.terminalId,
      status: venda.status,
    },
  })
}
