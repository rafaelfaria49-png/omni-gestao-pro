/**
 * Aquisição autenticada do WSDL oficial (GOAL-017 · pendências H-9/H-10).
 *
 * Capacidade **estritamente administrativa e de leitura de metadados**. Faz um único `GET` de
 * `<endpoint canônico>?wsdl` sobre TLS mútuo com o A1 já custodiado, e devolve o documento mais
 * evidências. Não fala SOAP, não conhece `SOAPAction`, `cStat`, `statusServico`, chave de acesso
 * nem qualquer bit de documento fiscal.
 *
 * ## O que esta ferramenta é incapaz de fazer, por construção
 *
 * | Capacidade | Por que é impossível |
 * |---|---|
 * | escolher destino | a entrada é a tupla `(uf, ambiente, serviço, versão)`; a URL vem da projeção do catálogo |
 * | falar com produção | barreira é a PRIMEIRA instrução, antes de cofre/TLS/socket; e produção não é projetada como alvo |
 * | falar com host NF-e / outra UF | não existe entrada correspondente na allow-list |
 * | transmitir XML fiscal | não há parâmetro de corpo; o método é `GET` fixo e a requisição é encerrada sem payload |
 * | executar `statusServico` | não há envelope SOAP, `Content-Type` SOAP nem `POST` neste módulo |
 * | seguir redirect | 3xx é recusa terminal, sem nova tentativa |
 * | tentar de novo | a autoridade é one-shot; não há laço de retry |
 * | abrir socket sem autorização | sem autoridade íntegra e no escopo, recusa antes do A1 |
 *
 * ## Evidência × autoridade
 *
 * `Content-Type` é registrado como **evidência sanitizada** e não decide nada: um servidor que
 * responda `text/html` com um WSDL válido é aceito, e um que responda `text/xml` com lixo é
 * recusado pela extração estrutural — que é outro módulo, offline.
 *
 * ## Segredo
 *
 * O material A1 é resolvido pelas referências opacas existentes (`loadA1MtlsMaterial`) e
 * descartado assim que o contexto TLS é construído. Nenhuma mensagem, código ou campo de saída
 * deriva de PFX, senha, PEM ou chave privada. Este módulo não escreve em disco, banco ou log.
 *
 * ## Telemetria de transporte (GOAL 020 · 138)
 *
 * Falhas de rede/TLS que antes viravam apenas `wsdl_rede_incerta` passam a carregar telemetria
 * sanitizada e tipada (`transportPhase`/`transportClass`/`transportCode`) para que uma execução
 * autorizada distinga a CLASSE técnica da falha sem expor dado sensível. A classe vem EXCLUSIVA-
 * MENTE de um código Node em allow-list fechada; onde não há código reconhecido, `transportCode`
 * é `UNKNOWN` e a classe é `UNKNOWN_NETWORK`. `transportPhase` registra onde a falha ocorreu,
 * sem inferir além da evidência: ausência de `secureConnect` NÃO vira "TLS" — DNS/TCP continuam
 * distinguíveis pelo código. `error.message`, `error.stack`, `error.cause`, `syscall`,
 * `address`, `hostname`, certificado peer, fingerprint, subject/issuer, PFX, senha, blobRef,
 * senhaRef, cookie e token nunca são lidos nem derivados.
 */
import "server-only"

import { createHash } from "node:crypto"
import type { SecureContext } from "node:tls"
import {
  A1MtlsMaterialError,
  loadA1MtlsMaterial,
  type A1MtlsMaterial,
  type LoadA1MtlsMaterialParams,
} from "@/lib/fiscal/certificate/a1-mtls-material"
import type { SefazHttpsRuntimePorts } from "../sefaz-runtime-ports"
import {
  SEFAZ_WSDL_METHOD,
  SEFAZ_WSDL_QUERY,
  canonicalSefazWsdlTarget,
  selectSefazWsdlTarget,
  type SefazWsdlTarget,
} from "./wsdl-acquisition-target"
import {
  consumeWsdlExecutionAuthority,
  isWsdlExecutionAuthority,
  type SefazWsdlExecutionAuthority,
} from "./wsdl-execution-authority"

