/**
 * /api/financeiro/receber
 *
 * GET    → lista títulos  (storeId por header)
 * GET    → ?localKey=<k>  detalhe + payload.historico
 * POST   → cria título manual
 * PATCH  → op: liquidar | parcial | estornar | cancelar
 * DELETE → cancelamento seguro (não destrói dados)
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { prismaEnsureConnected, prisma } from "@/lib/prisma"
import { opsLojaIdFromRequest } from "@/lib/ops-api-gate"
import { storeIdFromAssistecRequestForWrite } from "@/lib/store-id-from-request"
import { auth } from "@/auth"
import { getOperatorLabelFromSession } from "@/lib/auth/session-operator"
import { extractAuditoriaActor, logAuditoriaFinanceira } from "@/lib/financeiro/services/auditoria-actor"
import { apiGuardFinanceiroEditEnterpriseOrLegacy, apiGuardFinanceiroViewOrOps } from "@/lib/auth/api-enterprise-guard"
import {
  buildContaReceberAuditTrail,
  buildContaReceberSummary,
  cancelContaReceber,
  getContaReceberByLocalKey,
  liquidarContaReceber,
  registrarPagamentoParcial,
  estornarContaReceber,
  upsertContaReceber,
} from "@/lib/financeiro/services"
import {
  createMovimentacaoEntradaFromReceber,
  estornarMovimentacaoPorReferencia,
} from "@/lib/financeiro/services/movimentacoes-service"
import { verificarPeriodoFechado } from "@/lib/financeiro/services/fechamento-service"
import { registrarRecebimentoCrSeCaixaAberto } from "@/lib/caixa/recebimento-cr-caixa"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

// ─── helpers ──────────────────────────────────────────────────────────────────

function err(error: string, code: string, status = 400) {
  return NextResponse.json({ ok: false, error, code }, { status })
}

function readSid(req: Request, forWrite = false): string | null {
  return forWrite
    ? storeIdFromAssistecRequestForWrite(req)
    : opsLojaIdFromRequest(req)
}

type HistEntry = { at?: string; tipo?: string; userLabel?: string; valor?: number; observacao?: string; formaPagamento?: string }

function parseHistorico(payload: unknown): HistEntry[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return []
  const hist = (payload as Record<string, unknown>).historico
  if (!Array.isArray(hist)) return []
  return hist.filter((e) => e && typeof e === "object") as HistEntry[]
}

/**
 * Resolve `carteiraId` do payload do título, validando que existe na loja e
 * está ativa. Retorna `null` quando o título não tem carteira definida ou
 * quando a carteira foi removida/desativada (a movimentação não é vinculada).
 */
async function resolveCarteiraIdFromPayload(payload: unknown, storeId: string): Promise<string | null> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null
  const raw = (payload as Record<string, unknown>).carteiraId
  if (typeof raw !== "string") return null
  const id = raw.trim()
  if (!id) return null
  const c = await prisma.carteiraFinanceira.findFirst({
    where: { id, storeId, ativo: true },
    select: { id: true },
  })
  return c?.id ?? null
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const postSchema = z.object({
  lojaId: z.string().min(1).max(120).optional(),
  descricao: z.string().min(1, "Descrição obrigatória").max(240),
  cliente: z.string().min(1, "Cliente obrigatório").max(240),
  valor: z.number({ required_error: "Valor obrigatório" }).finite().nonnegative("Valor deve ser ≥ 0"),
  vencimento: z.string().min(1, "Vencimento obrigatório").max(32),
  observacao: z.string().max(2000).optional(),
  /** Metadados opcionais — gravados no `payload` (não há colunas dedicadas no Prisma). */
  origem: z.enum(["manual", "venda", "os", "crediario", "ajuste"]).optional(),
  numeroDocumento: z.string().max(120).optional(),
  competencia: z.string().max(32).optional(),
  formaPagamento: z.string().max(80).optional(),
  carteiraId: z.string().max(120).optional(),
})

const patchSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("liquidar"),
    lojaId: z.string().max(120).optional(),
    localKey: z.string().min(1).max(260),
    observacao: z.string().max(2000).optional(),
    formaPagamento: z.string().max(80).optional(),
  }),
  z.object({
    op: z.literal("parcial"),
    lojaId: z.string().max(120).optional(),
    localKey: z.string().min(1).max(260),
    valor: z.number().finite().positive("Valor deve ser positivo"),
    observacao: z.string().max(2000).optional(),
    formaPagamento: z.string().max(80).optional(),
  }),
  z.object({
    op: z.literal("estornar"),
    lojaId: z.string().max(120).optional(),
    localKey: z.string().min(1).max(260),
    modo: z.enum(["titulo_completo", "ultimo_pagamento"]),
    motivo: z.string().max(2000).optional(),
  }),
  z.object({
    op: z.literal("cancelar"),
    lojaId: z.string().max(120).optional(),
    localKey: z.string().min(1).max(260),
    motivo: z.string().max(2000).optional(),
  }),
  // Espelho da baixa no caixa operacional: cria CaixaOperacao(recebimento_cr) na
  // sessão aberta para que o recebimento entre no fechamento. Usado pela tela
  // Financeiro → Contas a Receber, que baixa o título no cliente (localStorage)
  // e depois sincroniza a gaveta via esta op. Idempotente por `movimentoId`.
  z.object({
    op: z.literal("vincular-caixa"),
    lojaId: z.string().max(120).optional(),
    valor: z.number().finite().positive().max(1e12),
    formaPagamento: z.string().max(80).optional(),
    movimentoId: z.string().min(1).max(200),
    tituloId: z.string().max(200).optional(),
    localKey: z.string().max(260).optional(),
    cliente: z.string().max(240).optional(),
    descricao: z.string().max(240).optional(),
    sessaoId: z.string().max(120).optional(),
    terminalId: z.string().max(120).optional(),
  }),
])

