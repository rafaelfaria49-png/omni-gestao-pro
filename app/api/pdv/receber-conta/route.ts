/**
 * POST /api/pdv/receber-conta
 *
 * Recebimento de título no PDV (F5): baixa financeira + movimentação + vínculo à sessão de caixa.
 * Reusa services existentes — sem alteração de schema.
 *
 * Invariantes (GOAL PDV-RECEBIMENTO-CANONICALIDADE-HARDENING-002):
 *  - ATÔMICO: título + histórico + `MovimentacaoFinanceira` + `CaixaOperacao` numa única
 *    `$transaction`. Se a movimentação ou o caixa falham, a baixa NÃO persiste.
 *  - IDEMPOTENTE: `payload.localId` determinístico (sem `Date.now()`), verificado DENTRO
 *    da transação — retry não cria uma segunda entrada de caixa.
 *  - Título já quitado nunca vira entrada de caixa: o service devolve `ja_pago` e a rota
 *    não grava nada. O valor lançado é SEMPRE o saldo em aberto real, nunca o valor bruto.
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma, prismaEnsureConnected } from "@/lib/prisma"
import { storeIdFromAssistecRequestForWrite } from "@/lib/store-id-from-request"
import { auth } from "@/auth"
import { getOperatorLabelFromSession } from "@/lib/auth/session-operator"
import { apiGuardFinanceiroEditEnterpriseOrLegacy } from "@/lib/auth/api-enterprise-guard"
import {
  buildContaReceberAuditTrail,
  getContaReceberById,
  getContaReceberByLocalKey,
  liquidarContaReceber,
  registrarPagamentoParcial,
} from "@/lib/financeiro/services"
import { createMovimentacaoEntradaFromReceber } from "@/lib/financeiro/services/movimentacoes-service"
import { verificarPeriodoFechado } from "@/lib/financeiro/services/fechamento-service"
import { logAuditoriaFinanceira, extractAuditoriaActor } from "@/lib/financeiro/services/auditoria-actor"
import { PAY_EPS } from "@/lib/financeiro/contracts/valores"
import type { Prisma } from "@/generated/prisma"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

/** Transação curta: pooler pgBouncer em modo transação com `connection_limit=1`. */
const TX_OPTS = { maxWait: 5_000, timeout: 15_000 } as const

async function resolveCarteiraIdFromPayload(
  payload: unknown,
  storeId: string,
  db: Prisma.TransactionClient,
): Promise<string | null> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null
  const raw = (payload as Record<string, unknown>).carteiraId
  if (typeof raw !== "string") return null
  const id = raw.trim()
  if (!id) return null
  const c = await db.carteiraFinanceira.findFirst({
    where: { id, storeId, ativo: true },
    select: { id: true },
  })
  return c?.id ?? null
}

const bodySchema = z.object({
  lojaId: z.string().min(1).max(120).optional(),
  op: z.enum(["liquidar", "parcial"]),
  tituloId: z.union([z.string(), z.number()]).optional(),
  localKey: z.string().min(1).max(260).optional(),
  valor: z.number().finite().positive().max(1e12).optional(),
  formaPagamento: z.string().max(120).optional(),
  observacao: z.string().max(2000).optional(),
  sessaoId: z.string().min(1).max(120),
  /**
   * Identidade da OPERAÇÃO (não do título). O cliente reusa a mesma chave ao repetir uma
   * tentativa que pode ter commitado — o servidor devolve o mesmo resultado sem regravar.
   */
  idempotencyKey: z.string().min(1).max(160).optional(),
})

/**
 * `payload.localId` da `CaixaOperacao`. Mesmo formato do helper compartilhado
 * `lib/caixa/recebimento-cr-caixa.ts` (`<prefixo>:<storeId>:<chave>`), escopado por loja.
 *
 * Sem chave explícita, cai numa identidade derivada da operação — determinística, nunca
 * `Date.now()`. Isso cobre o retry idêntico de `parcial` (mesmo valor ⇒ mesma chave ⇒
 * replay). Para `liquidar`, o valor derivado muda depois da 1ª baixa (o saldo virou 0), de
 * modo que o retry não casa a chave e é barrado um passo adiante, pelo `ja_pago` do
 * service: nada é duplicado, mas a resposta é erro em vez de replay. Chamadores que
 * queiram replay gracioso devem enviar `idempotencyKey` — o modal do PDV envia.
 */
