import { createServer as createHttpsServer } from "node:https"
import { createServer as createTcpServer } from "node:net"
import type { AddressInfo, Server as NetServer, Socket } from "node:net"
import type { IncomingMessage, ServerResponse } from "node:http"
import { afterAll, afterEach, describe, expect, it, vi } from "vitest"
import { canonicalEnvRef } from "@/lib/fiscal/vault/fiscal-secret-vault"
import { scanForSecrets } from "@/lib/fiscal/vault/secret-scan"
import { loadA1MtlsMaterial } from "@/lib/fiscal/certificate/a1-mtls-material"
import { createTestMtlsPki } from "../__fixtures__/mtls-test-pki"
import type { SefazHttpsRuntimePorts } from "../sefaz-runtime-ports"
import {
  SEFAZ_WSDL_ACQUISITION_TARGETS,
  selectSefazWsdlTarget,
} from "./wsdl-acquisition-target"
import {
  WSDL_MAX_CONNECTION_TIMEOUT_MS,
  WSDL_MAX_RESPONSE_BYTES,
  WSDL_MAX_TOTAL_DEADLINE_MS,
  SefazWsdlAcquisition,
  boundWsdlDeadlines,
  contentTypeEvidencia,
  type SefazWsdlAcquisitionOutcome,
  type SefazWsdlAcquisitionRequest,
} from "./wsdl-acquisition"
import {
  consumeWsdlExecutionAuthority,
  createWsdlLoopbackTestAuthority,
  isWsdlExecutionAuthority,
  novoWsdlLoopbackTestProbe,
  type SefazWsdlExecutionAuthority,
  type SefazWsdlLoopbackTestProbe,
} from "./wsdl-execution-authority"
import { wsdlFixture } from "./__fixtures__/wsdl-fixtures"

const STORE = "store-wsdl-017"
const PFX_REF = canonicalEnvRef("pfx", STORE)
const SENHA_REF = canonicalEnvRef("senha", STORE)
const HOST_HOMOLOGACAO = "homologacao.nfce.fazenda.sp.gov.br"
const ESCOPO_PADRAO = {
  uf: "SP",
  ambiente: "HOMOLOGACAO",
  servico: "NFeStatusServico4",
  versao: "4.00",
} as const

const pki = createTestMtlsPki()

type Closable = { close: () => Promise<void> }
const running: Closable[] = []

afterEach(async () => {
  await Promise.all(running.splice(0).map((item) => item.close()))
  vi.unstubAllEnvs()
})

afterAll(() => {
  pki.clientPfx.fill(0)
  pki.wrongClientPfx.fill(0)
})

function pedido(overrides: Partial<SefazWsdlAcquisitionRequest> = {}): SefazWsdlAcquisitionRequest {
  return {
    uf: "SP",
    ambiente: "HOMOLOGACAO",
    servico: "NFeStatusServico4",
    certificate: { storeId: STORE, blobRef: PFX_REF, senhaRef: SENHA_REF },
    correlationId: "corr-wsdl-017",
    connectionTimeoutMs: 2_000,
    totalDeadlineMs: 5_000,
    ...overrides,
  }
}

function materialLoader(pfx = pki.clientPfx, passphrase = pki.clientPassphrase) {
  const env = {
    FISCAL_SECRET_PROVIDER: "env",
    [PFX_REF]: pfx.toString("base64"),
    [SENHA_REF]: passphrase,
  }
  return (refs: Parameters<typeof loadA1MtlsMaterial>[0]) => loadA1MtlsMaterial({ ...refs, env })
}

async function listen(server: NetServer): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => resolve())
  })
  return (server.address() as AddressInfo).port
}

function trackServer(server: NetServer): void {
  const sockets = new Set<Socket>()
  server.on("connection", (socket) => {
    sockets.add(socket)
    socket.once("close", () => sockets.delete(socket))
  })
  running.push({
    close: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  })
}

type ServerObservacao = {
  metodos: string[]
  urls: string[]
  corpos: string[]
}

