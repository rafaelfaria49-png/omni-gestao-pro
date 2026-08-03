import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { opsLojaIdFromRequestForWrite } from "@/lib/ops-api-gate"
import { apiGuardEnterpriseOrOps } from "@/lib/auth/api-enterprise-guard"
import type { Prisma } from "@/generated/prisma"
import { z } from "zod"
import {
  escolherEscopoVendas,
  financeiroDasVendasWhere,
  somarVendasAtivas,
} from "@/lib/caixa/sessao-vendas-escopo"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

const schema = z.object({
  sessaoId: z.string().min(1),
  saldoFinal: z.number().min(0).optional(),
  saldoContado: z.number().min(0).optional(),
  observacao: z.string().max(500).default(""),
  /** Snapshot do ledger diário para auditoria (enviado pelo cliente). */
  payload: z.record(z.unknown()).optional(),
})

export async function POST(req: Request) {
  const lojaId = opsLojaIdFromRequestForWrite(req)
  if (!lojaId) {
    return NextResponse.json(
      { error: "Unidade obrigatória: envie o header x-assistec-loja-id." },
      { status: 400 },
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 })
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 422 })
  }

  const denied = await apiGuardEnterpriseOrOps(
    lojaId,
    (p) => p.pdv.fecharCaixa,
    "Sem permissão para fechar o caixa.",
  )
  if (denied) return denied

  const { sessaoId, saldoFinal, saldoContado, observacao, payload } = parsed.data

  try {
    const existing = await prisma.sessaoCaixa.findFirst({
      where: { id: sessaoId, storeId: lojaId, status: "ABERTA" },
      select: { id: true },
    })

    if (!existing) {
      return NextResponse.json(
        { error: "Sessão não encontrada ou já fechada." },
        { status: 404 }
      )
    }

    // Busca observação anterior e horário de abertura para calcular totalVendas server-side
    const prev = await prisma.sessaoCaixa.findUnique({
      where: { id: sessaoId },
      select: { observacao: true, abertaEm: true, terminalId: true },
    })
    const obsMerge =
      observacao.trim() && prev?.observacao?.trim()
        ? `${prev.observacao.trim()}\n[Fechamento] ${observacao.trim()}`
        : observacao.trim() || prev?.observacao?.trim() || ""

    // Calcula totalVendas a partir do ledger financeiro para auditoria fiel.
    // O valor do cliente (localStorage) pode divergir; o server-side é o canônico.
    //
    // O escopo é o MESMO de `sessao-detalhe`: vendas ligadas à sessão por
    // `payload.sessaoId` (janela + terminal só como fallback legado). Usar apenas a
    // janela `abertaEm..agora` deixava de fora venda registrada segundos antes do POST
    // de abertura — e este snapshot é congelado no payload, nunca recalculado depois.
    // Ver `lib/caixa/sessao-vendas-escopo.ts`.
    const agora = new Date()
    const vendasPorSessaoId = await prisma.venda.findMany({
      where: { storeId: lojaId, payload: { path: ["sessaoId"], equals: sessaoId } },
      select: { pedidoId: true, total: true, status: true },
    })
    const { vendas: vendasDaSessao } = escolherEscopoVendas(
      vendasPorSessaoId,
      vendasPorSessaoId.length > 0
        ? []
        : await prisma.venda.findMany({
            where: {
              storeId: lojaId,
              at: { gte: prev?.abertaEm ?? agora, lte: agora },
              ...(prev?.terminalId ? { terminalId: prev.terminalId } : {}),
            },
            select: { pedidoId: true, total: true, status: true },
          }),
    )
    const vendasAtivas = somarVendasAtivas(vendasDaSessao)
    const financeiroWhere = financeiroDasVendasWhere(lojaId, vendasAtivas.pedidoIds)
    const movFinAgg = financeiroWhere
      ? await prisma.movimentacaoFinanceira.aggregate({
          where: financeiroWhere,
          _sum: { valor: true },
          _count: true,
        })
      : { _sum: { valor: null as number | null }, _count: 0 }
    const totalVendasServer = Math.round((movFinAgg._sum.valor ?? 0) * 100) / 100

    // Mescla payload do cliente com totais server-side.
    // O cliente envia o snapshot do ledger diário (localStorage); o servidor sobrepõe
    // o totalVendas com o valor calculado do banco para garantir auditoria correta.
    const payloadFinal: Prisma.InputJsonValue = {
      ...(payload ? (payload as Record<string, unknown>) : {}),
      totalVendasServer,
      totalVendasCount: movFinAgg._count,
      computadoEm: agora.toISOString(),
    }

    const sessao = await prisma.sessaoCaixa.update({
      where: { id: sessaoId },
      data: {
        status: "FECHADA",
        saldoFinal: saldoFinal ?? null,
        saldoContado: saldoContado ?? null,
        observacao: obsMerge,
        fechadaEm: agora,
        payload: payloadFinal,
      },
      select: { id: true, fechadaEm: true, status: true },
    })

    return NextResponse.json({ ok: true, sessao })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[ops/caixa/fechar]", msg)
    return NextResponse.json({ error: "Falha ao fechar sessão de caixa" }, { status: 500 })
  }
}
