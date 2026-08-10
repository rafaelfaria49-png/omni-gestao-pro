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

const ONE_SHOT_ATTEMPT_PORT = Symbol("sefaz-one-shot-attempt-port")

export type SefazOneShotAttemptContext = {
  readonly endpointLogico: string
  readonly correlationId: string
}

/**
 * Porta mínima para a futura capability G-H3. O brand privado impede criação estrutural
 * acidental. Este GOAL não implementa contador durável nem autoridade produtiva.
 */
export type SefazOneShotAttemptPort = {
  readonly [ONE_SHOT_ATTEMPT_PORT]: true
  authorizeOnce(context: SefazOneShotAttemptContext): Promise<boolean>
}

export const sefazRefusingOneShotAttemptPort: SefazOneShotAttemptPort = Object.freeze({
  [ONE_SHOT_ATTEMPT_PORT]: true as const,
  async authorizeOnce(_context: SefazOneShotAttemptContext): Promise<boolean> {
    void _context
    return false
  },
})

/**
 * Capability efêmera SOMENTE para os testes loopback. Fora de `NODE_ENV=test`, falha fechado.
 * Consome no máximo uma tentativa por instância; não substitui o futuro ledger durável G-H3.
 */
export function createOfflineLoopbackTestOneShotAttemptPort(): SefazOneShotAttemptPort {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Capability loopback disponível somente no ambiente de testes.")
  }
  let available = true
  return {
    [ONE_SHOT_ATTEMPT_PORT]: true,
    async authorizeOnce(_context: SefazOneShotAttemptContext): Promise<boolean> {
      void _context
      if (!available) return false
      available = false
      return true
    },
  }
}

export const nodeSefazHttpsRuntimePorts: SefazHttpsRuntimePorts = Object.freeze({
  request: (options, onResponse) => nodeHttpsRequest(options, onResponse),
  createSecureContext: (options) => nodeCreateSecureContext(options),
})
