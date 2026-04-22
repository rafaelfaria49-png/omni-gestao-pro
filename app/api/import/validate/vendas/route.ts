import { NextResponse } from "next/server"
import { getVerifiedSubscriptionFromCookies } from "@/lib/api-auth"
import { isVencimentoExpired } from "@/lib/subscription-seal"
import { getTrustedTimeMs } from "@/lib/trusted-time"
import { storeIdFromAssistecRequestForWrite } from "@/lib/store-id-from-request"
import { validateOrdensImport, validateVendasMovimentosImport, type MappingRecord } from "@/lib/import-validate"

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

type VendasMode = "vendas" | "ordens"

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

  const mode = (body as { mode?: string }).mode as VendasMode | undefined
  const rows = (body as { rows?: unknown }).rows
  const mapping = (body as { mapping?: unknown }).mapping

  if (!mode || !["vendas", "ordens"].includes(mode)) {
    return NextResponse.json({ error: "mode deve ser vendas ou ordens." }, { status: 400 })
  }
  if (!Array.isArray(rows)) {
    return NextResponse.json({ error: "rows deve ser um array" }, { status: 400 })
  }
  if (!mapping || typeof mapping !== "object") {
    return NextResponse.json({ error: "mapping deve ser um objeto" }, { status: 400 })
  }

  const m = mapping as MappingRecord
  const errors =
    mode === "vendas"
      ? validateVendasMovimentosImport({ rows: rows as Record<string, unknown>[], mapping: m })
      : validateOrdensImport({ rows: rows as Record<string, unknown>[], mapping: m })

  return NextResponse.json({
    ok: errors.length === 0,
    storeId,
    mode,
    errors,
    validRowCount: rows.length,
  })
}
