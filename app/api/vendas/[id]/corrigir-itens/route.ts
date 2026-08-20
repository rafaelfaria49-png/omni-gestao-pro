/**
 * POST /api/vendas/[id]/corrigir-itens  — Workspace de Correção, F2 (Produtos/Estoque)
 *
 * Corrige os ITENS de uma venda à vista, aplicando o DELTA de estoque de forma
 * auditada. NÃO altera pagamento (forma), cliente, data nem fiscal. Reaproveita o
 * padrão de `upsertVendaInTransaction` (resolução id|sku|barcode, baixa anti-negativa)
 * e o ledger `MovimentacaoEstoque` (origem "correcao_pdv").
 *
 * Efeitos automáticos (Parte 7 do GOAL — gerados pela correção de produtos):
 *  - `ItemVenda` recriado conforme o draft.
 *  - `MovimentacaoEstoque`: baixa a diferença a mais / devolve a diferença a menos.
 *    Item avulso e linhas O.S. não tocam estoque.
 *  - `Venda.total` atualizado; `MovimentacaoFinanceira(origem:"venda")` reconciliada
 *    ao novo total (à vista); o delta cai em `payload.paymentBreakdown.dinheiro`.
 *  - `payload.correcoes[]` recebe a trilha completa (antes/depois/motivo/supervisor/impacto).
 *
 * Guardas: motivo + PIN supervisor; período/caixa fechado (F-02); venda não cancelada;
 * concorrência otimista por `expectedTotal`; anti-estoque-negativo; venda à vista pura
 * (aPrazo/vale bloqueados → fase futura).
 */
import { NextResponse } from "next/server"
import { prisma, prismaEnsureConnected } from "@/lib/prisma"
import { opsLojaIdFromRequest } from "@/lib/ops-api-gate"
import { requireCorrecaoVendaAuth } from "@/lib/vendas/guard-correcao-venda"
import { assertVendaFiscalEditavel } from "@/lib/fiscal/venda-fiscal-state-machine"
import { getOperatorLabelFromSession } from "@/lib/auth/session-operator"
import { authenticateSupervisorPin } from "@/lib/auth/verify-supervisor-pin"
import type { PaymentBreakdownFull } from "@/lib/operations-sale-types"
import { isVirtualSaleLine } from "@/lib/os-pdv-virtual-lines"
import { verificarPeriodoFechado } from "@/lib/financeiro/services/fechamento-service"
import {
  computeCorrecaoItensPlan,
  round2,
  type CorrecaoLineInput,
} from "@/lib/vendas/correcao-itens-plan"
import { composeCorrectedSalePayloadLines } from "@/lib/vendas/preserve-sale-line-payload"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

type CorrigirItensBody = {
  motivo?: string
  supervisorPin?: string
  /** Total atual conhecido pelo cliente (concorrência otimista). */
  expectedTotal?: number
  itens?: CorrecaoLineInput[]
}

function describePayment(pb: Partial<PaymentBreakdownFull>): string {
  const labels: Record<string, string> = {
    dinheiro: "Dinheiro", pix: "Pix", cartaoDebito: "Débito", cartaoCredito: "Crédito",
    carne: "Carnê", aPrazo: "A Prazo", creditoVale: "Vale/Crédito",
  }
  return (Object.keys(labels) as (keyof PaymentBreakdownFull)[])
    .filter((k) => (pb[k] ?? 0) > 0)
    .map((k) => labels[k])
    .join(" + ") || "—"
}

