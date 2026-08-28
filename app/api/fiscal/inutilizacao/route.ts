/**
 * Ação administrativa de inutilização NFC-e (GOAL 019).
 *
 * POST: enfileira job INUTILIZACAO (número ou faixa) com justificativa.
 * GET: status auditável do job/marca para a faixa.
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { storeIdFromAssistecRequestForWrite } from "@/lib/store-id-from-request"
import { requireFiscalAdmin } from "@/lib/fiscal/guard-fiscal-admin"
import { solicitarInutilizacaoAdministrativa } from "@/lib/fiscal/inutilizacao/admin"
import { createPrismaInutilizacaoPorts } from "@/lib/fiscal/inutilizacao/prisma-ports"
import { buildInutilizacaoDedupeKey } from "@/lib/fiscal/inutilizacao/mark"
import { reemitirVendaAposRejeicao } from "@/lib/fiscal/inutilizacao/reissue"
import { createPrismaFiscalNumberingPorts } from "@/lib/fiscal/numbering/prisma-numbering-ports"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

function jsonError(msg: string, status: number, code?: string) {
  return NextResponse.json({ ok: false, error: msg, code: code ?? null }, { status })
}

const postSchema = z.object({
  action: z.enum(["inutilizar", "reemitir"]).default("inutilizar"),
  vendaId: z.string().trim().min(1),
  notaFiscalId: z.string().trim().min(1).optional().nullable(),
  serie: z.number().int().min(0).optional(),
  numeroInicial: z.number().int().positive().optional(),
  numeroFinal: z.number().int().positive().optional(),
  justificativa: z.string().trim().min(15).max(255),
})

export async function POST(request: Request) {
  const storeId = storeIdFromAssistecRequestForWrite(request)
  const auth = await requireFiscalAdmin(storeId)
  if (!auth.ok) return jsonError(auth.error, auth.status)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError("JSON inválido", 400, "json_invalido")
  }
  const parsed = postSchema.safeParse(body)
  if (!parsed.success) {
    return jsonError("Parâmetros inválidos.", 400, "parametros_invalidos")
  }
  const ports = createPrismaInutilizacaoPorts()
  const operador = auth.session.user?.email ?? auth.session.user?.id ?? "admin"

  if (parsed.data.action === "reemitir") {
    const result = await reemitirVendaAposRejeicao(
      {
        storeId: auth.storeId,
        vendaId: parsed.data.vendaId,
        operador,
        justificativa: parsed.data.justificativa,
      },
      ports,
      createPrismaFiscalNumberingPorts(),
    )
    if (!result.ok) return jsonError(result.error, 409, result.code)
    return NextResponse.json({ ok: true, result })
  }

  if (
    parsed.data.serie == null ||
    parsed.data.numeroInicial == null ||
    parsed.data.numeroFinal == null
  ) {
    return jsonError("Série e faixa são obrigatórias para inutilizar.", 400, "parametros_invalidos")
  }

  const result = await solicitarInutilizacaoAdministrativa(
    {
      storeId: auth.storeId,
      vendaId: parsed.data.vendaId,
      notaFiscalId: parsed.data.notaFiscalId ?? null,
      serie: parsed.data.serie,
      numeroInicial: parsed.data.numeroInicial,
      numeroFinal: parsed.data.numeroFinal,
      justificativa: parsed.data.justificativa,
      actor: operador,
    },
    ports,
  )
  if (!result.ok) return jsonError(result.error, 409, result.code)
  return NextResponse.json({ ok: true, result })
}

export async function GET(request: Request) {
  const storeId = storeIdFromAssistecRequestForWrite(request)
  const auth = await requireFiscalAdmin(storeId)
  if (!auth.ok) return jsonError(auth.error, auth.status)
  const url = new URL(request.url)
  const serie = Number(url.searchParams.get("serie"))
  const numeroInicial = Number(url.searchParams.get("numeroInicial"))
  const numeroFinal = Number(url.searchParams.get("numeroFinal") ?? url.searchParams.get("numeroInicial"))
  if (!Number.isInteger(serie) || !Number.isInteger(numeroInicial) || !Number.isInteger(numeroFinal)) {
    return jsonError("Série e faixa são obrigatórias.", 400, "parametros_invalidos")
  }
  const ports = createPrismaInutilizacaoPorts()
  const dedupeKey = buildInutilizacaoDedupeKey({
    storeId: auth.storeId,
    modelo: "NFCE",
    ambiente: "HOMOLOGACAO",
    serie,
    numeroInicial,
    numeroFinal,
  })
  const job = await ports.findJobByDedupe({ storeId: auth.storeId, dedupeKey })
  return NextResponse.json({
    ok: true,
    dedupeKey,
    found: Boolean(job),
    status: job?.status ?? null,
    mark: job?.payload.mark ?? null,
    protocolo: job?.payload.protocolo ?? null,
    cStat: job?.payload.cStat ?? null,
  })
}
