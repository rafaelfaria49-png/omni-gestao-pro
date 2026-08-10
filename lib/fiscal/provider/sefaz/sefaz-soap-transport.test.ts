import { createServer as createHttpsServer, request as httpsRequest } from "node:https"
import { createServer as createTcpServer } from "node:net"
import { createSecureContext } from "node:tls"
import type { AddressInfo } from "node:net"
import type { ServerResponse } from "node:http"
import type { Server as NetServer, Socket } from "node:net"
import { afterAll, afterEach, describe, expect, it, vi } from "vitest"
import { canonicalEnvRef } from "@/lib/fiscal/vault/fiscal-secret-vault"
import { scanForSecrets } from "@/lib/fiscal/vault/secret-scan"
import { loadA1MtlsMaterial } from "@/lib/fiscal/certificate/a1-mtls-material"
import { createTestMtlsPki } from "./__fixtures__/mtls-test-pki"
import { SEFAZ_ENDPOINT_CATALOG, selectSefazEndpoint } from "./sefaz-endpoint-catalog"
import {
  createOfflineLoopbackTestOneShotAttemptPort,
  type SefazHttpsRuntimePorts,
} from "./sefaz-runtime-ports"
import {
  SEFAZ_HTTPS_MAX_RESPONSE_BYTES,
  SEFAZ_MAX_CONNECTION_TIMEOUT_MS,
  SEFAZ_MAX_TOTAL_DEADLINE_MS,
  SefazSoapTransport,
  boundSefazTransportDeadlines,
} from "./sefaz-soap-transport"
import type { SefazTransportRequest } from "./sefaz-transport.types"

const STORE = "store-mtls-offline"
const PFX_REF = canonicalEnvRef("pfx", STORE)
const SENHA_REF = canonicalEnvRef("senha", STORE)
const pki = createTestMtlsPki()

type Closable = { close: () => Promise<void> }
const running: Closable[] = []

afterEach(async () => {
  await Promise.all(running.splice(0).map((item) => item.close()))
})

afterAll(() => {
  pki.clientPfx.fill(0)
  pki.wrongClientPfx.fill(0)
})

function homologEndpoint() {
  const selected = selectSefazEndpoint({
    uf: "SP",
    ambiente: "HOMOLOGACAO",
    servico: "NFeStatusServico4",
  })
  if (!selected.ok) throw new Error("catálogo de homologação ausente")
  return selected.endpoint
}

function requestInput(overrides: Partial<SefazTransportRequest> = {}): SefazTransportRequest {
  return {
    endpoint: homologEndpoint(),
    contentType: "application/soap+xml; charset=utf-8",
    bodyBytes: Buffer.from("<offline-test/>", "utf8"),
    correlationId: "corr-mtls-offline-003",
    certificate: { storeId: STORE, blobRef: PFX_REF, senhaRef: SENHA_REF },
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
  return (refs: Parameters<typeof loadA1MtlsMaterial>[0]) =>
    loadA1MtlsMaterial({ ...refs, env })
}

type LocalRuntimeOptions = {
  port: number
  trustedCaPem?: string
  withoutClientCertificate?: boolean
  calls?: { count: number; destinations: string[] }
  onDestroy?: () => void
}

function localRuntime(options: LocalRuntimeOptions): SefazHttpsRuntimePorts {
  return {
    createSecureContext: (tlsOptions) =>
      createSecureContext({
        ...tlsOptions,
        ...(options.withoutClientCertificate ? { pfx: undefined, passphrase: undefined } : {}),
        ca: options.trustedCaPem ?? pki.caCertificatePem,
      }),
    request: (requestOptions, onResponse) => {
      if (options.calls) {
        options.calls.count += 1
        options.calls.destinations.push(`127.0.0.1:${options.port}`)
      }
      // Único desvio dos testes: conexão física loopback. Host lógico/SNI continuam sendo o
      // endpoint oficial já validado, portanto nenhum DNS nem pacote externo é emitido.
      const clientRequest = httpsRequest(
        {
          ...requestOptions,
          hostname: "127.0.0.1",
          port: options.port,
          servername: pki.serverName,
        },
        onResponse,
      )
      if (options.onDestroy) {
        const destroy = clientRequest.destroy.bind(clientRequest)
        clientRequest.destroy = ((error?: Error) => {
          options.onDestroy?.()
          return destroy(error)
        }) as typeof clientRequest.destroy
      }
      return clientRequest
    },
  }
}

async function listen(server: NetServer): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => resolve())
  })
  return (server.address() as AddressInfo).port
}

