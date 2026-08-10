/**
 * Transporte HTTPS/mTLS genérico e fail-closed (GOAL-016D-C foundation 003).
 *
 * DORMENTE: não é o transporte default do provider e não é registrado em rota/registry.
 * Recebe somente endpoint do catálogo fechado + referências opacas do A1. Não conhece
 * `statusServico`, wrapper WSDL, `SOAPAction`, cStat ou rejeição fiscal.
 */
import "server-only"

import {
  A1MtlsMaterialError,
  loadA1MtlsMaterial,
  type A1MtlsMaterial,
  type LoadA1MtlsMaterialParams,
} from "@/lib/fiscal/certificate/a1-mtls-material"
import {
  SEFAZ_ENDPOINT_CATALOG,
  sefazEndpointIntegro,
  type SefazEndpoint,
} from "./sefaz-endpoint-catalog"
import {
  consumeOfflineLoopbackTestAuthority,
  isOfflineLoopbackTestAuthority,
  type SefazHttpsRuntimePorts,
  type SefazOfflineLoopbackTestAuthority,
} from "./sefaz-runtime-ports"
import type {
  SefazTransport,
  SefazTransportErrorCode,
  SefazTransportFailure,
  SefazTransportOutcome,
  SefazTransportRequest,
} from "./sefaz-transport.types"

export const SEFAZ_MAX_CONNECTION_TIMEOUT_MS = 15_000
export const SEFAZ_MAX_TOTAL_DEADLINE_MS = 60_000
export const SEFAZ_HTTPS_MAX_RESPONSE_BYTES = 2 * 1024 * 1024

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308])

export type LoadA1MtlsMaterialPort = (
  params: LoadA1MtlsMaterialParams,
) => Promise<A1MtlsMaterial>

export type SefazSoapTransportOptions = {
  /** Default produtivo: resolver server-side sobre `process.env`. */
  loadMaterial?: LoadA1MtlsMaterialPort
  /**
   * Seam diagnóstico fail-closed. Informar qualquer runtime explicitamente jamais autoriza rede;
   * combinado com authority de teste, bloqueia a configuração antes do A1/TLS/socket.
   */
  runtime?: SefazHttpsRuntimePorts
  /** Token opaco cujo runtime é criado e preso a `127.0.0.1` no mesmo factory de teste. */
  offlineLoopbackTestAuthority?: SefazOfflineLoopbackTestAuthority
}

function failure(
  codigo: SefazTransportErrorCode,
  mensagem: string,
  classification: SefazTransportFailure["classification"],
  externalTransmissionAttempted: boolean,
): SefazTransportFailure {
  return { ok: false, codigo, mensagem, classification, externalTransmissionAttempted }
}

function boundedTimeout(value: number, maximum: number): number {
  if (!Number.isFinite(value) || value <= 0) return maximum
  return Math.min(Math.floor(value), maximum)
}

export type SefazTransportDeadlines = {
  readonly connectionTimeoutMs: number
  readonly totalDeadlineMs: number
}

/** Normalização pura e testável: callers nunca ampliam os tetos fail-closed do transporte. */
export function boundSefazTransportDeadlines(
  connectionTimeoutMs: number,
  totalDeadlineMs: number,
): SefazTransportDeadlines {
  return {
    connectionTimeoutMs: boundedTimeout(
      connectionTimeoutMs,
      SEFAZ_MAX_CONNECTION_TIMEOUT_MS,
    ),
    totalDeadlineMs: boundedTimeout(totalDeadlineMs, SEFAZ_MAX_TOTAL_DEADLINE_MS),
  }
}

/**
 * Re-resolve a tupla no catálogo e usa a entrada canônica. Mesmo um objeto forjado com URL
 * livre é recusado; o destino efetivo nunca é lido de input não catalogado.
 */
function canonicalAllowedEndpoint(candidate: SefazEndpoint): SefazEndpoint | null {
  const canonical = SEFAZ_ENDPOINT_CATALOG.find(
    (entry) =>
      entry.uf === candidate.uf &&
      entry.ambiente === candidate.ambiente &&
      entry.servico === candidate.servico &&
      entry.versao === candidate.versao,
  )
  if (
    !canonical ||
    !canonical.permitido ||
    !sefazEndpointIntegro(canonical) ||
    candidate.url !== canonical.url ||
    candidate.host !== canonical.host ||
    candidate.namespace !== canonical.namespace ||
    candidate.permitido !== canonical.permitido
  ) {
    return null
  }
  return canonical
}

