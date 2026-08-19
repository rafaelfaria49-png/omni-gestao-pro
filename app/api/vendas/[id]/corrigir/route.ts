/**
 * POST /api/vendas/[id]/corrigir
 *
 * Correção segura de venda — permite alterar:
 *   - forma de pagamento (com RECONCILIAÇÃO financeira completa — F-01)
 *   - cliente vinculado
 *   - observação
 *
 * NÃO altera itens, total nem estoque (estoque independe da forma de pagamento).
 * Exige PIN de supervisor quando há correção financeira.
 * Registra auditoria completa em Venda.payload.correcoes[].
 *
 * ── Correção de pagamento (F-01) — REUSO do motor de cancelamento ─────────────
 * Quando a NATUREZA muda (à vista ↔ à prazo ↔ vale), o pagamento é reconciliado ao
 * estado-alvo do novo breakdown, reaproveitando exatamente o mesmo motor já usado
 * pelo cancelamento e pela criação da venda:
 *   - À vista: `MovimentacaoFinanceira(origem:"venda")` é reconciliada ao novo
 *     "dinheiro real" (total − aPrazo − creditoVale). Cria/atualiza/remove conforme alvo.
 *   - À prazo: títulos `pdv-aprazo-{pedidoId}*` são estornados+cancelados
 *     (`estornarMovimentacaoPorReferencia` + `cancelContaReceber`) e recriados
 *     (`upsertContaReceber`) — mesmas funções do cancelamento.
 *   - Vale/crédito: `ClienteCredito` é debitado/restaurado convergindo o uso real
 *     registrado em `UsoCreditoCliente` ao novo alvo (padrão de `upsertVendaInTransaction`).
 * A reconciliação é CONVERGENTE/idempotente: reaplicar o mesmo alvo é no-op.
 *
 * ── Caixa fechado (F-02) ──────────────────────────────────────────────────────
 * Correção de pagamento respeita `verificarPeriodoFechado` (mesmo comportamento do
 * cancelamento): se a data da venda cai em período fechado, bloqueia (409).
 */
import { NextResponse } from "next/server"
import { prisma, prismaEnsureConnected } from "@/lib/prisma"
import { opsLojaIdFromRequest } from "@/lib/ops-api-gate"
import { requireCorrecaoVendaAuth } from "@/lib/vendas/guard-correcao-venda"
import { assertVendaFiscalEditavel } from "@/lib/fiscal/venda-fiscal-state-machine"
import { getOperatorLabelFromSession } from "@/lib/auth/session-operator"
import type { PaymentBreakdownFull } from "@/lib/operations-sale-types"
import {
  computeCorrecaoPagamentoPlan,
  normalizeBreakdown,
  round2,
} from "@/lib/financeiro/correcao-pagamento-plan"
import { verificarPeriodoFechado } from "@/lib/financeiro/services/fechamento-service"
import { estornarMovimentacaoPorReferencia } from "@/lib/financeiro/services/movimentacoes-service"
import { cancelContaReceber, upsertContaReceber } from "@/lib/financeiro/services/contas-receber-service"
import { RECEBER_STATUS, normalizeReceberStatus } from "@/lib/financeiro/contracts/status"
import { aPrazoExigeCliente, podeLimparCliente, tituloEditavel, parseVencimentoBr } from "@/lib/vendas/correcao-cliente-titulo-plan"
import { authenticateSupervisorPin } from "@/lib/auth/verify-supervisor-pin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

const PAYMENT_KEYS: (keyof PaymentBreakdownFull)[] = [
  "dinheiro", "pix", "cartaoDebito", "cartaoCredito", "carne", "aPrazo", "creditoVale",
]

const PAYMENT_LABELS: Record<string, string> = {
  dinheiro: "Dinheiro",
  pix: "Pix",
  cartaoDebito: "Débito",
  cartaoCredito: "Crédito",
  carne: "Carnê",
  aPrazo: "A Prazo",
  creditoVale: "Vale/Crédito",
}

function describePayment(pb: Partial<PaymentBreakdownFull>): string {
  return PAYMENT_KEYS
    .filter((k) => (pb[k] ?? 0) > 0)
    .map((k) => PAYMENT_LABELS[k] ?? k)
    .join(" + ") || "—"
}

