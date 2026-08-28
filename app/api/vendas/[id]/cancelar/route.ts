/**
 * POST /api/vendas/[id]/cancelar
 *
 * Cancela uma venda PDV de forma profissional:
 * - Valida que não está já cancelada
 * - Avisa se houver devoluções parciais vinculadas
 * - Exige motivo
 * - Registra auditoria
 * - Estorna movimentação financeira quando aplicável
 * - Respeita período financeiro fechado
 */
import { NextResponse } from "next/server"
import { prisma, prismaEnsureConnected } from "@/lib/prisma"
import { opsLojaIdFromRequest, requireOpsSubscription } from "@/lib/ops-api-gate"
import { estornarMovimentacaoPorReferencia } from "@/lib/financeiro/services/movimentacoes-service"
import { cancelContaReceber } from "@/lib/financeiro/services/contas-receber-service"
import { verificarPeriodoFechado } from "@/lib/financeiro/services/fechamento-service"
import { requireEnterpriseWith } from "@/lib/auth/guard-enterprise"
import { getOperatorLabelFromSession } from "@/lib/auth/session-operator"
import { isVirtualSaleLine } from "@/lib/os-pdv-virtual-lines"
import { assertVendaFiscalCancelavel } from "@/lib/fiscal/venda-fiscal-state-machine"
import { auth } from "@/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

