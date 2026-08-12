/**
 * POST /api/fiscal/certificado/selftest — prova A1 real → mTLS estritamente loopback.
 *
 * Capacidade administrativa dormente: exige feature flag explícita, ADMIN e loja canônica.
 * Não aceita material, refs ou qualquer opção de rede no request. Não emite, não numera e não
 * comunica com a SEFAZ.
 */
import { NextResponse } from "next/server"
import { prisma, prismaEnsureConnected } from "@/lib/prisma"
import { storeIdFromAssistecRequestForWrite } from "@/lib/store-id-from-request"
import { requireFiscalAdmin } from "@/lib/fiscal/guard-fiscal-admin"
import { resolveActiveCertificate } from "@/lib/fiscal/certificate/resolve-active-certificate"
import { runA1DeploymentLoopbackSelftest } from "@/lib/fiscal/certificate/a1-deployment-loopback-selftest"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

const FEATURE_FLAG = "FISCAL_A1_OFFLINE_SELFTEST_ENABLED"
const ALLOWED_QUERY_KEYS = new Set(["storeId", "lojaId"])
const EMPTY_BODY_READ_TIMEOUT_MS = 250
const EMPTY_BODY_CANCEL_TIMEOUT_MS = 25
const MAX_EMPTY_BODY_CHUNKS = 16
const BODY_READ_TIMED_OUT = Symbol("body-read-timed-out")

function response(status: number, body: Record<string, unknown>): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  })
}

async function cancelBodyReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      reader.cancel().catch(() => undefined),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, EMPTY_BODY_CANCEL_TIMEOUT_MS)
      }),
    ])
  } catch {
    // Cancelamento é best-effort; a validação já falhou fechada.
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

async function bodyIsEmpty(req: Request): Promise<boolean> {
  if (req.body === null) return true

  let reader: ReadableStreamDefaultReader<Uint8Array>
  try {
    reader = req.body.getReader()
  } catch {
    return false
  }

  let accepted = false
  let timeout: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<typeof BODY_READ_TIMED_OUT>((resolve) => {
    timeout = setTimeout(() => resolve(BODY_READ_TIMED_OUT), EMPTY_BODY_READ_TIMEOUT_MS)
  })

  try {
    for (let reads = 0; reads < MAX_EMPTY_BODY_CHUNKS; reads += 1) {
      const result = await Promise.race([reader.read(), timedOut])
      if (result === BODY_READ_TIMED_OUT) return false
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
    if (timeout !== undefined) clearTimeout(timeout)
    if (!accepted) await cancelBodyReader(reader)
    try {
      reader.releaseLock()
    } catch {
      // Um reader hostil pode manter read() pendente mesmo após cancel(); não bloqueia a resposta.
    }
  }
}

async function requestIsParameterless(req: Request, storeId: string): Promise<boolean> {
  const url = new URL(req.url)
  if ([...url.searchParams.keys()].some((key) => !ALLOWED_QUERY_KEYS.has(key))) return false
  for (const key of ALLOWED_QUERY_KEYS) {
    if (url.searchParams.getAll(key).some((value) => value.trim() !== storeId)) return false
  }
  return bodyIsEmpty(req)
}

export async function POST(req: Request) {
  // Primeira barreira: endpoint indistinguível de inexistente quando a janela operacional fecha.
  if (String(process.env[FEATURE_FLAG] ?? "").trim().toLowerCase() !== "true") {
    return response(404, { ok: false, codigo: "selftest_indisponivel" })
  }

  const requestedStoreId = storeIdFromAssistecRequestForWrite(req)
  const acl = await requireFiscalAdmin(requestedStoreId)
  if (!acl.ok) return response(acl.status, { ok: false, codigo: "acesso_negado" })

  try {
    // Nenhum parâmetro além da seleção canônica de loja atravessa o endpoint.
    if (!(await requestIsParameterless(req, acl.storeId))) {
      return response(400, { ok: false, codigo: "parametros_nao_permitidos" })
    }

    await prismaEnsureConnected()
    const [store, config] = await Promise.all([
      prisma.store.findUnique({
        where: { id: acl.storeId },
        select: { id: true },
      }),
      prisma.configuracaoFiscalLoja.findUnique({
        where: { storeId: acl.storeId },
        select: {
          storeId: true,
          ambiente: true,
          modeloFiscal: true,
          fiscalEnabled: true,
          certificadoAtivoId: true,
        },
      }),
    ])
    if (!store || !config || config.storeId !== store.id) {
      return response(409, { ok: false, codigo: "store_ou_configuracao_incoerente" })
    }
    if (
      config.ambiente !== "HOMOLOGACAO" ||
      config.modeloFiscal !== "NFCE" ||
      config.fiscalEnabled !== false
    ) {
      return response(409, { ok: false, codigo: "preflight_fiscal_bloqueado" })
    }
    if (!String(config.certificadoAtivoId ?? "").trim()) {
      return response(409, { ok: false, codigo: "certificado_indisponivel" })
    }

    // Revalida id+store, status, vigência, refs e disponibilidade do provider sem ler o segredo.
    const active = await resolveActiveCertificate({ storeId: acl.storeId })
    if (!active.ok || active.certificadoId !== config.certificadoAtivoId) {
      return response(409, { ok: false, codigo: "certificado_indisponivel" })
    }

    const selftest = await runA1DeploymentLoopbackSelftest({
      storeId: active.storeId,
      blobRef: active.blobRef,
      senhaRef: active.senhaRef,
    })
    if (!selftest.ok) {
      const listenerUnavailable = selftest.codigo === "listener_loopback_indisponivel"
      return response(listenerUnavailable ? 503 : 422, {
        ok: false,
        codigo: listenerUnavailable ? "listener_loopback_indisponivel" : "selftest_falhou",
        destination: "loopback",
        externalNetworkAttempted: false,
      })
    }
    const safeBody = {
      ok: true,
      codigo: "ok",
      storeCoerente: true,
      certificadoAtivo: true,
      materialResolvido: selftest.materialResolvido,
      secureContextOk: selftest.secureContextOk,
      clientCertificatePresented: selftest.clientCertificatePresented,
      mtlsLoopbackOk: selftest.mtlsLoopbackOk,
      destination: "loopback" as const,
      externalNetworkAttempted: false as const,
    }
    return response(200, safeBody)
  } catch {
    // Nunca propaga mensagem/stack do Prisma, vault, OpenSSL ou runtime TLS.
    return response(500, { ok: false, codigo: "selftest_falhou" })
  }
}