/** Mantém apenas as formas > 0 (formato canônico do payload). */
function compactBreakdown(pb: PaymentBreakdownFull): Partial<PaymentBreakdownFull> {
  const out: Partial<PaymentBreakdownFull> = {}
  for (const k of PAYMENT_KEYS) {
    if ((pb[k] ?? 0) > 0) out[k] = pb[k]
  }
  return out
}

type CorrigirBody = {
  motivo: string
  supervisorPin?: string
  novaFormaPagamento?: Partial<PaymentBreakdownFull>
  /** Vencimento DD/MM/AAAA do título à prazo gerado pela correção (F3). Opcional. */
  aPrazoVencimento?: string | null
  novoClienteId?: string | null
  novoClienteNome?: string | null
  novaObservacao?: string | null
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const storeId = opsLojaIdFromRequest(req)
  if (!storeId) return NextResponse.json({ error: "storeId obrigatório" }, { status: 400 })
  const { id: rawId } = await params
  const pedidoId = rawId?.trim()

  if (!pedidoId) {
    return NextResponse.json({ ok: false, error: "ID da venda obrigatório" }, { status: 400 })
  }

  // Segurança (mesmo padrão de cancelar/venda-persist): sessão + acesso à loja +
  // permissão; assinatura no PDV legado. Escopa a correção à loja do operador.
  const acl = await requireCorrecaoVendaAuth(storeId)
  if (!acl.ok) return NextResponse.json({ ok: false, error: acl.error }, { status: acl.status })
  const session = acl.session

  let body: CorrigirBody
  try {
    body = (await req.json()) as CorrigirBody
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 })
  }

  const { motivo, supervisorPin, novaFormaPagamento, aPrazoVencimento, novoClienteId, novoClienteNome, novaObservacao } = body

  if (!motivo?.trim()) {
    return NextResponse.json({ ok: false, error: "Motivo da correção é obrigatório" }, { status: 400 })
  }

  const hasPaymentChange = !!novaFormaPagamento
  const hasClienteChange = novoClienteId !== undefined
  const hasObsChange = novaObservacao !== undefined

  if (!hasPaymentChange && !hasClienteChange && !hasObsChange) {
    return NextResponse.json({ ok: false, error: "Nenhuma alteração informada" }, { status: 400 })
  }

  try {
    await prismaEnsureConnected()

    const operador = session?.user ? getOperatorLabelFromSession(session) : "Operador"

    const venda = await prisma.venda.findFirst({
      where: { pedidoId, storeId },
    })

    if (!venda) {
      return NextResponse.json({ ok: false, error: "Venda não encontrada" }, { status: 404 })
    }

    if (venda.status === "cancelada") {
      return NextResponse.json({ ok: false, error: "Não é possível corrigir uma venda cancelada" }, { status: 409 })
    }

    // Gate fiscal (GOAL_003): NAO_FISCAL → no-op (comportamento atual); estados fiscais
    // bloqueados impedem a correção operacional.
    const fiscalGate = assertVendaFiscalEditavel(venda)
    if (!fiscalGate.ok) {
      return NextResponse.json({ ok: false, error: fiscalGate.error, code: fiscalGate.code }, { status: fiscalGate.status })
    }

    const payload = (venda.payload && typeof venda.payload === "object" ? venda.payload : {}) as Record<string, unknown>
    const oldPb = (payload.paymentBreakdown ?? {}) as Partial<PaymentBreakdownFull>
    const now = new Date()

    const correcao: Record<string, unknown> = {
      at: now.toISOString(),
      operador,
      storeId,
      rota: "vendas/corrigir",
      motivo: motivo.trim(),
      campos: [] as string[],
    }
    const campos = correcao.campos as string[]

    const updateData: Record<string, unknown> = {}
    const newPayload = { ...payload }

    // ── Correção de forma de pagamento — RECONCILIAÇÃO (F-01) ───────────────────
    let financeiroCorrected = false
    let creditoCorrected = false
    let titulosCancelados = 0
    let tituloCriado = false

    // O plano é PURO: decide o estado-alvo. Calculado mesmo se não houver mudança,
    // para detectar "no_change" (idempotência) e "total_mismatch" cedo.
    const plan = hasPaymentChange
      ? computeCorrecaoPagamentoPlan({
          total: venda.total,
          oldBreakdown: oldPb,
          newBreakdown: novaFormaPagamento,
        })
      : null

    // Só executa a correção de pagamento quando há mudança REAL (plan.ok).
    const applyPayment = !!plan?.ok

    if (plan && plan.errorCode === "total_mismatch") {
      return NextResponse.json({ ok: false, error: plan.error, code: "total_mismatch" }, { status: 422 })
    }

    if (applyPayment && plan) {
      // 1) PIN de supervisor (correção financeira)
      if (!supervisorPin?.trim()) {
        return NextResponse.json(
          { ok: false, error: "PIN de supervisor obrigatório para correção financeira", code: "pin_required" },
          { status: 403 },
        )
      }
      const admin = await authenticateSupervisorPin(supervisorPin)
      if (!admin) {
        return NextResponse.json(
          { ok: false, error: "PIN de supervisor inválido", code: "pin_invalid" },
          { status: 401 },
        )
      }
      const supervisorName = admin.name || "Supervisor"

      // 2) Caixa/período fechado (F-02) — mesmo comportamento do cancelamento.
      //    Usa a DATA DA VENDA: corrigir o pagamento reescreve o caixa daquele dia.
      const lock = await verificarPeriodoFechado(storeId, venda.at)
      if (lock.fechado) {
        return NextResponse.json(
          {
            ok: false,
            error: "Período financeiro fechado para a data desta venda. Reabra o fechamento para corrigir o pagamento.",
            code: "periodo_fechado",
          },
          { status: 409 },
        )
      }

      const newPbNorm = normalizeBreakdown(novaFormaPagamento)
      const oldPbNorm = normalizeBreakdown(oldPb)

      // 2b) Venda à prazo exige cliente (F3). A correção de pagamento usa o cliente
      //     JÁ vinculado à venda — para lançar saldo a prazo sem cliente, o operador
      //     deve primeiro vincular um cliente (aba Cliente).
      const clienteNomeEfetivo = venda.clienteNome ?? ""
      const reqCliente = aPrazoExigeCliente(plan.newAPrazo, clienteNomeEfetivo)
      if (!reqCliente.ok) {
        return NextResponse.json({ ok: false, error: reqCliente.error, code: reqCliente.code }, { status: 422 })
      }

      // 2c) Vencimento do título à prazo (se informado, validar DD/MM/AAAA).
      let aPrazoVencStr: string | null = null
      if (plan.criarTituloValor !== null && typeof aPrazoVencimento === "string" && aPrazoVencimento.trim()) {
        const venc = parseVencimentoBr(aPrazoVencimento)
        if (!venc.ok) {
          return NextResponse.json({ ok: false, error: venc.error, code: "vencimento_invalido" }, { status: 422 })
        }
        aPrazoVencStr = venc.vencimento ?? null
      }

      // 3) Pré-checagens read-only (antes de QUALQUER mutação) ────────────────────
      // 3a) Título à prazo já recebido (pago/parcial) não pode ser convertido aqui.
      if (plan.reconcileTitulos) {
        const titulosExistentes = await prisma.contaReceberTitulo.findMany({
          where: { storeId, localKey: { startsWith: `pdv-aprazo-${pedidoId}` } },
          select: { id: true, status: true },
        })
        for (const t of titulosExistentes) {
          const st = normalizeReceberStatus(t.status)
          if (st === RECEBER_STATUS.PAGO || st === RECEBER_STATUS.PARCIAL) {
            return NextResponse.json(
              {
                ok: false,
                error: "Há título à prazo desta venda já recebido (total/parcial). Estorne no Contas a Receber antes de corrigir o pagamento.",
                code: "titulo_recebido",
              },
              { status: 409 },
            )
          }
        }
      }

      // 3b) Crédito/vale: se vamos DEBITAR mais (alvo > uso atual), validar CPF + saldo.
      const cpfNorm = typeof payload.customerCpf === "string" ? payload.customerCpf.replace(/\D/g, "") : ""
      const usosAtuais = await prisma.usoCreditoCliente.findMany({
        where: { storeId, vendaId: pedidoId },
        select: { valor: true, creditoId: true, at: true },
        orderBy: { at: "desc" },
      })
      const creditoUsadoAtual = round2(usosAtuais.reduce((s, u) => s + (u.valor || 0), 0))
      const creditoDelta = round2(plan.creditoTarget - creditoUsadoAtual)
      if (creditoDelta > 0.005) {
        if (!cpfNorm) {
          return NextResponse.json(
            { ok: false, error: "Venda sem CPF/CNPJ vinculado — não é possível debitar vale/crédito. Vincule um cliente primeiro.", code: "credito_sem_cpf" },
            { status: 422 },
          )
        }
        const agg = await prisma.clienteCredito.aggregate({
          where: { storeId, clienteDoc: cpfNorm, status: "ativo", saldoAtual: { gt: 0 } },
          _sum: { saldoAtual: true },
        })
        const disponivel = round2(agg._sum.saldoAtual ?? 0)
        if (disponivel + 0.005 < creditoDelta) {
          return NextResponse.json(
            {
              ok: false,
              error: `Saldo de vale/crédito insuficiente (disponível R$ ${disponivel.toFixed(2)}, necessário R$ ${creditoDelta.toFixed(2)}).`,
              code: "credito_insuficiente",
            },
            { status: 422 },
          )
        }
      }

      // 4) Reconciliação de títulos à prazo (FORA da transação — reuso de serviços
      //    que usam o prisma global, exatamente como o cancelamento faz). Idempotente.
      if (plan.reconcileTitulos) {
        const targetLocalKey = `pdv-aprazo-${pedidoId}`
        const titulos = await prisma.contaReceberTitulo.findMany({
          where: { storeId, localKey: { startsWith: `pdv-aprazo-${pedidoId}` } },
          select: { id: true, localKey: true, status: true },
        })
        for (const t of titulos) {
          const st = normalizeReceberStatus(t.status)
          if (st === RECEBER_STATUS.CANCELADO || st === RECEBER_STATUS.ESTORNADO) continue
          // Mantém o título-alvo (será atualizado pelo upsert) quando ainda haverá à prazo.
          if (plan.criarTituloValor !== null && t.localKey === targetLocalKey) continue
          try {
            await estornarMovimentacaoPorReferencia(storeId, t.id, "receber")
          } catch (e) {
            console.error("[vendas/corrigir] estorno título falhou:", t.localKey, e)
          }
          const res = await cancelContaReceber({ storeId, id: t.id, motivo: motivo.trim(), userLabel: operador })
          if (res.ok) titulosCancelados += 1
          else console.error("[vendas/corrigir] cancelContaReceber falhou:", t.localKey, res.reason)
        }

        if (plan.criarTituloValor !== null) {
          const vencimento = aPrazoVencStr ?? new Date(venda.at.getTime() + 30 * 86_400_000).toLocaleDateString("pt-BR")
          await upsertContaReceber({
            storeId,
            localKey: targetLocalKey,
            descricao: `Venda PDV ${pedidoId} — À prazo (correção de pagamento)`,
            cliente: clienteNomeEfetivo || venda.clienteNome || "Cliente",
            valor: plan.criarTituloValor,
            vencimento,
            status: "pendente",
            payloadPatch: {
              tipo: "pdv_aprazo",
              numeroParcela: 1,
              totalParcelas: 1,
              origemCorrecao: true,
              vendas: [{ saleId: pedidoId, total: plan.criarTituloValor }],
            },
            historicoEntrada: { tipo: "correcao_pagamento", userLabel: operador, motivo: motivo.trim() },
          })
          tituloCriado = true
          // Mantém a FK rápida coerente.
          const titNovo = await prisma.contaReceberTitulo.findUnique({
            where: { storeId_localKey: { storeId, localKey: targetLocalKey } },
            select: { id: true },
          })
          if (titNovo) updateData.contaReceberTituloId = titNovo.id
        } else {
          // Não há mais à prazo — solta a FK rápida (títulos ficam cancelados/auditados).
          updateData.contaReceberTituloId = null
        }
      }

      // 5) Transação atômica: caixa à vista + crédito/vale + payload/auditoria + FK.
      const descEntrada =
        `Venda PDV ${pedidoId} — ${describePayment(compactBreakdown(newPbNorm))}` +
        ` (corrigido de ${describePayment(compactBreakdown(oldPbNorm))} em ${now.toLocaleDateString("pt-BR")})`

      await prisma.$transaction(async (tx) => {
        // 5a) Caixa/financeiro à vista (origem "venda") → reconciliar ao alvo.
        const existingEntrada = await tx.movimentacaoFinanceira.findFirst({
          where: { storeId, referenciaId: pedidoId, tipo: "entrada", origem: "venda" },
          orderBy: { createdAt: "asc" },
        })
        if (plan.cashTarget > 0.005) {
          if (existingEntrada) {
            await tx.movimentacaoFinanceira.update({
              where: { id: existingEntrada.id },
              data: { valor: plan.cashTarget, descricao: descEntrada },
            })
          } else {
            await tx.movimentacaoFinanceira.create({
              data: {
                storeId,
                tipo: "entrada",
                valor: plan.cashTarget,
                descricao: descEntrada,
                origem: "venda",
                referenciaId: pedidoId,
                createdAt: venda.at,
              },
            })
          }
          financeiroCorrected = true
        } else if (existingEntrada) {
          // Alvo à vista = 0 (ex.: virou 100% à prazo/vale). Remove a entrada — logado
          // em correcoes[]. Evita "dinheiro sobrando no caixa".
          await tx.movimentacaoFinanceira.delete({ where: { id: existingEntrada.id } })
          financeiroCorrected = true
        }

        // 5b) Crédito/Vale → converge o uso desta venda ao alvo (delta vs. uso real).
        const usos = await tx.usoCreditoCliente.findMany({
          where: { storeId, vendaId: pedidoId },
          orderBy: { at: "desc" },
        })
        const usado = round2(usos.reduce((s, u) => s + (u.valor || 0), 0))
        const delta = round2(plan.creditoTarget - usado)
        if (delta > 0.005) {
          // Debitar mais (FIFO) — pré-validado em 3b.
          const creditos = await tx.clienteCredito.findMany({
            where: { storeId, clienteDoc: cpfNorm, status: "ativo", saldoAtual: { gt: 0 } },
            orderBy: { createdAt: "asc" },
          })
          let restante = delta
          for (const c of creditos) {
            if (restante <= 0.005) break
            const deb = round2(Math.min(c.saldoAtual, restante))
            if (deb <= 0) continue
            const saldoAntes = c.saldoAtual
            const saldoDepois = round2(c.saldoAtual - deb)
            await tx.clienteCredito.update({
              where: { id: c.id },
              data: { saldoAtual: saldoDepois, status: saldoDepois <= 0.005 ? "zerado" : "ativo" },
            })
            await tx.usoCreditoCliente.create({
              data: { creditoId: c.id, storeId, vendaId: pedidoId, valor: deb, saldoAntes, saldoDepois, operador },
            })
            restante = round2(restante - deb)
          }
          if (restante > 0.005) {
            // Concorrência rara (saldo mudou após a pré-checagem) → aborta a transação.
            throw new Error("credito_insuficiente_concorrente")
          }
          creditoCorrected = true
        } else if (delta < -0.005) {
          // Restaurar (-delta) nos créditos que ESTA venda consumiu (LIFO), com log.
          let toRestore = round2(-delta)
          const creditoIds: string[] = []
          for (const u of usos) {
            if ((u.valor || 0) > 0 && !creditoIds.includes(u.creditoId)) creditoIds.push(u.creditoId)
          }
          for (const cid of creditoIds) {
            if (toRestore <= 0.005) break
            const c = await tx.clienteCredito.findUnique({ where: { id: cid } })
            if (!c) continue
            const espaco = round2(Math.max(0, c.valorOriginal - c.saldoAtual))
            const restore = round2(Math.min(toRestore, espaco))
            if (restore <= 0.005) continue
            const saldoAntes = c.saldoAtual
            const saldoDepois = round2(c.saldoAtual + restore)
            await tx.clienteCredito.update({
              where: { id: c.id },
              data: { saldoAtual: saldoDepois, status: saldoDepois > 0.005 ? "ativo" : "zerado" },
            })
            await tx.usoCreditoCliente.create({
              data: { creditoId: c.id, storeId, vendaId: pedidoId, valor: -restore, saldoAntes, saldoDepois, operador },
            })
            toRestore = round2(toRestore - restore)
          }
          if (toRestore > 0.005) {
            console.warn("[vendas/corrigir] credito-restauracao-parcial", { pedidoId, toRestore })
          }
          creditoCorrected = true
        }

        // 5c) Payload + auditoria + FK — gravados POR ÚLTIMO (retry-safety: se algo
        //     acima falhar, o payload mantém o breakdown ANTIGO e o re-envio reconcilia).
        const newPbStored = compactBreakdown(newPbNorm)
        newPayload.paymentBreakdown = newPbStored
        if (plan.newAPrazo > 0.005) {
          newPayload.aPrazoConfig = {
            parcelas: 1,
            primeiroVencimento: aPrazoVencStr ?? new Date(venda.at.getTime() + 30 * 86_400_000).toLocaleDateString("pt-BR"),
            intervalDias: 30,
          }
        } else {
          delete (newPayload as Record<string, unknown>).aPrazoConfig
        }

        correcao.pagamentoAnterior = describePayment(compactBreakdown(oldPbNorm))
        correcao.pagamentoNovo = describePayment(newPbStored)
        correcao.pagamentoAnteriorDetalhe = compactBreakdown(oldPbNorm)
        correcao.pagamentoNovoDetalhe = newPbStored
        correcao.supervisorNome = supervisorName
        // Trilha do que foi revertido/recriado (GOAL Parte 5).
        correcao.financeiro = {
          caixaAnterior: plan.oldCashReal,
          caixaNovo: plan.cashTarget,
          aPrazoAnterior: plan.oldAPrazo,
          aPrazoNovo: plan.newAPrazo,
          creditoValeAnterior: plan.oldCreditoVale,
          creditoValeNovo: plan.creditoTarget,
          titulosCancelados,
          tituloCriado,
          entradaReconciliada: financeiroCorrected,
          creditoReconciliado: creditoCorrected,
        }
        campos.push("formaPagamento")

        const correcoes = Array.isArray(newPayload.correcoes) ? [...(newPayload.correcoes as unknown[])] : []
        correcoes.push(correcao)
        newPayload.correcoes = correcoes

        await tx.venda.update({
          where: { id: venda.id },
          data: {
            ...updateData,
            payload: newPayload as unknown as import("@/generated/prisma").Prisma.InputJsonValue,
          },
        })
      })

      // Pagamento aplicado dentro da transação acima — retorna cedo.
      return NextResponse.json({
        ok: true,
        pedidoId,
        campos,
        financeiroCorrected,
        creditoCorrected,
        titulosCancelados,
        tituloCriado,
        correcao,
      })
    }

    // ── Correção de cliente (F3) ────────────────────────────────────────────────
    // PIN de supervisor obrigatório para troca de cliente (Parte 11). O bloco de
    // pagamento retorna cedo, então aqui sempre validamos (cliente/observação).
    let titulosClienteAtualizados = 0
    if (hasClienteChange) {
      if (!supervisorPin?.trim()) {
        return NextResponse.json(
          { ok: false, error: "PIN de supervisor obrigatório para trocar o cliente", code: "pin_required" },
          { status: 403 },
        )
      }
      const adminCli = await authenticateSupervisorPin(supervisorPin)
      if (!adminCli) {
        return NextResponse.json({ ok: false, error: "PIN de supervisor inválido", code: "pin_invalid" }, { status: 401 })
      }
      correcao.supervisorNome = adminCli.name || "Supervisor"
      // Títulos à prazo desta venda (para regras de obrigatoriedade/propagação).
      const titulosVenda = await prisma.contaReceberTitulo.findMany({
        where: { storeId, localKey: { startsWith: `pdv-aprazo-${pedidoId}` } },
        select: { id: true, status: true, payload: true },
      })
      const titulosAbertos = titulosVenda.filter((t) => {
        const st = normalizeReceberStatus(t.status)
        return st !== RECEBER_STATUS.CANCELADO && st !== RECEBER_STATUS.ESTORNADO
      })
      const temAPrazoAberto = titulosAbertos.length > 0

      const limpandoCliente = !novoClienteId && !(novoClienteNome ?? "").trim()
      if (limpandoCliente) {
        const r = podeLimparCliente(temAPrazoAberto)
        if (!r.ok) return NextResponse.json({ ok: false, error: r.error, code: r.code }, { status: 422 })
      }

      // Título já recebido (pago/parcial) bloqueia troca de cliente (exige fluxo futuro).
      if (temAPrazoAberto) {
        for (const t of titulosAbertos) {
          const editavel = tituloEditavel(t.status)
          if (!editavel.ok) {
            return NextResponse.json(
              { ok: false, error: "Há título à prazo recebido (total/parcial). Estorne no Contas a Receber antes de trocar o cliente.", code: editavel.code },
              { status: 409 },
            )
          }
        }
      }

      correcao.clienteAnterior = venda.clienteNome ?? null
      correcao.clienteNovo = novoClienteNome ?? null
      correcao.clienteIdAnterior = venda.clienteId ?? null
      correcao.clienteIdNovo = novoClienteId ?? null
      campos.push("cliente")

      updateData.clienteNome = novoClienteNome ?? null
      updateData.clienteId = novoClienteId ?? null

      let nomeClienteFinal = novoClienteNome ?? null
      if (novoClienteId) {
        const cpfPayload = payload.customerCpf
        const cliente = await prisma.cliente.findUnique({
          where: { id: novoClienteId },
          select: { document: true, name: true },
        })
        if (cliente) {
          newPayload.customerCpf = cliente.document ?? cpfPayload ?? null
          newPayload.customerName = cliente.name ?? novoClienteNome ?? null
          nomeClienteFinal = cliente.name ?? novoClienteNome ?? null
        }
      } else {
        newPayload.customerCpf = null
        newPayload.customerName = novoClienteNome ?? null
      }

      // Propaga o novo cliente para os títulos à prazo ABERTOS (campo `cliente`).
      if (temAPrazoAberto && nomeClienteFinal) {
        const upd = await prisma.contaReceberTitulo.updateMany({
          where: { id: { in: titulosAbertos.map((t) => t.id) } },
          data: { cliente: nomeClienteFinal },
        })
        titulosClienteAtualizados = upd.count
      }
      correcao.titulosClienteAtualizados = titulosClienteAtualizados
    }

    // ── Correção de observação ──────────────────────────────────────────────────
    if (hasObsChange) {
      correcao.observacaoAnterior = (payload.observacao as string) ?? null
      correcao.observacaoNova = novaObservacao ?? null
      campos.push("observacao")
      newPayload.observacao = novaObservacao ?? null
    }

    // Se a única "mudança" de pagamento era no_change e não houve cliente/obs,
    // não há nada a gravar.
    if (campos.length === 0) {
      return NextResponse.json({ ok: true, pedidoId, campos: [], naoAlterado: true })
    }

    // Append correção ao histórico
    const correcoes = Array.isArray(newPayload.correcoes) ? [...(newPayload.correcoes as unknown[])] : []
    correcoes.push(correcao)
    newPayload.correcoes = correcoes

    await prisma.venda.update({
      where: { id: venda.id },
      data: {
        ...updateData,
        payload: newPayload as unknown as import("@/generated/prisma").Prisma.InputJsonValue,
      },
    })

    return NextResponse.json({
      ok: true,
      pedidoId,
      campos,
      financeiroCorrected,
      correcao,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[vendas/corrigir]", msg)
    return NextResponse.json(
      { ok: false, error: "Falha ao corrigir venda", detail: process.env.NODE_ENV === "development" ? msg : undefined },
      { status: 503 },
    )
  }
}
