/**
 * GET /api/vendas/[id]
 *
 * Retorna detalhe completo de uma venda:
 * - Dados normalizados (status, operador, datas)
 * - Itens da venda
 * - Devoluções vinculadas
 * - Payload JSON (pagamentos, descontos, cpf)
 */
import { NextResponse } from "next/server"
import { prisma, prismaEnsureConnected, withPrismaSafe } from "@/lib/prisma"
import { opsLojaIdFromRequest } from "@/lib/ops-api-gate"
import type { PaymentBreakdownFull } from "@/lib/operations-sale-types"
import { computeVendaStatusFinanceiro, sumPagamentosHistorico } from "@/lib/vendas/venda-financeiro-resumo"
import { readAccessorySelectionForDisplay } from "@/lib/vendas/accessory-selection-readback"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

const PAYMENT_LABELS: Record<keyof PaymentBreakdownFull, string> = {
  dinheiro: "Dinheiro",
  pix: "Pix",
  cartaoDebito: "Débito",
  cartaoCredito: "Crédito",
  carne: "Carnê",
  aPrazo: "A Prazo",
  creditoVale: "Vale/Crédito",
}

function extractPayments(payload: unknown): Array<{ label: string; valor: number }> {
  if (!payload || typeof payload !== "object") return []
  const pb = (payload as Record<string, unknown>).paymentBreakdown as
    | Partial<PaymentBreakdownFull>
    | undefined
  if (!pb) return []
  const result: Array<{ label: string; valor: number }> = []
  for (const [k, v] of Object.entries(pb)) {
    const val = Number(v) || 0
    if (val > 0) {
      result.push({
        label: PAYMENT_LABELS[k as keyof PaymentBreakdownFull] ?? k,
        valor: val,
      })
    }
  }
  return result
}

function extractDiscount(payload: unknown): number {
  if (!payload || typeof payload !== "object") return 0
  const p = payload as Record<string, unknown>
  const d = p.discountTotal ?? p.discountReais
  return typeof d === "number" ? d : 0
}

function extractCashTendered(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null
  const value = Number((payload as Record<string, unknown>).cashTendered)
  return Number.isFinite(value) && value >= 0 ? value : null
}

