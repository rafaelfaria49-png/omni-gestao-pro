import { createHash, timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"
import { sanitizeFiscalQueueError } from "@/lib/fiscal/queue"
import { readFiscalObservabilitySnapshot } from "@/lib/fiscal/observability"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

function secretMatches(received: string, expected: string): boolean {
  const receivedHash = createHash("sha256").update(received, "utf8").digest()
  const expectedHash = createHash("sha256").update(expected, "utf8").digest()
  return timingSafeEqual(receivedHash, expectedHash)
}

function authorize(request: Request): NextResponse | null {
  const expected = process.env.FISCAL_QUEUE_INTERNAL_SECRET?.trim()
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "observabilidade_interna_indisponivel" },
      { status: 503 },
    )
  }
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim()
  const received = bearer || request.headers.get("x-fiscal-queue-secret")?.trim() || ""
  if (!received || !secretMatches(received, expected)) {
    return NextResponse.json({ ok: false, error: "nao_autorizado" }, { status: 401 })
  }
  return null
}

export async function GET(request: Request) {
  const denied = authorize(request)
  if (denied) return denied

  const url = new URL(request.url)
  const storeId = url.searchParams.get("storeId")?.trim()
  if (!storeId) {
    return NextResponse.json(
      { ok: false, error: "store_id_obrigatorio" },
      { status: 400 },
    )
  }

  try {
    const snapshot = await readFiscalObservabilitySnapshot({ storeId })
    return NextResponse.json({ ok: true, snapshot })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "observabilidade_falhou",
        detail: sanitizeFiscalQueueError(error),
      },
      { status: 503 },
    )
  }
}
