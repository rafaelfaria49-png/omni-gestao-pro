/**
 * POST /api/fiscal/wsdl/ephemeral-execution
 *
 * Superfície administrativa dormente para uma futura coleta única dos seis WSDLs oficiais. A
 * janela é versionada em código e nasce desativada (restaurada a `null` no refresh do GOAL 020;
 * a ativação de 24/08 é apenas evidência histórica). O request não aceita payload, serviço, URL,
 * destino, relógio, contagem ou retry. A loja-piloto é resolvida DINAMICAMENTE de
 * `ConfiguracaoFiscalLoja` (ADR-0016, fail-closed) — nunca de um literal — e a request
 * autenticada deve pertencer exatamente à candidata resolvida.
 *
 * `fiscalEnabled`: a aquisição H-9/H-10 é metadado read-only (GET sem corpo, sem SOAP, alvos
 * fechados do catálogo) e NÃO é emissão — por isso o preflight exige `fiscalEnabled = false`
 * (GOAL 020 · 132, invertendo a decisão do refresh 129): emissão permanece globalmente
 * desligada durante a aquisição, e a habilitação (`SEFAZ_DIRETO` + `fiscalEnabled=true`)
 * pertence ao gate posterior do live drill de contingência. Providers elegíveis: somente
 * `STUB_HOMOLOGACAO` ou `SEFAZ_DIRETO` (sempre com emissão off). A semântica global de
 * `fiscalEnabled` (snapshot/emissão) NÃO é alterada — a regra vale para este contrato.
 */
import { NextResponse } from "next/server"
import { prisma, prismaEnsureConnected } from "@/lib/prisma"
import { storeIdFromAssistecRequestForWrite } from "@/lib/store-id-from-request"
import { requireFiscalAdmin } from "@/lib/fiscal/guard-fiscal-admin"
import { resolveActiveCertificate } from "@/lib/fiscal/certificate/resolve-active-certificate"
import { loadA1SefazMtlsSecureContext } from "@/lib/fiscal/certificate/a1-mtls-material"
import {
  configuredWsdlExecutionWindowStatus,
  consumeConfiguredWsdlExecutionActivation,
} from "@/lib/fiscal/provider/sefaz/wsdl/wsdl-ephemeral-execution-window"
import {
  candidataAquisicaoWsdl,
  resolveWsdlPilotStore,
} from "@/lib/fiscal/provider/sefaz/wsdl/wsdl-pilot-store-resolver"
import { runConfiguredWsdlEphemeralBatch } from "@/lib/fiscal/provider/sefaz/wsdl/wsdl-ephemeral-batch"
import { isWsdlCanonicalProductionSurface } from "@/lib/fiscal/provider/sefaz/wsdl/wsdl-canonical-production-surface"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0
export const maxDuration = 180

const ALLOWED_QUERY_KEYS = new Set(["storeId", "lojaId"])
const BODY_READ_TIMEOUT_MS = 250
const BODY_CANCEL_TIMEOUT_MS = 25
const MAX_EMPTY_CHUNKS = 16
const BODY_TIMEOUT = Symbol("body-timeout")

