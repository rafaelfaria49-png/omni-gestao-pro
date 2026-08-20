/**
 * XML sintético derivado do corpus XSD aprovado. Sem cliente real, sem SEFAZ,
 * sem certificado de produção. Persistido como texto de coluna — o Contador
 * não reconstrói XML na leitura.
 */
import { VALID_NFCE_XML } from "@/lib/fiscal/xsd/__fixtures__/nfce-xsd-fixtures"

export const DHEMI_COMPETENCIA = "2026-07-14T12:00:00-03:00"
export const DHEMI_FORA_COMPETENCIA = "2026-06-14T12:00:00-03:00"
export const DHEMI_INVALIDO = "nao-e-instante"

function withDhEmi(xml: string, dhEmi: string): string {
  return xml.replace(/<dhEmi>[^<]*<\/dhEmi>/, `<dhEmi>${dhEmi}</dhEmi>`)
}

function withoutDhEmi(xml: string): string {
  return xml.replace(/<dhEmi>[^<]*<\/dhEmi>/, "")
}

/** AUTORIZADA entregável: dhEmi na competência 2026-07. */
export const XML_AUTORIZADA_COMPETENCIA = withDhEmi(VALID_NFCE_XML, DHEMI_COMPETENCIA)

/** AUTORIZADA fora da competência de referência. */
export const XML_AUTORIZADA_FORA = withDhEmi(VALID_NFCE_XML, DHEMI_FORA_COMPETENCIA)

/** AUTORIZADA com dhEmi ilegível (fail-closed DECISION_3). */
export const XML_AUTORIZADA_DHEMI_INVALIDO = withDhEmi(VALID_NFCE_XML, DHEMI_INVALIDO)

/** AUTORIZADA sem elemento dhEmi. */
export const XML_SEM_DHEMI = withoutDhEmi(VALID_NFCE_XML)
