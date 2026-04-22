import { NextResponse } from "next/server"
import { getVerifiedSubscriptionFromCookies } from "@/lib/api-auth"
import { isVencimentoExpired } from "@/lib/subscription-seal"
import { getTrustedTimeMs } from "@/lib/trusted-time"
import { storeIdFromAssistecRequestForWrite } from "@/lib/store-id-from-request"
import { validateProdutosImport, type MappingRecord } from "@/lib/import-validate"

export const runtime = "nodejs"

async function requireSubscription() {
  const sub = await getVerifiedSubscriptionFromCookies()
  if (!sub.ok) {
    return { ok: false as const, res: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) }
  }
  const now = await getTrustedTimeMs()
  if (isVencimentoExpired(now, sub.vencimento) || sub.status !== "ativa") {
    return { ok: false as const, res: NextResponse.json({ error: "Assinatura inválida" }, { status: 403 }) }
  }
  return { ok: true as const, sub }
}

export async function POST(req: Request) {
  const gate = await requireSubscription()
  if (!gate.ok) return gate.res

  const storeId = storeIdFromAssistecRequestForWrite(req)
  if (!storeId) {
    return NextResponse.json(
      { error: "Unidade obrigatória: selecione a loja no cabeçalho e envie x-assistec-loja-id." },
      { status: 400 }
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 })
  }

  const rows = (body as { rows?: unknown }).rows
  const mapping = (body as { mapping?: unknown }).mapping
  if (!Array.isArray(rows)) {
    return NextResponse.json({ error: "rows deve ser um array" }, { status: 400 })
  }
  if (!mapping || typeof mapping !== "object") {
    return NextResponse.json({ error: "mapping deve ser um objeto" }, { status: 400 })
  }

  const errors = validateProdutosImport({
    rows: rows as Record<string, unknown>[],
    mapping: mapping as MappingRecord,
  })

  return NextResponse.json({
    ok: errors.length === 0,
    storeId,
    errors,
    validRowCount: rows.length,
  })
}