function buildRecebimentoLocalId(params: {
  storeId: string
  sessaoId: string
  tituloId: string
  op: "liquidar" | "parcial"
  valor: number
  idempotencyKey?: string
}): string {
  const chave =
    params.idempotencyKey?.trim() || `${params.tituloId}:${params.op}:${params.valor.toFixed(2)}`
  return `pdv-rc:${params.storeId}:${params.sessaoId}:${chave}`
}

function pickTituloRef(input: { tituloId?: string | number; localKey?: string }): { id?: string; localKey?: string } {
  const idRaw = input.tituloId != null ? String(input.tituloId).trim() : ""
  const lk = (input.localKey ?? "").trim()
  if (idRaw) return { id: idRaw }
  if (lk) return { localKey: lk }
  return {}
}

export async function POST(request: Request) {
  let json: unknown
  try {
    json = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Dados inválidos", issues: parsed.error.flatten() }, { status: 400 })
  }

  const storeId = storeIdFromAssistecRequestForWrite(request)
  if (!storeId) {
    return NextResponse.json(
      { ok: false, error: "Unidade obrigatória: envie o header x-assistec-loja-id." },
      { status: 400 },
    )
  }
  if (parsed.data.lojaId && parsed.data.lojaId !== storeId) {
    return NextResponse.json({ ok: false, error: "Unidade inconsistente (body vs header)." }, { status: 400 })
  }

  const denied = await apiGuardFinanceiroEditEnterpriseOrLegacy(storeId)
  if (denied) return denied

  const ref = pickTituloRef(parsed.data)
  if (!ref.id && !ref.localKey) {
    return NextResponse.json({ ok: false, error: "Informe tituloId ou localKey." }, { status: 400 })
  }

  if (parsed.data.op === "parcial" && !(parsed.data.valor != null && parsed.data.valor > 0)) {
    return NextResponse.json({ ok: false, error: "Valor parcial obrigatório." }, { status: 400 })
  }

  const session = await auth()
  const userLabel = getOperatorLabelFromSession(session)
  const actor = extractAuditoriaActor(session, request)
  const forma = (parsed.data.formaPagamento ?? "dinheiro").trim() || "dinheiro"
  const obsBase = (parsed.data.observacao ?? "").trim()
  const observacao = obsBase
    ? `${obsBase} · PDV · ${forma}`
    : `Recebimento PDV · ${forma}`

  try {
    await prismaEnsureConnected()

    const lock = await verificarPeriodoFechado(storeId, new Date())
    if (lock.fechado) {
      return NextResponse.json(
        { ok: false, error: "Período financeiro fechado. Reabra o fechamento para receber.", code: "periodo_fechado" },
        { status: 409 },
      )
    }

    const sessao = await prisma.sessaoCaixa.findFirst({
      where: { id: parsed.data.sessaoId, storeId, status: "ABERTA" },
      select: { id: true },
    })
    if (!sessao) {
      return NextResponse.json(
        { ok: false, error: "Sessão de caixa não encontrada ou já fechada. Abra o caixa no PDV.", code: "caixa_fechado" },
        { status: 409 },
      )
    }

    const parcial = parsed.data.op === "parcial"

    // Título + histórico + movimentação + operação de caixa numa ÚNICA unidade
    // transacional. Qualquer falha aqui desfaz a baixa — nada de título quitado sem
    // lançamento financeiro correspondente.
    const outcome = await prisma.$transaction(async (tx) => {
      const atual = ref.id
        ? await getContaReceberById(storeId, ref.id, tx)
        : await getContaReceberByLocalKey(storeId, ref.localKey!, tx)
      if (!atual) return { kind: "erro" as const, code: "not_found", status: 404 }

      // Saldo REAL em aberto (valor − pagamentos já registrados no histórico) ANTES de
      // quitar. A coluna `valor` é o valor BRUTO e não diminui em baixas parciais —
      // usá-la lançaria mais que o devido no caixa de um título parcialmente pago.
      const abertoAntes = buildContaReceberAuditTrail([atual])[0]?.saldoAberto ?? 0
      const valorMov = parcial ? parsed.data.valor! : abertoAntes

      const localId = buildRecebimentoLocalId({
        storeId,
        sessaoId: sessao.id,
        tituloId: atual.id,
        op: parsed.data.op,
        valor: valorMov,
        idempotencyKey: parsed.data.idempotencyKey,
      })

      // Idempotência: a mesma operação repetida não gera uma segunda entrada no caixa.
      // Checada ANTES de qualquer escrita — inclusive antes de reaplicar o pagamento.
      const jaRegistrada = await tx.caixaOperacao.findFirst({
        where: { storeId, tipo: "recebimento_cr", payload: { path: ["localId"], equals: localId } },
        select: { id: true, valor: true },
      })
      if (jaRegistrada) {
        return { kind: "replay" as const, titulo: atual, valorMov: jaRegistrada.valor }
      }

      // O service é a autoridade sobre a recusa (`ja_pago` / `nada_em_aberto` /
      // `titulo_encerrado`) e não escreve nada quando recusa.
      const res = parcial
        ? await registrarPagamentoParcial({
            storeId,
            id: ref.id,
            localKey: ref.localKey,
            valorPago: parsed.data.valor!,
            observacao,
            userLabel,
            tituloSnapshot: atual,
            db: tx,
          })
        : await liquidarContaReceber({
            storeId,
            id: ref.id,
            localKey: ref.localKey,
            observacao,
            userLabel,
            tituloSnapshot: atual,
            db: tx,
          })
      if (!res.ok) {
        const status = res.reason === "not_found" ? 404 : res.reason === "titulo_alterado" ? 409 : 422
        return { kind: "erro" as const, code: res.reason, status }
      }
      // Invariante: o service só aceita quando há saldo acima do epsilon — logo `valorMov`
      // aqui é sempre > 0. Nunca cair no valor bruto da coluna como fallback.
      if (!(valorMov > PAY_EPS)) throw new Error("valor_recebimento_invalido")

      const carteiraId = await resolveCarteiraIdFromPayload(res.data.payload, storeId, tx)
      const mov = await createMovimentacaoEntradaFromReceber(
        { id: res.data.id, storeId: res.data.storeId, descricao: res.data.descricao, cliente: res.data.cliente },
        valorMov,
        { parcial, carteiraId, db: tx },
      )
      // Escrita financeira NÃO é best-effort: sem movimentação, a baixa não vale.
      if (!mov.ok) throw new Error(`movimentacao_financeira_falhou:${mov.reason}`)

      await tx.caixaOperacao.create({
        data: {
          sessaoId: sessao.id,
          storeId,
          tipo: "recebimento_cr",
          valor: valorMov,
          motivo: `Recebimento CR — ${res.data.cliente || res.data.descricao} (${forma})`,
          operador: userLabel,
          payload: {
            localId,
            tituloId: res.data.id,
            localKey: res.data.localKey,
            formaPagamento: forma,
            op: parsed.data.op,
          } as Prisma.InputJsonValue,
        },
      })

      return { kind: "ok" as const, titulo: res.data, valorMov }
    }, TX_OPTS)

    if (outcome.kind === "erro") {
      return NextResponse.json(
        { ok: false, error: outcome.code, code: outcome.code },
        { status: outcome.status },
      )
    }

    const titulo = outcome.titulo
    const valorMov = outcome.valorMov
    const replay = outcome.kind === "replay"

    if (!replay) {
      void logAuditoriaFinanceira({
        storeId,
        entidade: "receber",
        entidadeId: titulo.id,
        acao: "liquidar",
        actor,
        depois: { localKey: titulo.localKey, valor: valorMov, formaPagamento: forma, sessaoId: sessao.id, parcial },
      })
    }

    const audit = buildContaReceberAuditTrail([titulo])[0] ?? null

    return NextResponse.json({
      ok: true,
      op: parsed.data.op,
      valorRecebido: valorMov,
      /** true = operação já registrada antes (retry); nada foi gravado de novo. */
      jaRegistrado: replay,
      titulo: {
        id: titulo.id,
        localKey: titulo.localKey,
        status: titulo.status,
        valor: titulo.valor,
        vencimento: titulo.vencimento,
        cliente: titulo.cliente,
        descricao: titulo.descricao,
      },
      audit,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Falha interna"
    console.error("[pdv/receber-conta]", msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 503 })
  }
}
