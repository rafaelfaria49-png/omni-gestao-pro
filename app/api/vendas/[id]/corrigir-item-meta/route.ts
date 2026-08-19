/**
 * POST /api/vendas/[id]/corrigir-item-meta  — Workspace de Correção, F4 (metadados de item)
 *
 * Edita METADADOS de um item da venda — observação, garantia, número de série, IMEI,
 * lote — SEM tocar quantidade, preço, total, estoque, caixa, financeiro nem fiscal.
 * Armazena em `Venda.payload.lines[idx].metadata` (cria `lines` a partir de `ItemVenda`
 * quando ausente). Como não move dinheiro/estoque, NÃO é gated por período fechado.
 *
 * Guardas: motivo + PIN supervisor; venda não cancelada; índice válido.
 * Auditoria: `Venda.payload.correcoes[]` (antes/depois dos metadados).
 */
import { NextResponse } from "next/server"
import { prisma, prismaEnsureConnected } from "@/lib/prisma"
import { opsLojaIdFromRequest } from "@/lib/ops-api-gate"
import { requireCorrecaoVendaAuth } from "@/lib/vendas/guard-correcao-venda"
import { assertVendaFiscalEditavel } from "@/lib/fiscal/venda-fiscal-state-machine"
import { getOperatorLabelFromSession } from "@/lib/auth/session-operator"
import { authenticateSupervisorPin } from "@/lib/auth/verify-supervisor-pin"
import type { Prisma } from "@/generated/prisma"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

const META_KEYS = ["observacao", "garantia", "serial", "imei", "lote"] as const
type MetaKey = (typeof META_KEYS)[number]

type Body = {
  itemIndex?: number
  motivo?: string
  supervisorPin?: string
  metadata?: Partial<Record<MetaKey, string | null>>
}

function sanitizeMeta(input: unknown): Partial<Record<MetaKey, string>> {
  const out: Partial<Record<MetaKey, string>> = {}
  if (!input || typeof input !== "object") return out
  const rec = input as Record<string, unknown>
  for (const k of META_KEYS) {
    const v = rec[k]
    if (typeof v === "string") {
      const t = v.trim()
      if (t) out[k] = t.slice(0, 200)
    }
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

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 })
  }

  const motivo = body.motivo?.trim()
  const itemIndex = Number(body.itemIndex)
  if (!motivo) return NextResponse.json({ ok: false, error: "Motivo da correção é obrigatório" }, { status: 400 })
  if (!Number.isInteger(itemIndex) || itemIndex < 0) {
    return NextResponse.json({ ok: false, error: "itemIndex inválido" }, { status: 400 })
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
    if (itemIndex >= venda.itens.length) {
      return NextResponse.json({ ok: false, error: "Item não encontrado nesta venda" }, { status: 404 })
    }

    // PIN supervisor.
    const supervisorPin = body.supervisorPin?.trim()
    if (!supervisorPin) {
      return NextResponse.json({ ok: false, error: "PIN de supervisor obrigatório", code: "pin_required" }, { status: 403 })
    }
    const admin = await authenticateSupervisorPin(supervisorPin)
    if (!admin) return NextResponse.json({ ok: false, error: "PIN de supervisor inválido", code: "pin_invalid" }, { status: 401 })
    const supervisorName = admin.name || "Supervisor"

    const operador = session?.user ? getOperatorLabelFromSession(session) : "Operador"
    const now = new Date()

    const payload = (venda.payload && typeof venda.payload === "object" ? venda.payload : {}) as Record<string, unknown>

    // Garante payload.lines alinhado com ItemVenda (ordem = ordem de criação).
    const linesAtuais = Array.isArray(payload.lines) ? (payload.lines as Array<Record<string, unknown>>) : []
    const lines: Array<Record<string, unknown>> = venda.itens.map((it, i) => {
      const base = linesAtuais[i] && typeof linesAtuais[i] === "object" ? { ...linesAtuais[i] } : {}
      return {
        ...base,
        inventoryId: base.inventoryId ?? it.inventoryId ?? "",
        name: base.name ?? it.nome,
        quantity: base.quantity ?? it.quantidade,
        unitPrice: base.unitPrice ?? it.precoUnitario,
        lineTotal: base.lineTotal ?? it.lineTotal,
      }
    })

    const novaMeta = sanitizeMeta(body.metadata)
    const metaAnterior = (lines[itemIndex].metadata && typeof lines[itemIndex].metadata === "object"
      ? lines[itemIndex].metadata
      : {}) as Record<string, unknown>

    lines[itemIndex] = {
      ...lines[itemIndex],
      metadata: Object.keys(novaMeta).length > 0 ? novaMeta : undefined,
    }

    const newPayload: Record<string, unknown> = { ...payload, lines }
    const correcao = {
      at: now.toISOString(),
      operador,
      storeId,
      rota: "vendas/corrigir-item-meta",
      motivo,
      campos: ["item_metadata"],
      supervisorNome: supervisorName,
      itemIndex,
      itemNome: venda.itens[itemIndex]?.nome ?? "",
      metadataAnterior: metaAnterior,
      metadataNova: novaMeta,
    }
    const correcoes = Array.isArray(newPayload.correcoes) ? [...(newPayload.correcoes as unknown[])] : []
    correcoes.push(correcao)
    newPayload.correcoes = correcoes

    await prisma.venda.update({
      where: { id: venda.id },
      data: { payload: newPayload as unknown as Prisma.InputJsonValue },
    })

    return NextResponse.json({ ok: true, pedidoId, itemIndex, metadata: novaMeta })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[vendas/corrigir-item-meta]", msg)
    return NextResponse.json(
      { ok: false, error: "Falha ao salvar metadados do item", detail: process.env.NODE_ENV === "development" ? msg : undefined },
      { status: 503 },
    )
  }
}
