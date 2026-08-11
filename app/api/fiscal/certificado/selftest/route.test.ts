import { beforeEach, describe, expect, it, vi } from "vitest"

const STORE = "loja-1"
const CERT = "cert-ativo-1"

const h = vi.hoisted(() => {
  const requireFiscalAdmin = vi.fn()
  const resolveActiveCertificate = vi.fn()
  const runSelftest = vi.fn()
  const prismaEnsureConnected = vi.fn(async () => undefined)
  let store: { id: string } | null = { id: "loja-1" }
  let config: Record<string, unknown> | null = null

  const prisma = {
    store: {
      findUnique: vi.fn(async () => store),
    },
    configuracaoFiscalLoja: {
      findUnique: vi.fn(async () => config),
    },
  }
  return {
    prisma,
    prismaEnsureConnected,
    requireFiscalAdmin,
    resolveActiveCertificate,
    runSelftest,
    setStore: (value: { id: string } | null) => {
      store = value
    },
    setConfig: (value: Record<string, unknown> | null) => {
      config = value
    },
  }
})

vi.mock("@/lib/prisma", () => ({
  prisma: h.prisma,
  prismaEnsureConnected: h.prismaEnsureConnected,
}))
vi.mock("@/lib/store-id-from-request", () => ({
  storeIdFromAssistecRequestForWrite: vi.fn(() => STORE),
}))
vi.mock("@/lib/fiscal/guard-fiscal-admin", () => ({
  requireFiscalAdmin: h.requireFiscalAdmin,
}))
vi.mock("@/lib/fiscal/certificate/resolve-active-certificate", () => ({
  resolveActiveCertificate: h.resolveActiveCertificate,
}))
vi.mock("@/lib/fiscal/certificate/a1-deployment-loopback-selftest", () => ({
  runA1DeploymentLoopbackSelftest: h.runSelftest,
}))

import { POST } from "./route"

function config(overrides: Record<string, unknown> = {}) {
  return {
    storeId: STORE,
    ambiente: "HOMOLOGACAO",
    modeloFiscal: "NFCE",
    fiscalEnabled: false,
    certificadoAtivoId: CERT,
    ...overrides,
  }
}

