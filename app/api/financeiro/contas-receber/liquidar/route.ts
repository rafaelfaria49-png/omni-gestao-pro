import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma, prismaEnsureConnected } from "@/lib/prisma"
import { storeIdFromAssistecRequestForWrite } from "@/lib/store-id-from-request"
import { auth } from "@/auth"
import { getOperatorLabelFromSession } from "@/lib/auth/session-operator"
import { apiGuardFinanceiroEditEnterpriseOrLegacy } from "@/lib/auth/api-enterprise-guard"
import { liquidarContaReceber, buildContaReceberAuditTrail } from "@/lib/financeiro/services"

export const runtime = "nodejs"

const bodySchema = z.object({
  lojaId: z.string().min(1).max(120).optional(),
  tituloId: z.union([z.string(), z.number()]).optional(),
  localKey: z.string().min(1).max(260).optional(),
  formaPagamento: z.string().max(120).optional(),
  observacao: z.string().max(2000).optional(),
})

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
      { ok: false, error: "Unidade obrigatória: envie o header x-assistec-loja-id ou query storeId / lojaId." },
      { status: 400 },
    )
  }
  if (parsed.data.lojaId && parsed.data.lojaId !== storeId) {
    return NextResponse.json(
      { ok: false, error: "Unidade inconsistente: o corpo e o header devem referir a mesma loja." },
      { status: 400 },
    )
  }

  const denied = await apiGuardFinanceiroEditEnterpriseOrLegacy(storeId)
  if (denied) return denied

  const userLabel = getOperatorLabelFromSession(await auth())

  const ref = pickTituloRef(parsed.data)
  if (!ref.id && !ref.localKey) {
    return NextResponse.json({ ok: false, error: "Informe tituloId ou localKey." }, { status: 400 })
  }

  const res = await liquidarContaReceber({
    storeId,
    id: ref.id,
    localKey: ref.localKey,
    observacao: parsed.data.observacao,
    userLabel,
  })

  if (!res.ok) {
    // `ja_pago` / `nada_em_aberto` / `titulo_encerrado` não são "não encontrado": o título
    // existe e a operação é que não se aplica. Mesmo mapeamento da rota do PDV.
    const status = res.reason === "not_found" ? 404 : res.reason === "titulo_alterado" ? 409 : 422
    return NextResponse.json({ ok: false, error: res.reason, code: res.reason }, { status })
  }

  try {
    await prismaEnsureConnected()
    await prisma.logsAuditoria.create({
      data: {
        action: "liquidacao_conta_receber",
        userLabel,
        detail: `Liquidação CR — loja ${storeId}, título ${res.data.id}`,
        metadata: JSON.stringify({
          storeId,
          tituloId: res.data.id,
          localKey: res.data.localKey,
          formaPagamento: parsed.data.formaPagamento,
          observacao: parsed.data.observacao,
          at: new Date().toISOString(),
        }).slice(0, 8000),
        source: "api",
      },
    })
  } catch (e) {
    if (process.env.NODE_ENV === "development") console.error("[contas-receber/liquidar] audit", e)
  }

  const audit = buildContaReceberAuditTrail([res.data])[0] ?? null

  return NextResponse.json({
    ok: true,
    titulo: {
      id: res.data.id,
      storeId: res.data.storeId,
      localKey: res.data.localKey,
      status: res.data.status,
      valor: res.data.valor,
      vencimento: res.data.vencimento,
      cliente: res.data.cliente,
    },
    audit,
  })
}