async function startMtlsServer(
  handler: (response: ServerResponse, request: IncomingMessage) => void,
): Promise<{ port: number; hits: () => number; observado: ServerObservacao }> {
  let hitCount = 0
  const observado: ServerObservacao = { metodos: [], urls: [], corpos: [] }
  const server = createHttpsServer(
    {
      key: pki.serverPrivateKeyPem,
      cert: pki.serverCertificatePem,
      ca: pki.caCertificatePem,
      requestCert: true,
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
    },
    (request, response) => {
      hitCount += 1
      observado.metodos.push(request.method ?? "")
      observado.urls.push(request.url ?? "")
      const chunks: Buffer[] = []
      request.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
      request.on("end", () => {
        observado.corpos.push(Buffer.concat(chunks).toString("utf8"))
        handler(response, request)
      })
    },
  )
  server.on("tlsClientError", () => undefined)
  trackServer(server)
  return { port: await listen(server), hits: () => hitCount, observado }
}

async function startStalledTcpServer(): Promise<number> {
  // Aceita TCP e nunca inicia TLS: exercita o relógio de conexão/handshake isoladamente.
  const server = createTcpServer(() => undefined)
  trackServer(server)
  return listen(server)
}

function autoridade(
  port: number,
  options: {
    escopo?: typeof ESCOPO_PADRAO
    probe?: SefazWsdlLoopbackTestProbe
    withoutClientCertificate?: boolean
  } = {},
): SefazWsdlExecutionAuthority {
  return createWsdlLoopbackTestAuthority({
    port,
    trustedCaPem: pki.caCertificatePem,
    escopo: options.escopo ?? ESCOPO_PADRAO,
    probe: options.probe,
    withoutClientCertificate: options.withoutClientCertificate,
  })
}

function adquiridor(
  authority: SefazWsdlExecutionAuthority | undefined,
  loadMaterial = materialLoader(),
): SefazWsdlAcquisition {
  return new SefazWsdlAcquisition({ loadMaterial, executionAuthority: authority })
}

const WSDL_VALIDO = wsdlFixture()

