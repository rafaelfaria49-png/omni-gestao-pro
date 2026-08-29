import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CANONICAL_VERCEL_PROJECT_ID } from "@/lib/deploy/canonical-deployment"
import { WSDL_CANONICAL_PRODUCTION_HOST } from "@/lib/fiscal/provider/sefaz/wsdl/wsdl-canonical-production-surface"

const STORE = "loja-1"
const CERT = "cert-1"
const CANONICAL_ORIGIN = `https://${WSDL_CANONICAL_PRODUCTION_HOST}`
const PREVIEW_ORIGIN = "https://omni-gestao-pro-git-goal-wsdl-preview-team.vercel.app"
const UNIQUE_DEPLOYMENT_ORIGIN = "https://omni-gestao-pro-8b84c7cad369cf62-team.vercel.app"
const LEGACY_ORIGIN = "https://omni-gestao-pi.vercel.app"
const LOCAL_ORIGIN = "http://localhost"

const h = vi.hoisted(() => {
  let store: { id: string } | null = { id: "loja-1" }
  let config: Record<string, unknown> | null = null
  const prisma = {
    store: { findUnique: vi.fn(async () => store) },
    configuracaoFiscalLoja: { findUnique: vi.fn(async () => config) },
  }
  return {
    prisma,
    prismaEnsureConnected: vi.fn(async () => undefined),
    storeResolver: vi.fn((): string | null => STORE),
    resolvePilot: vi.fn(),
    requireFiscalAdmin: vi.fn(),
    windowStatus: vi.fn(),
    consumeActivation: vi.fn(),
    resolveActiveCertificate: vi.fn(),
    loadSecureContext: vi.fn(),
    runBatch: vi.fn(),
    setStore: (value: { id: string } | null) => { store = value },
    setConfig: (value: Record<string, unknown> | null) => { config = value },
  }
})

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma, prismaEnsureConnected: h.prismaEnsureConnected }))
vi.mock("@/lib/store-id-from-request", () => ({
  storeIdFromAssistecRequestForWrite: h.storeResolver,
}))
vi.mock("@/lib/fiscal/guard-fiscal-admin", () => ({ requireFiscalAdmin: h.requireFiscalAdmin }))
vi.mock("@/lib/fiscal/certificate/resolve-active-certificate", () => ({
  resolveActiveCertificate: h.resolveActiveCertificate,
}))
vi.mock("@/lib/fiscal/certificate/a1-mtls-material", () => ({
  loadA1MtlsSecureContext: h.loadSecureContext,
}))
vi.mock("@/lib/fiscal/provider/sefaz/wsdl/wsdl-ephemeral-execution-window", () => ({
  configuredWsdlExecutionWindowStatus: h.windowStatus,
  consumeConfiguredWsdlExecutionActivation: h.consumeActivation,
}))
vi.mock("@/lib/fiscal/provider/sefaz/wsdl/wsdl-pilot-store-resolver", () => ({
  resolveWsdlPilotStore: h.resolvePilot,
}))
vi.mock("@/lib/fiscal/provider/sefaz/wsdl/wsdl-ephemeral-batch", () => ({
  runConfiguredWsdlEphemeralBatch: h.runBatch,
}))

import { POST } from "./route"

function fiscalConfig(overrides: Record<string, unknown> = {}) {
  return {
    storeId: STORE,
    ambiente: "HOMOLOGACAO",
    modeloFiscal: "NFCE",
    provider: "SEFAZ_DIRETO",
    fiscalEnabled: true,
    certificadoAtivoId: CERT,
    ...overrides,
  }
}

function request(
  query = "?storeId=loja-1",
  body?: BodyInit,
  headers?: HeadersInit,
  origin = CANONICAL_ORIGIN,
) {
  return new Request(`${origin}/api/fiscal/wsdl/ephemeral-execution${query}`, {
    method: "POST",
    headers: { "x-assistec-loja-id": STORE, ...headers },
    body,
    ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
  } as RequestInit & { duplex?: "half" })
}

function stubCanonicalProductionRuntime() {
  vi.stubEnv("VERCEL_ENV", "production")
  vi.stubEnv("VERCEL_PROJECT_ID", CANONICAL_VERCEL_PROJECT_ID)
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>
}

