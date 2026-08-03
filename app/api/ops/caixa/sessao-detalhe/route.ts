import { NextResponse } from "next/server"
import { prisma, withPrismaSafe } from "@/lib/prisma"
import { opsLojaIdFromRequest } from "@/lib/ops-api-gate"
import { apiGuardEnterpriseOrOps } from "@/lib/auth/api-enterprise-guard"
import type { PaymentBreakdownFull } from "@/lib/operations-sale-types"
import { classifyLineOrigem, type OrigemVendaKey } from "@/lib/caixa-fechamento-resumo"
import {
  escolherEscopoVendas,
  financeiroDasVendasWhere,
  somarVendasAtivas,
} from "@/lib/caixa/sessao-vendas-escopo"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

/** Item de venda mínimo (GOAL CAIXA-SESSAO-DETALHE-VENDAS-003 — base p/ Conferência de Caixa). */
export type VendaSessaoDetalheItem = {
  id: string
  numero: string
  origem: OrigemVendaKey
  total: number
  formaPagamento: string | null
  clienteNome: string | null
  clienteCpf: string | null
  createdAt: string
  status: string
  terminalId: string | null
}

const FORMA_LABEL: Record<keyof PaymentBreakdownFull, string> = {
  dinheiro: "dinheiro",
  pix: "pix",
  cartaoDebito: "cartao_debito",
  cartaoCredito: "cartao_credito",
  carne: "carne",
  aPrazo: "a_prazo",
  creditoVale: "vale",
}

function readPaymentBreakdown(payload: unknown): PaymentBreakdownFull | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null
  const pb = (payload as Record<string, unknown>).paymentBreakdown
  if (!pb || typeof pb !== "object" || Array.isArray(pb)) return null
  const o = pb as Record<string, unknown>
  const num = (k: string) => (typeof o[k] === "number" && Number.isFinite(o[k]) ? (o[k] as number) : 0)
  return {
    dinheiro: num("dinheiro"),
    pix: num("pix"),
    cartaoDebito: num("cartaoDebito"),
    cartaoCredito: num("cartaoCredito"),
    carne: num("carne"),
    aPrazo: num("aPrazo"),
    creditoVale: num("creditoVale"),
  }
}

function readCustomerCpf(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null
  const v = (payload as Record<string, unknown>).customerCpf
  return typeof v === "string" && v.trim() ? v.trim() : null
}

/** Rótulo único da forma de pagamento (null sem breakdown; "multiplo" com 2+ formas). */
function resolveFormaPagamento(pb: PaymentBreakdownFull | null): string | null {
  if (!pb) return null
  const nonZero = (Object.keys(FORMA_LABEL) as Array<keyof PaymentBreakdownFull>).filter(
    (k) => (pb[k] ?? 0) > 0.009,
  )
  if (nonZero.length === 0) return null
  if (nonZero.length === 1) return FORMA_LABEL[nonZero[0]!]
  return "multiplo"
}

/** Origem dominante da venda pelo maior valor bruto por linha (mesma classificação do fechamento). */
function resolveOrigemVenda(itens: Array<{ inventoryId: string | null; lineTotal: number }>): OrigemVendaKey {
  const acc: Record<OrigemVendaKey, number> = { pdv: 0, avulso: 0, os: 0 }
  for (const it of itens) {
    acc[classifyLineOrigem(it.inventoryId ?? "")] += it.lineTotal
  }
  if (acc.os > acc.pdv && acc.os > acc.avulso) return "os"
  if (acc.avulso > acc.pdv && acc.avulso > acc.os) return "avulso"
  return "pdv"
}