function trackServer(server: NetServer): Closable {
  const sockets = new Set<Socket>()
  server.on("connection", (socket) => {
    sockets.add(socket)
    socket.once("close", () => sockets.delete(socket))
  })
  const closable = {
    close: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
  running.push(closable)
  return closable
}

async function startMtlsServer(
  handler: (response: ServerResponse, requestHeaders: Record<string, string | string[] | undefined>) => void,
  options: {
    trustedServer?: boolean
    minVersion?: "TLSv1" | "TLSv1.1" | "TLSv1.2" | "TLSv1.3"
    maxVersion?: "TLSv1" | "TLSv1.1" | "TLSv1.2" | "TLSv1.3"
  } = {},
): Promise<{ port: number; hits: () => number }> {
  let hitCount = 0
  const trusted = options.trustedServer !== false
  const server = createHttpsServer(
    {
      key: trusted ? pki.serverPrivateKeyPem : pki.wrongServerPrivateKeyPem,
      cert: trusted ? pki.serverCertificatePem : pki.wrongServerCertificatePem,
      ca: pki.caCertificatePem,
      requestCert: true,
      rejectUnauthorized: true,
      minVersion: options.minVersion,
      maxVersion: options.maxVersion,
    },
    (request, response) => {
      hitCount += 1
      handler(response, request.headers)
    },
  )
  server.on("tlsClientError", () => undefined)
  trackServer(server)
  return { port: await listen(server), hits: () => hitCount }
}

async function startStalledTcpServer(): Promise<number> {
  const server = createTcpServer(() => {
    // Aceita TCP e não inicia TLS: prova o relógio de conexão/handshake separadamente.
  })
  trackServer(server)
  return listen(server)
}

function transport(port: number, runtimeOptions: Omit<LocalRuntimeOptions, "port"> = {}) {
  return new SefazSoapTransport({
    loadMaterial: materialLoader(),
    runtime: localRuntime({ port, ...runtimeOptions }),
    attemptPort: createOfflineLoopbackTestOneShotAttemptPort(),
  })
}

describe("SefazSoapTransport · gates antes de segredo/TLS/socket", () => {
  it("bloqueia PRODUCAO antes de carregar PFX, resolver senha, criar TLS ou request", async () => {
    const production = SEFAZ_ENDPOINT_CATALOG.find(
      (entry) => entry.ambiente === "PRODUCAO" && entry.servico === "NFeStatusServico4",
    )
    if (!production) throw new Error("entrada explícita de produção ausente")

    const loadPfx = vi.fn()
    const resolvePassword = vi.fn()
    const loadMaterial = vi.fn(async () => {
      loadPfx()
      resolvePassword()
      return loadA1MtlsMaterial({
        storeId: STORE,
        blobRef: PFX_REF,
        senhaRef: SENHA_REF,
        env: {},
      })
    })
    const runtime: SefazHttpsRuntimePorts = {
      createSecureContext: vi.fn(() => {
        throw new Error("não deveria criar TLS")
      }),
      request: vi.fn(() => {
        throw new Error("não deveria abrir socket")
      }),
    }

    const outcome = await new SefazSoapTransport({ loadMaterial, runtime }).send(
      requestInput({ endpoint: production }),
    )
    expect(outcome).toMatchObject({
      ok: false,
      codigo: "transporte_producao_bloqueada",
      classification: "BLOCKED_BEFORE_NETWORK",
      externalTransmissionAttempted: false,
    })
    expect(loadMaterial).not.toHaveBeenCalled()
    expect(loadPfx).not.toHaveBeenCalled()
    expect(resolvePassword).not.toHaveBeenCalled()
    expect(runtime.createSecureContext).not.toHaveBeenCalled()
    expect(runtime.request).not.toHaveBeenCalled()
  })

  it("recusa URL forjada mesmo com tupla homologação válida", async () => {
    const loadMaterial = vi.fn(materialLoader())
    const runtime: SefazHttpsRuntimePorts = {
      createSecureContext: vi.fn(() => {
        throw new Error("não deveria criar TLS")
      }),
      request: vi.fn(() => {
        throw new Error("não deveria abrir socket")
      }),
    }
    const forged = { ...homologEndpoint(), url: "https://127.0.0.1/roubo", host: "127.0.0.1" }
    const outcome = await new SefazSoapTransport({ loadMaterial, runtime }).send(
      requestInput({ endpoint: forged }),
    )
    expect(outcome).toMatchObject({
      ok: false,
      codigo: "transporte_destino_recusado",
      externalTransmissionAttempted: false,
    })
    expect(loadMaterial).not.toHaveBeenCalled()
    expect(runtime.request).not.toHaveBeenCalled()
  })

  it("sem wiring explícito da capability one-shot permanece offline antes do A1 e socket", async () => {
    const loadMaterial = vi.fn(materialLoader())
    const runtime: SefazHttpsRuntimePorts = {
      createSecureContext: vi.fn(() => {
        throw new Error("não deveria criar TLS")
      }),
      request: vi.fn(() => {
        throw new Error("não deveria abrir socket")
      }),
    }
    const transportWithoutCapability = new SefazSoapTransport({ loadMaterial, runtime })
    const outcome = await transportWithoutCapability.send(requestInput())
    expect(transportWithoutCapability.permiteRede).toBe(false)
    expect(outcome).toMatchObject({
      ok: false,
      codigo: "transporte_tentativa_nao_autorizada",
      classification: "BLOCKED_BEFORE_NETWORK",
      externalTransmissionAttempted: false,
    })
    expect(loadMaterial).not.toHaveBeenCalled()
    expect(runtime.createSecureContext).not.toHaveBeenCalled()
    expect(runtime.request).not.toHaveBeenCalled()
  })
})

describe("SefazSoapTransport · mTLS ponta a ponta exclusivamente loopback", () => {
  it("cliente válido negocia mTLS/TLS >=1.2 e não envia headers proibidos", async () => {
    let capturedHeaders: Record<string, string | string[] | undefined> = {}
    const server = await startMtlsServer((response, headers) => {
      capturedHeaders = headers
      response.writeHead(200, { "Content-Type": "application/xml" })
      response.end("<local-only/>")
    }, { minVersion: "TLSv1.2" })
    const calls = { count: 0, destinations: [] as string[] }

    const outcome = await transport(server.port, { calls }).send(requestInput())
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error(outcome.codigo)
    expect(Buffer.from(outcome.bodyBytes).toString("utf8")).toBe("<local-only/>")
    expect(server.hits()).toBe(1)
    expect(calls).toEqual({ count: 1, destinations: [`127.0.0.1:${server.port}`] })
    expect(capturedHeaders.authorization).toBeUndefined()
    expect(capturedHeaders.cookie).toBeUndefined()
    expect(capturedHeaders.soapaction).toBeUndefined()
  })

  it("falha fechado sem certificado de cliente", async () => {
    const server = await startMtlsServer((response) => response.end("não deveria chegar"))
    const outcome = await transport(server.port, { withoutClientCertificate: true }).send(
      requestInput(),
    )
    expect(outcome).toMatchObject({
      ok: false,
      codigo: "transporte_rede_incerta",
      classification: "UNKNOWN_UNCERTAIN",
    })
    expect(server.hits()).toBe(0)
  })

  it("falha fechado com certificado cliente não confiável", async () => {
    const server = await startMtlsServer((response) => response.end("não deveria chegar"))
    const outcome = await new SefazSoapTransport({
      loadMaterial: materialLoader(pki.wrongClientPfx, pki.wrongClientPassphrase),
      runtime: localRuntime({ port: server.port }),
      attemptPort: createOfflineLoopbackTestOneShotAttemptPort(),
    }).send(requestInput())
    expect(outcome).toMatchObject({ ok: false, classification: "UNKNOWN_UNCERTAIN" })
    expect(server.hits()).toBe(0)
  })

  it("falha fechado quando o certificado do servidor não é confiável", async () => {
    const server = await startMtlsServer((response) => response.end("não deveria chegar"), {
      trustedServer: false,
    })
    const outcome = await transport(server.port).send(requestInput())
    expect(outcome).toMatchObject({ ok: false, classification: "UNKNOWN_UNCERTAIN" })
    expect(server.hits()).toBe(0)
  })

  it("recusa servidor limitado a TLS 1.1", async () => {
    const server = await startMtlsServer((response) => response.end("não deveria chegar"), {
      minVersion: "TLSv1",
      maxVersion: "TLSv1.1",
    })
    const outcome = await transport(server.port).send(requestInput())
    expect(outcome).toMatchObject({ ok: false, classification: "UNKNOWN_UNCERTAIN" })
    expect(server.hits()).toBe(0)
  })

  it("erros e outcomes não serializam PFX, senha ou private key", async () => {
    const server = await startMtlsServer((response) => response.end("não deveria chegar"), {
      trustedServer: false,
    })
    const outcome = await transport(server.port).send(requestInput())
    expect(
      scanForSecrets(outcome, {
        senha: pki.clientPassphrase,
        pfxBytes: pki.clientPfx,
        privateKeyPem: pki.clientPrivateKeyPem,
      }),
    ).toEqual({ vazou: false, ocorrencias: [] })
  })
})

describe("SefazSoapTransport · limites, relógios e tentativa única", () => {
  it("impõe tetos absolutos de 15 s para conexão e 60 s para o ciclo total", () => {
    expect(boundSefazTransportDeadlines(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)).toEqual({
      connectionTimeoutMs: SEFAZ_MAX_CONNECTION_TIMEOUT_MS,
      totalDeadlineMs: SEFAZ_MAX_TOTAL_DEADLINE_MS,
    })
    expect(boundSefazTransportDeadlines(321, 654)).toEqual({
      connectionTimeoutMs: 321,
      totalDeadlineMs: 654,
    })
  })

  it("aceita resposta abaixo de 2 MiB", async () => {
    const body = Buffer.alloc(256 * 1024, 0x61)
    const server = await startMtlsServer((response) => response.end(body))
    const outcome = await transport(server.port).send(requestInput())
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.bodyBytes.byteLength).toBe(body.length)
  })

  it("aborta acima de 2 MiB durante streaming", async () => {
    const chunk = Buffer.alloc(64 * 1024, 0x62)
    let bytesWritten = 0
    let destroyCalls = 0
    const target = SEFAZ_HTTPS_MAX_RESPONSE_BYTES + 1024 * 1024
    const server = await startMtlsServer((response) => {
      const writeNext = () => {
        if (response.destroyed || bytesWritten >= target) {
          if (!response.destroyed) response.end()
          return
        }
        bytesWritten += chunk.length
        response.write(chunk)
        setImmediate(writeNext)
      }
      writeNext()
    })
    const outcome = await transport(server.port, {
      onDestroy: () => {
        destroyCalls += 1
      },
    }).send(requestInput())
    expect(outcome).toMatchObject({
      ok: false,
      codigo: "transporte_resposta_excedida",
      classification: "UNKNOWN_UNCERTAIN",
    })
    expect(bytesWritten).toBeGreaterThan(SEFAZ_HTTPS_MAX_RESPONSE_BYTES)
    expect(destroyCalls).toBeGreaterThan(0)
  })

  it.each([301, 302, 307, 308])("não segue redirect HTTP %i", async (status) => {
    let redirectTargetHits = 0
    const redirectTarget = await startMtlsServer((response) => {
      redirectTargetHits += 1
      response.end("não deveria alcançar")
    })
    const source = await startMtlsServer((response) => {
      response.writeHead(status, { Location: `https://127.0.0.1:${redirectTarget.port}/target` })
      response.end()
    })
    const calls = { count: 0, destinations: [] as string[] }
    const outcome = await transport(source.port, { calls }).send(requestInput())
    expect(outcome).toMatchObject({ ok: false, codigo: "transporte_redirect_recusado" })
    expect(source.hits()).toBe(1)
    expect(redirectTargetHits).toBe(0)
    expect(calls.count).toBe(1)
  })

  it("separa timeout de conexão/TLS do deadline total", async () => {
    const stalledPort = await startStalledTcpServer()
    const connectOutcome = await transport(stalledPort).send(
      requestInput({ connectionTimeoutMs: 120, totalDeadlineMs: 2_000 }),
    )
    expect(connectOutcome).toMatchObject({
      ok: false,
      codigo: "transporte_timeout_conexao",
      classification: "UNKNOWN_UNCERTAIN",
    })

    const slowBody = await startMtlsServer((response) => {
      response.write("inicio")
      setTimeout(() => response.end("fim"), 1_000)
    })
    const deadlineOutcome = await transport(slowBody.port).send(
      requestInput({ connectionTimeoutMs: 1_000, totalDeadlineMs: 150 }),
    )
    expect(deadlineOutcome).toMatchObject({
      ok: false,
      codigo: "transporte_deadline_total",
      classification: "UNKNOWN_UNCERTAIN",
    })
  })

  it("faz exatamente uma tentativa e não repete após HTTP 503", async () => {
    const server = await startMtlsServer((response) => {
      response.writeHead(503)
      response.end("indisponível")
    })
    const calls = { count: 0, destinations: [] as string[] }
    const oneShotTransport = transport(server.port, { calls })
    const outcome = await oneShotTransport.send(requestInput())
    expect(outcome).toMatchObject({
      ok: false,
      codigo: "transporte_http_incerto",
      classification: "UNKNOWN_UNCERTAIN",
    })
    expect(server.hits()).toBe(1)
    expect(calls.count).toBe(1)

    const secondOutcome = await oneShotTransport.send(requestInput())
    expect(secondOutcome).toMatchObject({
      ok: false,
      codigo: "transporte_tentativa_nao_autorizada",
      externalTransmissionAttempted: false,
    })
    expect(server.hits()).toBe(1)
    expect(calls.count).toBe(1)
  })
})
