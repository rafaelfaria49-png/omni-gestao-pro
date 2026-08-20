/**
 * XML sintético derivado do corpus XSD aprovado. Sem cliente real, sem SEFAZ,
 * sem certificado de produção. Persistido como texto de coluna — o Contador
 * não reconstrói XML na leitura.
 */
import { VALID_NFCE_XML } from "@/lib/fiscal/xsd/__fixtures__/nfce-xsd-fixtures"

export const DHEMI_COMPETENCIA = "2026-07-14T12:00:00-03:00"
export const DHEMI_COMPETENCIA_Z = "2026-07-14T15:00:00Z"
export const DHEMI_FORA_COMPETENCIA = "2026-06-14T12:00:00-03:00"
export const DHEMI_INVALIDO = "nao-e-instante"
export const DHEMI_SEM_OFFSET = "2026-07-14T12:00:00"
export const DHEMI_SO_DATA = "2026-07-14"

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

/** AUTORIZADA com timezone `Z` (UTC explícito). */
export const XML_AUTORIZADA_DHEMI_Z = withDhEmi(VALID_NFCE_XML, DHEMI_COMPETENCIA_Z)

/** AUTORIZADA com datetime sem timezone — deve ser rejeitado (fail-closed). */
export const XML_AUTORIZADA_SEM_OFFSET = withDhEmi(VALID_NFCE_XML, DHEMI_SEM_OFFSET)

/** AUTORIZADA com data nua, sem hora/offset. */
export const XML_AUTORIZADA_SO_DATA = withDhEmi(VALID_NFCE_XML, DHEMI_SO_DATA)

/** AUTORIZADA com dhEmi vazio. */
export const XML_DHEMI_VAZIO = withDhEmi(VALID_NFCE_XML, "")

/**
 * XML com dois `dhEmi` (ambos com offset). Cardinalidade 2+ → extração nula.
 * Não é “primeiro match vence”.
 */
export const XML_DHEMI_DUPLICADO = VALID_NFCE_XML.replace(
  /<dhEmi>[^<]*<\/dhEmi>/,
  `<dhEmi>${DHEMI_COMPETENCIA}</dhEmi><dhEmi>${DHEMI_COMPETENCIA_Z}</dhEmi>`,
)

/**
 * REJEITADA sintética da massa HOMOLOGACAO: exatamente 1 dhEmi com offset
 * na competência 2026-07. Sem data fiscal válida o sinal não é atribuído ao
 * mês; a prova exige REJECTED_COUNT=1. Não é Production.
 */
export const XML_REJEITADA_COMPETENCIA = withDhEmi(VALID_NFCE_XML, DHEMI_COMPETENCIA)
