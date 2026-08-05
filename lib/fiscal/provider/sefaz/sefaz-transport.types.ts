/**
 * Contrato do transporte SEFAZ (GOAL-016D-A · plano 016D D5 · ADR-0020).
 *
 * O transporte é INJETÁVEL e o default RECUSA qualquer chamada. Este módulo — e o adapter
 * que o consome — **não importa nenhum cliente HTTP**: sem `fetch`, `undici`, `axios`,
 * `node:http`, `node:https`, `node:net` e `node:tls`. Não existe socket a abrir neste slice;
 * o transporte real (mTLS/TLS 1.2) pertence ao 016D-C, sob gates humanos próprios.
 *
 * O transporte também NÃO resolve PFX nem senha: o material do certificado é assunto do
 * consumidor autorizado (F4/F5), nunca deste contrato.
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
  readonly timeoutMs: number
}

export type SefazTransportErrorCode =
  /** Transporte offline por construção: nenhuma tentativa de rede foi feita. */
  | "transporte_offline_bloqueado"
  /** Transporte recusou o destino (não deveria acontecer: catálogo já filtra). */
  | "transporte_destino_recusado"

export type SefazTransportOutcome = {
  readonly ok: false
  readonly codigo: SefazTransportErrorCode
  readonly mensagem: string
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
      // Literal `false` nesta implementação: nenhum socket é aberto, então não há tentativa.
      externalTransmissionAttempted: false as const,
    }
  }
}

/** Instância compartilhada do transporte offline (sem estado). */
export const sefazOfflineRefusingTransport = new SefazOfflineRefusingTransport()