/** Tetos fail-closed. Menores que os do transporte SOAP: isto é leitura de metadados. */
export const WSDL_MAX_CONNECTION_TIMEOUT_MS = 10_000
export const WSDL_MAX_TOTAL_DEADLINE_MS = 20_000
/** WSDLs dos serviços NFC-e são documentos de dezenas de KB. 256 KiB já é folga larga. */
export const WSDL_MAX_RESPONSE_BYTES = 256 * 1024

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308])
const MAX_CONTENT_TYPE_EVIDENCIA = 128

export type LoadA1MtlsMaterialPort = (params: LoadA1MtlsMaterialParams) => Promise<A1MtlsMaterial>

export type SefazWsdlAcquisitionOptions = {
  /** Default produtivo: resolver server-side sobre `process.env`. */
  loadMaterial?: LoadA1MtlsMaterialPort
  /**
   * Seam diagnóstico fail-closed. Informar um runtime explicitamente **jamais** autoriza rede;
   * combinado com autoridade, produz conflito e bloqueia antes do A1/TLS/socket.
   */
  runtime?: SefazHttpsRuntimePorts
  /** Token opaco one-shot, criado junto do runtime que autoriza e preso ao alvo. */
  executionAuthority?: SefazWsdlExecutionAuthority
}

export type SefazWsdlAcquisitionRequest = {
  readonly uf: string
  readonly ambiente: string
  readonly servico: string
  readonly versao?: string
  /** Referências opacas já aprovadas; nunca material secreto. */
  readonly certificate: {
    readonly storeId: string
    readonly blobRef: string
    readonly senhaRef: string
  }
  /** Contexto A1 já aberto e validado antes do ledger global da execução efêmera. */
  readonly preparedSecureContext?: SecureContext
  /** Correlação para auditoria — nunca contém segredo. */
  readonly correlationId: string
  readonly connectionTimeoutMs?: number
  readonly totalDeadlineMs?: number
}

export type SefazWsdlAcquisitionErrorCode =
  /** Nenhuma autoridade de execução íntegra e no escopo; nenhum socket foi aberto. */
  | "wsdl_tentativa_nao_autorizada"
  /** Produção negada antes de cofre, contexto TLS e socket. */
  | "wsdl_producao_bloqueada"
  /** Alvo fora da allow-list projetada do catálogo, ou metadados fora do contrato. */
  | "wsdl_alvo_recusado"
  /** Referências/cofre/material A1 indisponíveis; nenhum socket foi aberto. */
  | "wsdl_certificado_indisponivel"
  /** Contexto TLS não pôde ser construído. */
  | "wsdl_tls_invalido"
  /** Conexão/TLS não concluiu dentro do relógio de conexão. */
  | "wsdl_timeout_conexao"
  /** Ciclo completo excedeu o deadline total. */
  | "wsdl_deadline_total"
  /** Redirect recusado e NÃO seguido. */
  | "wsdl_redirect_recusado"
  /** Corpo excedeu o teto durante o streaming. */
  | "wsdl_resposta_excedida"
  /** Status HTTP não conclusivo (inclui o `403` já observado sem certificado). */
  | "wsdl_http_incerto"
  /** Falha de rede/TLS. */
  | "wsdl_rede_incerta"
  /** Corpo vazio, com BOM ou fora de UTF-8 estrito. */
  | "wsdl_corpo_ilegivel"

export type SefazWsdlAcquisitionClassification =
  | "BLOCKED_BEFORE_NETWORK"
  | "UNKNOWN_UNCERTAIN"
  | "RESPONSE_RECEIVED"

/**
 * Onde a falha de transporte ocorreu, observado diretamente pelo ciclo de vida da request.
 * Nunca inferido: `SECURE_CONNECT` só é atribuído quando o TCP conectou e o `secureConnect`
 * ainda não disparou.
 */
