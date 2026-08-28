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
  /** Data/hora em que a contingência offline foi acionada (`tpEmis=9`). */
  dhCont?: string | Date
  /** Justificativa da entrada em contingência offline (`xJust`, 15–256 chars). */
  xJust?: string
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
  /**
   * Opt-in do QR NFC-e v3 **online** (`infNFeSupl`). Ausente → XML idêntico ao caminho legado.
   *
   * `chave` e `tpAmb` NÃO entram aqui: derivam do mesmo build que produz `infNFe`.
   * URLs são injetadas pelo caller a partir de `selectNfceSpPublicUrls` (P-URL-SP).
   * Incompatível com `qrOfflineV3` e com `tpEmis=9`.
   */
  qrOnlineV3?: NfceQrOnlineV3Config
  /**
   * Opt-in do QR NFC-e v3 **offline** (`tpEmis=9`). Ausente → sem `infNFeSupl` no legado.
   *
   * `chave`, `tpAmb`, `dhEmi`, `vNF` e destinatário NÃO entram aqui: derivam do `infNFe`.
   * O caller injeta URLs e a assinatura RSA-SHA-1 do payload QR (não o XMLDSig).
   * Incompatível com `qrOnlineV3` e com `tpEmis≠9`.
   */
  qrOfflineV3?: NfceQrOfflineV3Config
}

/**
 * Configuração injetada do QR v3 online. Sem env, sem URL de SP hardcoded.
 * `urlChave` é a consulta por chave (ZX03), distinta da base do QR (`qrCodeBaseUrl`).
 */
export type NfceQrOnlineV3Config = {
  /** URL base do QR (`https://host/…` sem `?p=`). */
  qrCodeBaseUrl: string
  /** URL da consulta por chave de acesso (XSD: TString, 21–85). */
  urlChave: string
}

/**
 * Configuração injetada do QR v3 offline. Sem env, sem URL de SP hardcoded, sem cofre.
 * `sign` e `assinaturaBase64` assinam a concatenação 1–7 — nunca o DigestValue XMLDSig.
 */
export type NfceQrOfflineV3Config = {
  qrCodeBaseUrl: string
  urlChave: string
  /** Porta RSA-SHA-1 Base64 da concatenação canônica 1–7. */
  sign?: (canonicalUtf8: string) => string
  /** Assinatura já pronta (mesmo alfabeto Base64 do encoder). */
  assinaturaBase64?: string
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
  | "qr_online_invalido"
  | "qr_offline_invalido"
  | "qr_modo_incompativel"
  | "contingencia_invalida"
  | "pagamento_ausente"
  | "pagamento_formato_invalido"
  | "pagamento_valor_invalido"
  | "pagamento_forma_desconhecida"
  | "pagamento_forma_sem_capacidade"
  | "pagamento_pix_legado_sem_evidencia"
  | "pagamento_pix_tpintegra_ausente"
  | "pagamento_pix_tpintegra_invalido"
  | "pagamento_pix_integrado_nao_suportado"
  | "pagamento_cartao_tpintegra_ausente"
  | "pagamento_cartao_tpintegra_invalido"
  | "pagamento_cartao_integrado_nao_suportado"
  | "pagamento_cartao_legado_sem_evidencia"
  | "pagamento_cartao_dados_nao_suportados"
  | "pagamento_soma_divergente"
  | "pagamento_canonico_ausente"

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
  /**
   * Presente somente quando QR v3 válido foi injetado. Origem estrutural de
   * `qrCodeData`/`urlConsulta` na finalização (`FinalizedFiscalDocument`) —
   * não extrair depois por regex do XML.
   */
  infNFeSupl?: { qrCode: string; urlChave: string }
}