function arredonda2(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const storeId = opsLojaIdFromRequest(req)
  if (!storeId) return NextResponse.json({ error: "storeId obrigatório" }, { status: 400 })
  const { id: rawId } = await params
  const pedidoId = rawId?.trim()

  const session = await auth()
  if (session?.user) {
    const guard = await requireEnterpriseWith(
      storeId,
      (p) => p.pdv.cancelarVenda,
      "Sem permissão para cancelar vendas.",
    )
    if (!guard.ok) {
      return NextResponse.json({ ok: false, error: guard.error }, { status: guard.status })
    }
  } else {
    const sub = await requireOpsSubscription()
    if (!sub.ok) return sub.res
  }

  if (!pedidoId) {
    return NextResponse.json({ ok: false, error: "ID da venda obrigatório" }, { status: 400 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 })
  }

  const { motivo, canceladaPor, forcar } = body as {
    motivo?: string
    canceladaPor?: string
    forcar?: boolean
  }

  if (!motivo?.trim()) {
    return NextResponse.json({ ok: false, error: "Motivo do cancelamento é obrigatório" }, { status: 400 })
  }

  try {
    await prismaEnsureConnected()

    const venda = await prisma.venda.findFirst({
      where: { pedidoId, storeId },
      include: {
        itens: true,
      },
    })

    if (!venda) {
      return NextResponse.json({ ok: false, error: "Venda não encontrada" }, { status: 404 })
    }

    if (venda.status === "cancelada") {
      return NextResponse.json(
        { ok: false, error: "Esta venda já foi cancelada anteriormente" },
        { status: 409 }
      )
    }

    // Gate fiscal (GOAL_003): NAO_FISCAL (todas as vendas atuais) → no-op; estados
    // fiscais bloqueados (EMITINDO/AUTORIZADA/EM_CONTINGENCIA/CANCELADA/BLOQUEADA)
    // impedem o cancelamento operacional puro.
    const fiscalGate = assertVendaFiscalCancelavel(venda)
    if (!fiscalGate.ok) {
      return NextResponse.json({ ok: false, error: fiscalGate.error, code: fiscalGate.code }, { status: fiscalGate.status })
    }

    // Verificar se há devoluções vinculadas (com itens para o netting de estoque)
    const devolucoes = await prisma.devolucaoVenda.findMany({
      where: { storeId, vendaLocalId: pedidoId },
      select: {
        id: true,
        tipo: true,
        valorTotal: true,
        itens: { select: { inventoryId: true, quantidade: true } },
      },
    })

    const hasPartialReturn = devolucoes.length > 0 && venda.status !== "devolvida"

    if (hasPartialReturn && !forcar) {
      return NextResponse.json(
        {
          ok: false,
          error: "Esta venda possui devoluções registradas. Confirme o cancelamento com forcar=true.",
          devolucoes: devolucoes.length,
          requireConfirm: true,
        },
        { status: 409 }
      )
    }

    const lock = await verificarPeriodoFechado(storeId, new Date())
    if (lock.fechado) {
      return NextResponse.json(
        { ok: false, error: "Período financeiro fechado. Reabra o fechamento para cancelar vendas.", code: "periodo_fechado" },
        { status: 409 },
      )
    }

    const now = new Date()
    const operadorCancelamento = canceladaPor?.trim() || "Operador"
    // Operador para a trilha de auditoria das movimentações (preferir sessão NextAuth).
    const operadorLedger =
      (session?.user ? getOperatorLabelFromSession(session) : "") || operadorCancelamento
    // sessaoId apenas como metadata no estorno — NÃO reabrimos sessão fechada (risco documentado).
    const sessaoIdVenda =
      venda.payload && typeof venda.payload === "object"
        ? ((venda.payload as Record<string, unknown>).sessaoId as string | undefined)
        : undefined

    let estoqueRepostoCount = 0
    let estornoVendaRealizado = false
    /** Trilha do estorno de Crédito/Vale (lida na resposta e persistida no payload). */
    const estornoCreditoTrail: Array<{
      usoId: string
      creditoId: string
      valor: number
      saldoAntes: number
      saldoDepois: number
    }> = []

    await prisma.$transaction(async (tx) => {
      // 0. Estorno do Crédito/Vale consumido (PDV-TROCAS-VALE-HARDENING-PRE-PUBLISH-002).
      // Restaura EXATAMENTE a soma dos `UsoCreditoCliente` desta venda — numa compra
      // mista, somente a parcela de crédito/vale. Nada entra nem sai do caixa: vale
      // não é dinheiro (nenhuma MovimentacaoFinanceira é criada aqui). Idempotente:
      // o guard de status no topo (409 p/ já cancelada) impede que um replay rode
      // esta transação de novo, então o crédito nunca é devolvido duas vezes.
      const usosCredito = await tx.usoCreditoCliente.findMany({
        where: { storeId, vendaId: pedidoId },
        select: { id: true, creditoId: true, valor: true },
      })
      for (const uso of usosCredito) {
        // Incremento atômico condicionado à loja — sem write-down de outras lojas.
        const upd = await tx.clienteCredito.updateMany({
          where: { id: uso.creditoId, storeId },
          data: { saldoAtual: { increment: uso.valor } },
        })
        if (upd.count === 0) continue
        const credito = await tx.clienteCredito.findUnique({
          where: { id: uso.creditoId },
          select: { saldoAtual: true, status: true },
        })
        const saldoDepois = arredonda2(credito?.saldoAtual ?? 0)
        const saldoAntes = arredonda2(saldoDepois - uso.valor)
        // Vale com saldo restaurado volta a ser utilizável (ex.: zerado → ativo).
        if (credito && credito.status !== "ativo" && saldoDepois > 0.001) {
          await tx.clienteCredito.update({
            where: { id: uso.creditoId },
            data: { status: "ativo" },
          })
        }
        estornoCreditoTrail.push({
          usoId: uso.id,
          creditoId: uso.creditoId,
          valor: arredonda2(uso.valor),
          saldoAntes,
          saldoDepois,
        })
      }

      // 1. Marca a venda como cancelada — o payload ganha a trilha de estorno do vale.
      const payloadAtual =
        venda.payload && typeof venda.payload === "object" && !Array.isArray(venda.payload)
          ? (venda.payload as Record<string, unknown>)
          : {}
      await tx.venda.update({
        where: { id: venda.id },
        data: {
          status: "cancelada",
          canceladaEm: now,
          canceladaPor: operadorCancelamento,
          motivoCancelamento: motivo.trim(),
          ...(estornoCreditoTrail.length > 0
            ? {
                payload: {
                  ...payloadAtual,
                  estornoCreditoVale: {
                    at: now.toISOString(),
                    operador: operadorLedger,
                    usos: estornoCreditoTrail,
                  },
                },
              }
            : {}),
        },
      })

      // Resolução de produto (id|sku|barcode) com cache por inventoryId.
      const resolveCache = new Map<string, string | null>()
      const resolveProdutoId = async (rawInvId: string): Promise<string | null> => {
        if (resolveCache.has(rawInvId)) return resolveCache.get(rawInvId) ?? null
        const p = await tx.produto.findFirst({
          where: { storeId, OR: [{ id: rawInvId }, { sku: rawInvId }, { barcode: rawInvId }] },
          select: { id: true },
        })
        const id = p?.id ?? null
        resolveCache.set(rawInvId, id)
        return id
      }

      // 2. Reposição de estoque — repõe o LÍQUIDO (vendido − já devolvido na Fase 0),
      // evitando duplicidade de entrada quando a venda já tem devoluções. origem "cancelamento_pdv".
      const soldByProdutoId = new Map<string, number>()
      for (const it of venda.itens) {
        const raw = (it.inventoryId ?? "").trim()
        if (!raw || isVirtualSaleLine(raw)) continue
        const q = Math.max(0, Math.round(it.quantidade))
        if (q <= 0) continue
        const pid = await resolveProdutoId(raw)
        if (!pid) continue
        soldByProdutoId.set(pid, (soldByProdutoId.get(pid) ?? 0) + q)
      }
      const returnedByProdutoId = new Map<string, number>()
      for (const dev of devolucoes) {
        for (const it of dev.itens) {
          const raw = (it.inventoryId ?? "").trim()
          if (!raw || isVirtualSaleLine(raw)) continue
          const q = Math.max(0, Math.round(it.quantidade))
          if (q <= 0) continue
          const pid = await resolveProdutoId(raw)
          if (!pid) continue
          returnedByProdutoId.set(pid, (returnedByProdutoId.get(pid) ?? 0) + q)
        }
      }
      for (const [produtoId, sold] of soldByProdutoId) {
        const net = sold - (returnedByProdutoId.get(produtoId) ?? 0)
        if (net <= 0) continue
        // Idempotência: não repor duas vezes a mesma venda/produto.
        const jaExiste = await tx.movimentacaoEstoque.findFirst({
          where: { storeId, documento: pedidoId, produtoId, origem: "cancelamento_pdv" },
          select: { id: true },
        })
        if (jaExiste) continue
        const atual = await tx.produto.findUnique({
          where: { id: produtoId },
          select: { stock: true, precoCusto: true, sku: true, name: true },
        })
        if (!atual) continue
        const estoqueAntes = atual.stock
        const custo = arredonda2(Math.max(0, atual.precoCusto))
        await tx.produto.update({ where: { id: produtoId }, data: { stock: { increment: net } } })
        await tx.movimentacaoEstoque.create({
          data: {
            storeId,
            produtoId,
            produtoSku: atual.sku ?? null,
            produtoNome: atual.name,
            tipo: "entrada",
            origem: "cancelamento_pdv",
            quantidade: net,
            estoqueAntes,
            estoqueDepois: estoqueAntes + net,
            custoUnitario: custo,
            custoMedioAntes: custo,
            custoMedioDepois: custo,
            valorTotal: arredonda2(net * custo),
            documento: pedidoId,
            motivo: `Cancelamento venda ${pedidoId}`,
            usuario: operadorLedger || null,
          },
        })
        estoqueRepostoCount += 1
      }

      // 3. Estorno financeiro à vista — reverte o valor LÍQUIDO da entrada de venda
      // (origem "venda") descontando o que já foi estornado por devoluções. Idempotente.
      const jaEstornado = await tx.movimentacaoFinanceira.findFirst({
        where: { storeId, referenciaId: pedidoId, tipo: "saida", origem: "cancelamento_pdv" },
        select: { id: true },
      })
      if (!jaEstornado) {
        const entradas = await tx.movimentacaoFinanceira.findMany({
          where: { storeId, referenciaId: pedidoId, tipo: "entrada", origem: "venda" },
          select: { valor: true },
        })
        const valorEntrada = arredonda2(entradas.reduce((s, m) => s + (m.valor ?? 0), 0))
        let valorJaRefund = 0
        const devIds = devolucoes.map((d) => d.id)
        if (devIds.length > 0) {
          const refunds = await tx.movimentacaoFinanceira.findMany({
            where: { storeId, referenciaId: { in: devIds }, tipo: "saida", origem: "devolucao_pdv" },
            select: { valor: true },
          })
          valorJaRefund = arredonda2(refunds.reduce((s, m) => s + (m.valor ?? 0), 0))
        }
        const valorEstorno = arredonda2(Math.max(0, valorEntrada - valorJaRefund))
        if (valorEstorno > 0) {
          await tx.movimentacaoFinanceira.create({
            data: {
              storeId,
              tipo: "saida",
              valor: valorEstorno,
              descricao: `Estorno cancelamento venda ${pedidoId}${sessaoIdVenda ? ` | sessão ${sessaoIdVenda}` : ""}`,
              origem: "cancelamento_pdv",
              referenciaId: pedidoId,
            },
          })
          estornoVendaRealizado = true
        }
      }
    })

    // 4. Estorno do(s) título(s) à prazo (Contas a Receber) — N parcelas suportadas.
    // Varre TODOS os títulos via `localKey LIKE 'pdv-aprazo-${pedidoId}%'` em vez de
    // depender só da FK singular `Venda.contaReceberTituloId` (que aponta para o
    // primeiro título). Cobre venda 1 parcela e N parcelas com o mesmo código.
    // Mantido fora da transação por reaproveitar o recálculo de saldo de carteira.
    let estornoReceber = false
    let titulosCancelados = 0
    try {
      const titulosAprazo = await prisma.contaReceberTitulo.findMany({
        where: {
          storeId,
          localKey: { startsWith: `pdv-aprazo-${pedidoId}` },
        },
        select: { id: true, localKey: true },
      })
      for (const titulo of titulosAprazo) {
        try {
          const res = await estornarMovimentacaoPorReferencia(storeId, titulo.id, "receber")
          if (res.ok && res.action === "created") estornoReceber = true
        } catch (e) {
          console.error("[vendas/cancelar] estorno financeiro (a prazo) falhou:", titulo.localKey, e)
        }
        // Marca o título como cancelado se ainda não estiver pago (best-effort).
        try {
          await cancelContaReceber({
            storeId,
            id: titulo.id,
            motivo: motivo.trim(),
            userLabel: operadorCancelamento,
          })
          titulosCancelados += 1
        } catch (e) {
          console.error("[vendas/cancelar] cancelContaReceber falhou:", titulo.localKey, e)
        }
      }
    } catch (e) {
      console.error("[vendas/cancelar] busca de títulos à prazo falhou:", e)
    }

    return NextResponse.json({
      ok: true,
      cancelada: true,
      pedidoId,
      canceladaEm: now.toISOString(),
      canceladaPor: operadorCancelamento,
      motivoCancelamento: motivo.trim(),
      estoqueReposto: estoqueRepostoCount,
      estornoVenda: estornoVendaRealizado,
      estornoFinanceiro: estornoReceber || estornoVendaRealizado,
      titulosAprazoCancelados: titulosCancelados,
      devolucoesMantidas: devolucoes.length,
      // Estorno do crédito/vale consumido (parcela de Crédito/Vale do pagamento).
      estornoCreditoVale: {
        usos: estornoCreditoTrail.length,
        valor:
          Math.round(estornoCreditoTrail.reduce((s, e) => s + e.valor, 0) * 100) / 100,
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[vendas/cancelar]", msg)
    return NextResponse.json(
      { ok: false, error: "Falha ao cancelar venda", detail: process.env.NODE_ENV === "development" ? msg : undefined },
      { status: 503 }
    )
  }
}