export type SefazWsdlTransportPhase =
  /** Exceção síncrona na criação da request; nenhum socket foi criado. */
  | "REQUEST_CREATE"
  /** Socket atribuído, TCP ainda não estabelecido (janela de DNS/TCP). */
  | "BEFORE_SECURE_CONNECT"
  /** TCP estabelecido, handshake TLS em curso. */
  | "SECURE_CONNECT"
  /** Conexão concluída; falha durante resposta (headers ou streaming). */
  | "RESPONSE_STREAM"
  /** Ciclo `end()`/lifecycle sem socket observável. */
  | "REQUEST_LIFECYCLE"

/**
 * Classe técnica da falha, enum FECHADO. Deriva somente de código Node em allow-list —
 * nunca de mensagem, fase ou inferência.
 */
export type SefazWsdlTransportClass =
  | "DNS"
  | "TCP_CONNECT"
  | "TLS_CERTIFICATE"
  | "TLS_HANDSHAKE"
  | "CONNECTION_RESET"
  | "TIMEOUT"
  | "RESPONSE_STREAM"
  | "UNKNOWN_NETWORK"

/** Telemetria sanitizada: somente valores de enums fechados ou código em allow-list. */
export type SefazWsdlTransportTelemetry = {
  readonly phase: SefazWsdlTransportPhase
  readonly class: SefazWsdlTransportClass
  /** Código Node em allow-list, ou a constante `UNKNOWN` quando ausente/não reconhecido. */
  readonly code: string
}

/** Constante para código Node ausente ou fora da allow-list — nunca o código bruto. */
export const WSDL_TRANSPORT_UNKNOWN_CODE = "UNKNOWN"

/**
 * Allow-list FECHADA de códigos Node que o caminho `GET ?wsdl` pode realmente produzir,
 * mapeada para a classe técnica. Qualquer código fora dela vira `UNKNOWN`/`UNKNOWN_NETWORK`.
 */
export const WSDL_NODE_TRANSPORT_ERROR_CLASSES: ReadonlyMap<string, SefazWsdlTransportClass> =
  new Map([
    // Resolução de nomes (dns.lookup).
    ["ENOTFOUND", "DNS"],
    ["EAI_AGAIN", "DNS"],
    // Estabelecimento TCP.
    ["ECONNREFUSED", "TCP_CONNECT"],
    ["EHOSTUNREACH", "TCP_CONNECT"],
    ["ENETUNREACH", "TCP_CONNECT"],
    // Conexão interrompida.
    ["ECONNRESET", "CONNECTION_RESET"],
    ["EPIPE", "CONNECTION_RESET"],
    // Timeout produzido pelo runtime (SO_KEEPALIVE/connect).
    ["ETIMEDOUT", "TIMEOUT"],
    // Verificação de cadeia/identidade do certificado do servidor.
    ["UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "TLS_CERTIFICATE"],
    ["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "TLS_CERTIFICATE"],
    ["SELF_SIGNED_CERT_IN_CHAIN", "TLS_CERTIFICATE"],
    ["DEPTH_ZERO_SELF_SIGNED_CERT", "TLS_CERTIFICATE"],
    ["CERT_HAS_EXPIRED", "TLS_CERTIFICATE"],
    ["ERR_TLS_CERT_ALTNAME_INVALID", "TLS_CERTIFICATE"],
    // Handshake TLS sem falha de cadeia (protocolo/alerta/tempo de handshake).
    ["EPROTO", "TLS_HANDSHAKE"],
    ["ERR_TLS_HANDSHAKE_TIMEOUT", "TLS_HANDSHAKE"],
    ["ERR_SSL_WRONG_VERSION_NUMBER", "TLS_HANDSHAKE"],
    ["ERR_SSL_NO_PROTOCOLS", "TLS_HANDSHAKE"],
    ["ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE", "TLS_HANDSHAKE"],
    ["ERR_SSL_SSLV3_ALERT_ILLEGAL_PARAMETER", "TLS_HANDSHAKE"],
  ])

/**
 * Função PURA de classificação: lê exclusivamente a propriedade `code` do erro e a consulta
 * na allow-list. Nunca toca em `message`, `stack`, `cause`, `syscall`, `address`, `hostname`
 * ou qualquer outra propriedade — envenenar essas propriedades não contamina a saída.
 */
export function classifyWsdlTransportError(
  error: unknown,
): { readonly class: SefazWsdlTransportClass; readonly code: string } {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: unknown }).code
      : undefined
  if (typeof code === "string") {
    const mapped = WSDL_NODE_TRANSPORT_ERROR_CLASSES.get(code)
    if (mapped) return { class: mapped, code }
  }
  return { class: "UNKNOWN_NETWORK", code: WSDL_TRANSPORT_UNKNOWN_CODE }
}

