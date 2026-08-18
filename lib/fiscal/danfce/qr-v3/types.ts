/**
 * Tipos do encoder puro de QR Code NFC-e versão 3 (GOAL 021A).
 *
 * Contrato: Manual DANFE NFC-e/QR v6.0 §4.4 + NT 2025.001 v1.03 §04 + XSD PL_010e
 * `QRCODE V3 ONLINE` / `QRCODE V3 OFFLINE`. Sem CSC. Sem XML. Sem rede.
 */

export const QR_V3_VERSAO = "3" as const

export type QrV3Ambiente = "1" | "2"

export type QrV3TpId = "1" | "2" | "3"

export type QrV3Destinatario =
  | { readonly kind: "ausente" }
  | { readonly kind: "cnpj"; readonly cnpj: string }
  | { readonly kind: "cpf"; readonly cpf: string }
  | { readonly kind: "estrangeiro" }

export type QrV3ErrorCode =
  | "chave_invalida"
  | "tp_amb_invalido"
  | "tp_emis_incompativel"
  | "dh_emi_invalido"
  | "vnf_invalido"
  | "destinatario_invalido"
  | "assinatura_ausente"
  | "assinatura_invalida"
  | "url_base_invalida"

export type QrV3Err = {
  readonly ok: false
  readonly code: QrV3ErrorCode
}

export type QrV3OnlineOk = {
  readonly ok: true
  readonly versao: typeof QR_V3_VERSAO
  readonly tpAmb: QrV3Ambiente
  readonly chave: string
  /** Concatenação canônica `chave|3|tpAmb`. */
  readonly payload: string
  /** Valor do parâmetro `p` (idêntico ao payload na v3). */
  readonly p: string
}

export type QrV3OfflineCanonicalOk = {
  readonly ok: true
  readonly versao: typeof QR_V3_VERSAO
  readonly tpAmb: QrV3Ambiente
  readonly chave: string
  readonly dia: string
  readonly vNF: string
  readonly tpId: QrV3TpId | ""
  readonly idDest: string
  /**
   * Mensagem UTF-8 a assinar: parâmetros 1–7 com `|`.
   * Consumidor não identificado: `chave|3|tpAmb|dia|vNF||`
   */
  readonly canonical: string
}

export type QrV3OfflineOk = QrV3OfflineCanonicalOk & {
  readonly assinatura: string
  /** Concatenação final `canonical|assinatura`. */
  readonly payload: string
  readonly p: string
}

export type QrV3OnlineInput = {
  readonly chave: string
  readonly tpAmb: QrV3Ambiente | 1 | 2 | "1" | "2"
}

export type QrV3OfflineFieldsInput = {
  readonly chave: string
  readonly tpAmb: QrV3Ambiente | 1 | 2 | "1" | "2"
  /** B09 `dhEmi` no formato NFC-e (`YYYY-MM-DDThh:mm:ss±HH:MM`). */
  readonly dhEmi: string
  /** W16 `vNF`: número ou string TDec_1302 (ponto decimal, sem milhar). */
  readonly vNF: string | number
  readonly destinatario?: QrV3Destinatario | null
}

/**
 * Porta de assinatura injetada. Recebe a concatenação 1–7 em UTF-8 e devolve
 * RSA-SHA-1 Base64. O encoder nunca abre PFX, EnvVault ou Prisma.
 */
export type QrV3OfflineSigner = (canonicalUtf8: string) => string

export type QrV3OfflineInput = QrV3OfflineFieldsInput & {
  readonly assinaturaBase64?: string
  readonly sign?: QrV3OfflineSigner
}