function request(body?: unknown, query = "") {
  return new Request(`http://localhost/api/fiscal/certificado/selftest${query}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-assistec-loja-id": STORE },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.FISCAL_A1_OFFLINE_SELFTEST_ENABLED = "true"
  h.setStore({ id: STORE })
  h.setConfig(config())
  h.requireFiscalAdmin.mockResolvedValue({
    ok: true,
    session: { user: { id: "admin-1", role: "SUPER_ADMIN" } },
    storeId: STORE,
  })
  h.resolveActiveCertificate.mockResolvedValue({
    ok: true,
    storeId: STORE,
    certificadoId: CERT,
    blobRef: "FISCAL_A1_PFX_B64_LOJA_1",
    senhaRef: "FISCAL_A1_SENHA_LOJA_1",
    provider: "env-piloto",
  })
  h.runSelftest.mockResolvedValue({
    ok: true,
    codigo: "ok",
    materialResolvido: true,
    secureContextOk: true,
    clientCertificatePresented: true,
    mtlsLoopbackOk: true,
    destination: "loopback",
    externalNetworkAttempted: false,
    listenerClosed: true,
    materialDisposed: true,
  })
})

describe("POST /api/fiscal/certificado/selftest", () => {
  it("feature flag desligada responde 404 antes de ACL, banco, provider e material", async () => {
    delete process.env.FISCAL_A1_OFFLINE_SELFTEST_ENABLED
    const res = await POST(request({ senha: "nao-deve-ser-lida" }))
    expect(res.status).toBe(404)
    expect(await json(res)).toEqual({ ok: false, codigo: "selftest_indisponivel" })
    expect(h.requireFiscalAdmin).not.toHaveBeenCalled()
    expect(h.prismaEnsureConnected).not.toHaveBeenCalled()
    expect(h.resolveActiveCertificate).not.toHaveBeenCalled()
    expect(h.runSelftest).not.toHaveBeenCalled()
  })

  it("não-admin é bloqueado antes do banco e material", async () => {
    h.requireFiscalAdmin.mockResolvedValue({ ok: false, status: 403, error: "Apenas ADMIN" })
    const res = await POST(request())
    expect(res.status).toBe(403)
    expect(await json(res)).toEqual({ ok: false, codigo: "acesso_negado" })
    expect(h.prismaEnsureConnected).not.toHaveBeenCalled()
    expect(h.resolveActiveCertificate).not.toHaveBeenCalled()
    expect(h.runSelftest).not.toHaveBeenCalled()
  })

  it("store divergente bloqueia antes do resolver/material", async () => {
    h.setStore({ id: "loja-2" })
    const res = await POST(request())
    expect(res.status).toBe(409)
    expect(await json(res)).toEqual({ ok: false, codigo: "store_ou_configuracao_incoerente" })
    expect(h.resolveActiveCertificate).not.toHaveBeenCalled()
    expect(h.runSelftest).not.toHaveBeenCalled()
  })

  it("fiscalEnabled=true bloqueia antes do resolver/material", async () => {
    h.setConfig(config({ fiscalEnabled: true }))
    const res = await POST(request())
    expect(res.status).toBe(409)
    expect(await json(res)).toEqual({ ok: false, codigo: "preflight_fiscal_bloqueado" })
    expect(h.resolveActiveCertificate).not.toHaveBeenCalled()
    expect(h.runSelftest).not.toHaveBeenCalled()
  })

  it("ambiente/modelo fora de HOMOLOGACAO/NFCE bloqueiam", async () => {
    h.setConfig(config({ ambiente: "PRODUCAO", modeloFiscal: "NFE" }))
    const res = await POST(request())
    expect(res.status).toBe(409)
    expect(h.runSelftest).not.toHaveBeenCalled()
  })

  it("certificadoAtivoId ausente bloqueia", async () => {
    h.setConfig(config({ certificadoAtivoId: null }))
    const res = await POST(request())
    expect(res.status).toBe(409)
    expect(await json(res)).toEqual({ ok: false, codigo: "certificado_indisponivel" })
    expect(h.resolveActiveCertificate).not.toHaveBeenCalled()
  })

  it.each([
    "certificado_ativo_indisponivel",
    "certificado_inativo",
    "referencias_do_certificado_ausentes",
  ])("resolver %s é colapsado antes do material", async (codigo) => {
    h.resolveActiveCertificate.mockResolvedValue({ ok: false, codigo, mensagem: "sanitizada" })
    const res = await POST(request())
    expect(res.status).toBe(409)
    expect(await json(res)).toEqual({ ok: false, codigo: "certificado_indisponivel" })
    expect(h.runSelftest).not.toHaveBeenCalled()
  })

  it.each(["url", "hostname", "ip", "porta", "pfx", "senha", "blobRef", "senhaRef", "pem"])(
    "recusa parâmetro de transporte/material %s antes do resolver",
    async (campo) => {
      const res = await POST(request({ [campo]: "segredo-ou-destino-sentinela" }))
      expect(res.status).toBe(400)
      expect(await json(res)).toEqual({ ok: false, codigo: "parametros_nao_permitidos" })
      expect(h.resolveActiveCertificate).not.toHaveBeenCalled()
      expect(h.runSelftest).not.toHaveBeenCalled()
    },
  )

  it("recusa query não canônica e não permite retargeting", async () => {
    const res = await POST(request(undefined, "?storeId=loja-1&url=https://externo.invalid"))
    expect(res.status).toBe(400)
    expect(h.runSelftest).not.toHaveBeenCalled()
  })

  it("recusa seletores de loja conflitantes mesmo quando a ACL resolveu outra loja", async () => {
    const res = await POST(request(undefined, "?storeId=loja-1&lojaId=loja-2"))
    expect(res.status).toBe(400)
    expect(h.resolveActiveCertificate).not.toHaveBeenCalled()
    expect(h.runSelftest).not.toHaveBeenCalled()
  })

  it("sucesso projeta somente metadados sanitizados e loopback", async () => {
    const res = await POST(request())
    const body = await json(res)
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(body).toEqual({
      ok: true,
      codigo: "ok",
      storeCoerente: true,
      certificadoAtivo: true,
      materialResolvido: true,
      secureContextOk: true,
      clientCertificatePresented: true,
      mtlsLoopbackOk: true,
      destination: "loopback",
      externalNetworkAttempted: false,
    })
    expect(JSON.stringify(body)).not.toContain("FISCAL_A1_")
    expect(h.runSelftest).toHaveBeenCalledWith({
      storeId: STORE,
      blobRef: "FISCAL_A1_PFX_B64_LOJA_1",
      senhaRef: "FISCAL_A1_SENHA_LOJA_1",
    })
  })

  it("falhas criptográficas diferentes viram o mesmo código público", async () => {
    h.runSelftest.mockResolvedValue({
      ok: false,
      codigo: "material_ou_tls_invalido",
      materialResolvido: true,
      secureContextOk: false,
      clientCertificatePresented: false,
      mtlsLoopbackOk: false,
      destination: "loopback",
      externalNetworkAttempted: false,
      listenerClosed: true,
      materialDisposed: true,
    })
    const res = await POST(request())
    expect(res.status).toBe(422)
    expect(await json(res)).toEqual({
      ok: false,
      codigo: "selftest_falhou",
      destination: "loopback",
      externalNetworkAttempted: false,
    })
  })

  it("expÃµe apenas a indisponibilidade sanitizada do listener local", async () => {
    h.runSelftest.mockResolvedValue({
      ok: false,
      codigo: "listener_loopback_indisponivel",
      materialResolvido: true,
      secureContextOk: true,
      clientCertificatePresented: false,
      mtlsLoopbackOk: false,
      destination: "loopback",
      externalNetworkAttempted: false,
      listenerClosed: true,
      materialDisposed: true,
    })
    const res = await POST(request())
    expect(res.status).toBe(503)
    expect(await json(res)).toEqual({
      ok: false,
      codigo: "listener_loopback_indisponivel",
      destination: "loopback",
      externalNetworkAttempted: false,
    })
  })

  it("erro inesperado não vaza mensagem de secret/runtime", async () => {
    const secret = "senha-nativa-nao-pode-vazar"
    h.runSelftest.mockRejectedValue(new Error(secret))
    const res = await POST(request())
    const body = await json(res)
    expect(res.status).toBe(500)
    expect(body).toEqual({ ok: false, codigo: "selftest_falhou" })
    expect(JSON.stringify(body)).not.toContain(secret)
  })
})