export async function GET(req: Request) {
  const lojaId = opsLojaIdFromRequest(req)
  if (!lojaId) {
    return NextResponse.json(
      { error: "Unidade obrigatória: envie o header x-assistec-loja-id." },
      { status: 400 }
    )
  }

  const denied = await apiGuardEnterpriseOrOps(
    lojaId,
    (p) => p.hubs.caixaHistorico,
    "Sem permissão para consultar o histórico de caixa.",
  )
  if (denied) return denied

  const url = new URL(req.url)
  const sessaoId = url.searchParams.get("sessaoId")
  if (!sessaoId) {
    return NextResponse.json({ error: "sessaoId obrigatório." }, { status: 400 })
  }

  try {
    const sessao = await prisma.sessaoCaixa.findFirst({
      where: { id: sessaoId, storeId: lojaId },
      include: {
        operacoes: {
          orderBy: { at: "asc" },
        },
        devolucoes: {
          select: {
            id: true,
            localId: true,
            tipo: true,
            valorTotal: true,
            creditoEmitido: true,
            clienteNome: true,
            operador: true,
            at: true,
            _count: { select: { itens: true } },
          },
          orderBy: { at: "asc" },
        },
      },
    })

    if (!sessao) {
      return NextResponse.json({ error: "Sessão não encontrada." }, { status: 404 })
    }

    // Totais de sangria/suprimento/devoluções existentes
    const sangrias = sessao.operacoes
      .filter((o) => o.tipo === "sangria")
      .reduce((s, o) => s + o.valor, 0)
    const suprimentos = sessao.operacoes
      .filter((o) => o.tipo === "suprimento")
      .reduce((s, o) => s + o.valor, 0)
    const recebimentosContas = sessao.operacoes
      .filter((o) => o.tipo === "recebimento_cr")
      .reduce((s, o) => s + o.valor, 0)
    const qtdRecebimentosContas = sessao.operacoes.filter((o) => o.tipo === "recebimento_cr").length
    const totalDevolucoes = sessao.devolucoes.reduce((s, d) => s + d.valorTotal, 0)

    const fimPeriodo = sessao.fechadaEm ?? new Date()

    // Vendas da sessão (GOAL CAIXA-SESSAO-DETALHE-VENDAS-003 — base p/ Conferência de
    // Caixa). Preferência: casar por `payload.sessaoId` (mesma regra do client
    // `filterSalesDaSessao`); sem isso (sessão legada), cai para terminalId + janela de
    // tempo. Não inventa FK nova.
    //
    // Resolvido ANTES dos totais de propósito: lista e totais precisam sair do MESMO
    // conjunto. Enquanto os totais usavam só a janela `abertaEm..fechadaEm`, uma venda
    // registrada segundos antes do POST de abertura aparecia na lista e ficava fora do
    // fechamento — ver `lib/caixa/sessao-vendas-escopo.ts`.
    const vendasItensSelect = { inventoryId: true, lineTotal: true } as const
    const vendaSelect = {
      id: true,
      pedidoId: true,
      total: true,
      at: true,
      clienteNome: true,
      status: true,
      terminalId: true,
      payload: true,
      itens: { select: vendasItensSelect },
    } as const
    const vendasPorSessaoId = await prisma.venda.findMany({
      where: { storeId: lojaId, payload: { path: ["sessaoId"], equals: sessao.id } },
      select: vendaSelect,
      orderBy: { at: "asc" },
    })
    const { vendas: vendaRows, modo: escopoVendasModo } = escolherEscopoVendas(
      vendasPorSessaoId,
      vendasPorSessaoId.length > 0
        ? []
        : await prisma.venda.findMany({
            where: {
              storeId: lojaId,
              at: { gte: sessao.abertaEm, lte: fimPeriodo },
              ...(sessao.terminalId ? { terminalId: sessao.terminalId } : {}),
            },
            select: vendaSelect,
            orderBy: { at: "asc" },
          }),
    )

    // Total de vendas a partir do ledger financeiro (MovimentacaoFinanceira origem="venda"),
    // ligado às vendas da sessão por `referenciaId = pedidoId` — e não mais por janela de
    // `createdAt`, que excluía venda legítima da própria sessão.
    const vendasAtivas = somarVendasAtivas(vendaRows)
    const financeiroWhere = financeiroDasVendasWhere(lojaId, vendasAtivas.pedidoIds)
    const movFinAgg = financeiroWhere
      ? await prisma.movimentacaoFinanceira.aggregate({
          where: financeiroWhere,
          _sum: { valor: true },
          _count: true,
        })
      : { _sum: { valor: null as number | null }, _count: 0 }
    const totalVendas = Math.round((movFinAgg._sum.valor ?? 0) * 100) / 100
    const totalVendasCount = movFinAgg._count

    // Mesmo conjunto, agora somado pelo valor da própria venda (inclui o que não gera
    // entrada imediata no ledger, como a parcela à prazo).
    const totalVendasTerminal = sessao.terminalId ? vendasAtivas.total : null
    const totalVendasCountTerminal = sessao.terminalId ? vendasAtivas.count : null

    // Info do terminal (gracioso se a tabela ainda não existir).
    const terminal = sessao.terminalId
      ? await withPrismaSafe(
          async (db) =>
            (await db.pdvTerminal.findFirst({
              where: { id: sessao.terminalId!, storeId: lojaId },
              select: { id: true, code: true, name: true },
            })) as { id: string; code: string; name: string } | null,
          null as { id: string; code: string; name: string } | null,
        )
      : null

    const vendas: VendaSessaoDetalheItem[] = vendaRows.map((v) => ({
      id: v.id,
      numero: v.pedidoId,
      origem: resolveOrigemVenda(v.itens),
      total: v.total,
      formaPagamento: resolveFormaPagamento(readPaymentBreakdown(v.payload)),
      clienteNome: v.clienteNome,
      clienteCpf: readCustomerCpf(v.payload),
      createdAt: v.at.toISOString(),
      status: v.status,
      terminalId: v.terminalId,
    }))

    return NextResponse.json({
      ok: true,
      sessao,
      terminal,
      vendas,
      totais: {
        sangrias,
        suprimentos,
        recebimentosContas: Math.round(recebimentosContas * 100) / 100,
        qtdRecebimentosContas,
        totalDevolucoes,
        totalVendas,
        totalVendasCount,
        totalVendasTerminal,
        totalVendasCountTerminal,
        /** Como o conjunto foi resolvido: `vinculo` (payload.sessaoId) ou `janela` (legado). */
        escopoVendasModo,
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[ops/caixa/sessao-detalhe]", msg)
    return NextResponse.json({ error: "Falha ao carregar detalhes da sessão" }, { status: 500 })
  }
}
