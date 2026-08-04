/**
 * Envelope SOAP 1.2 da SEFAZ (GOAL-016D-A · plano 016D D5 · MOC 7.00 §3.2).
 *
 * Montagem OFFLINE, pura, sem rede. Regras oficiais aplicadas:
 *  - SOAP **1.2**, `Content-Type: application/soap+xml; charset=utf-8`;
 *  - **sem `soap12:Header`** — o leiaute 4.00 eliminou o `nfeCabecMsg` (MOC 7.00: *"foi
 *    eliminado o uso de variáveis no SOAP Header"*);
 *  - corpo `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/<Serviço>">`;
 *  - UTF-8; **zero compressão** (GZip só existe no método `…LoteZip`, fora do piloto).
 *
 * ⚠️ **Byte-exatidão (ADR-0017/0018).** Os bytes fiscais assinados entram no envelope por
 * CONCATENAÇÃO DE BYTES — nunca há parse, re-serialização, normalização, re-indentação ou
 * round-trip de string do XML assinado. Qualquer uma dessas operações invalidaria a
 * assinatura XMLDSig. O prefixo e o sufixo são gerados separadamente e os `exactBytes`
 * originais são copiados intactos entre eles.
 */
import { sefazServiceNamespace, type SefazServico } from "./sefaz-endpoint-catalog"

/** Content-Type obrigatório do SOAP 1.2 (MOC 7.00). */
export const SEFAZ_SOAP12_CONTENT_TYPE = "application/soap+xml; charset=utf-8" as const

const SOAP12_ENVELOPE_NS = "http://www.w3.org/2003/05/soap-envelope"

export type SefazSoapEnvelope = {
  readonly contentType: typeof SEFAZ_SOAP12_CONTENT_TYPE
  /** Envelope completo em bytes — os bytes fiscais aparecem intactos no meio. */
  readonly bytes: Uint8Array
  /** Offset onde os bytes fiscais começam dentro de `bytes` (prova de byte-exatidão). */
  readonly fiscalBytesOffset: number
  readonly fiscalBytesLength: number
  readonly namespace: string
}

/**
 * Monta o envelope SOAP 1.2 preservando os bytes fiscais byte a byte.
 *
 * `exactBytes` deve ser exatamente o que foi persistido e conferido por hash pelo
 * coordenador (ADR-0017) — este módulo não gera, altera, assina nem valida XML.
 */
export function buildSefazSoap12Envelope(input: {
  servico: SefazServico
  exactBytes: Uint8Array
}): SefazSoapEnvelope {
  const namespace = sefazServiceNamespace(input.servico)
  const encoder = new TextEncoder()

  // Sem `soap12:Header` — o leiaute 4.00 eliminou o nfeCabecMsg.
  const prefixo = encoder.encode(
    `<?xml version="1.0" encoding="utf-8"?>` +
      `<soap12:Envelope xmlns:soap12="${SOAP12_ENVELOPE_NS}">` +
      `<soap12:Body>` +
      `<nfeDadosMsg xmlns="${namespace}">`,
  )
  const sufixo = encoder.encode(`</nfeDadosMsg></soap12:Body></soap12:Envelope>`)

  const bytes = new Uint8Array(prefixo.length + input.exactBytes.length + sufixo.length)
  bytes.set(prefixo, 0)
  bytes.set(input.exactBytes, prefixo.length)
  bytes.set(sufixo, prefixo.length + input.exactBytes.length)

  return {
    contentType: SEFAZ_SOAP12_CONTENT_TYPE,
    bytes,
    fiscalBytesOffset: prefixo.length,
    fiscalBytesLength: input.exactBytes.length,
    namespace,
  }
}

/**
 * Extrai de volta os bytes fiscais do envelope. Existe para PROVA (teste de byte-exatidão)
 * e diagnóstico — não faz parse de XML, apenas recorta pelo offset registrado na montagem.
 */
export function extractFiscalBytes(envelope: SefazSoapEnvelope): Uint8Array {
  return envelope.bytes.slice(
    envelope.fiscalBytesOffset,
    envelope.fiscalBytesOffset + envelope.fiscalBytesLength,
  )
}