export type SefazWsdlAcquisitionFailure = {
  readonly ok: false
  readonly codigo: SefazWsdlAcquisitionErrorCode
  /** Mensagem estável e sanitizada: sem corpo de resposta, sem segredo, sem stack. */
  readonly mensagem: string
  readonly classification: Exclude<SefazWsdlAcquisitionClassification, "RESPONSE_RECEIVED">
  /** Proveniência honesta: `true` somente se um socket externo foi de fato iniciado. */
  readonly externalTransmissionAttempted: boolean
  /** Telemetria sanitizada de transporte; `null` onde não há falha de rede a diagnosticar. */
  readonly transportPhase: SefazWsdlTransportPhase | null
  readonly transportClass: SefazWsdlTransportClass | null
  readonly transportCode: string | null
}

export type SefazWsdlAcquisitionSuccess = {
  readonly ok: true
  readonly classification: "RESPONSE_RECEIVED"
  readonly alvo: {
    readonly uf: string
    readonly ambiente: string
    readonly servico: string
    readonly versao: string
  }
  readonly httpStatus: number
  /** Evidência sanitizada — nunca autoridade sobre a leitura do documento. */
  readonly contentTypeEvidencia: string | null
  readonly byteLength: number
  readonly sha256: string
  /** Documento decodificado em UTF-8 estrito. NÃO é persistido nem logado por este módulo. */
  readonly documento: string
  readonly externalTransmissionAttempted: true
}

export type SefazWsdlAcquisitionOutcome =
  | SefazWsdlAcquisitionFailure
  | SefazWsdlAcquisitionSuccess

function failure(
  codigo: SefazWsdlAcquisitionErrorCode,
  mensagem: string,
  classification: SefazWsdlAcquisitionFailure["classification"],
  externalTransmissionAttempted: boolean,
  transport: SefazWsdlTransportTelemetry | null = null,
): SefazWsdlAcquisitionFailure {
  return {
    ok: false,
    codigo,
    mensagem,
    classification,
    externalTransmissionAttempted,
    transportPhase: transport?.phase ?? null,
    transportClass: transport?.class ?? null,
    transportCode: transport?.code ?? null,
  }
}

function boundedTimeout(value: number | undefined, maximum: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return maximum
  return Math.min(Math.floor(value), maximum)
}

export type SefazWsdlDeadlines = {
  readonly connectionTimeoutMs: number
  readonly totalDeadlineMs: number
}

/** Normalização pura e testável: o chamador nunca amplia os tetos fail-closed. */
export function boundWsdlDeadlines(
  connectionTimeoutMs?: number,
  totalDeadlineMs?: number,
): SefazWsdlDeadlines {
  return {
    connectionTimeoutMs: boundedTimeout(connectionTimeoutMs, WSDL_MAX_CONNECTION_TIMEOUT_MS),
    totalDeadlineMs: boundedTimeout(totalDeadlineMs, WSDL_MAX_TOTAL_DEADLINE_MS),
  }
}

/** Evidência de `Content-Type`: sem CRLF, comprimento limitado. Nunca alimenta decisão. */
export function contentTypeEvidencia(valor: unknown): string | null {
  if (typeof valor !== "string") return null
  const normalizado = valor.replace(/[\r\n]+/g, " ").trim().slice(0, MAX_CONTENT_TYPE_EVIDENCIA)
  return normalizado.length > 0 ? normalizado : null
}

function correlacaoValida(valor: unknown): boolean {
  return typeof valor === "string" && valor.trim().length > 0 && !/[\r\n]/.test(valor)
}

function decodificarUtf8Estrito(bytes: Buffer): string | null {
  if (bytes.length === 0) return null
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return null
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes)
  } catch {
    return null
  }
}

