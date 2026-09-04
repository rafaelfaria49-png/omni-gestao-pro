/**
 * POST /api/pdv/receber-conta-lote
 *
 * Recebimento de VÁRIOS títulos de Contas a Receber numa única operação lógica e
 * transacional (GOAL `PDV-RECEBIMENTO-MULTITITULO-BACKEND-003` · G2).
 *
 * Esta rota é só a borda HTTP: validação de contrato, unidade, permissão e mapeamento de
 * erro. Toda a regra — lock, revalidação de saldo, escrita e idempotência — vive em
 * `lib/financeiro/services/recebimento-lote-service.ts` e roda dentro de UMA
 * `prisma.$transaction`.
 *
 * Invariantes (ver o service para o detalhe):
 *  - ATÔMICO: todos os títulos, todas as movimentações e a operação de caixa numa única
 *    transação. Qualquer recusa é lançada e reverte o lote inteiro — nunca "3 de 5 pagos".
 *  - REVALIDADO NO SERVIDOR: `saldoEsperado` é asserção de concorrência, não fonte. O
 *    saldo real vem do ledger dentro da transação e o total é recalculado aqui.
 *  - IDEMPOTENTE SOB CONCORRÊNCIA: advisory lock transacional sobre a chave do lote +
 *    `payload.localId` determinístico da `CaixaOperacao`.
 *  - A rota singular `/api/pdv/receber-conta` NÃO foi alterada — segue servindo o
 *    "Quitar este título".
 *
 * Nenhuma UI multitítulo é implementada neste GOAL (isso é o G3).
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma, prismaEnsureConnected } from "@/lib/prisma"
import { storeIdFromAssistecRequestForWrite } from "@/lib/store-id-from-request"
import { auth } from "@/auth"
import { getOperatorLabelFromSession } from "@/lib/auth/session-operator"
import { apiGuardFinanceiroEditEnterpriseOrLegacy } from "@/lib/auth/api-enterprise-guard"
import { verificarPeriodoFechado } from "@/lib/financeiro/services/fechamento-service"
import { logAuditoriaFinanceira, extractAuditoriaActor } from "@/lib/financeiro/services/auditoria-actor"
import {
  RECEBIMENTO_LOTE_MAX_ITENS,
  executarRecebimentoLote,
  isRecebimentoLoteError,
  validarRecebimentoLote,
} from "@/lib/financeiro/services/recebimento-lote-service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

/**
 * Transação curta: pgBouncer em modo transação com `connection_limit=1`. Mesmos limites
 * do recebimento singular (G1) — o teto de itens é que mantém o lote dentro deles.
 */
const TX_OPTS = { maxWait: 5_000, timeout: 15_000 } as const

const itemSchema = z.object({
  /** Conferência extra. A chave financeira é sempre `localKey` — nunca nome/documento. */
  tituloId: z.string().min(1).max(120).optional(),
  localKey: z.string().min(1).max(260),
  saldoEsperado: z.number().finite().nonnegative().max(1e12),
  valorReceber: z.number().finite().positive().max(1e12),
})

const bodySchema = z.object({
  lojaId: z.string().min(1).max(120).optional(),
  sessaoId: z.string().min(1).max(120),
  formaPagamento: z.string().min(1).max(120),
  observacao: z.string().max(2000).optional(),
  idempotencyKey: z.string().min(1).max(160),
  itens: z.array(itemSchema).min(1).max(RECEBIMENTO_LOTE_MAX_ITENS),
})

export async function POST(request: Request) {
  let json: unknown
  try {
    json = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Dados inválidos", code: "dados_invalidos", issues: parsed.error.flatten() },
      { status: 400 },
    )
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

  // Contrato do lote antes de qualquer I/O: chave, teto, duplicidade e coerência dos valores.
  const validacao = validarRecebimentoLote({
    idempotencyKey: parsed.data.idempotencyKey,
    itens: parsed.data.itens,
  })
  if (!validacao.ok) {
    return NextResponse.json(
      { ok: false, error: validacao.mensagem, code: validacao.code, detalhes: validacao.detalhes },
      { status: 400 },
    )
  }

  const session = await auth()
  const userLabel = getOperatorLabelFromSession(session)
  const actor = extractAuditoriaActor(session, request)
  const forma = parsed.data.formaPagamento.trim() || "dinheiro"

  try {
    await prismaEnsureConnected()

    // Comportamento preservado do G1 (P2-E): `fechamento-service` ainda não tem porta
    // `db`, então a checagem de período fica antes da transação. A SESSÃO de caixa, essa
    // sim, é relida e travada DENTRO da transação pelo service.
    const lock = await verificarPeriodoFechado(storeId, new Date())
    if (lock.fechado) {
      return NextResponse.json(
        { ok: false, error: "Período financeiro fechado. Reabra o fechamento para receber.", code: "periodo_fechado" },
        { status: 409 },
      )
    }

    const outcome = await prisma.$transaction(
      (tx) =>
        executarRecebimentoLote(
          tx,
          {
            storeId,
            sessaoId: parsed.data.sessaoId,
            formaPagamento: forma,
            observacao: parsed.data.observacao,
            idempotencyKey: parsed.data.idempotencyKey.trim(),
            userLabel,
          },
          validacao.itens,
        ),
      TX_OPTS,
    )

    if (!outcome.jaRegistrado) {
      // Fora da transação e sem `await`: auditoria nunca derruba um recebimento gravado.
      for (const item of outcome.itens) {
        void logAuditoriaFinanceira({
          storeId,
          entidade: "receber",
          entidadeId: item.tituloId,
          acao: "liquidar",
          actor,
          depois: {
            localKey: item.localKey,
            valor: item.valorRecebido,
            saldoDepois: item.saldoDepois,
            statusFinal: item.statusFinal,
            formaPagamento: forma,
            sessaoId: outcome.sessaoId,
            lote: outcome.localId,
          },
        })
      }
    }

    return NextResponse.json({
      ok: true,
      /** true = lote já registrado antes (retry); nada foi gravado de novo. */
      jaRegistrado: outcome.jaRegistrado,
      totalRecebido: outcome.totalRecebido,
      sessaoId: outcome.sessaoId,
      itens: outcome.itens,
    })
  } catch (e) {
    if (isRecebimentoLoteError(e)) {
      return NextResponse.json(
        { ok: false, error: e.message, code: e.code, detalhes: e.detalhes },
        { status: e.status },
      )
    }
    const msg = e instanceof Error ? e.message : "Falha interna"
    console.error("[pdv/receber-conta-lote]", msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 503 })
  }
}
