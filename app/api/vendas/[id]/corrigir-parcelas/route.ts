/**
 * POST /api/vendas/[id]/corrigir-parcelas  — Workspace de Correção, F4 (Reparcelamento)
 *
 * Reparcela o saldo À PRAZO de uma venda (1 → N parcelas), editando vencimento inicial,
 * intervalo e valores. NÃO altera o total da venda, o caixa à vista, o estoque, o cliente
 * nem fiscal. Sem schema novo — reusa `ContaReceberTitulo` + o motor de estorno/cancelamento.
 *
 * Reaproveita EXATAMENTE a convenção de localKey de `upsertVendaInTransaction`
 * (`pdv-aprazo-{pedidoId}` / `pdv-aprazo-{pedidoId}-{n}`), então cancelamento/estorno
 * existentes continuam varrendo `startsWith pdv-aprazo-{pedidoId}`.
 *
 * Guardas: motivo + PIN supervisor; venda não cancelada; há saldo à prazo; cliente
 * vinculado (à prazo exige cliente); período fechado bloqueia; títulos já recebidos
 * (pago/parcial) bloqueiam (estorne no Contas a Receber antes). Idempotente por localKey.
 */
import { NextResponse } from "next/server"
import { prisma, prismaEnsureConnected } from "@/lib/prisma"
import { opsLojaIdFromRequest } from "@/lib/ops-api-gate"
import { requireCorrecaoVendaAuth } from "@/lib/vendas/guard-correcao-venda"
import { assertVendaFiscalEditavel } from "@/lib/fiscal/venda-fiscal-state-machine"
import { getOperatorLabelFromSession } from "@/lib/auth/session-operator"
import { authenticateSupervisorPin } from "@/lib/auth/verify-supervisor-pin"
import type { PaymentBreakdownFull } from "@/lib/operations-sale-types"
import { verificarPeriodoFechado } from "@/lib/financeiro/services/fechamento-service"
import { estornarMovimentacaoPorReferencia } from "@/lib/financeiro/services/movimentacoes-service"
import { cancelContaReceber, upsertContaReceber } from "@/lib/financeiro/services/contas-receber-service"
import { RECEBER_STATUS, normalizeReceberStatus } from "@/lib/financeiro/contracts/status"
import { computeParcelamentoPlan, round2 } from "@/lib/vendas/correcao-parcelamento-plan"
import { aPrazoExigeCliente } from "@/lib/vendas/correcao-cliente-titulo-plan"
import type { Prisma } from "@/generated/prisma"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