function safeContentType(value: string): string | null {
  const normalized = String(value ?? "").trim()
  if (!normalized || /[\r\n]/.test(normalized)) return null
  return normalized
}

export class SefazSoapTransport implements SefazTransport {
  readonly permiteRede: boolean

  private readonly loadMaterial: LoadA1MtlsMaterialPort
  private readonly offlineLoopbackTestAuthority: SefazOfflineLoopbackTestAuthority | null
  private readonly hasRuntimeAuthorityConflict: boolean

  constructor(options: SefazSoapTransportOptions = {}) {
    this.loadMaterial = options.loadMaterial ?? loadA1MtlsMaterial
    this.offlineLoopbackTestAuthority = options.offlineLoopbackTestAuthority ?? null
    this.hasRuntimeAuthorityConflict =
      options.runtime !== undefined && this.offlineLoopbackTestAuthority !== null
    this.permiteRede =
      !this.hasRuntimeAuthorityConflict &&
      isOfflineLoopbackTestAuthority(this.offlineLoopbackTestAuthority)
  }

  async send(request: SefazTransportRequest): Promise<SefazTransportOutcome> {
    // A barreira de produção é a PRIMEIRA operação: antes de cofre, senha, TLS ou socket.
    if (request.endpoint.ambiente !== "HOMOLOGACAO") {
      return failure(
        "transporte_producao_bloqueada",
        "Ambiente de produção bloqueado antes da preparação do transporte.",
        "BLOCKED_BEFORE_NETWORK",
        false,
      )
    }

    const endpoint = canonicalAllowedEndpoint(request.endpoint)
    const contentType = safeContentType(request.contentType)
    if (!endpoint || !contentType) {
      return failure(
        "transporte_destino_recusado",
        "Destino ou metadados de transporte fora do contrato fechado.",
        "BLOCKED_BEFORE_NETWORK",
        false,
      )
    }

    let runtime: SefazHttpsRuntimePorts | null = null
    if (!this.hasRuntimeAuthorityConflict && this.offlineLoopbackTestAuthority) {
      runtime = consumeOfflineLoopbackTestAuthority(this.offlineLoopbackTestAuthority, {
        endpointLogico: `${endpoint.uf}/${endpoint.ambiente}/${endpoint.servico}/${endpoint.versao}`,
        correlationId: request.correlationId,
      })
    }
    if (!runtime) {
      return failure(
        "transporte_tentativa_nao_autorizada",
        "Tentativa HTTPS não autorizada por authority loopback one-shot íntegra.",
        "BLOCKED_BEFORE_NETWORK",
        false,
      )
    }

    let material: A1MtlsMaterial
    try {
      material = await this.loadMaterial({
        storeId: request.certificate.storeId,
        blobRef: request.certificate.blobRef,
        senhaRef: request.certificate.senhaRef,
      })
    } catch (error) {
      const mensagem =
        error instanceof A1MtlsMaterialError
          ? "Material A1 indisponível para o transporte mTLS."
          : "Falha sanitizada ao carregar material A1."
      return failure(
        "transporte_certificado_indisponivel",
        mensagem,
        "BLOCKED_BEFORE_NETWORK",
        false,
      )
    }

    let secureContext: ReturnType<SefazHttpsRuntimePorts["createSecureContext"]> | null = null
    try {
      material.withTlsOptions(({ pfx, passphrase }) => {
        secureContext = runtime.createSecureContext({
          pfx,
          passphrase,
          minVersion: "TLSv1.2",
        })
      })
    } catch {
      return failure(
        "transporte_tls_invalido",
        "Contexto TLS do certificado A1 não pôde ser construído.",
        "UNKNOWN_UNCERTAIN",
        false,
      )
    } finally {
      material.dispose()
    }
    if (!secureContext) {
      return failure(
        "transporte_tls_invalido",
        "Contexto TLS do certificado A1 não foi construído.",
        "UNKNOWN_UNCERTAIN",
        false,
      )
    }
    const preparedSecureContext = secureContext

    const url = new URL(endpoint.url)
    const { connectionTimeoutMs, totalDeadlineMs } = boundSefazTransportDeadlines(
      request.connectionTimeoutMs,
      request.totalDeadlineMs,
    )

    return new Promise<SefazTransportOutcome>((resolve) => {
      let settled = false
      let connectionTimer: ReturnType<typeof setTimeout> | null = null
      let totalTimer: ReturnType<typeof setTimeout> | null = null

      const finish = (outcome: SefazTransportOutcome): void => {
        if (settled) return
        settled = true
        if (connectionTimer) clearTimeout(connectionTimer)
        if (totalTimer) clearTimeout(totalTimer)
        resolve(outcome)
      }

      let transportRequest: ReturnType<SefazHttpsRuntimePorts["request"]>
      try {
        transportRequest = runtime.request(
          {
            protocol: "https:",
            hostname: endpoint.host,
            servername: endpoint.host,
            port: 443,
            path: url.pathname,
            method: "POST",
            headers: {
              "Content-Type": contentType,
              "Content-Length": String(request.bodyBytes.byteLength),
              Connection: "close",
            },
            agent: false,
            rejectUnauthorized: true,
            minVersion: "TLSv1.2",
            secureContext: preparedSecureContext,
          },
          (response) => {
            const status = response.statusCode ?? 0
            if (REDIRECT_STATUS.has(status)) {
              response.resume()
              finish(
                failure(
                  "transporte_redirect_recusado",
                  "Redirect HTTP recusado sem nova tentativa.",
                  "UNKNOWN_UNCERTAIN",
                  true,
                ),
              )
              return
            }

            const chunks: Buffer[] = []
            let received = 0
            response.on("data", (chunk: Buffer | string) => {
              if (settled) return
              const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
              received += bytes.length
              if (received > SEFAZ_HTTPS_MAX_RESPONSE_BYTES) {
                response.destroy()
                transportRequest.destroy()
                finish(
                  failure(
                    "transporte_resposta_excedida",
                    "Resposta excedeu o limite de 2 MiB durante streaming.",
                    "UNKNOWN_UNCERTAIN",
                    true,
                  ),
                )
                return
              }
              chunks.push(bytes)
            })
            response.once("end", () => {
              if (settled) return
              if (status < 200 || status >= 300) {
                finish(
                  failure(
                    "transporte_http_incerto",
                    "Resposta HTTP não conclusiva para o domínio fiscal.",
                    "UNKNOWN_UNCERTAIN",
                    true,
                  ),
                )
                return
              }
              finish({
                ok: true,
                classification: "RESPONSE_RECEIVED",
                httpStatus: status,
                contentType:
                  typeof response.headers["content-type"] === "string"
                    ? response.headers["content-type"]
                    : null,
                bodyBytes: Buffer.concat(chunks, received),
                externalTransmissionAttempted: true,
              })
            })
            response.once("error", () => {
              finish(
                failure(
                  "transporte_rede_incerta",
                  "Falha de rede durante leitura da resposta.",
                  "UNKNOWN_UNCERTAIN",
                  true,
                ),
              )
            })
          },
        )
      } catch {
        finish(
          failure(
            "transporte_rede_incerta",
            "Falha de rede ao iniciar a tentativa HTTPS.",
            "UNKNOWN_UNCERTAIN",
            false,
          ),
        )
        return
      }

      totalTimer = setTimeout(() => {
        finish(
          failure(
            "transporte_deadline_total",
            "Deadline total do transporte excedido.",
            "UNKNOWN_UNCERTAIN",
            true,
          ),
        )
        transportRequest.destroy()
      }, totalDeadlineMs)

      transportRequest.once("socket", (socket) => {
        connectionTimer = setTimeout(() => {
          finish(
            failure(
              "transporte_timeout_conexao",
              "Timeout de conexão/TLS excedido.",
              "UNKNOWN_UNCERTAIN",
              true,
            ),
          )
          transportRequest.destroy()
        }, connectionTimeoutMs)
        socket.once("secureConnect", () => {
          if (connectionTimer) clearTimeout(connectionTimer)
          connectionTimer = null
        })
      })

      transportRequest.once("error", () => {
        finish(
          failure(
            "transporte_rede_incerta",
            "Falha de rede ou TLS; resultado fiscal desconhecido.",
            "UNKNOWN_UNCERTAIN",
            true,
          ),
        )
      })

      try {
        transportRequest.end(Buffer.from(request.bodyBytes))
      } catch {
        finish(
          failure(
            "transporte_rede_incerta",
            "Falha após criação da tentativa HTTPS.",
            "UNKNOWN_UNCERTAIN",
            true,
          ),
        )
        transportRequest.destroy()
      }
    })
  }
}