describe("SefazWsdlAcquisition · sem autoridade a capability é inerte", () => {
  it("recusa antes de A1, TLS e socket quando nenhuma autoridade é fornecida", async () => {
    const loadMaterial = vi.fn(materialLoader())
    const acquisition = new SefazWsdlAcquisition({ loadMaterial })

    expect(acquisition.permiteRede).toBe(false)
    const outcome = await acquisition.acquire(pedido())
    expect(outcome).toMatchObject({
      ok: false,
      codigo: "wsdl_tentativa_nao_autorizada",
      classification: "BLOCKED_BEFORE_NETWORK",
      externalTransmissionAttempted: false,
    })
    expect(loadMaterial).not.toHaveBeenCalled()
  })

  it("informar um runtime explicitamente NÃO autoriza rede — vira conflito fail-closed", async () => {
    const runtime: SefazHttpsRuntimePorts = {
      createSecureContext: vi.fn(() => {
        throw new Error("não deveria criar TLS")
      }),
      request: vi.fn(() => {
        throw new Error("não deveria abrir socket")
      }),
    }
    const loadMaterial = vi.fn(materialLoader())
    const port = await startStalledTcpServer()
    const acquisition = new SefazWsdlAcquisition({
      loadMaterial,
      runtime,
      executionAuthority: autoridade(port),
    })

    expect(acquisition.permiteRede).toBe(false)
    const outcome = await acquisition.acquire(pedido())
    expect(outcome).toMatchObject({ ok: false, codigo: "wsdl_tentativa_nao_autorizada" })
    expect(runtime.request).not.toHaveBeenCalled()
    expect(runtime.createSecureContext).not.toHaveBeenCalled()
    expect(loadMaterial).not.toHaveBeenCalled()
  })

  it("a única fábrica de autoridade exige NODE_ENV=test — não existe caminho de produção", () => {
    const original = process.env.NODE_ENV
    try {
      vi.stubEnv("NODE_ENV", "production")
      expect(() =>
        createWsdlLoopbackTestAuthority({
          port: 4443,
          trustedCaPem: pki.caCertificatePem,
          escopo: ESCOPO_PADRAO,
        }),
      ).toThrow(/somente no ambiente de testes/i)
    } finally {
      vi.unstubAllEnvs()
      expect(process.env.NODE_ENV).toBe(original)
    }
  })

  it("token forjado ou clonado não é autoridade e não devolve runtime", () => {
    const forjado = Object.freeze({}) as SefazWsdlExecutionAuthority
    expect(isWsdlExecutionAuthority(forjado)).toBe(false)
    const alvo = SEFAZ_WSDL_ACQUISITION_TARGETS[0]!
    expect(consumeWsdlExecutionAuthority(forjado, { alvo, correlationId: "x" })).toBeNull()
  })

  it("autoridade é one-shot: a segunda tentativa não abre socket (sem retry automático)", async () => {
    const probe = novoWsdlLoopbackTestProbe()
    const { port } = await startMtlsServer((response) => {
      response.writeHead(200, { "Content-Type": "text/xml; charset=utf-8" })
      response.end(WSDL_VALIDO)
    })
    const acquisition = adquiridor(autoridade(port, { probe }))

    const primeira = await acquisition.acquire(pedido())
    expect(primeira.ok).toBe(true)

    const segunda = await acquisition.acquire(pedido())
    expect(segunda).toMatchObject({
      ok: false,
      codigo: "wsdl_tentativa_nao_autorizada",
      externalTransmissionAttempted: false,
    })
    expect(probe.nodeRequestCalls).toBe(1)
  })

  it("autoridade emitida para um serviço não autoriza outro", async () => {
    const probe = novoWsdlLoopbackTestProbe()
    const { port } = await startMtlsServer((response) => response.end(WSDL_VALIDO))
    const acquisition = adquiridor(autoridade(port, { probe }))

    const outroServico = await acquisition.acquire(pedido({ servico: "NFeAutorizacao4" }))
    expect(outroServico).toMatchObject({ ok: false, codigo: "wsdl_tentativa_nao_autorizada" })
    expect(probe.nodeRequestCalls).toBe(0)

    // Escopo divergente não consome a autoridade: o alvo correto ainda funciona.
    const correto = await acquisition.acquire(pedido())
    expect(correto.ok).toBe(true)
  })
})