beforeEach(() => {
  vi.clearAllMocks()
  stubCanonicalProductionRuntime()
  h.setStore({ id: STORE })
  h.setConfig(fiscalConfig())
  h.storeResolver.mockReturnValue(STORE)
  h.resolvePilot.mockResolvedValue({ ok: true, storeId: STORE })
  h.windowStatus.mockReturnValue({
    active: true,
    window: {
      activationId: "hidden",
      notBefore: new Date("2026-08-13T12:00:00Z"),
      expiresAt: new Date("2026-08-13T12:10:00Z"),
    },
  })
  h.requireFiscalAdmin.mockResolvedValue({
    ok: true,
    storeId: STORE,
    session: { user: { id: "admin-1", role: "SUPER_ADMIN" } },
  })
  h.resolveActiveCertificate.mockResolvedValue({
    ok: true,
    storeId: STORE,
    certificadoId: CERT,
    blobRef: "REF_PFX_SECRETA",
    senhaRef: "REF_SENHA_SECRETA",
    provider: "env-piloto",
  })
  h.loadSecureContext.mockResolvedValue({})
  h.consumeActivation.mockResolvedValue({ ok: true, activation: {} })
  h.runBatch.mockResolvedValue({
    ok: true,
    code: "completed",
    services: [{
      service: "NFeStatusServico4",
      httpStatus: 200,
      byteLength: 123,
      sha256: "a".repeat(64),
      contentTypeEvidence: "text/xml",
      h9: true,
      h10: true,
      operation: "op",
      binding: "binding",
      soapAction: "action",
      inputWrapper: "input",
      inputNamespace: "namespace",
      outputWrapper: "output",
      outputNamespace: "namespace",
      failureClass: null,
    }],
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("POST /api/fiscal/wsdl/ephemeral-execution", () => {
  it("default dormente retorna 404 antes de ACL, Prisma, certificado, A1 e batch", async () => {
    h.windowStatus.mockReturnValue({ active: false, reason: "disabled" })

    const response = await POST(request("?storeId=loja-1&host=attacker.invalid", "segredo"))

    expect(response.status).toBe(404)
    expect(await json(response)).toEqual({ ok: false, code: "wsdl_execution_unavailable" })
    expect(h.requireFiscalAdmin).not.toHaveBeenCalled()
    expect(h.prismaEnsureConnected).not.toHaveBeenCalled()
    expect(h.resolveActiveCertificate).not.toHaveBeenCalled()
    expect(h.loadSecureContext).not.toHaveBeenCalled()
    expect(h.consumeActivation).not.toHaveBeenCalled()
    expect(h.runBatch).not.toHaveBeenCalled()
  })

  it("janela null/null/null continua 404 mesmo no Production canônico", async () => {
    h.windowStatus.mockReturnValue({ active: false, reason: "disabled" })

    const response = await POST(request())

    expect(response.status).toBe(404)
    expect(await json(response)).toEqual({ ok: false, code: "wsdl_execution_unavailable" })
    expect(h.requireFiscalAdmin).not.toHaveBeenCalled()
    expect(h.prismaEnsureConnected).not.toHaveBeenCalled()
    expect(h.resolveActiveCertificate).not.toHaveBeenCalled()
    expect(h.loadSecureContext).not.toHaveBeenCalled()
    expect(h.runBatch).not.toHaveBeenCalled()
  })

  it("Preview + janela válida é indisponível antes de ACL, Prisma, A1 e batch", async () => {
    vi.stubEnv("VERCEL_ENV", "preview")
    vi.stubEnv("VERCEL_PROJECT_ID", CANONICAL_VERCEL_PROJECT_ID)

    const response = await POST(request(
      "?storeId=loja-1",
      undefined,
      { "x-forwarded-host": WSDL_CANONICAL_PRODUCTION_HOST, host: WSDL_CANONICAL_PRODUCTION_HOST },
      PREVIEW_ORIGIN,
    ))

    expect(response.status).toBe(404)
    expect(await json(response)).toEqual({ ok: false, code: "wsdl_execution_unavailable" })
    expect(h.requireFiscalAdmin).not.toHaveBeenCalled()
    expect(h.prismaEnsureConnected).not.toHaveBeenCalled()
    expect(h.resolveActiveCertificate).not.toHaveBeenCalled()
    expect(h.loadSecureContext).not.toHaveBeenCalled()
    expect(h.consumeActivation).not.toHaveBeenCalled()
    expect(h.runBatch).not.toHaveBeenCalled()
  })

  it("URL única de deployment + janela válida é bloqueada antes de ACL/Prisma", async () => {
    const response = await POST(request("?storeId=loja-1", undefined, undefined, UNIQUE_DEPLOYMENT_ORIGIN))

    expect(response.status).toBe(404)
    expect(await json(response)).toEqual({ ok: false, code: "wsdl_execution_unavailable" })
    expect(h.requireFiscalAdmin).not.toHaveBeenCalled()
    expect(h.prismaEnsureConnected).not.toHaveBeenCalled()
    expect(h.runBatch).not.toHaveBeenCalled()
  })

  it("projeto/host legado + janela válida é bloqueado antes de ACL/Prisma", async () => {
    vi.stubEnv("VERCEL_ENV", "production")
    vi.stubEnv("VERCEL_PROJECT_ID", "prj_legacy_test_fixture")

    const response = await POST(request("?storeId=loja-1", undefined, undefined, LEGACY_ORIGIN))

    expect(response.status).toBe(404)
    expect(await json(response)).toEqual({ ok: false, code: "wsdl_execution_unavailable" })
    expect(h.requireFiscalAdmin).not.toHaveBeenCalled()
    expect(h.prismaEnsureConnected).not.toHaveBeenCalled()
    expect(h.runBatch).not.toHaveBeenCalled()
  })

  it("localhost/dev + janela válida é bloqueado antes de ACL/Prisma", async () => {
    vi.unstubAllEnvs()

    const response = await POST(request("?storeId=loja-1", undefined, undefined, LOCAL_ORIGIN))

    expect(response.status).toBe(404)
    expect(await json(response)).toEqual({ ok: false, code: "wsdl_execution_unavailable" })
    expect(h.requireFiscalAdmin).not.toHaveBeenCalled()
    expect(h.prismaEnsureConnected).not.toHaveBeenCalled()
    expect(h.runBatch).not.toHaveBeenCalled()
  })

  it("query/header com o host canônico não atravessa Preview", async () => {
    vi.stubEnv("VERCEL_ENV", "preview")
    vi.stubEnv("VERCEL_PROJECT_ID", CANONICAL_VERCEL_PROJECT_ID)

    const response = await POST(request(
      `?storeId=loja-1&host=${WSDL_CANONICAL_PRODUCTION_HOST}`,
      undefined,
      { "x-canonical-host": WSDL_CANONICAL_PRODUCTION_HOST },
      PREVIEW_ORIGIN,
    ))

    expect(response.status).toBe(404)
    expect(h.requireFiscalAdmin).not.toHaveBeenCalled()
    expect(h.runBatch).not.toHaveBeenCalled()
  })

  it("Production canônico + janela válida atravessa só a nova barreira e segue para ACL", async () => {
    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(h.requireFiscalAdmin).toHaveBeenCalledOnce()
    expect(h.prismaEnsureConnected).toHaveBeenCalledOnce()
    expect(h.runBatch).toHaveBeenCalledOnce()
  })

  it("não-admin é bloqueado antes de body, banco, certificado e consumo", async () => {
    h.requireFiscalAdmin.mockResolvedValue({ ok: false, status: 403, error: "denied" })
    const stream = new ReadableStream<Uint8Array>({ pull() {} })

    const response = await POST(request("?storeId=loja-1", stream))

    expect(response.status).toBe(403)
    expect(await json(response)).toEqual({ ok: false, code: "access_denied" })
    expect(h.prismaEnsureConnected).not.toHaveBeenCalled()
    expect(h.consumeActivation).not.toHaveBeenCalled()
  })

  it("exige loja explícita e somente a piloto RESOLVIDA", async () => {
    h.storeResolver.mockReturnValue(null)
    h.requireFiscalAdmin.mockResolvedValue({ ok: false, status: 400, error: "store" })
    expect((await POST(request(""))).status).toBe(400)
    expect(h.prismaEnsureConnected).not.toHaveBeenCalled()

    h.storeResolver.mockReturnValue("loja-2")
    h.requireFiscalAdmin.mockResolvedValue({
      ok: true,
      storeId: "loja-2",
      session: { user: { id: "admin" } },
    })
    expect((await POST(request("?storeId=loja-2"))).status).toBe(400)
    expect(h.prismaEnsureConnected).not.toHaveBeenCalled()
  })

  it.each([
    ["zero candidatas", { ok: false, code: "no_candidate" }],
    ["múltiplas candidatas (decisão humana)", { ok: false, code: "ambiguous" }],
    ["falha de leitura", { ok: false, code: "unavailable" }],
  ])("resolução da piloto: %s bloqueia antes de Prisma/consumo/batch", async (_label, result) => {
    h.resolvePilot.mockResolvedValue(result)
    const response = await POST(request())
    expect(response.status).toBe(409)
    expect(await json(response)).toEqual({ ok: false, code: "pilot_store_unresolved" })
    expect(h.prismaEnsureConnected).not.toHaveBeenCalled()
    expect(h.consumeActivation).not.toHaveBeenCalled()
    expect(h.runBatch).not.toHaveBeenCalled()
  })

  it("request autenticada de outra loja que a piloto resolvida é recusada", async () => {
    h.resolvePilot.mockResolvedValue({ ok: true, storeId: "loja-9" })
    const response = await POST(request())
    expect(response.status).toBe(400)
    expect(await json(response)).toEqual({ ok: false, code: "request_not_allowed" })
    expect(h.prismaEnsureConnected).not.toHaveBeenCalled()
    expect(h.consumeActivation).not.toHaveBeenCalled()
  })

  it.each([
    "?storeId=loja-1&url=https://attacker.invalid/x",
    "?storeId=loja-1&host=127.0.0.1",
    "?storeId=loja-1&port=443",
    "?storeId=loja-1&service=NFeStatusServico4",
    "?storeId=loja-1&count=7",
    "?storeId=loja-1&retry=1",
    "?storeId=loja-1&notBeforeUtc=2099-01-01T00:00:00Z",
    "?storeId=loja-1&storeId=loja-1",
    "?storeId=loja-2",
  ])("rejeita query controlável/ambígua antes de Prisma e consumo: %s", async (query) => {
    const response = await POST(request(query))
    expect(response.status).toBe(400)
    expect(await json(response)).toEqual({ ok: false, code: "request_not_allowed" })
    expect(h.prismaEnsureConnected).not.toHaveBeenCalled()
    expect(h.consumeActivation).not.toHaveBeenCalled()
  })

  it.each(["{}", " ", "pfx=abc", "password=abc"])(
    "rejeita qualquer payload efetivo antes de Prisma/A1: %s",
    async (body) => {
      const response = await POST(request("?storeId=loja-1", body))
      expect(response.status).toBe(400)
      expect(h.prismaEnsureConnected).not.toHaveBeenCalled()
      expect(h.runBatch).not.toHaveBeenCalled()
    },
  )

  it("aceita ReadableStream vazio sem materializar body ilimitado", async () => {
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.close() } })
    const response = await POST(request("?storeId=loja-1", stream))
    expect(response.status).toBe(200)
    expect(h.runBatch).toHaveBeenCalledOnce()
  })

  it("stream com erro falha fechado antes de Prisma", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.error(new Error("body hostil")) },
    })
    const response = await POST(request("?storeId=loja-1", stream))
    expect(response.status).toBe(400)
    expect(h.prismaEnsureConnected).not.toHaveBeenCalled()
    expect(h.runBatch).not.toHaveBeenCalled()
  })

  it("stream pendente sofre timeout bounded, é cancelado e não alcança Prisma", async () => {
    vi.useFakeTimers()
    const onCancel = vi.fn()
    try {
      const pending = POST(request(
        "?storeId=loja-1",
        new ReadableStream<Uint8Array>({ cancel: onCancel }),
      ))
      await vi.advanceTimersByTimeAsync(1_000)
      const response = await pending
      expect(response.status).toBe(400)
      expect(onCancel).toHaveBeenCalledOnce()
      expect(h.prismaEnsureConnected).not.toHaveBeenCalled()
      expect(h.runBatch).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    ["ambiente", { ambiente: "PRODUCAO" }],
    ["modelo", { modeloFiscal: "NFE" }],
    ["provider", { provider: "STUB_HOMOLOGACAO" }],
    ["fiscal disabled (regra resultante: exige true)", { fiscalEnabled: false }],
    ["certificado id", { certificadoAtivoId: null }],
    ["store divergente", { storeId: "loja-2" }],
  ])("preflight %s bloqueia antes de resolver/consumir/A1", async (_label, override) => {
    h.setConfig(fiscalConfig(override))
    const response = await POST(request())
    expect(response.status).toBe(409)
    expect(await json(response)).toEqual({ ok: false, code: "preflight_blocked" })
    expect(h.consumeActivation).not.toHaveBeenCalled()
    expect(h.runBatch).not.toHaveBeenCalled()
  })

  it.each(["not_started", "expired"])(
    "janela %s bloqueia antes de ACL, A1, ledger e batch",
    async (reason) => {
      h.windowStatus.mockReturnValue({ active: false, reason })

      const response = await POST(request())

      expect(response.status).toBe(404)
      expect(h.requireFiscalAdmin).not.toHaveBeenCalled()
      expect(h.loadSecureContext).not.toHaveBeenCalled()
      expect(h.consumeActivation).not.toHaveBeenCalled()
      expect(h.runBatch).not.toHaveBeenCalled()
    },
  )

  it("certificado ausente/inativo/refs ausentes colapsa antes do consumo", async () => {
    h.resolveActiveCertificate.mockResolvedValue({
      ok: false,
      codigo: "referencias_do_certificado_ausentes",
      mensagem: "não pública",
    })
    const response = await POST(request())
    expect(response.status).toBe(409)
    expect(await json(response)).toEqual({ ok: false, code: "preflight_blocked" })
    expect(h.loadSecureContext).not.toHaveBeenCalled()
    expect(h.consumeActivation).not.toHaveBeenCalled()
    expect(h.runBatch).not.toHaveBeenCalled()
  })

  it("PFX ou senha inválidos falham antes de criar job/log/dedupe e antes do batch", async () => {
    h.loadSecureContext.mockRejectedValue(new Error("OPENSSL PFX SENHA SEGREDO"))

    const response = await POST(request())

    expect(response.status).toBe(500)
    expect(await json(response)).toEqual({ ok: false, code: "wsdl_execution_failed" })
    expect(h.loadSecureContext).toHaveBeenCalledOnce()
    // O ledger só é alcançado por consumeActivation; logo não há job, log ou dedupe.
    expect(h.consumeActivation).not.toHaveBeenCalled()
    expect(h.runBatch).not.toHaveBeenCalled()
  })

  it("A1 válido é preparado antes do consume e o batch recebe o mesmo contexto", async () => {
    const preparedSecureContext = { marker: "opaque-test-context" }
    const activation = { marker: "one-shot-activation" }
    h.loadSecureContext.mockResolvedValue(preparedSecureContext)
    h.consumeActivation.mockResolvedValue({ ok: true, activation })

    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(h.loadSecureContext).toHaveBeenCalledOnce()
    expect(h.consumeActivation).toHaveBeenCalledOnce()
    expect(h.runBatch).toHaveBeenCalledWith(expect.objectContaining({
      activation,
      preparedSecureContext,
    }))
    expect(h.loadSecureContext.mock.invocationCallOrder[0]).toBeLessThan(
      h.consumeActivation.mock.invocationCallOrder[0]!,
    )
    expect(h.consumeActivation.mock.invocationCallOrder[0]).toBeLessThan(
      h.runBatch.mock.invocationCallOrder[0]!,
    )
  })

  it("conflito persistente/cold start bloqueia antes do batch", async () => {
    h.consumeActivation.mockResolvedValue({
      ok: false,
      code: "already_consumed_or_persistence_unavailable",
    })
    const response = await POST(request())
    expect(response.status).toBe(409)
    expect(await json(response)).toEqual({ ok: false, code: "activation_unavailable" })
    expect(h.loadSecureContext).toHaveBeenCalledOnce()
    expect(h.loadSecureContext.mock.invocationCallOrder[0]).toBeLessThan(
      h.consumeActivation.mock.invocationCallOrder[0]!,
    )
    expect(h.runBatch).not.toHaveBeenCalled()
  })

  it("duas requisições concorrentes com A1 válido deixam somente uma avançar ao batch", async () => {
    let consumed = false
    h.consumeActivation.mockImplementation(async () => {
      if (consumed) return { ok: false, code: "already_consumed_or_persistence_unavailable" }
      consumed = true
      return { ok: true, activation: { marker: "winner" } }
    })

    const responses = await Promise.all([POST(request()), POST(request())])

    expect(responses.map((item) => item.status).sort()).toEqual([200, 409])
    expect(h.loadSecureContext).toHaveBeenCalledTimes(2)
    expect(h.consumeActivation).toHaveBeenCalledTimes(2)
    expect(h.runBatch).toHaveBeenCalledOnce()
  })

  it("resposta pública preserva só evidência sanitizada e nunca refs/A1", async () => {
    const response = await POST(request())
    const body = await json(response)
    const serialized = JSON.stringify(body)
    expect(response.status).toBe(200)
    expect(serialized).not.toContain("REF_PFX_SECRETA")
    expect(serialized).not.toContain("REF_SENHA_SECRETA")
    expect(serialized).not.toContain("activationId")
    expect(serialized).not.toContain("documento")
  })

  it("exceções de Prisma/vault/TLS são colapsadas sem mensagem", async () => {
    h.runBatch.mockRejectedValue(new Error("OPENSSL VAULT PRISMA SEGREDO"))
    const response = await POST(request())
    expect(response.status).toBe(500)
    expect(await json(response)).toEqual({ ok: false, code: "wsdl_execution_failed" })
    expect(h.loadSecureContext).toHaveBeenCalledOnce()
    expect(h.consumeActivation).toHaveBeenCalledOnce()
    expect(h.runBatch).toHaveBeenCalledOnce()
  })
})