function extractCustomerCpf(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null
  const cpf = (payload as Record<string, unknown>).customerCpf
  return typeof cpf === "string" && cpf.trim() ? cpf.trim() : null
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const storeId = opsLojaIdFromRequest(req)
  if (!storeId) return NextResponse.json({ error: "storeId obrigatório" }, { status: 400 })
  const { id: rawId } = await params
  const pedidoId = rawId?.trim()
  // Workspace Enterprise (F1): enriquecimento read-only opt-in. Os consumidores
  // legados (drawer, cupom, correção) NÃO enviam `full` → resposta inalterada.
  const full = new URL(req.url).searchParams.get("full") === "1"

  if (!pedidoId) {
    return NextResponse.json({ ok: false, error: "ID da venda obrigatório" }, { status: 400 })
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

    // Buscar devoluções vinculadas via vendaLocalId
    const devolucoes = await prisma.devolucaoVenda.findMany({
      where: { storeId, vendaLocalId: pedidoId },
      include: { itens: true },
      orderBy: { at: "desc" },
    })

    // Buscar sessão de caixa — sessaoId pode vir do payload
    const sessaoIdPayload = venda.payload && typeof venda.payload === "object"
      ? ((venda.payload as Record<string, unknown>).sessaoId as string | undefined)
      : undefined

    // Flags de cancelamento ERP-safe: houve reposição de estoque / estorno financeiro?
    const [movEstoqueCancel, movFinCancel] = await Promise.all([
      prisma.movimentacaoEstoque.findFirst({
        where: { storeId, documento: pedidoId, origem: "cancelamento_pdv" },
        select: { id: true },
      }),
      prisma.movimentacaoFinanceira.findFirst({
        where: { storeId, referenciaId: pedidoId, tipo: "saida", origem: "cancelamento_pdv" },
        select: { id: true },
      }),
    ])

    const correcoes = venda.payload && typeof venda.payload === "object"
      ? (Array.isArray((venda.payload as Record<string, unknown>).correcoes)
        ? (venda.payload as Record<string, unknown>).correcoes as unknown[]
        : [])
      : []

    // Terminal: resolve via FK na coluna `Venda.terminalId` (Fase 3) ou via payload
    // (vendas da Fase 1/2 antes do backfill da coluna).
    const terminalIdResolved =
      venda.terminalId ||
      (venda.payload && typeof venda.payload === "object"
        ? ((venda.payload as Record<string, unknown>).terminalId as string | undefined)
        : undefined) ||
      null
    const terminal = terminalIdResolved
      ? await withPrismaSafe(
          async (db) =>
            (await db.pdvTerminal.findFirst({
              where: { id: terminalIdResolved, storeId },
              select: { id: true, code: true, name: true },
            })) as { id: string; code: string; name: string } | null,
          null as { id: string; code: string; name: string } | null,
        )
      : null

    // Procedência de recuperação: presente só em vendas renumeradas a partir de uma
    // quarentena de identidade. O número ANTIGO vive aqui, como trilha de auditoria —
    // nunca como identidade atual da venda.
    const recoveryRaw =
      venda.payload && typeof venda.payload === "object"
        ? ((venda.payload as Record<string, unknown>).recovery as Record<string, unknown> | undefined)
        : undefined
    const recovery =
      recoveryRaw && typeof recoveryRaw.recoveredFromPedidoId === "string"
        ? {
            recoveredFromPedidoId: recoveryRaw.recoveredFromPedidoId,
            recoveredAt:
              typeof recoveryRaw.recoveredAt === "string" ? recoveryRaw.recoveredAt : null,
            motivo: typeof recoveryRaw.motivo === "string" ? recoveryRaw.motivo : null,
            conflictCode:
              typeof recoveryRaw.conflictCode === "string" ? recoveryRaw.conflictCode : null,
          }
        : null

    // Forma de pagamento bruta (espelho do payload) — usada pelo Workspace.
    const pbRaw =
      venda.payload && typeof venda.payload === "object"
        ? ((venda.payload as Record<string, unknown>).paymentBreakdown as Partial<PaymentBreakdownFull> | undefined) ?? null
        : null

    // ── Enriquecimento Enterprise (Workspace F1) — SOMENTE LEITURA, opt-in `?full=1`.
    // Nenhuma mutação. Carrega cliente completo, sessão de caixa, movimentações
    // financeiras, títulos a receber e o status financeiro derivado da venda.
    let enterprise: Record<string, unknown> = {}
    if (full) {
      const [clienteCompleto, sessao, movimentacoesFinanceiras, titulosRaw] = await Promise.all([
        venda.clienteId
          ? prisma.cliente.findFirst({
              where: { id: venda.clienteId, storeId },
              select: {
                id: true, name: true, kind: true, document: true, phone: true,
                email: true, city: true, totalSpent: true, lastPurchaseAt: true,
              },
            })
          : Promise.resolve(null),
        sessaoIdPayload
          ? prisma.sessaoCaixa.findFirst({
              where: { id: sessaoIdPayload, storeId },
              select: {
                id: true, operador: true, status: true, abertaEm: true,
                fechadaEm: true, saldoInicial: true, terminalId: true,
              },
            })
          : Promise.resolve(null),
        prisma.movimentacaoFinanceira.findMany({
          where: { storeId, referenciaId: pedidoId },
          orderBy: { createdAt: "asc" },
          select: { id: true, tipo: true, origem: true, valor: true, descricao: true, createdAt: true },
        }),
        prisma.contaReceberTitulo.findMany({
          where: {
            storeId,
            OR: [
              { localKey: { startsWith: `pdv-aprazo-${pedidoId}` } },
              ...(venda.contaReceberTituloId ? [{ id: venda.contaReceberTituloId }] : []),
            ],
          },
          orderBy: { createdAt: "asc" },
        }),
      ])

      const titulos = titulosRaw.map((t) => ({
        id: t.id,
        localKey: t.localKey,
        descricao: t.descricao,
        cliente: t.cliente,
        valor: t.valor,
        vencimento: t.vencimento,
        status: t.status,
        pago: sumPagamentosHistorico(t.payload),
        createdAt: t.createdAt.toISOString(),
      }))

      const statusFinanceiro = computeVendaStatusFinanceiro({
        total: venda.total,
        paymentBreakdown: pbRaw,
        movimentacoes: movimentacoesFinanceiras.map((m) => ({ tipo: m.tipo, origem: m.origem, valor: m.valor })),
        titulos: titulosRaw.map((t) => ({ status: t.status, valor: t.valor, payload: t.payload })),
      })

      enterprise = {
        clienteCompleto: clienteCompleto
          ? { ...clienteCompleto, lastPurchaseAt: clienteCompleto.lastPurchaseAt?.toISOString() ?? null }
          : null,
        sessao: sessao
          ? {
              ...sessao,
              abertaEm: sessao.abertaEm.toISOString(),
              fechadaEm: sessao.fechadaEm?.toISOString() ?? null,
            }
          : null,
        movimentacoesFinanceiras: movimentacoesFinanceiras.map((m) => ({
          id: m.id,
          tipo: m.tipo,
          origem: m.origem,
          valor: m.valor,
          descricao: m.descricao,
          createdAt: m.createdAt.toISOString(),
        })),
        titulos,
        statusFinanceiro,
      }
    }

    return NextResponse.json({
      ok: true,
      venda: {
        id: venda.pedidoId,
        dbId: venda.id,
        at: venda.at.toISOString(),
        paymentBreakdown: pbRaw,
        recovery,
        ...enterprise,
        clienteNome: venda.clienteNome || null,
        clienteId: venda.clienteId || null,
        clienteCpf: extractCustomerCpf(venda.payload),
        total: venda.total,
        desconto: extractDiscount(venda.payload),
        cashTendered: extractCashTendered(venda.payload),
        status: venda.status,
        operador: venda.operador || null,
        canceladaEm: venda.canceladaEm?.toISOString() ?? null,
        canceladaPor: venda.canceladaPor ?? null,
        motivoCancelamento: venda.motivoCancelamento ?? null,
        estoqueReposto: !!movEstoqueCancel,
        estornoFinanceiro: !!movFinCancel,
        sessaoId: sessaoIdPayload ?? null,
        terminalId: terminalIdResolved,
        terminal,
        observacao: venda.payload && typeof venda.payload === "object"
          ? ((venda.payload as Record<string, unknown>).observacao as string | null) ?? null
          : null,
        correcoes,
        pagamentos: extractPayments(venda.payload),
        itens: venda.itens.map((it, i) => {
          // Metadados do item (serial/IMEI/lote/garantia/observação) vivem em
          // payload.lines[i].metadata (F4). Casamento por posição (ordem de criação).
          const pl = venda.payload && typeof venda.payload === "object"
            ? (venda.payload as Record<string, unknown>).lines
            : undefined
          const line = Array.isArray(pl) && pl[i] && typeof pl[i] === "object" ? (pl[i] as Record<string, unknown>) : null
          const metadata = line && line.metadata && typeof line.metadata === "object" ? line.metadata : null
          // Read-back de accessorySelection (004C): mesmo casamento por posição
          // já usado para `metadata` (F4) — payload.lines[i] ↔ ItemVenda[i].
          const acessorio = readAccessorySelectionForDisplay(line)
          return {
            id: it.id,
            inventoryId: it.inventoryId,
            nome: it.nome,
            quantidade: it.quantidade,
            precoUnitario: it.precoUnitario,
            lineTotal: it.lineTotal,
            metadata,
            ...(acessorio.hasSelection
              ? { acessorio: { modelLabel: acessorio.modelLabel, colorLabel: acessorio.colorLabel } }
              : {}),
          }
        }),
        devolucoes: devolucoes.map((d) => {
          // Extrai metadata de troca imediata do payload (vendaOriginalId, novaVendaId, totais).
          const meta =
            d.payload && typeof d.payload === "object"
              ? (d.payload as Record<string, unknown>)
              : null
          const modo = meta && typeof meta.modo === "string" ? (meta.modo as string) : null
          const novaVendaId = meta && typeof meta.novaVendaId === "string" ? (meta.novaVendaId as string) : null
          return {
            id: d.id,
            localId: d.localId,
            at: d.at.toISOString(),
            tipo: d.tipo,
            valorTotal: d.valorTotal,
            creditoEmitido: d.creditoEmitido,
            operador: d.operador,
            motivo: d.motivo,
            modo,
            novaVendaId,
            itens: d.itens.map((it) => ({
              nome: it.nome,
              quantidade: it.quantidade,
              valorTotal: it.valorTotal,
            })),
          }
        }),
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[vendas/detalhe]", msg)
    return NextResponse.json({ ok: false, error: "Falha ao carregar venda" }, { status: 503 })
  }
}