describe("SefazWsdlAcquisition · destino é fechado antes de qualquer socket", () => {
  it("bloqueia PRODUCAO na primeira instrução, sem tocar cofre, TLS ou autoridade", async () => {
    const probe = novoWsdlLoopbackTestProbe()
    const loadMaterial = vi.fn(materialLoader())
    const { port } = await startMtlsServer((response) => response.end(WSDL_VALIDO))
    const acquisition = new SefazWsdlAcquisition({
      loadMaterial,
      executionAuthority: autoridade(port, { probe }),
    })

    const outcome = await acquisition.acquire(pedido({ ambiente: "PRODUCAO" }))
    expect(outcome).toMatchObject({
      ok: false,
      codigo: "wsdl_producao_bloqueada",
      classification: "BLOCKED_BEFORE_NETWORK",
      externalTransmissionAttempted: false,
    })
    expect(loadMaterial).not.toHaveBeenCalled()
    expect(probe.secureContextCalls).toBe(0)
    expect(probe.runtimeRequestCalls).toBe(0)

    // A autoridade sequer foi consumida: o alvo legítimo continua utilizável.
    expect((await acquisition.acquire(pedido())).ok).toBe(true)
  })

  it.each([
    ["serviço desconhecido", { servico: "NFeQualquerCoisa" }],
    ["outra UF", { uf: "RS" }],
    ["versão divergente", { versao: "3.10" }],
    ["correlationId vazio", { correlationId: "  " }],
    ["correlationId com CRLF", { correlationId: "a\r\nb" }],
  ])("recusa %s antes de abrir socket", async (_rotulo, patch: Partial<SefazWsdlAcquisitionRequest>) => {
    const probe = novoWsdlLoopbackTestProbe()
    const loadMaterial = vi.fn(materialLoader())
    const { port, hits } = await startMtlsServer((response) => response.end(WSDL_VALIDO))
    const acquisition = new SefazWsdlAcquisition({
      loadMaterial,
      executionAuthority: autoridade(port, { probe }),
    })

    const outcome = await acquisition.acquire(pedido(patch))
    expect(outcome).toMatchObject({
      ok: false,
      codigo: "wsdl_alvo_recusado",
      classification: "BLOCKED_BEFORE_NETWORK",
      externalTransmissionAttempted: false,
    })
    expect(loadMaterial).not.toHaveBeenCalled()
    expect(probe.runtimeRequestCalls).toBe(0)
    expect(hits()).toBe(0)
  })

  it("o host NF-e é inalcançável: não há entrada de catálogo nem parâmetro que o carregue", async () => {
    const probe = novoWsdlLoopbackTestProbe()
    const { port } = await startMtlsServer((response) => response.end(WSDL_VALIDO))
    const acquisition = adquiridor(autoridade(port, { probe }))

    // Campos de destino injetados no request são ignorados pelo contrato.
    const outcome = await acquisition.acquire({
      ...pedido(),
      ...({
        url: "https://nfe.fazenda.sp.gov.br/ws/NFeStatusServico4.asmx?wsdl",
        host: "nfe.fazenda.sp.gov.br",
        path: "/ws/NFeStatusServico4.asmx",
      } as object),
    })

    expect(outcome.ok).toBe(true)
    // O SNI efetivamente apresentado é sempre o host canônico de homologação.
    expect(probe.servernames).toEqual([HOST_HOMOLOGACAO])
    expect(probe.servernames).not.toContain("nfe.fazenda.sp.gov.br")
  })
})

describe("SefazWsdlAcquisition · a ferramenta só lê metadados", () => {
  it("emite GET em /ws/<Serviço>.asmx?wsdl e nunca envia corpo", async () => {
    const probe = novoWsdlLoopbackTestProbe()
    const { port, observado } = await startMtlsServer((response) => {
      response.writeHead(200, { "Content-Type": "text/xml; charset=utf-8" })
      response.end(WSDL_VALIDO)
    })
    const acquisition = adquiridor(autoridade(port, { probe }))

    const outcome = await acquisition.acquire(pedido())
    expect(outcome.ok).toBe(true)
    expect(acquisition.metodo).toBe("GET")
    expect(probe.methods).toEqual(["GET"])
    expect(probe.paths).toEqual(["/ws/NFeStatusServico4.asmx?wsdl"])
    expect(observado.metodos).toEqual(["GET"])
    expect(observado.urls).toEqual(["/ws/NFeStatusServico4.asmx?wsdl"])
    // Nenhum byte fiscal atravessa: não existe parâmetro de corpo neste módulo.
    expect(observado.corpos).toEqual([""])
  })

  it("devolve documento, sha256 e Content-Type como evidência — nunca como autoridade", async () => {
    const { port } = await startMtlsServer((response) => {
      // Content-Type deliberadamente "errado": não pode decidir a aceitação do documento.
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      response.end(WSDL_VALIDO)
    })
    const outcome = await adquiridor(autoridade(port)).acquire(pedido())

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.classification).toBe("RESPONSE_RECEIVED")
    expect(outcome.httpStatus).toBe(200)
    expect(outcome.contentTypeEvidencia).toBe("text/html; charset=utf-8")
    expect(outcome.byteLength).toBe(Buffer.byteLength(WSDL_VALIDO, "utf8"))
    expect(outcome.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(outcome.documento).toBe(WSDL_VALIDO)
    expect(outcome.alvo).toEqual({
      uf: "SP",
      ambiente: "HOMOLOGACAO",
      servico: "NFeStatusServico4",
      versao: "4.00",
    })
  })

  it("sanitiza a evidência de Content-Type", () => {
    expect(contentTypeEvidencia("text/xml\r\nX-Injected: 1")).toBe("text/xml X-Injected: 1")
    expect(contentTypeEvidencia(undefined)).toBeNull()
    expect(contentTypeEvidencia("   ")).toBeNull()
    expect(contentTypeEvidencia("a".repeat(500))?.length).toBe(128)
  })
})

