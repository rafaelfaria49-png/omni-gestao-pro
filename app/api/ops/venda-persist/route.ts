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
  PedidoIdDeOutraLojaError,
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
    await prisma.$transaction(
      async (tx) => {
        await upsertVendaInTransaction(tx, lojaId, sale, operadorLabel, {
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

    return NextResponse.json({ ok: true })
  } catch (e) {
    // Colisão de `pedidoId` entre lojas (PDV-PEDIDO-ID-COLISAO-MULTILOJA-FIX-001): o
    // número já pertence a uma venda de OUTRA loja. Fail-closed — nada foi gravado e a
    // venda da outra loja permanece intacta. Não é contornável por reenvio nem por
    // sincronização retroativa; a saída é renumeração administrada (GOAL próprio).
    // Log estruturado sem payload nem dados do cliente.
    if (e instanceof PedidoIdDeOutraLojaError) {
      console.warn(
        "[ops/venda-persist] pedido-id-de-outra-loja",
        JSON.stringify({
          lojaIdSolicitante: lojaId,
          pedidoId,
          ownerStoreId: e.ownerStoreId,
          terminalId: sale.terminalId ?? null,
          bloqueio: "fail-closed",
        }),
      )
      return NextResponse.json({ error: e.message, code: e.code }, { status: 409 })
    }
    // Caixa servidor obrigatório (P1 OPS-SALE-SAFETY-P1-001): venda com entrada no caixa
    // sem `SessaoCaixa` ABERTA válida é falha de negócio (409), não erro de servidor.
    // Nada foi gravado (validação dentro da transação). O PDV mantém `syncPending` e
    // mostra o toast — o operador abre o caixa e usa "Reenviar sync".
    if (e instanceof CaixaSessaoInvalidaError) {
      console.warn(
        "[ops/venda-persist] caixa-fechado",
        JSON.stringify({ lojaId, pedidoId, sessaoId: sale.sessaoId ?? null, terminalId: sale.terminalId ?? null }),
      )
      return NextResponse.json({ error: e.message, code: e.code }, { status: 409 })
    }
    // Venda pendente antiga cuja sessão de caixa original existe e é desta loja, mas já
    // foi fechada. Nunca sincroniza sozinha no caixa atual (ver
    // PDV-VENDA-PENDENTE-DIA-ANTERIOR-SYNC-AUDIT-001) — exige `allowClosedOriginalSession`
    // explícito (ação manual do operador/gerente confirmando o lançamento retroativo).
    if (e instanceof CaixaOriginalFechadoError) {
      console.warn(
        "[ops/venda-persist] caixa-original-fechado",
        JSON.stringify({ lojaId, pedidoId, sessaoId: sale.sessaoId ?? null, allowClosedOriginalSession }),
      )
      return NextResponse.json({ error: e.message, code: e.code }, { status: 409 })
    }
    // Produto físico não resolvido (P1): item sem casamento em `Produto` não pode gerar
    // venda/financeiro sem baixa de estoque. Nada foi gravado (transação revertida).
    if (e instanceof UnresolvedProductError) {
      console.warn(
        "[ops/venda-persist] produto-nao-resolvido",
        JSON.stringify({ lojaId, pedidoId, inventoryIds: e.inventoryIds }),
      )
      return NextResponse.json({ error: e.message, code: e.code }, { status: 409 })
    }
    // Anti-negativo (DT-B): saldo insuficiente é falha de negócio explícita (409),
    // não erro de servidor. O cliente PDV mantém a venda em `syncPending` e mostra o
    // toast com `detail`, permitindo reabrir o caixa/ajustar estoque e reenviar.
    if (e instanceof InsufficientStockError) {
      console.warn(
        "[ops/venda-persist] estoque-insuficiente",
        JSON.stringify({
          lojaId,
          pedidoId,
          produtoId: e.produtoId,
          disponivel: e.disponivel,
          solicitado: e.solicitado,
        }),
      )
      return NextResponse.json(
        { error: "Estoque insuficiente", detail: e.message, code: e.code },
        { status: 409 },
      )
    }
    const msg = e instanceof Error ? e.message : String(e)
    // Extrai code do PrismaClientKnownRequestError (P2002 unique, P2003 FK, P2025 not found, etc.)
    const code =
      e && typeof e === "object" && "code" in e && typeof (e as { code: unknown }).code === "string"
        ? (e as { code: string }).code
        : undefined
    const meta =
      e && typeof e === "object" && "meta" in e ? (e as { meta: unknown }).meta : undefined
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