type Body = {
  motivo?: string
  supervisorPin?: string
  parcelas?: number
  primeiroVencimento?: string
  intervaloDias?: number
  valoresManuais?: number[] | null
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

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 })
  }

  const motivo = body.motivo?.trim()
  if (!motivo) return NextResponse.json({ ok: false, error: "Motivo da correção é obrigatório" }, { status: 400 })

  try {
    await prismaEnsureConnected()

    const venda = await prisma.venda.findFirst({ where: { pedidoId, storeId } })
    if (!venda) return NextResponse.json({ ok: false, error: "Venda não encontrada" }, { status: 404 })
    if (venda.status === "cancelada") {
      return NextResponse.json({ ok: false, error: "Não é possível corrigir uma venda cancelada" }, { status: 409 })
    }

    // Gate fiscal (GOAL_003): NAO_FISCAL → no-op; estados fiscais bloqueados impedem a correção.
    const fiscalGate = assertVendaFiscalEditavel(venda)
    if (!fiscalGate.ok) {
      return NextResponse.json({ ok: false, error: fiscalGate.error, code: fiscalGate.code }, { status: fiscalGate.status })
    }

    const payload = (venda.payload && typeof venda.payload === "object" ? venda.payload : {}) as Record<string, unknown>
    const pb = (payload.paymentBreakdown ?? {}) as Partial<PaymentBreakdownFull>
    const totalAPrazo = round2(Number(pb.aPrazo) || 0)
    if (!(totalAPrazo > 0.005)) {
      return NextResponse.json(
        { ok: false, error: "Esta venda não tem saldo à prazo para reparcelar.", code: "sem_aprazo" },
        { status: 422 },
      )
    }

    // À prazo exige cliente.
    const reqCli = aPrazoExigeCliente(totalAPrazo, venda.clienteNome)
    if (!reqCli.ok) return NextResponse.json({ ok: false, error: reqCli.error, code: reqCli.code }, { status: 422 })

    // Plano puro.
    const plan = computeParcelamentoPlan({
      pedidoId,
      totalAPrazo,
      parcelas: Number(body.parcelas) || 1,
      primeiroVencimento: body.primeiroVencimento,
      intervaloDias: body.intervaloDias,
      valoresManuais: body.valoresManuais ?? null,
    })
    if (!plan.ok) return NextResponse.json({ ok: false, error: plan.error, code: plan.errorCode }, { status: 422 })

    // PIN supervisor.
    const supervisorPin = body.supervisorPin?.trim()
    if (!supervisorPin) {
      return NextResponse.json({ ok: false, error: "PIN de supervisor obrigatório", code: "pin_required" }, { status: 403 })
    }
    const admin = await authenticateSupervisorPin(supervisorPin)
    if (!admin) return NextResponse.json({ ok: false, error: "PIN de supervisor inválido", code: "pin_invalid" }, { status: 401 })
    const supervisorName = admin.name || "Supervisor"

    // Período fechado (consistente com correção de pagamento).
    const lock = await verificarPeriodoFechado(storeId, venda.at)
    if (lock.fechado) {
      return NextResponse.json(
        { ok: false, error: "Período financeiro fechado para a data desta venda. Reabra o fechamento para reparcelar.", code: "periodo_fechado" },
        { status: 409 },
      )
    }

    // Títulos atuais da venda. Bloqueia se algum já recebido (pago/parcial).
    const existentes = await prisma.contaReceberTitulo.findMany({
      where: { storeId, localKey: { startsWith: `pdv-aprazo-${pedidoId}` } },
      select: { id: true, localKey: true, status: true },
    })
    for (const t of existentes) {
      const st = normalizeReceberStatus(t.status)
      if (st === RECEBER_STATUS.PAGO || st === RECEBER_STATUS.PARCIAL) {
        return NextResponse.json(
          { ok: false, error: "Há parcela já recebida (total/parcial). Estorne no Contas a Receber antes de reparcelar.", code: "titulo_recebido" },
          { status: 409 },
        )
      }
    }

    const operador = session?.user ? getOperatorLabelFromSession(session) : "Operador"
    const now = new Date()
    const novosLocalKeys = new Set(plan.itens.map((i) => i.localKey))

    // 1) Cancela/estorna títulos antigos cujo localKey NÃO será reaproveitado.
    let titulosCancelados = 0
    for (const t of existentes) {
      const st = normalizeReceberStatus(t.status)
      if (st === RECEBER_STATUS.CANCELADO || st === RECEBER_STATUS.ESTORNADO) continue
      if (novosLocalKeys.has(t.localKey ?? "")) continue // será atualizado in-place
      try {
        await estornarMovimentacaoPorReferencia(storeId, t.id, "receber") // no-op se nunca recebido
      } catch (e) {
        console.error("[vendas/corrigir-parcelas] estorno falhou:", t.localKey, e)
      }
      const res = await cancelContaReceber({ storeId, id: t.id, motivo, userLabel: operador })
      if (res.ok) titulosCancelados += 1
    }

    // 2) Upsert das novas parcelas (cria ou atualiza in-place pelo localKey).
    let primeiroTituloId: string | null = null
    for (const it of plan.itens) {
      const desc =
        plan.parcelas === 1
          ? `Venda PDV ${pedidoId} — À prazo (reparcelado)`
          : `Venda PDV ${pedidoId} — À prazo ${it.numero}/${plan.parcelas} (reparcelado)`
      await upsertContaReceber({
        storeId,
        localKey: it.localKey,
        descricao: desc,
        cliente: venda.clienteNome || "Cliente",
        valor: it.valor,
        vencimento: it.vencimento,
        status: "pendente",
        payloadPatch: {
          tipo: "pdv_aprazo",
          numeroParcela: it.numero,
          totalParcelas: plan.parcelas,
          total_value: totalAPrazo,
          origemReparcelamento: true,
          vendas: [{ saleId: pedidoId, total: totalAPrazo }],
        },
        historicoEntrada: { tipo: "reparcelamento", userLabel: operador, motivo },
      })
      if (it.numero === 1) {
        const t = await prisma.contaReceberTitulo.findUnique({
          where: { storeId_localKey: { storeId, localKey: it.localKey } },
          select: { id: true },
        })
        primeiroTituloId = t?.id ?? null
      }
    }

    // 3) Atualiza payload (aPrazoConfig) + FK + auditoria.
    const newPayload: Record<string, unknown> = { ...payload }
    newPayload.aPrazoConfig = {
      parcelas: plan.parcelas,
      primeiroVencimento: plan.itens[0]?.vencimento,
      intervalDias: plan.intervaloDias,
    }
    const correcao = {
      at: now.toISOString(),
      operador,
      storeId,
      rota: "vendas/corrigir-parcelas",
      motivo,
      campos: ["parcelas"],
      supervisorNome: supervisorName,
      totalAPrazo,
      parcelasNovas: plan.parcelas,
      titulosCancelados,
      parcelas: plan.itens.map((i) => ({ numero: i.numero, valor: i.valor, vencimento: i.vencimento })),
    }
    const correcoes = Array.isArray(newPayload.correcoes) ? [...(newPayload.correcoes as unknown[])] : []
    correcoes.push(correcao)
    newPayload.correcoes = correcoes

    await prisma.venda.update({
      where: { id: venda.id },
      data: {
        ...(primeiroTituloId ? { contaReceberTituloId: primeiroTituloId } : {}),
        payload: newPayload as unknown as Prisma.InputJsonValue,
      },
    })

    return NextResponse.json({
      ok: true,
      pedidoId,
      parcelas: plan.parcelas,
      titulosCancelados,
      itens: plan.itens,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[vendas/corrigir-parcelas]", msg)
    return NextResponse.json(
      { ok: false, error: "Falha ao reparcelar", detail: process.env.NODE_ENV === "development" ? msg : undefined },
      { status: 503 },
    )
  }
}
