/**
 * POST /api/vendas/[id]/corrigir-titulo  — Workspace de Correção, F3 (Conta a Receber)
 *
 * Edita, de forma auditada, o VENCIMENTO e/ou a OBSERVAÇÃO de um título à prazo ABERTO
 * gerado por esta venda. NÃO altera valor, NÃO recebe, NÃO cancela (estorno/baixa seguem
 * nos fluxos próprios do Contas a Receber). Sem schema novo.
 *
 * Guardas: motivo + PIN supervisor; título pertence à venda; título editável
 * (PENDENTE/VENCIDO — bloqueia PAGO/PARCIAL/CANCELADO/ESTORNADO); vencimento DD/MM/AAAA.
 *
 * Auditoria: histórico próprio do título (`payload.historico[]`) E trilha unificada em
 * `Venda.payload.correcoes[]` (visível na aba Auditoria do Workspace).
 *
 * Observação sobre período fechado: editar metadado de um recebível futuro NÃO move
 * dinheiro nem reescreve o caixa do dia da venda — por isso esta ação NÃO é bloqueada
 * por `verificarPeriodoFechado` (diferente da correção de pagamento/itens).
 */
import { NextResponse } from "next/server"
import { prisma, prismaEnsureConnected } from "@/lib/prisma"
import { opsLojaIdFromRequest } from "@/lib/ops-api-gate"
import { requireCorrecaoVendaAuth } from "@/lib/vendas/guard-correcao-venda"
import { assertVendaFiscalEditavel } from "@/lib/fiscal/venda-fiscal-state-machine"
import { getOperatorLabelFromSession } from "@/lib/auth/session-operator"
import { authenticateSupervisorPin } from "@/lib/auth/verify-supervisor-pin"
import { mergeFinanceiroPayload, appendFinanceiroHistorico } from "@/lib/financeiro/contracts/payload"
import { tituloEditavel, parseVencimentoBr } from "@/lib/vendas/correcao-cliente-titulo-plan"
import type { Prisma } from "@/generated/prisma"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

