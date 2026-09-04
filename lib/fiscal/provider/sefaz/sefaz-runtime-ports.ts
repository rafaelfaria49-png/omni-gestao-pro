/**
 * Portas Node mínimas do transporte HTTPS/mTLS (GOAL-016D-C foundation 003).
 *
 * A separação permite que os testes redirecionem a conexão exclusivamente para servidores
 * loopback sem alterar o endpoint lógico aprovado. A implementação produtiva usa somente
 * `node:https`/`node:tls`, sem dependência HTTP externa.
 */
import { request as nodeHttpsRequest, type RequestOptions } from "node:https"
import type { ClientRequest, IncomingMessage } from "node:http"
import {
  createSecureContext as nodeCreateSecureContext,
  type SecureContext,
  type SecureContextOptions,
} from "node:tls"
import {
  createSefazSecureContext,
  getSefazCompositeRootCAs,
} from "./trust/icp-brasil-v10"

export { createSefazSecureContext } from "./trust/icp-brasil-v10"

export type SefazHttpsRequestPort = (
  options: SefazHttpsRequestOptions,
  onResponse: (response: IncomingMessage) => void,
) => ClientRequest

/** `https.request` encaminha estas opções para `tls.connect`; tipamos o contexto pré-criado. */
export type SefazHttpsRequestOptions = RequestOptions & {
  readonly secureContext: SecureContext
}

export type SefazCreateSecureContextPort = (options: SecureContextOptions) => SecureContext

export type SefazHttpsRuntimePorts = {
  readonly request: SefazHttpsRequestPort
  readonly createSecureContext: SefazCreateSecureContextPort
}

const OFFLINE_LOOPBACK_TEST_AUTHORITY = Symbol("sefaz-offline-loopback-test-authority")

export type SefazOneShotAttemptContext = {
  readonly endpointLogico: string
  readonly correlationId: string
}

/**
 * Observabilidade exclusivamente de teste. Se `throwSynchronouslyBeforeNodeRequest` estiver
 * ativo, `runtimeRequestCalls` aumenta, mas `nodeRequestCalls` permanece zero: nenhum
 * `node:https.request` foi criado.
 */
export type SefazOfflineLoopbackTestProbe = {
  secureContextCalls: number
  runtimeRequestCalls: number
  nodeRequestCalls: number
  destroyCalls: number
  destinations: string[]
}

export type SefazOfflineLoopbackTestAuthorityOptions = {
  readonly port: number
  readonly trustedCaPem: string
  readonly withoutClientCertificate?: boolean
  readonly throwSynchronouslyBeforeNodeRequest?: boolean
  readonly probe?: SefazOfflineLoopbackTestProbe
}

/**
 * Token opaco. Não contém runtime nem método de autorização publicamente acessível; a associação
 * é guardada no `WeakMap` privado abaixo. Copiar ou forjar o objeto não reproduz a autoridade.
 */
export type SefazOfflineLoopbackTestAuthority = {
  readonly [OFFLINE_LOOPBACK_TEST_AUTHORITY]: true
}

type OfflineLoopbackBinding = {
  available: boolean
  readonly runtime: SefazHttpsRuntimePorts
}

const offlineLoopbackBindings = new WeakMap<object, OfflineLoopbackBinding>()

function assertLoopbackTestOptions(options: SefazOfflineLoopbackTestAuthorityOptions): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Authority loopback disponível somente no ambiente de testes.")
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65_535) {
    throw new Error("Porta loopback de teste inválida.")
  }
  if (!options.trustedCaPem.trim()) {
    throw new Error("CA sintética de teste obrigatória.")
  }
}

/**
 * Cria authority + runtime como uma unidade indivisível. O runtime efetivo sempre sobrescreve
 * destino físico para `127.0.0.1:<port>`; host lógico e SNI continuam vindos do endpoint canônico.
 * Nenhum caller consegue autorizá-lo junto de `nodeSefazHttpsRuntimePorts` ou runtime custom.
 */
export function createOfflineLoopbackTestAuthority(
  options: SefazOfflineLoopbackTestAuthorityOptions,
): SefazOfflineLoopbackTestAuthority {
  assertLoopbackTestOptions(options)

  const runtime: SefazHttpsRuntimePorts = {
    createSecureContext: (tlsOptions) => {
      if (options.probe) options.probe.secureContextCalls += 1
      return nodeCreateSecureContext({
        ...tlsOptions,
        ...(options.withoutClientCertificate ? { pfx: undefined, passphrase: undefined } : {}),
        ca: options.trustedCaPem,
      })
    },
    request: (requestOptions, onResponse) => {
      if (options.probe) options.probe.runtimeRequestCalls += 1
      if (options.throwSynchronouslyBeforeNodeRequest) {
        throw new Error("Falha sintética antes de node:https.request.")
      }

      if (options.probe) {
        options.probe.nodeRequestCalls += 1
        options.probe.destinations.push(`127.0.0.1:${options.port}`)
      }
      // Allowlist fechada: nunca encaminhar `agent`, `createConnection`, `socketPath`,
      // `lookup` ou qualquer outro override de conexão recebido de um deep import.
      const loopbackRequestOptions: SefazHttpsRequestOptions = {
        protocol: "https:",
        hostname: "127.0.0.1",
        port: options.port,
        path: requestOptions.path,
        method: requestOptions.method,
        headers: requestOptions.headers,
        agent: false,
        rejectUnauthorized: true,
        minVersion: "TLSv1.2",
        secureContext: requestOptions.secureContext,
        servername: requestOptions.servername,
      }
      const request = nodeHttpsRequest(loopbackRequestOptions, onResponse)
      if (options.probe) {
        const destroy = request.destroy.bind(request)
        request.destroy = ((error?: Error) => {
          options.probe!.destroyCalls += 1
          return destroy(error)
        }) as typeof request.destroy
      }
      return request
    },
  }

  const authority = Object.freeze({
    [OFFLINE_LOOPBACK_TEST_AUTHORITY]: true as const,
  })
  offlineLoopbackBindings.set(authority, { available: true, runtime })
  return authority
}

/** Validação nominal em runtime; cast, clone e objeto estrutural não atravessam o WeakMap. */
export function isOfflineLoopbackTestAuthority(
  authority: SefazOfflineLoopbackTestAuthority | null,
): boolean {
  return (
    process.env.NODE_ENV === "test" &&
    authority !== null &&
    offlineLoopbackBindings.has(authority)
  )
}

/**
 * Consome no máximo uma vez e devolve somente o runtime já preso a loopback. A função é exportada
 * para o transporte, mas um deep import não obtém capability separável nem runtime retargetable.
 */
export function consumeOfflineLoopbackTestAuthority(
  authority: SefazOfflineLoopbackTestAuthority,
  context: SefazOneShotAttemptContext,
): SefazHttpsRuntimePorts | null {
  void context
  if (process.env.NODE_ENV !== "test") return null
  const binding = offlineLoopbackBindings.get(authority)
  if (!binding?.available) return null
  binding.available = false
  return binding.runtime
}

export const nodeSefazHttpsRuntimePorts: SefazHttpsRuntimePorts = Object.freeze({
  request: (options, onResponse) => nodeHttpsRequest(options, onResponse),
  createSecureContext: (options) => createSefazSecureContext(options),
})