describe("SefazWsdlAcquisition · desfechos de rede fail-closed", () => {
  it("recusa redirect sem seguir e sem nova tentativa", async () => {
    const probe = novoWsdlLoopbackTestProbe()
    const { port, hits } = await startMtlsServer((response) => {
      response.writeHead(302, { Location: "https://nfe.fazenda.sp.gov.br/ws/x.asmx?wsdl" })
      response.end()
    })
    const outcome = await adquiridor(autoridade(port, { probe })).acquire(pedido())

    expect(outcome).toMatchObject({
      ok: false,
      codigo: "wsdl_redirect_recusado",
      classification: "UNKNOWN_UNCERTAIN",
      externalTransmissionAttempted: true,
    })
    expect(hits()).toBe(1)
    expect(probe.nodeRequestCalls).toBe(1)
  })

  it("recusa corpo acima do limite durante o streaming", async () => {
    const excedente = Buffer.alloc(WSDL_MAX_RESPONSE_BYTES + 4_096, 0x78)
    const { port } = await startMtlsServer((response) => {
      response.writeHead(200, { "Content-Type": "text/xml" })
      response.end(excedente)
    })
    const outcome = await adquiridor(autoridade(port)).acquire(pedido())

    expect(outcome).toMatchObject({
      ok: false,
      codigo: "wsdl_resposta_excedida",
      classification: "UNKNOWN_UNCERTAIN",
      externalTransmissionAttempted: true,
    })
  })

  it("falha fechado no timeout de conexão/TLS", async () => {
    const port = await startStalledTcpServer()
    const outcome = await adquiridor(autoridade(port)).acquire(
      pedido({ connectionTimeoutMs: 300, totalDeadlineMs: 5_000 }),
    )
    expect(outcome).toMatchObject({
      ok: false,
      codigo: "wsdl_timeout_conexao",
      classification: "UNKNOWN_UNCERTAIN",
    })
  })

  it("falha fechado no deadline total quando a resposta não termina", async () => {
    const { port } = await startMtlsServer((response) => {
      response.writeHead(200, { "Content-Type": "text/xml" })
      response.write("<wsdl:definitions")
      // Nunca encerra: exercita o deadline total, não o de conexão.
    })
    const outcome = await adquiridor(autoridade(port)).acquire(
      pedido({ connectionTimeoutMs: 5_000, totalDeadlineMs: 400 }),
    )
    expect(outcome).toMatchObject({
      ok: false,
      codigo: "wsdl_deadline_total",
      classification: "UNKNOWN_UNCERTAIN",
    })
  })

  it("trata status não-2xx como incerto (inclui o 403 observado sem certificado)", async () => {
    const { port } = await startMtlsServer((response) => {
      response.writeHead(403, { "Content-Type": "text/html" })
      response.end("<html>Forbidden</html>")
    })
    const outcome = await adquiridor(autoridade(port)).acquire(pedido())
    expect(outcome).toMatchObject({ ok: false, codigo: "wsdl_http_incerto" })
  })

  it("recusa corpo vazio ou fora de UTF-8 estrito", async () => {
    const { port } = await startMtlsServer((response) => {
      response.writeHead(200, { "Content-Type": "text/xml" })
      response.end(Buffer.from([0xff, 0xfe, 0x00]))
    })
    const outcome = await adquiridor(autoridade(port)).acquire(pedido())
    expect(outcome).toMatchObject({ ok: false, codigo: "wsdl_corpo_ilegivel" })
  })

  it("falha fechado quando o material A1 é indisponível, sem abrir socket", async () => {
    const probe = novoWsdlLoopbackTestProbe()
    const { port, hits } = await startMtlsServer((response) => response.end(WSDL_VALIDO))
    const acquisition = new SefazWsdlAcquisition({
      loadMaterial: (refs) => loadA1MtlsMaterial({ ...refs, env: {} }),
      executionAuthority: autoridade(port, { probe }),
    })

    const outcome = await acquisition.acquire(pedido())
    expect(outcome).toMatchObject({
      ok: false,
      codigo: "wsdl_certificado_indisponivel",
      classification: "BLOCKED_BEFORE_NETWORK",
      externalTransmissionAttempted: false,
    })
    expect(probe.runtimeRequestCalls).toBe(0)
    expect(hits()).toBe(0)
  })

  it("sem certificado de cliente, o handshake mTLS falha e nada é dado por adquirido", async () => {
    const { port } = await startMtlsServer((response) => response.end(WSDL_VALIDO))
    const outcome = await adquiridor(
      autoridade(port, { withoutClientCertificate: true }),
    ).acquire(pedido())
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.codigo).toBe("wsdl_rede_incerta")
  })
})