function compactBreakdown(pb: PaymentBreakdownFull): Partial<PaymentBreakdownFull> {
  const out: Partial<PaymentBreakdownFull> = {}
  for (const k of Object.keys(pb) as (keyof PaymentBreakdownFull)[]) {
    if ((pb[k] ?? 0) > 0) out[k] = pb[k]
  }
  return out
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const storeId = opsLojaIdFromRequest(req)
  if (!storeId) return NextResponse.json({ ok: false, error: "storeId obrigatório" }, { status: 400 })
  const { id: rawId } = await params
  const pedidoId = rawId?.trim()
  if (!pedidoId) return NextResponse.json({ ok: false, error: "ID da venda obrigatório" }, { status: 400 })

  // Segurança (mesmo padrão de cancelar/venda-persist): sessão + acesso à loja +
  // permissão; assinatura no PDV legado. Escopa a correção à loja do operador.
  const acl = await requireCorrecaoVendaAuth(storeId)
  if (!acl.ok) return NextResponse.json({ ok: false, error: acl.error }, { status: acl.status })
  const session = acl.session

  let body: CorrigirItensBody
  try {
    body = (await req.json()) as CorrigirItensBody
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 })
  }

  const motivo = body.motivo?.trim()
  if (!motivo) {
    return NextResponse.json({ ok: false, error: "Motivo da correção é obrigatório" }, { status: 400 })
  }
  if (!Array.isArray(body.itens)) {
    return NextResponse.json({ ok: false, error: "Lista de itens obrigatória" }, { status: 400 })
  }

  try {
    await prismaEnsureConnected()

    const venda = await prisma.venda.findFirst({ where: { pedidoId, storeId }, include: { itens: true } })
    if (!venda) return NextResponse.json({ ok: false, error: "Venda não encontrada" }, { status: 404 })
    if (venda.status === "cancelada") {
      return NextResponse.json({ ok: false, error: "Não é possível corrigir uma venda cancelada" }, { status: 409 })
    }

    // Gate fiscal (GOAL_003): NAO_FISCAL → no-op; estados fiscais bloqueados impedem a correção.
    const fiscalGate = assertVendaFiscalEditavel(venda)
    if (!fiscalGate.ok) {
      return NextResponse.json({ ok: false, error: fiscalGate.error, code: fiscalGate.code }, { status: fiscalGate.status })
    }

    // Concorrência otimista: o draft foi montado sobre um total específico.
    if (typeof body.expectedTotal === "number" && Math.abs(round2(body.expectedTotal) - round2(venda.total)) > 0.01) {
      return NextResponse.json(
        { ok: false, error: "A venda foi alterada por outro processo. Recarregue o Workspace e refaça a correção.", code: "stale" },
        { status: 409 },
      )
    }

    const payload = (venda.payload && typeof venda.payload === "object" ? venda.payload : {}) as Record<string, unknown>
    const oldPb = (payload.paymentBreakdown ?? {}) as Partial<PaymentBreakdownFull>

    // Linhas antigas: fonte única = ItemVenda (mesma base que o GET expõe e o draft do
    // cliente usa). `inventoryId` aqui já é o produtoId resolvido (ou `__avulso__/__os__`
    // para virtuais, detectados por prefixo). Evita divergência payload.lines × ItemVenda.
    const oldLines: CorrecaoLineInput[] = venda.itens.map((it) => ({
      inventoryId: it.inventoryId ?? "",
      nome: it.nome,
      quantidade: it.quantidade,
      precoUnitario: it.precoUnitario,
    }))

    // Plano puro (decide tudo; não toca o banco).
    const plan = computeCorrecaoItensPlan({ oldLines, newLines: body.itens, oldTotal: venda.total, oldBreakdown: oldPb })
    if (!plan.ok) {
      const status = plan.errorCode === "no_change" ? 200 : 422
      return NextResponse.json({ ok: false, error: plan.error, code: plan.errorCode }, { status })
    }

    // PIN supervisor (correção de itens altera total/estoque).
    const supervisorPin = body.supervisorPin?.trim()
    if (!supervisorPin) {
      return NextResponse.json(
        { ok: false, error: "PIN de supervisor obrigatório para corrigir itens", code: "pin_required" },
        { status: 403 },
      )
    }
    const admin = await authenticateSupervisorPin(supervisorPin)
    if (!admin) {
      return NextResponse.json({ ok: false, error: "PIN de supervisor inválido", code: "pin_invalid" }, { status: 401 })
    }
    const supervisorName = admin.name || "Supervisor"

    // Período/caixa fechado (F-02) — usa a data da venda.
    const lock = await verificarPeriodoFechado(storeId, venda.at)
    if (lock.fechado) {
      return NextResponse.json(
        { ok: false, error: "Período financeiro fechado para a data desta venda. Reabra o fechamento para corrigir os itens.", code: "periodo_fechado" },
        { status: 409 },
      )
    }

    const operador = session?.user ? getOperatorLabelFromSession(session) : "Operador"
    const now = new Date()

    // ── Resolver produtos reais (id|sku|barcode) e re-agregar deltas por produtoId ──
    const resolveCache = new Map<string, { id: string; sku: string | null; name: string } | null>()
    const resolveProduto = async (rawInvId: string) => {
      if (resolveCache.has(rawInvId)) return resolveCache.get(rawInvId) ?? null
      const p = await prisma.produto.findFirst({
        where: { storeId, OR: [{ id: rawInvId }, { sku: rawInvId }, { barcode: rawInvId }] },
        select: { id: true, sku: true, name: true },
      })
      const v = p ? { id: p.id, sku: p.sku ?? null, name: p.name } : null
      resolveCache.set(rawInvId, v)
      return v
    }

    // deltaQty por produtoId real (>0 baixa, <0 devolve). Linhas virtuais já foram excluídas pelo plano.
    const deltaByProduto = new Map<string, { delta: number; nome: string }>()
    const naoResolvidos: string[] = []
    for (const d of plan.stockDeltas) {
      if (isVirtualSaleLine(d.inventoryId)) continue
      const prod = await resolveProduto(d.inventoryId)
      if (!prod) {
        naoResolvidos.push(d.inventoryId)
        continue
      }
      const cur = deltaByProduto.get(prod.id)
      if (cur) cur.delta += d.deltaQty
      else deltaByProduto.set(prod.id, { delta: d.deltaQty, nome: prod.name })
    }

    // Pré-checagem anti-negativo (read-only) para todas as BAIXAS.
    for (const [produtoId, info] of deltaByProduto) {
      if (info.delta <= 0) continue
      const p = await prisma.produto.findUnique({ where: { id: produtoId }, select: { stock: true, name: true } })
      if (!p) continue
      if (p.stock < info.delta) {
        return NextResponse.json(
          {
            ok: false,
            error: `Estoque insuficiente para "${p.name}": disponível ${p.stock}, necessário a mais ${info.delta}.`,
            code: "estoque_insuficiente",
          },
          { status: 409 },
        )
      }
    }

    // ── Transação atômica ────────────────────────────────────────────────────────
    let estoqueMovimentos = 0
    await prisma.$transaction(async (tx) => {
      // 1) Estoque: aplica delta por produto (baixa anti-negativa / devolução).
      for (const [produtoId, info] of deltaByProduto) {
        if (info.delta === 0) continue
        const atual = await tx.produto.findUnique({
          where: { id: produtoId },
          select: { stock: true, precoCusto: true, sku: true, name: true },
        })
        if (!atual) continue
        const estoqueAntes = atual.stock
        const custo = round2(Math.max(0, atual.precoCusto))

        if (info.delta > 0) {
          // baixar a mais — anti-negativo atômico
          const baixa = await tx.produto.updateMany({
            where: { id: produtoId, storeId, stock: { gte: info.delta } },
            data: { stock: { decrement: info.delta } },
          })
          if (baixa.count === 0) throw new Error(`estoque_insuficiente_concorrente:${produtoId}`)
        } else {
          // devolver — incrementa
          await tx.produto.update({ where: { id: produtoId }, data: { stock: { increment: -info.delta } } })
        }

        const estoqueDepois = estoqueAntes - info.delta
        await tx.movimentacaoEstoque.create({
          data: {
            storeId,
            produtoId,
            produtoSku: atual.sku ?? null,
            produtoNome: atual.name,
            tipo: info.delta > 0 ? "saida" : "entrada",
            origem: "correcao_pdv",
            quantidade: -info.delta, // saída negativa, devolução positiva (convenção do ledger)
            estoqueAntes,
            estoqueDepois,
            custoUnitario: custo,
            custoMedioAntes: custo,
            custoMedioDepois: custo,
            valorTotal: round2(Math.abs(info.delta) * custo),
            documento: pedidoId,
            motivo: `Correção de itens — venda ${pedidoId}`,
            usuario: operador,
          },
        })
        estoqueMovimentos += 1
      }

      // 2) ItemVenda: recria conforme o draft (espelha upsertVendaInTransaction).
      await tx.itemVenda.deleteMany({ where: { vendaId: venda.id } })
      for (const l of plan.newLines) {
        let inventoryId: string | null = l.inventoryId
        if (!l.virtual) {
          const prod = await resolveProduto(l.inventoryId)
          if (prod) inventoryId = prod.id
        }
        await tx.itemVenda.create({
          data: {
            vendaId: venda.id,
            inventoryId,
            nome: l.nome,
            quantidade: l.quantidade,
            precoUnitario: l.precoUnitario,
            lineTotal: l.lineTotal,
          },
        })
      }

      // 3) Financeiro à vista: reconcilia a entrada única ao novo total.
      const descEntrada = `Venda PDV ${pedidoId} — correção de itens (${plan.oldTotal.toFixed(2)} → ${plan.newTotal.toFixed(2)} em ${now.toLocaleDateString("pt-BR")})`
      const entrada = await tx.movimentacaoFinanceira.findFirst({
        where: { storeId, referenciaId: pedidoId, tipo: "entrada", origem: "venda" },
        orderBy: { createdAt: "asc" },
      })
      if (plan.cashEntryTarget > 0.005) {
        if (entrada) {
          await tx.movimentacaoFinanceira.update({ where: { id: entrada.id }, data: { valor: plan.cashEntryTarget, descricao: descEntrada } })
        } else {
          await tx.movimentacaoFinanceira.create({
            data: { storeId, tipo: "entrada", valor: plan.cashEntryTarget, descricao: descEntrada, origem: "venda", referenciaId: pedidoId, createdAt: venda.at },
          })
        }
      } else if (entrada) {
        await tx.movimentacaoFinanceira.delete({ where: { id: entrada.id } })
      }

      // 4) Payload + total + auditoria.
      const newPbStored = compactBreakdown(plan.newBreakdown)
      const newPayload: Record<string, unknown> = { ...payload }
      newPayload.paymentBreakdown = newPbStored
      newPayload.lines = composeCorrectedSalePayloadLines({
        existingPayloadLines: payload.lines,
        correctedLines: plan.newLines.map((l) => ({
          inventoryId: l.inventoryId,
          name: l.nome,
          quantity: l.quantidade,
          unitPrice: l.precoUnitario,
          lineTotal: l.lineTotal,
          desconto: l.desconto,
          isAvulso: l.isAvulso,
          sourceIndex: l.sourceIndex,
        })),
      })

      const correcao = {
        at: now.toISOString(),
        operador,
        storeId,
        rota: "vendas/corrigir-itens",
        motivo,
        campos: ["itens"],
        supervisorNome: supervisorName,
        totalAnterior: plan.oldTotal,
        totalNovo: plan.newTotal,
        deltaTotal: plan.deltaTotal,
        pagamentoAnterior: describePayment(oldPb),
        pagamentoNovo: describePayment(newPbStored),
        itensAdicionados: plan.changes.added.map((l) => ({ nome: l.nome, quantidade: l.quantidade, lineTotal: l.lineTotal })),
        itensRemovidos: plan.changes.removed.map((l) => ({ nome: l.nome, quantidade: l.quantidade, lineTotal: l.lineTotal })),
        itensAlterados: plan.changes.modified.map((m) => ({
          nome: m.depois.nome,
          de: { quantidade: m.antes.quantidade, precoUnitario: m.antes.precoUnitario, desconto: m.antes.desconto },
          para: { quantidade: m.depois.quantidade, precoUnitario: m.depois.precoUnitario, desconto: m.depois.desconto },
        })),
        impactoEstoque: plan.stockDeltas.map((d) => ({ produto: d.nome, delta: -d.deltaQty })), // delta no estoque (+devolve / −baixa)
        estoqueNaoResolvido: naoResolvidos,
        financeiro: { caixaAnterior: round2(plan.oldBreakdown.dinheiro), caixaNovo: round2(plan.newBreakdown.dinheiro), entradaNova: plan.cashEntryTarget },
      }
      const correcoes = Array.isArray(newPayload.correcoes) ? [...(newPayload.correcoes as unknown[])] : []
      correcoes.push(correcao)
      newPayload.correcoes = correcoes

      await tx.venda.update({
        where: { id: venda.id },
        data: { total: plan.newTotal, payload: newPayload as unknown as import("@/generated/prisma").Prisma.InputJsonValue },
      })
    })

    return NextResponse.json({
      ok: true,
      pedidoId,
      totalAnterior: plan.oldTotal,
      totalNovo: plan.newTotal,
      deltaTotal: plan.deltaTotal,
      estoqueMovimentos,
      estoqueNaoResolvido: naoResolvidos,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[vendas/corrigir-itens]", msg)
    if (msg.startsWith("estoque_insuficiente_concorrente")) {
      return NextResponse.json(
        { ok: false, error: "Estoque alterado durante a correção. Recarregue e tente novamente.", code: "estoque_insuficiente" },
        { status: 409 },
      )
    }
    return NextResponse.json(
      { ok: false, error: "Falha ao corrigir itens", detail: process.env.NODE_ENV === "development" ? msg : undefined },
      { status: 503 },
    )
  }
}