/**
 * Adquiridor de WSDL. `permiteRede` é a declaração explícita de capacidade: sem autoridade
 * íntegra ele é `false`, e uma instância criada sem wiring é incapaz de abrir socket.
 */
export class SefazWsdlAcquisition {
  readonly permiteRede: boolean
  /** Fixo e inspecionável: esta ferramenta só lê metadados. */
  readonly metodo = SEFAZ_WSDL_METHOD

  private readonly loadMaterial: LoadA1MtlsMaterialPort
  private readonly executionAuthority: SefazWsdlExecutionAuthority | null
  private readonly authorityConflict: boolean

  constructor(options: SefazWsdlAcquisitionOptions = {}) {
    this.loadMaterial = options.loadMaterial ?? loadA1MtlsMaterial
    this.executionAuthority = options.executionAuthority ?? null
    this.authorityConflict =
      options.runtime !== undefined && this.executionAuthority !== null
    this.permiteRede =
      !this.authorityConflict && isWsdlExecutionAuthority(this.executionAuthority)
  }

  async acquire(request: SefazWsdlAcquisitionRequest): Promise<SefazWsdlAcquisitionOutcome> {
    // Barreira de produção como PRIMEIRA operação: antes de catálogo, cofre, TLS ou socket.
    if (request.ambiente !== "HOMOLOGACAO") {
      return failure(
        "wsdl_producao_bloqueada",
        "Somente o ambiente de homologação é elegível à aquisição de WSDL.",
        "BLOCKED_BEFORE_NETWORK",
        false,
      )
    }

    const lookup = selectSefazWsdlTarget({
      uf: request.uf,
      ambiente: request.ambiente,
      servico: request.servico,
      versao: request.versao,
    })
    if (!lookup.ok) {
      return failure("wsdl_alvo_recusado", lookup.mensagem, "BLOCKED_BEFORE_NETWORK", false)
    }
    const alvo = canonicalSefazWsdlTarget(lookup.alvo)
    if (!alvo || !correlacaoValida(request.correlationId)) {
      return failure(
        "wsdl_alvo_recusado",
        "Destino ou metadados de aquisição fora do contrato fechado.",
        "BLOCKED_BEFORE_NETWORK",
        false,
      )
    }

    let runtime: SefazHttpsRuntimePorts | null = null
    if (!this.authorityConflict && this.executionAuthority) {
      runtime = consumeWsdlExecutionAuthority(this.executionAuthority, {
        alvo,
        correlationId: request.correlationId,
      })
    }
    if (!runtime) {
      return failure(
        "wsdl_tentativa_nao_autorizada",
        "Aquisição de WSDL sem autoridade de execução íntegra, one-shot e no escopo do alvo.",
        "BLOCKED_BEFORE_NETWORK",
        false,
      )
    }

    let secureContext: ReturnType<SefazHttpsRuntimePorts["createSecureContext"]> | null =
      request.preparedSecureContext ?? null
    if (!secureContext) {
      let material: A1MtlsMaterial
      try {
        material = await this.loadMaterial({
          storeId: request.certificate.storeId,
          blobRef: request.certificate.blobRef,
          senhaRef: request.certificate.senhaRef,
        })
      } catch (error) {
        return failure(
          "wsdl_certificado_indisponivel",
          error instanceof A1MtlsMaterialError
            ? "Material A1 indisponível para a aquisição mTLS."
            : "Falha sanitizada ao carregar material A1.",
          "BLOCKED_BEFORE_NETWORK",
          false,
        )
      }

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
          "wsdl_tls_invalido",
          "Contexto TLS do certificado A1 não pôde ser construído.",
          "UNKNOWN_UNCERTAIN",
          false,
        )
      } finally {
        material.dispose()
      }
    }
    if (!secureContext) {
      return failure(
        "wsdl_tls_invalido",
        "Contexto TLS do certificado A1 não foi construído.",
        "UNKNOWN_UNCERTAIN",
        false,
      )
    }
    const preparedSecureContext = secureContext

    const { connectionTimeoutMs, totalDeadlineMs } = boundWsdlDeadlines(
      request.connectionTimeoutMs,
      request.totalDeadlineMs,
    )

    return this.get({ alvo, runtime, preparedSecureContext, connectionTimeoutMs, totalDeadlineMs })
  }

  /** Uma tentativa, sem retry. Todo desfecho é terminal. */
  private get(input: {
    alvo: SefazWsdlTarget
    runtime: SefazHttpsRuntimePorts
    preparedSecureContext: ReturnType<SefazHttpsRuntimePorts["createSecureContext"]>
    connectionTimeoutMs: number
    totalDeadlineMs: number
  }): Promise<SefazWsdlAcquisitionOutcome> {
    const { alvo, runtime } = input

    return new Promise<SefazWsdlAcquisitionOutcome>((resolve) => {
      let settled = false
      let connectionTimer: ReturnType<typeof setTimeout> | null = null
      let totalTimer: ReturnType<typeof setTimeout> | null = null

      // Estado observado do ciclo de vida — base da `phase` da telemetria. Nunca inferido além
      // do que os eventos de fato dispararam.
      let socketSeen = false
      let tcpConnected = false
      let secureConnected = false
      let responseStarted = false

      const faseAtual = (): SefazWsdlTransportPhase => {
        if (responseStarted || secureConnected) return "RESPONSE_STREAM"
        if (tcpConnected) return "SECURE_CONNECT"
        if (socketSeen) return "BEFORE_SECURE_CONNECT"
        return "REQUEST_LIFECYCLE"
      }

      /** Telemetria a partir de um erro Node: classe/código só da allow-list; fase observada. */
      const telemetria = (
        error: unknown,
        fase: SefazWsdlTransportPhase = faseAtual(),
      ): SefazWsdlTransportTelemetry => {
        const classificacao = classifyWsdlTransportError(error)
        // Durante o streaming da resposta, a classe honesta é o segmento que falhou; o código
        // Node reconhecido (ex.: ECONNRESET) continua indo em `code`.
        const classe: SefazWsdlTransportClass =
          fase === "RESPONSE_STREAM" ? "RESPONSE_STREAM" : classificacao.class
        return { phase: fase, class: classe, code: classificacao.code }
      }

      /** Timeout interno (sem objeto de erro Node): classe TIMEOUT com a fase observada. */
      const telemetriaTimeout = (): SefazWsdlTransportTelemetry => ({
        phase: faseAtual(),
        class: "TIMEOUT",
        code: WSDL_TRANSPORT_UNKNOWN_CODE,
      })

      const finish = (outcome: SefazWsdlAcquisitionOutcome): void => {
        if (settled) return
        settled = true
        if (connectionTimer) clearTimeout(connectionTimer)
        if (totalTimer) clearTimeout(totalTimer)
        resolve(outcome)
      }

      let httpRequest: ReturnType<SefazHttpsRuntimePorts["request"]>
      try {
        httpRequest = runtime.request(
          {
            protocol: "https:",
            hostname: alvo.host,
            servername: alvo.host,
            port: 443,
            // Path e query literais do alvo canônico — nenhum componente vem do chamador.
            path: `${alvo.path}?${SEFAZ_WSDL_QUERY}`,
            method: SEFAZ_WSDL_METHOD,
            headers: {
              Accept: "text/xml, application/xml",
              Connection: "close",
            },
            agent: false,
            rejectUnauthorized: true,
            minVersion: "TLSv1.2",
            secureContext: input.preparedSecureContext,
          },
          (response) => {
            responseStarted = true
            const status = response.statusCode ?? 0
            if (REDIRECT_STATUS.has(status)) {
              response.resume()
              // `finish` ANTES de `destroy`: destruir primeiro pode disparar o handler de erro do
              // socket e fazer `wsdl_rede_incerta` vencer a corrida, mascarando o motivo real.
              finish(
                failure(
                  "wsdl_redirect_recusado",
                  "Redirect HTTP recusado; nenhuma nova tentativa foi feita.",
                  "UNKNOWN_UNCERTAIN",
                  true,
                ),
              )
              httpRequest.destroy()
              return
            }

            const chunks: Buffer[] = []
            let received = 0
            response.on("data", (chunk: Buffer | string) => {
              if (settled) return
              const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
              received += bytes.length
              if (received > WSDL_MAX_RESPONSE_BYTES) {
                // Mesma ordem do redirect: selar o desfecho antes de destruir o socket.
                finish(
                  failure(
                    "wsdl_resposta_excedida",
                    "Documento excedeu o limite aceito para WSDL durante o streaming.",
                    "UNKNOWN_UNCERTAIN",
                    true,
                  ),
                )
                response.destroy()
                httpRequest.destroy()
                return
              }
              chunks.push(bytes)
            })
            response.once("end", () => {
              if (settled) return
              if (status < 200 || status >= 300) {
                finish(
                  failure(
                    "wsdl_http_incerto",
                    `Resposta HTTP ${status} não conclusiva para aquisição de WSDL.`,
                    "UNKNOWN_UNCERTAIN",
                    true,
                  ),
                )
                return
              }
              const corpo = Buffer.concat(chunks, received)
              const documento = decodificarUtf8Estrito(corpo)
              if (documento === null) {
                finish(
                  failure(
                    "wsdl_corpo_ilegivel",
                    "Corpo vazio, com BOM inesperado ou fora de UTF-8 estrito.",
                    "UNKNOWN_UNCERTAIN",
                    true,
                  ),
                )
                return
              }
              finish({
                ok: true,
                classification: "RESPONSE_RECEIVED",
                alvo: {
                  uf: alvo.uf,
                  ambiente: alvo.ambiente,
                  servico: alvo.servico,
                  versao: alvo.versao,
                },
                httpStatus: status,
                contentTypeEvidencia: contentTypeEvidencia(response.headers["content-type"]),
                byteLength: corpo.byteLength,
                sha256: createHash("sha256").update(corpo).digest("hex"),
                documento,
                externalTransmissionAttempted: true,
              })
            })
            response.once("error", (error: unknown) => {
              finish(
                failure(
                  "wsdl_rede_incerta",
                  "Falha de rede durante a leitura do documento.",
                  "UNKNOWN_UNCERTAIN",
                  true,
                  telemetria(error),
                ),
              )
            })
          },
        )
      } catch (error) {
        finish(
          failure(
            "wsdl_rede_incerta",
            "Falha de rede ao iniciar a tentativa HTTPS.",
            "UNKNOWN_UNCERTAIN",
            false,
            telemetria(error, "REQUEST_CREATE"),
          ),
        )
        return
      }

      totalTimer = setTimeout(() => {
        finish(
          failure(
            "wsdl_deadline_total",
            "Deadline total da aquisição excedido.",
            "UNKNOWN_UNCERTAIN",
            true,
            telemetriaTimeout(),
          ),
        )
        httpRequest.destroy()
      }, input.totalDeadlineMs)

      httpRequest.once("socket", (socket) => {
        socketSeen = true
        socket.once("connect", () => {
          tcpConnected = true
        })
        connectionTimer = setTimeout(() => {
          finish(
            failure(
              "wsdl_timeout_conexao",
              "Timeout de conexão/TLS excedido.",
              "UNKNOWN_UNCERTAIN",
              true,
              telemetriaTimeout(),
            ),
          )
          httpRequest.destroy()
        }, input.connectionTimeoutMs)
        socket.once("secureConnect", () => {
          secureConnected = true
          if (connectionTimer) clearTimeout(connectionTimer)
          connectionTimer = null
        })
      })

      httpRequest.once("error", (error: unknown) => {
        finish(
          failure(
            "wsdl_rede_incerta",
            "Falha de rede ou TLS durante a aquisição.",
            "UNKNOWN_UNCERTAIN",
            true,
            telemetria(error),
          ),
        )
      })

      try {
        // `GET` sem corpo: não existe parâmetro de payload nesta ferramenta.
        httpRequest.end()
      } catch (error) {
        finish(
          failure(
            "wsdl_rede_incerta",
            "Falha após criação da tentativa HTTPS.",
            "UNKNOWN_UNCERTAIN",
            true,
            telemetria(error, "REQUEST_LIFECYCLE"),
          ),
        )
        httpRequest.destroy()
      }
    })
  }
}
