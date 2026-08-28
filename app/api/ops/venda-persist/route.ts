import { NextResponse } from "next/server"
import { prisma, prismaEnsureConnected } from "@/lib/prisma"
import { opsLojaIdFromRequestForWrite } from "@/lib/ops-api-gate"
import { apiGuardEnterpriseOrOps } from "@/lib/auth/api-enterprise-guard"
import { auth } from "@/auth"
import { getOperatorLabelFromSession } from "@/lib/auth/session-operator"
import {
  upsertVendaInTransaction,
  InsufficientStockError,
  UnresolvedProductError,
  CaixaSessaoInvalidaError,
  CaixaOriginalFechadoError,
  CreditoValeInsuficienteError,
  PedidoIdDeOutraLojaError,
  PedidoIdConflitoMesmaLojaError,
  VendaCreateUniqueConflictError,
  classifyExistingVendaReplay,
  VENDA_REPLAY_SELECT,
  type SalePayload,
} from "@/lib/ops-upsert-venda"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function POST(req: Request) {
  const lojaId = opsLojaIdFromRequestForWrite(req)
  if (!lojaId) {
    return NextResponse.json(
      { error: "Unidade obrigatória: envie o header x-assistec-loja-id ou query storeId / lojaId." },
      { status: 400 }
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 })
  }

  const sale = (body as { sale?: SalePayload }).sale
  if (!sale || typeof sale !== "object") {
    return NextResponse.json({ error: "sale obrigatório" }, { status: 400 })
  }

  // Flag explícito e manual (nunca inferido/automático) para sincronizar uma venda
  // pendente cuja `sessaoId` original existe e é desta loja, mas já está `FECHADA`
  // (fechamento diário já rodou). Aceita os dois nomes por compatibilidade com o PDV.
  // Sem esse flag, esse cenário falha com 409 `CAIXA_ORIGINAL_FECHADO` (ver
  // `lib/ops-upsert-venda.ts#CaixaOriginalFechadoError`).
  const bodyObj = body as { allowClosedOriginalSession?: unknown; retroactiveClosedSession?: unknown }
  const allowClosedOriginalSession =
    bodyObj.allowClosedOriginalSession === true || bodyObj.retroactiveClosedSession === true

  const pedidoId = typeof sale.id === "string" && sale.id.trim() ? sale.id.trim() : ""
  if (!pedidoId) {
    return NextResponse.json({ error: "sale.id inválido" }, { status: 400 })
  }

  const denied = await apiGuardEnterpriseOrOps(
    lojaId,
    (p) => p.hubs.vendas,
    "Sem permissão para registrar vendas.",
  )
  if (denied) return denied

  // Resolve o operador a partir da sessão NextAuth — mais confiável que o cashierId do cliente.
  const session = await auth()
  const operadorLabel = session?.user ? getOperatorLabelFromSession(session) : undefined

  try {
    await prismaEnsureConnected()
    const result = await prisma.$transaction(
      async (tx) => {
        return upsertVendaInTransaction(tx, lojaId, sale, operadorLabel, {
          enforceStock: true,
          requireCaixaSession: true,
          allowClosedOriginalSession,
        })
      },
      // `DATABASE_URL` usa `connection_limit=1` (pooler Supabase) — vendas com muitas
      // linhas + parcelamento à prazo fazem várias idas ao banco dentro da mesma
      // transação e podem esperar a única conexão ficar livre. Os defaults do Prisma
      // (maxWait 2s / timeout 5s) estouravam nesse cenário e o Postgres já tinha
      // encerrado a transação quando a próxima query rodava, gerando
      // "Transaction not found... refere-se a uma transação antiga já encerrada".
      { maxWait: 15_000, timeout: 20_000 },
    )

    return NextResponse.json({ ok: true, replayed: result.replayed, venda: result.venda })
  } catch (e) {
    let error: unknown = e

    // A transação que perdeu a unique de `pedidoId` já foi revertida integralmente.
    // Releitura obrigatoriamente FORA dela: classifica o vencedor sem tentar update.
    if (e instanceof VendaCreateUniqueConflictError) {
      try {
        const winner = await prisma.venda.findUnique({
          where: { pedidoId },
          select: VENDA_REPLAY_SELECT,
        })
        if (winner) {
          try {
            const replay = classifyExistingVendaReplay(lojaId, sale, winner)
            return NextResponse.json({ ok: true, replayed: true, venda: replay.venda })
          } catch (classificationError) {
            error = classificationError
          }
        }
      } catch (lookupError) {
        error = lookupError
      }
    }

    // Colisão de `pedidoId` entre lojas (PDV-PEDIDO-ID-COLISAO-MULTILOJA-FIX-001): o
    // número já pertence a uma venda de OUTRA loja. Fail-closed — nada foi gravado e a
    // venda da outra loja permanece intacta. Não é contornável por reenvio nem por
    // sincronização retroativa; a saída é renumeração administrada (GOAL próprio).
    // Log estruturado sem payload nem dados do cliente.
    if (error instanceof PedidoIdDeOutraLojaError) {
      console.warn(
        "[ops/venda-persist] pedido-id-de-outra-loja",
        JSON.stringify({
          lojaIdSolicitante: lojaId,
          pedidoId,
          ownerStoreId: error.ownerStoreId,
          terminalId: sale.terminalId ?? null,
          bloqueio: "fail-closed",
        }),
      )
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 })
    }
    if (error instanceof PedidoIdConflitoMesmaLojaError) {
      console.warn(
        "[ops/venda-persist] pedido-id-conflito-mesma-loja",
        JSON.stringify({
          lojaId,
          pedidoId,
          terminalId: sale.terminalId ?? null,
          bloqueio: "fail-closed",
        }),
      )
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 })
    }
    // Caixa servidor obrigatório (P1 OPS-SALE-SAFETY-P1-001): venda com entrada no caixa
    // sem `SessaoCaixa` ABERTA válida é falha de negócio (409), não erro de servidor.
    // Nada foi gravado (validação dentro da transação). O PDV mantém `syncPending` e
    // mostra o toast — o operador abre o caixa e usa "Reenviar sync".
    if (error instanceof CaixaSessaoInvalidaError) {
      console.warn(
        "[ops/venda-persist] caixa-fechado",
        JSON.stringify({ lojaId, pedidoId, sessaoId: sale.sessaoId ?? null, terminalId: sale.terminalId ?? null }),
      )
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 })
    }
    // Venda pendente antiga cuja sessão de caixa original existe e é desta loja, mas já
    // foi fechada. Nunca sincroniza sozinha no caixa atual (ver
    // PDV-VENDA-PENDENTE-DIA-ANTERIOR-SYNC-AUDIT-001) — exige `allowClosedOriginalSession`
    // explícito (ação manual do operador/gerente confirmando o lançamento retroativo).
    if (error instanceof CaixaOriginalFechadoError) {
      console.warn(
        "[ops/venda-persist] caixa-original-fechado",
        JSON.stringify({ lojaId, pedidoId, sessaoId: sale.sessaoId ?? null, allowClosedOriginalSession }),
      )
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 })
    }
    // Produto físico não resolvido (P1): item sem casamento em `Produto` não pode gerar
    // venda/financeiro sem baixa de estoque. Nada foi gravado (transação revertida).
    if (error instanceof UnresolvedProductError) {
      console.warn(
        "[ops/venda-persist] produto-nao-resolvido",
        JSON.stringify({ lojaId, pedidoId, inventoryIds: error.inventoryIds }),
      )
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 })
    }
    // Crédito/Vale fail-closed (PDV-TROCAS-VALE-HARDENING-PRE-PUBLISH-002): venda
    // contabilizando creditoVale sem saldo efetivamente debitado NÃO conclui — a
    // transação inteira reverte. 409 com code específico: o client mantém a venda
    // `syncPending` (syncBlockedCode) e o operador reaplica o pagamento e reenvia.
    if (error instanceof CreditoValeInsuficienteError) {
      console.warn(
        "[ops/venda-persist] credito-vale-insuficiente",
        JSON.stringify({ lojaId, ...error.detail }),
      )
      return NextResponse.json(
        { error: error.message, code: error.code, detail: error.detail },
        { status: 409 },
      )
    }
    // Anti-negativo (DT-B): saldo insuficiente é falha de negócio explícita (409),
    // não erro de servidor. O cliente PDV mantém a venda em `syncPending` e mostra o
    // toast com `detail`, permitindo reabrir o caixa/ajustar estoque e reenviar.
    if (error instanceof InsufficientStockError) {
      console.warn(
        "[ops/venda-persist] estoque-insuficiente",
        JSON.stringify({
          lojaId,
          pedidoId,
          produtoId: error.produtoId,
          disponivel: error.disponivel,
          solicitado: error.solicitado,
        }),
      )
      return NextResponse.json(
        { error: "Estoque insuficiente", detail: error.message, code: error.code },
        { status: 409 },
      )
    }
    const msg = error instanceof Error ? error.message : String(error)
    // Extrai code do PrismaClientKnownRequestError (P2002 unique, P2003 FK, P2025 not found, etc.)
    const code =
      error && typeof error === "object" && "code" in error && typeof (error as { code: unknown }).code === "string"
        ? (error as { code: string }).code
        : undefined
    const meta =
      error && typeof error === "object" && "meta" in error ? (error as { meta: unknown }).meta : undefined
    console.error(
      "[ops/venda-persist] erro",
      JSON.stringify({ lojaId, pedidoId, code, msg, meta }),
    )
    return NextResponse.json(
      { error: "Falha ao salvar venda no servidor", detail: msg, code },
      { status: 503 },
    )
  }
}
