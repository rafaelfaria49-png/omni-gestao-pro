/**
 * Contrato do transporte SEFAZ (GOAL-016D-A · plano 016D D5 · ADR-0020).
 *
 * O transporte é INJETÁVEL e o default RECUSA qualquer chamada. A implementação Node HTTPS
 * continua fora deste arquivo e nunca é selecionada por padrão. Assim, criar o adapter sem
 * wiring explícito permanece incapaz de abrir socket.
 *
 * O request carrega somente referências opacas. PFX, senha e chave privada nunca entram no
 * contrato do caller nem podem vir de um futuro request administrativo.
 */
import type { SefazEndpoint } from "./sefaz-endpoint-catalog"

export type SefazTransportRequest = {
  /** Endpoint JÁ selecionado do catálogo fechado — o transporte nunca escolhe destino. */
  readonly endpoint: SefazEndpoint
  readonly contentType: string
  /** Envelope SOAP completo em bytes (bytes fiscais intactos no meio). */
  readonly bodyBytes: Uint8Array
  /** Correlação para auditoria — nunca contém segredo. */
  readonly correlationId: string
  /** Referências opacas já aprovadas pelos guards; nunca material secreto. */
  readonly certificate: {
    readonly storeId: string
    readonly blobRef: string
    readonly senhaRef: string
  }
  /** Timeout exclusivo da conexão/TLS. A implementação real limita a no máximo 15 s. */
  readonly connectionTimeoutMs: number
  /** Deadline do ciclo inteiro, inclusive leitura do body. Limitado a no máximo 60 s. */
  readonly totalDeadlineMs: number
}

export type SefazTransportErrorCode =
  /** Transporte offline por construção: nenhuma tentativa de rede foi feita. */
  | "transporte_offline_bloqueado"
  /** Transporte recusou o destino (não deveria acontecer: catálogo já filtra). */
  | "transporte_destino_recusado"
  /** Produção é negada antes de cofre, contexto TLS e socket. */
  | "transporte_producao_bloqueada"
  /** Nenhuma capability one-shot válida autorizou esta tentativa. */
  | "transporte_tentativa_nao_autorizada"
  /** Referências/cofre/material A1 indisponíveis; nenhum socket foi aberto. */
  | "transporte_certificado_indisponivel"
  /** O contexto TLS não pôde ser construído de forma segura. */
  | "transporte_tls_invalido"
  /** A conexão/TLS não terminou dentro do relógio de conexão. */
  | "transporte_timeout_conexao"
  /** O ciclo completo excedeu o deadline total. */
  | "transporte_deadline_total"
  /** Falha de rede/TLS depois de iniciada a tentativa; nunca é rejeição fiscal. */
  | "transporte_rede_incerta"
  /** Resposta HTTP não conclusiva; nunca é rejeição fiscal. */
  | "transporte_http_incerto"
  /** Redirect recusado e não seguido. */
  | "transporte_redirect_recusado"
  /** Limite de resposta excedido durante streaming. */
  | "transporte_resposta_excedida"

export type SefazTransportClassification =
  | "BLOCKED_BEFORE_NETWORK"
  | "UNKNOWN_UNCERTAIN"
  | "RESPONSE_RECEIVED"

export type SefazTransportFailure = {
  readonly ok: false
  readonly codigo: SefazTransportErrorCode
  readonly mensagem: string
  /** Nunca confundir falha técnica com rejeição fiscal. */
  readonly classification: Exclude<SefazTransportClassification, "RESPONSE_RECEIVED">
  /**
   * Proveniência honesta: `true` SOMENTE se um socket/requisição externa foi realmente
   * iniciado.
   *
   * O tipo é `boolean`, não o literal `false` (correção 002 · bloqueio 3): um canal incapaz de
   * exprimir `true` seria o próprio bug F-2 reescrito no sistema de tipos — a trilha jamais
   * poderia registrar uma transmissão que ocorreu. O que garante o `false` neste slice não é o
   * tipo, é o fato de que o ÚNICO transporte existente recusa antes de abrir socket; há teste
   * dedicado para isso.
   */
  readonly externalTransmissionAttempted: boolean
}

export type SefazTransportSuccess = {
  readonly ok: true
  readonly classification: "RESPONSE_RECEIVED"
  readonly httpStatus: number
  readonly contentType: string | null
  /** Bytes exatos recebidos, limitados durante streaming. */
  readonly bodyBytes: Uint8Array
  readonly externalTransmissionAttempted: true
}

export type SefazTransportOutcome = SefazTransportFailure | SefazTransportSuccess

export interface SefazTransport {
  /** Declaração explícita de capacidade. O transporte offline é `false`. */
  readonly permiteRede: boolean
  send(request: SefazTransportRequest): Promise<SefazTransportOutcome>
}

const MENSAGEM_OFFLINE =
  "Transporte SEFAZ offline: nenhuma chamada externa é permitida neste estágio (016D-A). " +
  "A primeira chamada real depende dos gates humanos G-F5.2 e G-H1..G-H3."

/**
 * Transporte DEFAULT — recusa tudo, sempre, sem abrir socket.
 *
 * Não é um stub "que finge sucesso": ele nunca devolve resposta de SEFAZ, nunca inventa
 * `cStat` e nunca reporta tentativa externa. É a barreira mecânica que torna o adapter
 * incapaz de falar com qualquer host, mesmo que todos os guards passem.
 */
export class SefazOfflineRefusingTransport implements SefazTransport {
  readonly permiteRede = false as const

  async send(_request: SefazTransportRequest): Promise<SefazTransportOutcome> {
    void _request
    return {
      ok: false,
      codigo: "transporte_offline_bloqueado",
      mensagem: MENSAGEM_OFFLINE,
      classification: "BLOCKED_BEFORE_NETWORK",
      // Literal `false` nesta implementação: nenhum socket é aberto, então não há tentativa.
      externalTransmissionAttempted: false as const,
    }
  }
}

/** Instância compartilhada do transporte offline (sem estado). */
export const sefazOfflineRefusingTransport = new SefazOfflineRefusingTransport()
