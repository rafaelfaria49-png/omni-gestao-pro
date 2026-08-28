import { createHash, randomUUID, timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"
import {
  cancelFiscalQueueJob,
  drainFiscalQueue,
  FiscalQueueAdminError,
  readFiscalQueueMetrics,
  reprocessFailedFiscalJob,
  sanitizeFiscalQueueError,
  setFiscalQueuePause,
} from "@/lib/fiscal/queue"
import { solicitarInutilizacaoAdministrativa } from "@/lib/fiscal/inutilizacao/admin"
import { createPrismaInutilizacaoPorts } from "@/lib/fiscal/inutilizacao/prisma-ports"
import { createNfceHomologationPilotWiring } from "@/lib/fiscal/homologation/nfce-homologation-pilot-wiring"

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
      { ok: false, error: "fila_interna_indisponivel" },
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

function adminErrorStatus(code: string): number {
  if (code === "parametros_invalidos") return 400
  if (code === "job_nao_encontrado") return 404
  return 409
}

export async function GET(request: Request) {
  const denied = authorize(request)
  if (denied) return denied
  const storeId = new URL(request.url).searchParams.get("storeId")
  try {
    const metrics = await readFiscalQueueMetrics({ storeId })
    return NextResponse.json({ ok: true, metrics })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "metricas_indisponiveis", detail: sanitizeFiscalQueueError(error) },
      { status: 503 },
    )
  }
}

export async function POST(request: Request) {
  const denied = authorize(request)
  if (denied) return denied
  const contentLength = Number(request.headers.get("content-length") ?? 0)
  if (contentLength > 32_768) {
    return NextResponse.json({ ok: false, error: "payload_muito_grande" }, { status: 413 })
  }
  let body: Record<string, unknown>
  try {
    const raw = await request.text()
    if (Buffer.byteLength(raw, "utf8") > 32_768) {
      return NextResponse.json({ ok: false, error: "payload_muito_grande" }, { status: 413 })
    }
    const parsed = JSON.parse(raw)
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return NextResponse.json({ ok: false, error: "json_invalido" }, { status: 400 })
  }
  const action = String(body.action ?? "").trim()

  try {
    if (action === "drain") {
      const workerLabel = String(body.workerId ?? "").trim().replace(/[^a-zA-Z0-9._:-]/g, "").slice(0, 80)
      const workerId = workerLabel || `internal:${randomUUID()}`
      const report = await drainFiscalQueue(
        {
          workerId,
          batchSize: Number(body.batchSize ?? 10),
        },
        createNfceHomologationPilotWiring().ports,
      )
      return NextResponse.json({ ok: true, report })
    }
    if (action === "pause") {
      if (body.scope !== "global" && body.scope !== "store") {
        throw new FiscalQueueAdminError(
          "parametros_invalidos",
          "scope deve ser global ou store.",
        )
      }
      if (typeof body.paused !== "boolean") {
        throw new FiscalQueueAdminError(
          "parametros_invalidos",
          "paused deve ser booleano.",
        )
      }
      const pause = await setFiscalQueuePause({
        scope: body.scope,
        storeId: String(body.storeId ?? ""),
        paused: body.paused,
        actor: String(body.actor ?? ""),
        reason: String(body.reason ?? ""),
      })
      return NextResponse.json({ ok: true, pause })
    }
    if (action === "reprocess") {
      const result = await reprocessFailedFiscalJob({
        jobId: String(body.jobId ?? ""),
        storeId: String(body.storeId ?? ""),
        actor: String(body.actor ?? ""),
        reason: String(body.reason ?? ""),
        consultationAuthorizedRetry: body.consultationAuthorizedRetry === true,
      })
      return NextResponse.json({ ok: true, result })
    }
    if (action === "cancel") {
      const result = await cancelFiscalQueueJob({
        jobId: String(body.jobId ?? ""),
        storeId: String(body.storeId ?? ""),
        actor: String(body.actor ?? ""),
        reason: String(body.reason ?? ""),
      })
      return NextResponse.json({ ok: true, result })
    }
    if (action === "inutilizar") {
      const result = await solicitarInutilizacaoAdministrativa(
        {
          storeId: String(body.storeId ?? ""),
          vendaId: String(body.vendaId ?? ""),
          notaFiscalId: body.notaFiscalId == null ? null : String(body.notaFiscalId),
          serie: Number(body.serie),
          numeroInicial: Number(body.numeroInicial),
          numeroFinal: Number(body.numeroFinal),
          justificativa: String(body.justificativa ?? body.reason ?? ""),
          actor: String(body.actor ?? ""),
        },
        createPrismaInutilizacaoPorts(),
      )
      if (!result.ok) {
        throw new FiscalQueueAdminError(result.code, result.error)
      }
      return NextResponse.json({ ok: true, result })
    }
    return NextResponse.json({ ok: false, error: "acao_invalida" }, { status: 400 })
  } catch (error) {
    if (error instanceof FiscalQueueAdminError) {
      return NextResponse.json(
        { ok: false, error: error.code, detail: error.message },
        { status: adminErrorStatus(error.code) },
      )
    }
    return NextResponse.json(
      { ok: false, error: "fila_interna_falhou", detail: sanitizeFiscalQueueError(error) },
      { status: 503 },
    )
  }
}