const deleteQuerySchema = z.object({
  localKey: z.string().min(1).max(260),
  motivo: z.string().max(2000).optional(),
})

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const storeId = readSid(req)
  if (!storeId) return err("Unidade obrigatória", "store_missing", 400)
  const denied = await apiGuardFinanceiroViewOrOps(storeId, { skipOpsInDev: true })
  if (denied) return denied

  const url = new URL(req.url)
  const localKeyParam = url.searchParams.get("localKey")?.trim()

  try {
    await prismaEnsureConnected()

    // Detalhe de um título específico
    if (localKeyParam) {
      const titulo = await prisma.contaReceberTitulo.findUnique({
        where: { storeId_localKey: { storeId, localKey: localKeyParam } },
      })
      if (!titulo) return err("Título não encontrado", "not_found", 404)
      return NextResponse.json({
        ok: true,
        titulo: {
          id: titulo.id,
          localKey: titulo.localKey,
          descricao: titulo.descricao,
          cliente: titulo.cliente,
          valor: titulo.valor,
          vencimento: titulo.vencimento,
          status: titulo.status,
          historico: parseHistorico(titulo.payload),
        },
      })
    }

    // Lista paginada
    const titulos = await prisma.contaReceberTitulo.findMany({
      where: { storeId },
      orderBy: { updatedAt: "desc" },
    })

    const rows = titulos.map((t) => {
      const pl = (t.payload as Record<string, unknown> | null) ?? null
      const parcelaObj = pl && typeof pl === "object" ? (pl.parcela as Record<string, unknown> | undefined) : undefined
      const numero = typeof parcelaObj?.numero === "number" ? parcelaObj.numero : null
      const total = typeof parcelaObj?.total === "number" ? parcelaObj.total : null
      const parcelaLabel = numero && total ? `${numero}/${total}` : null
      return {
        id: (t.localKey?.trim() || t.id) as string,
        descricao: t.descricao,
        cliente: t.cliente,
        valor: t.valor,
        vencimento: t.vencimento,
        status: t.status,
        parcela: parcelaLabel,
      }
    })

    return NextResponse.json({
      ok: true,
      rows,
      summary: buildContaReceberSummary(titulos),
      audit: buildContaReceberAuditTrail(titulos),
      metadata: { source: "server", storeId, generatedAt: new Date().toISOString() },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Falha interna"
    console.error("[financeiro/receber GET]", msg)
    return err(msg, "db_error", 503)
  }
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  let json: unknown
  try { json = await req.json() } catch {
    return err("JSON inválido", "invalid_json", 400)
  }

  const parsed = postSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Dados inválidos", code: "validation_error", issues: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const storeId = readSid(req, true)
  if (!storeId) return err("Unidade obrigatória (x-assistec-loja-id)", "store_missing", 400)
  if (parsed.data.lojaId && parsed.data.lojaId !== storeId) {
    return err("storeId inconsistente (body vs header)", "store_mismatch", 400)
  }

  const deniedPostCr = await apiGuardFinanceiroEditEnterpriseOrLegacy(storeId)
  if (deniedPostCr) return deniedPostCr

  try {
    await prismaEnsureConnected()
    const uuid = crypto.randomUUID()
    const localKey = `receber:manual:${storeId}:${uuid}`
    const titulo = await upsertContaReceber({
      storeId,
      localKey,
      descricao: parsed.data.descricao,
      cliente: parsed.data.cliente,
      valor: parsed.data.valor,
      vencimento: parsed.data.vencimento,
      status: "pendente",
      payloadPatch: {
        origem: parsed.data.origem ?? "manual",
        referencia: `CR manual ${uuid}`,
        createdFrom: "financeiro_hub",
        ...(parsed.data.observacao ? { observacoes: parsed.data.observacao } : {}),
        ...(parsed.data.numeroDocumento ? { numeroDocumento: parsed.data.numeroDocumento } : {}),
        ...(parsed.data.competencia ? { competencia: parsed.data.competencia } : {}),
        ...(parsed.data.formaPagamento ? { formaPagamento: parsed.data.formaPagamento } : {}),
        ...(parsed.data.carteiraId ? { carteiraId: parsed.data.carteiraId } : {}),
      },
    })
    void logAuditoriaFinanceira({
      storeId, entidade: "receber", entidadeId: titulo.id, acao: "criar",
      actor: extractAuditoriaActor(await auth(), req),
      depois: { localKey, descricao: titulo.descricao, cliente: titulo.cliente, valor: titulo.valor, vencimento: titulo.vencimento },
    })
    return NextResponse.json({ ok: true, id: titulo.id, localKey }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Falha interna"
    console.error("[financeiro/receber POST]", msg)
    return err(msg, "db_error", 503)
  }
}

// ─── PATCH ────────────────────────────────────────────────────────────────────

export async function PATCH(req: Request) {
  let json: unknown
  try { json = await req.json() } catch {
    return err("JSON inválido", "invalid_json", 400)
  }

  const parsed = patchSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Dados inválidos", code: "validation_error", issues: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const storeId = readSid(req, true)
  if (!storeId) return err("Unidade obrigatória (x-assistec-loja-id)", "store_missing", 400)
  if (parsed.data.lojaId && parsed.data.lojaId !== storeId) {
    return err("storeId inconsistente (body vs header)", "store_mismatch", 400)
  }

  const deniedPatchCr = await apiGuardFinanceiroEditEnterpriseOrLegacy(storeId)
  if (deniedPatchCr) return deniedPatchCr

  const session = await auth()
  const userLabel = getOperatorLabelFromSession(session)
  const actor = extractAuditoriaActor(session, req)

  try {
    await prismaEnsureConnected()

    // Bloqueio de período fechado para operações de mutação
    if (["liquidar", "parcial", "estornar"].includes(parsed.data.op)) {
      const lock = await verificarPeriodoFechado(storeId, new Date())
      if (lock.fechado) {
        return err(
          "Período financeiro fechado. Reabra o fechamento para alterar lançamentos.",
          "periodo_fechado",
          409,
        )
      }
    }

    if (parsed.data.op === "vincular-caixa") {
      // Espelho da baixa no caixa operacional. NÃO finge sucesso: se não houver
      // sessão aberta, retorna vinculadoCaixa=false para a UI avisar que a baixa
      // ficou só no financeiro (não entrou na gaveta/fechamento).
      const r = await registrarRecebimentoCrSeCaixaAberto({
        storeId,
        valor: parsed.data.valor,
        formaPagamento: parsed.data.formaPagamento,
        origem: "financeiro",
        tituloId: parsed.data.tituloId,
        localKey: parsed.data.localKey,
        cliente: parsed.data.cliente,
        descricao: parsed.data.descricao,
        operador: userLabel,
        idempotencyKey: parsed.data.movimentoId,
        sessaoId: parsed.data.sessaoId,
        terminalId: parsed.data.terminalId,
      })
      if (r.vinculado) {
        return NextResponse.json({
          ok: true,
          op: "vincular-caixa",
          vinculadoCaixa: true,
          sessaoId: r.sessaoId,
          jaRegistrado: r.jaRegistrado,
        })
      }
      return NextResponse.json({
        ok: true,
        op: "vincular-caixa",
        vinculadoCaixa: false,
        motivo: r.motivo,
      })
    }

    if (parsed.data.op === "liquidar") {
      // Saldo REAL em aberto ANTES de quitar (valor − pagamentos já no histórico).
      // `res.data.valor` é a coluna BRUTA e NÃO diminui em baixas parciais via backend —
      // usá-lo lançaria mais que o devido na movimentação/auditoria de títulos já parciais.
      const atual = await getContaReceberByLocalKey(storeId, parsed.data.localKey)
      const abertoAntes = atual ? buildContaReceberAuditTrail([atual])[0]?.saldoAberto ?? 0 : 0

      const res = await liquidarContaReceber({
        storeId,
        localKey: parsed.data.localKey,
        observacao: parsed.data.observacao,
        formaPagamento: parsed.data.formaPagamento,
        userLabel,
        tituloSnapshot: atual ?? undefined,
      })
      if (!res.ok) {
        return err(
          res.reason,
          `liquidar_${res.reason}`,
          res.reason === "titulo_alterado" ? 409 : 422,
        )
      }
      const valorMov = abertoAntes > 0 ? abertoAntes : res.data.valor
      const carteiraId = await resolveCarteiraIdFromPayload(res.data.payload, storeId)
      // Gerar movimentação de entrada (idempotente) — vincula à carteira do título se houver
      await createMovimentacaoEntradaFromReceber(
        { id: res.data.id, storeId: res.data.storeId, descricao: res.data.descricao, cliente: res.data.cliente },
        valorMov,
        { carteiraId },
      ).catch((e) => console.error("[receber/liquidar mov]", e))
      void logAuditoriaFinanceira({
        storeId, entidade: "receber", entidadeId: res.data.id, acao: "liquidar", actor,
        depois: { localKey: parsed.data.localKey, valor: valorMov, carteiraId, ...(parsed.data.formaPagamento ? { formaPagamento: parsed.data.formaPagamento } : {}) },
      })
      return NextResponse.json({ ok: true, op: "liquidar" })
    }

    if (parsed.data.op === "parcial") {
      const res = await registrarPagamentoParcial({ storeId, localKey: parsed.data.localKey, valorPago: parsed.data.valor, observacao: parsed.data.observacao, formaPagamento: parsed.data.formaPagamento, userLabel })
      if (!res.ok) {
        return err(
          res.reason,
          `parcial_${res.reason}`,
          res.reason === "titulo_alterado" ? 409 : 422,
        )
      }
      const carteiraId = await resolveCarteiraIdFromPayload(res.data.payload, storeId)
      // Gerar movimentação de entrada parcial (idempotente por soma total)
      await createMovimentacaoEntradaFromReceber(
        { id: res.data.id, storeId: res.data.storeId, descricao: res.data.descricao, cliente: res.data.cliente },
        parsed.data.valor,
        { parcial: true, carteiraId },
      ).catch((e) => console.error("[receber/parcial mov]", e))
      void logAuditoriaFinanceira({
        storeId, entidade: "receber", entidadeId: res.data.id, acao: "liquidar", actor,
        depois: { localKey: parsed.data.localKey, valorPago: parsed.data.valor, parcial: true, carteiraId, ...(parsed.data.formaPagamento ? { formaPagamento: parsed.data.formaPagamento } : {}) },
      })
      return NextResponse.json({ ok: true, op: "parcial" })
    }

    if (parsed.data.op === "estornar") {
      const res = await estornarContaReceber({ storeId, localKey: parsed.data.localKey, modo: parsed.data.modo, motivo: parsed.data.motivo, userLabel })
      if (!res.ok) return err(res.reason, `estornar_${res.reason}`, 422)
      // Estornar movimentação correspondente (idempotente)
      await estornarMovimentacaoPorReferencia(storeId, res.data.id, "receber")
        .catch((e) => console.error("[receber/estornar mov]", e))
      void logAuditoriaFinanceira({
        storeId, entidade: "receber", entidadeId: res.data.id, acao: "estornar", actor,
        depois: { localKey: parsed.data.localKey, modo: parsed.data.modo, motivo: parsed.data.motivo },
      })
      return NextResponse.json({ ok: true, op: "estornar" })
    }

    // cancelar — não gera movimentação nova
    const res = await cancelContaReceber({ storeId, localKey: parsed.data.localKey, motivo: parsed.data.motivo, userLabel })
    if (!res.ok) return err(res.reason, `cancelar_${res.reason}`, 422)
    void logAuditoriaFinanceira({
      storeId, entidade: "receber", entidadeId: res.data.id, acao: "cancelar", actor,
      depois: { localKey: parsed.data.localKey, motivo: parsed.data.motivo },
    })
    return NextResponse.json({ ok: true, op: "cancelar" })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Falha interna"
    console.error("[financeiro/receber PATCH]", msg)
    return err(msg, "db_error", 503)
  }
}

// ─── DELETE ───────────────────────────────────────────────────────────────────
// Cancelamento seguro — não destrói dados, apenas muda status para "cancelado".

export async function DELETE(req: Request) {
  const storeId = readSid(req, true)
  if (!storeId) return err("Unidade obrigatória (x-assistec-loja-id)", "store_missing", 400)

  const url = new URL(req.url)
  const localKeyParam = url.searchParams.get("localKey")?.trim()
  const motivoParam = url.searchParams.get("motivo")?.trim()

  const body = deleteQuerySchema.safeParse({
    localKey: localKeyParam,
    motivo: motivoParam || undefined,
  })
  if (!body.success) return err("localKey obrigatório via query ?localKey=", "missing_localKey", 400)

  const deniedDelCr = await apiGuardFinanceiroEditEnterpriseOrLegacy(storeId)
  if (deniedDelCr) return deniedDelCr

  const sessionDel = await auth()
  const userLabelDel = getOperatorLabelFromSession(sessionDel)
  const actorDel = extractAuditoriaActor(sessionDel, req)

  try {
    await prismaEnsureConnected()
    const res = await cancelContaReceber({ storeId, localKey: body.data.localKey, motivo: body.data.motivo, userLabel: userLabelDel })
    if (!res.ok) return err(res.reason, `cancel_${res.reason}`, 422)
    void logAuditoriaFinanceira({
      storeId, entidade: "receber", entidadeId: res.data.id, acao: "cancelar", actor: actorDel,
      depois: { localKey: body.data.localKey, motivo: body.data.motivo, via: "DELETE" },
    })
    return NextResponse.json({ ok: true, action: "cancelled" })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Falha interna"
    console.error("[financeiro/receber DELETE]", msg)
    return err(msg, "db_error", 503)
  }
}