type Body = {
  tituloId?: string
  motivo?: string
  supervisorPin?: string
  novoVencimento?: string | null
  novaObservacao?: string | null
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
  const tituloId = body.tituloId?.trim()
  if (!tituloId) return NextResponse.json({ ok: false, error: "tituloId obrigatório" }, { status: 400 })
  if (!motivo) return NextResponse.json({ ok: false, error: "Motivo da correção é obrigatório" }, { status: 400 })

  const mudaVencimento = body.novoVencimento !== undefined && body.novoVencimento !== null
  const mudaObservacao = body.novaObservacao !== undefined
  if (!mudaVencimento && !mudaObservacao) {
    return NextResponse.json({ ok: false, error: "Nenhuma alteração informada" }, { status: 400 })
  }

  try {
    await prismaEnsureConnected()

    const venda = await prisma.venda.findFirst({ where: { pedidoId, storeId } })
    if (!venda) return NextResponse.json({ ok: false, error: "Venda não encontrada" }, { status: 404 })

    // Gate fiscal (GOAL_003): NAO_FISCAL → no-op; estados fiscais bloqueados impedem a correção.
    const fiscalGate = assertVendaFiscalEditavel(venda)
    if (!fiscalGate.ok) {
      return NextResponse.json({ ok: false, error: fiscalGate.error, code: fiscalGate.code }, { status: fiscalGate.status })
    }

    const titulo = await prisma.contaReceberTitulo.findFirst({ where: { id: tituloId, storeId } })
    if (!titulo) return NextResponse.json({ ok: false, error: "Título não encontrado" }, { status: 404 })

    // Título precisa pertencer a esta venda (localKey pdv-aprazo-{pedidoId}* ou FK rápida).
    const pertence =
      (titulo.localKey ?? "").startsWith(`pdv-aprazo-${pedidoId}`) || venda.contaReceberTituloId === titulo.id
    if (!pertence) {
      return NextResponse.json({ ok: false, error: "Título não pertence a esta venda" }, { status: 409 })
    }

    // Título editável? (bloqueia PAGO/PARCIAL/CANCELADO/ESTORNADO)
    const editavel = tituloEditavel(titulo.status)
    if (!editavel.ok) {
      return NextResponse.json({ ok: false, error: editavel.error, code: editavel.code }, { status: 409 })
    }

    // PIN supervisor.
    const supervisorPin = body.supervisorPin?.trim()
    if (!supervisorPin) {
      return NextResponse.json({ ok: false, error: "PIN de supervisor obrigatório", code: "pin_required" }, { status: 403 })
    }
    const admin = await authenticateSupervisorPin(supervisorPin)
    if (!admin) {
      return NextResponse.json({ ok: false, error: "PIN de supervisor inválido", code: "pin_invalid" }, { status: 401 })
    }
    const supervisorName = admin.name || "Supervisor"

    let novoVenc: string | null = null
    if (mudaVencimento) {
      const venc = parseVencimentoBr(body.novoVencimento)
      if (!venc.ok) return NextResponse.json({ ok: false, error: venc.error, code: "vencimento_invalido" }, { status: 422 })
      novoVenc = venc.vencimento ?? null
    }

    const operador = session?.user ? getOperatorLabelFromSession(session) : "Operador"
    const now = new Date()

    const vencAnterior = titulo.vencimento
    const obsAnterior =
      titulo.payload && typeof titulo.payload === "object"
        ? ((titulo.payload as Record<string, unknown>).observacao as string | undefined) ?? null
        : null
    const novaObs = mudaObservacao ? ((body.novaObservacao ?? "").trim() || null) : obsAnterior

    // Payload do título: merge + histórico próprio.
    let tituloPayload = mergeFinanceiroPayload(
      (titulo.payload && typeof titulo.payload === "object" ? (titulo.payload as Record<string, unknown>) : {}),
      {
        ...(mudaVencimento ? { vencimento: novoVenc } : {}),
        ...(mudaObservacao ? { observacao: novaObs } : {}),
      },
    )
    tituloPayload = appendFinanceiroHistorico(tituloPayload, {
      tipo: "correcao_titulo",
      userLabel: operador,
      motivo,
      ...(mudaVencimento ? { vencimentoAnterior: vencAnterior, vencimentoNovo: novoVenc } : {}),
      ...(mudaObservacao ? { observacaoAlterada: true } : {}),
    })

    await prisma.$transaction(async (tx) => {
      await tx.contaReceberTitulo.update({
        where: { id: titulo.id },
        data: {
          ...(mudaVencimento && novoVenc ? { vencimento: novoVenc } : {}),
          payload: tituloPayload as unknown as Prisma.InputJsonValue,
        },
      })

      // Trilha unificada na venda.
      const vp = (venda.payload && typeof venda.payload === "object" ? venda.payload : {}) as Record<string, unknown>
      const correcao = {
        at: now.toISOString(),
        operador,
        storeId,
        rota: "vendas/corrigir-titulo",
        motivo,
        campos: ["titulo"],
        supervisorNome: supervisorName,
        tituloId: titulo.id,
        tituloLocalKey: titulo.localKey,
        ...(mudaVencimento ? { vencimentoAnterior: vencAnterior, vencimentoNovo: novoVenc } : {}),
        ...(mudaObservacao ? { observacaoTituloAnterior: obsAnterior, observacaoTituloNova: novaObs } : {}),
      }
      const correcoes = Array.isArray(vp.correcoes) ? [...(vp.correcoes as unknown[])] : []
      correcoes.push(correcao)
      const newVendaPayload = { ...vp, correcoes }
      await tx.venda.update({
        where: { id: venda.id },
        data: { payload: newVendaPayload as unknown as Prisma.InputJsonValue },
      })
    })

    return NextResponse.json({
      ok: true,
      pedidoId,
      tituloId: titulo.id,
      vencimentoAnterior: vencAnterior,
      vencimentoNovo: novoVenc,
      observacaoAlterada: mudaObservacao,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[vendas/corrigir-titulo]", msg)
    return NextResponse.json(
      { ok: false, error: "Falha ao corrigir título", detail: process.env.NODE_ENV === "development" ? msg : undefined },
      { status: 503 },
    )
  }
}
