/**
 * Tipos do gerador de XML NFC-e 4.00 (BL-FISCAL-004).
 *
 * O builder consome o Snapshot Fiscal CONGELADO (`VendaFiscalSnapshot`) e produz XML.
 * Os campos que NÃO existem no snapshot (numeração — série/número — alocada pela camada
 * `lib/fiscal/numbering` no momento da emissão, e parâmetros de emissão) entram por este
 * `NfceXmlContext` OPCIONAL. Quando ausente, são tratados como PLACEHOLDER e sinalizados
 * como pendência pela validação (o XML ainda é montado, mas não representa documento real).
 */

export const NFCE_XML_VERSAO = "4.00"
export const NFCE_MODELO = "65"
export const NFCE_XMLNS = "http://www.portalfiscal.inf.br/nfe"
/** Identificação do aplicativo emissor (verProc). */
export const NFCE_VER_PROC = "OmniGestao-Fiscal1.0"

/** Contexto de emissão NÃO presente no snapshot (numeração + parâmetros do documento). */
export type NfceXmlContext = {
  /** Série (3 díg). Default 0 (placeholder — numeração não alocada). */
  serie?: number
  /** Número da NF (nNF, 9 díg). Default 0 (placeholder). */
  numero?: number
  /** Código numérico (cNF). Default: derivado determinístico do vendaId. */
  cNF?: string
  /** Tipo de emissão (1 = normal). Default 1. */
  tpEmis?: number
  /** Data/hora de emissão. Default: `snapshot.venda.data`. */
  dataEmissao?: string | Date
  /** Natureza da operação. Default "VENDA AO CONSUMIDOR". */
  naturezaOperacao?: string
  /** verProc. Default `NFCE_VER_PROC`. */
  versaoAplicativo?: string
  /**
   * Omite a declaração `<?xml ?>`. Default false (inclui).
   *
   * ⚠️ NÃO é o contrato de transmissão: para bytes destinados a assinatura use
   * `buildNfceXmlAssinavel`. Quando `true`, o builder cai no mesmo produtor embutível e o
   * contrato é provado — não existe caminho que gere NFC-e sem declaração sem essa prova.
   */
  omitDeclaration?: boolean
}

export type NfceXmlErrorCode =
  | "snapshot_invalido"
  | "sem_itens"
  | "emitente_invalido"
  | "uf_invalida"
  | "tributacao_ausente"
  | "tributacao_pendente"
  | "tributacao_desalinhada"
  | "item_sem_ncm"
  | "item_sem_cfop"
  | "destinatario_invalido"

/** Erro estrutural do builder — lançado quando falta informação OBRIGATÓRIA. */
export class NfceXmlError extends Error {
  readonly code: NfceXmlErrorCode
  readonly itemIndex: number | null
  readonly campo: string | null
  constructor(code: NfceXmlErrorCode, message: string, itemIndex: number | null = null, campo: string | null = null) {
    super(message)
    this.name = "NfceXmlError"
    this.code = code
    this.itemIndex = itemIndex
    this.campo = campo
  }
}

export type NfceValidationIssue = {
  code: NfceXmlErrorCode
  mensagem: string
  itemIndex: number | null
  campo: string | null
}

export type NfceValidationResult = {
  /** true quando NÃO há erros bloqueantes (pode haver pendências não-bloqueantes). */
  ok: boolean
  /** Erros bloqueantes — impedem a montagem do XML. */
  erros: NfceValidationIssue[]
  /** Pendências não-bloqueantes (ex.: numeração placeholder, IE ausente, GTIN ausente). */
  pendencias: string[]
  /** true quando a chave de acesso é calculável (cUF + CNPJ válidos). */
  chaveAcessoCalculavel: boolean
}

/** Resultado rico do builder (XML + metadados úteis sem reparsear). */
export type BuildNfceXmlResult = {
  xml: string
  chaveAcesso: string
  /** Numeração efetivamente usada (placeholder quando não veio no contexto). */
  serie: number
  numero: number
  numeracaoPlaceholder: boolean
  validacao: NfceValidationResult
}