describe("SefazWsdlAcquisition · tetos e sanitização", () => {
  it("o chamador não amplia os tetos fail-closed", () => {
    expect(boundWsdlDeadlines(999_999, 999_999)).toEqual({
      connectionTimeoutMs: WSDL_MAX_CONNECTION_TIMEOUT_MS,
      totalDeadlineMs: WSDL_MAX_TOTAL_DEADLINE_MS,
    })
    expect(boundWsdlDeadlines(-1, Number.NaN)).toEqual({
      connectionTimeoutMs: WSDL_MAX_CONNECTION_TIMEOUT_MS,
      totalDeadlineMs: WSDL_MAX_TOTAL_DEADLINE_MS,
    })
    expect(boundWsdlDeadlines(1_000, 2_000)).toEqual({
      connectionTimeoutMs: 1_000,
      totalDeadlineMs: 2_000,
    })
  })

  it("nenhum valor do A1 aparece em desfecho de sucesso ou de falha", async () => {
    const segredos = {
      senha: pki.clientPassphrase,
      pfxBytes: pki.clientPfx,
      privateKeyPem: pki.clientPrivateKeyPem,
    }
    const desfechos: SefazWsdlAcquisitionOutcome[] = []

    const sucesso = await startMtlsServer((response) => {
      response.writeHead(200, { "Content-Type": "text/xml" })
      response.end(WSDL_VALIDO)
    })
    desfechos.push(await adquiridor(autoridade(sucesso.port)).acquire(pedido()))

    const erroHttp = await startMtlsServer((response) => {
      response.writeHead(500)
      response.end("erro")
    })
    desfechos.push(await adquiridor(autoridade(erroHttp.port)).acquire(pedido()))

    desfechos.push(
      await new SefazWsdlAcquisition({
        loadMaterial: (refs) => loadA1MtlsMaterial({ ...refs, env: {} }),
        executionAuthority: autoridade(erroHttp.port),
      }).acquire(pedido()),
    )
    desfechos.push(await adquiridor(undefined).acquire(pedido()))
    desfechos.push(await adquiridor(autoridade(erroHttp.port)).acquire(pedido({ ambiente: "PRODUCAO" })))

    for (const desfecho of desfechos) {
      expect(scanForSecrets(JSON.stringify(desfecho), segredos).vazou).toBe(false)
      expect(scanForSecrets(desfecho, segredos).vazou).toBe(false)
    }
  })
})

describe("catálogo de aquisição × superfície SOAP", () => {
  it("todos os seis alvos são alcançáveis pela mesma tupla usada pelo transporte SOAP", () => {
    for (const alvo of SEFAZ_WSDL_ACQUISITION_TARGETS) {
      const lookup = selectSefazWsdlTarget({
        uf: alvo.uf,
        ambiente: alvo.ambiente,
        servico: alvo.servico,
        versao: alvo.versao,
      })
      expect(lookup.ok).toBe(true)
    }
    expect(SEFAZ_WSDL_ACQUISITION_TARGETS).toHaveLength(6)
  })
})
