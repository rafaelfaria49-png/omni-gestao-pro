/** Entrada administrativa manual em contingência offline NFC-e (GOAL 020). */
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { storeIdFromAssistecRequestForWrite } from "@/lib/store-id-from-request"
import { requireFiscalAdmin } from "@/lib/fiscal/guard-fiscal-admin"
import { selectNfceSpPublicUrls } from "@/lib/fiscal/danfce/urls-sp"
import { createPersistedNfceFinalizationSourceResolver } from "@/lib/fiscal/emission/nfce-finalization-source-resolver"
import { createFinalizedNfcePreparer } from "@/lib/fiscal/emission/finalized-nfce-preparer"
import { NfceSignError } from "@/lib/fiscal/signing"
import { allocateFiscalNumber } from "@/lib/fiscal/numbering/allocate-fiscal-number"
import { createPrismaFiscalNumberingPorts } from "@/lib/fiscal/numbering/prisma-numbering-ports"
import { enterManualOfflineContingency } from "@/lib/fiscal/contingencia/offline-contingency"
import { createPrismaOfflineContingencyPersistence } from "@/lib/fiscal/contingencia/prisma-offline-contingency-ports"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

const schema = z.object({
  vendaId: z.string().trim().min(1),
  notaFiscalId: z.string().trim().min(1),
  xJust: z.string().trim().min(15).max(256),
  confirmarManual: z.literal(true),
})

function errorResponse(error: string, status: number, code: string) {
  return NextResponse.json({ ok: false, error, code }, { status })
}

/** Gate deliberadamente fechado até o A1/gate de homologação ser liberado. */
async function resolveCertificateBeforeExternalGate(): Promise<never> {
  throw new NfceSignError("material_ausente", "EXTERNAL_HOMOLOGATION_PENDING: material A1 não liberado para este piloto.")
}

export async function POST(request: Request) {
  const storeId = storeIdFromAssistecRequestForWrite(request)
  const auth = await requireFiscalAdmin(storeId)
  if (!auth.ok) return errorResponse(auth.error, auth.status, "fiscal_admin_required")
  let body: unknown
  try { body = await request.json() } catch { return errorResponse("JSON inválido.", 400, "json_invalido") }
  const parsed = schema.safeParse(body)
  if (!parsed.success) return errorResponse("Parâmetros inválidos.", 400, "parametros_invalidos")

  const config = await prisma.configuracaoFiscalLoja.findUnique({
    where: { storeId: auth.storeId },
    select: { fiscalEnabled: true, ambiente: true, modeloFiscal: true, provider: true },
  })
  if (!config?.fiscalEnabled) return errorResponse("Loja fiscalmente desabilitada.", 423, "loja_fiscal_desabilitada")
  if (config.ambiente !== "HOMOLOGACAO" || config.modeloFiscal !== "NFCE") return errorResponse("Piloto limitado a NFCE/HOMOLOGACAO.", 409, "contexto_piloto_invalido")
  if (config.provider !== "SEFAZ_DIRETO") return errorResponse("Contingência offline exige provider SEFAZ_DIRETO.", 409, "provider_invalido")

  const operador = auth.session.user?.email ?? auth.session.user?.id ?? "admin"
  try {
    await resolveCertificateBeforeExternalGate()
  } catch (error) {
    if (error instanceof NfceSignError) {
      return errorResponse("Homologação externa pendente; nenhum número foi reservado.", 503, "EXTERNAL_HOMOLOGATION_PENDING")
    }
    return errorResponse("Material A1 indisponível; operação recusada.", 503, "certificado_indisponivel")
  }
  const numbering = await allocateFiscalNumber(
    { storeId: auth.storeId, notaFiscalId: parsed.data.notaFiscalId },
    createPrismaFiscalNumberingPorts(),
  )
  if (!numbering.ok) return errorResponse(numbering.mensagem, 409, numbering.errorCode)

  const sourceResolver = createPersistedNfceFinalizationSourceResolver(prisma as never)
  const urls = selectNfceSpPublicUrls("HOMOLOGACAO")
  const preparer = createFinalizedNfcePreparer({
    resolveSource: sourceResolver,
    resolveCertificate: resolveCertificateBeforeExternalGate,
    qrUrls: { qrCodeBaseUrl: urls.qrCodeBaseUrl, urlChave: urls.urlChave },
  })
  try {
    const result = await enterManualOfflineContingency(
      {
        storeId: auth.storeId,
        vendaId: parsed.data.vendaId,
        notaFiscalId: parsed.data.notaFiscalId,
        operador,
        manualConfirmation: parsed.data.confirmarManual,
        fiscalEnabled: config.fiscalEnabled,
        ambiente: config.ambiente,
        provider: config.provider,
        xJust: parsed.data.xJust,
      },
      { preparer, persistence: createPrismaOfflineContingencyPersistence() },
    )
    if (!result.ok) return errorResponse(result.error, 409, result.code)
    return NextResponse.json({ ok: true, result, numbering: { serie: numbering.serie, numero: numbering.numero } })
  } catch (error) {
    if (error instanceof NfceSignError) return errorResponse("Homologação externa pendente; nenhuma emissão foi persistida.", 503, "EXTERNAL_HOMOLOGATION_PENDING")
    return errorResponse("Contingência recusada em modo fail-closed.", 409, "contingencia_recusada")
  }
}