function response(status: number, body: Record<string, unknown>): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  })
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      reader.cancel().catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, BODY_CANCEL_TIMEOUT_MS)
      }),
    ])
  } catch {
    // A validação já falhou fechada.
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function bodyIsEmpty(request: Request): Promise<boolean> {
  const contentLength = request.headers.get("content-length")?.trim()
  if (contentLength && contentLength !== "0") return false
  if (request.body === null) return true

  let reader: ReadableStreamDefaultReader<Uint8Array>
  try {
    reader = request.body.getReader()
  } catch {
    return false
  }
  let accepted = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<typeof BODY_TIMEOUT>((resolve) => {
    timer = setTimeout(() => resolve(BODY_TIMEOUT), BODY_READ_TIMEOUT_MS)
  })
  try {
    for (let reads = 0; reads < MAX_EMPTY_CHUNKS; reads += 1) {
      const result = await Promise.race([reader.read(), timeout])
      if (result === BODY_TIMEOUT) return false
      if (result.done) {
        accepted = true
        return true
      }
      if (result.value.byteLength > 0) return false
    }
    return false
  } catch {
    return false
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    if (!accepted) await cancelReader(reader)
    try {
      reader.releaseLock()
    } catch {
      // Reader hostil não mantém a invocation aberta.
    }
  }
}

async function requestIsClosed(request: Request, storeId: string): Promise<boolean> {
  const url = new URL(request.url)
  const keys = [...url.searchParams.keys()]
  if (keys.some((key) => !ALLOWED_QUERY_KEYS.has(key))) return false
  for (const key of ALLOWED_QUERY_KEYS) {
    const values = url.searchParams.getAll(key)
    if (values.length > 1 || values.some((value) => value.trim() !== storeId)) return false
  }
  return bodyIsEmpty(request)
}

export async function POST(request: Request) {
  // Primeira barreira: constantes null/inválidas/fora do prazo bloqueiam antes de ACL e Prisma.
  if (!configuredWsdlExecutionWindowStatus().active) {
    return response(404, { ok: false, code: "wsdl_execution_unavailable" })
  }

  // Segunda barreira permanente: só o Production canônico pode seguir. Preview, URL
  // única, projeto legado e localhost saem aqui — antes de ACL, Prisma, A1 e socket.
  if (
    !isWsdlCanonicalProductionSurface({
      requestUrl: request.url,
      vercelEnv: process.env.VERCEL_ENV,
      vercelProjectId: process.env.VERCEL_PROJECT_ID,
    })
  ) {
    return response(404, { ok: false, code: "wsdl_execution_unavailable" })
  }

  const requestedStoreId = storeIdFromAssistecRequestForWrite(request)
  const acl = await requireFiscalAdmin(requestedStoreId)
  if (!acl.ok) return response(acl.status, { ok: false, code: "access_denied" })

  try {
    if (!(await requestIsClosed(request, acl.storeId))) {
      return response(400, { ok: false, code: "request_not_allowed" })
    }

    // Loja-piloto resolvida do registro REAL. Zero candidatas, múltiplas candidatas (exige
    // decisão humana) ou falha de leitura bloqueiam antes de qualquer preparo.
    const pilot = await resolveWsdlPilotStore()
    if (!pilot.ok) {
      return response(409, { ok: false, code: "pilot_store_unresolved" })
    }
    if (acl.storeId !== pilot.storeId) {
      return response(400, { ok: false, code: "request_not_allowed" })
    }

    await prismaEnsureConnected()
    const [store, config] = await Promise.all([
      prisma.store.findUnique({ where: { id: acl.storeId }, select: { id: true } }),
      prisma.configuracaoFiscalLoja.findUnique({
        where: { storeId: acl.storeId },
        select: {
          storeId: true,
          ambiente: true,
          modeloFiscal: true,
          provider: true,
          fiscalEnabled: true,
          certificadoAtivoId: true,
        },
      }),
    ])
    if (!store || !config || config.storeId !== store.id) {
      return response(409, { ok: false, code: "preflight_blocked" })
    }
    // Revalidação da própria leitura com o MESMO predicado canônico do resolver — as duas
    // superfícies nunca divergem: HOMOLOGACAO, NFCE, provider em {STUB_HOMOLOGACAO,
    // SEFAZ_DIRETO}, fiscalEnabled=false (emissão desligada) e certificadoAtivoId presente.
    if (!candidataAquisicaoWsdl(config)) {
      return response(409, { ok: false, code: "preflight_blocked" })
    }

    const active = await resolveActiveCertificate({ storeId: acl.storeId })
    if (!active.ok || active.certificadoId !== config.certificadoAtivoId) {
      return response(409, { ok: false, code: "preflight_blocked" })
    }

    // Abre e valida PFX/senha em memória antes de tocar no ledger one-shot. Falha local deixa a
    // activation disponível; o material bruto é descartado dentro da primitiva.
    const preparedSecureContext = await loadA1SefazMtlsSecureContext({
      storeId: active.storeId,
      blobRef: active.blobRef,
      senhaRef: active.senhaRef,
    })

    const consumed = await consumeConfiguredWsdlExecutionActivation({
      storeId: acl.storeId,
      operatorId: String(acl.session.user.id ?? "admin"),
    })
    if (!consumed.ok) {
      return response(409, { ok: false, code: "activation_unavailable" })
    }

    const result = await runConfiguredWsdlEphemeralBatch({
      activation: consumed.activation,
      certificate: {
        storeId: active.storeId,
        blobRef: active.blobRef,
        senhaRef: active.senhaRef,
      },
      preparedSecureContext,
    })
    return response(200, result as unknown as Record<string, unknown>)
  } catch {
    // Nunca propaga mensagens/stacks de Prisma, vault, OpenSSL, TLS ou resposta remota.
    return response(500, { ok: false, code: "wsdl_execution_failed" })
  }
}
