/**
 * Superfície administrativa INTERNA do drill de transmissão posterior da
 * contingência (GOAL 020) — DISTINTA do drain genérico da fila.
 *
 * O caller identifica APENAS o job autorizado (jobId + storeId). URL, host,
 * porta, SOAPAction, XML, bytes, certificado, senha, CSC, ambiente, UF e
 * modelo são REJEITADOS como parâmetros: tudo isso é resolvido por dentro
 * (catálogo fechado, bytes persistidos, cofre, guards D4).
 *
 * Enquanto o gate efêmero específico da contingência estiver dormente, toda
 * chamada termina bloqueada antes de cofre, A1 e rede — sem qualquer efeito.
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { executeContingencyHomologationDrillTransmission } from "@/lib/fiscal/contingencia/contingency-drill-wiring"
import { sanitizeFiscalQueueError } from "@/lib/fiscal/queue/queue-policy"
import { createHash, timingSafeEqual } from "node:crypto"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

/**
 * `.strict()`: qualquer campo além de jobId/storeId/actor é recusado — o
 * caller não pode INJETAR nada do transporte.
 */
const schema = z
  .object({
    jobId: z.string().trim().min(1).max(64),
    storeId: z.string().trim().min(1).max(64),
    actor: z.string().trim().min(1).max(120).optional(),
  })
  .strict()

function secretMatches(received: string, expected: string): boolean {
  const receivedHash = createHash("sha256").update(received, "utf8").digest()
  const expectedHash = createHash("sha256").update(expected, "utf8").digest()
  return timingSafeEqual(receivedHash, expectedHash)
}

function authorize(request: Request): NextResponse | null {
  const expected = process.env.FISCAL_QUEUE_INTERNAL_SECRET?.trim()
  if (!expected) {
    return NextResponse.json({ ok: false, error: "drill_interno_indisponivel" }, { status: 503 })
  }
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim()
  const received = bearer || request.headers.get("x-fiscal-queue-secret")?.trim() || ""
  if (!received || !secretMatches(received, expected)) {
    return NextResponse.json({ ok: false, error: "nao_autorizado" }, { status: 401 })
  }
  return null
}

export async function POST(request: Request) {
  const denied = authorize(request)
  if (denied) return denied
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: "json_invalido" }, { status: 400 })
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "parametros_invalidos", detail: "Somente jobId, storeId e actor são aceitos." },
      { status: 400 },
    )
  }
  try {
    const report = await executeContingencyHomologationDrillTransmission({
      jobId: parsed.data.jobId,
      storeId: parsed.data.storeId,
      workerId: parsed.data.actor ? `drill:${parsed.data.actor}` : undefined,
    })
    return NextResponse.json({ ok: report.ok, report })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "drill_falhou", detail: sanitizeFiscalQueueError(error) },
      { status: 503 },
    )
  }
}
