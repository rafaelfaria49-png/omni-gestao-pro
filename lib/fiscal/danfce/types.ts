/**
 * Modelo de dados do DANFC-e (NFC-e 4.00) — GOAL 021.
 *
 * Contrato puro, imutável, derivado exclusivamente do documento fiscal persistido
 * (XML + metadados de `NotaFiscal`). Sem Venda/Produto/Cliente vivos.
 */

export const DANFCE_DOCUMENTO = "DANFCE" as const
export const DANFCE_LAYOUT = "4.00" as const

export type DanfceAmbiente = "HOMOLOGACAO" | "PRODUCAO"
export type DanfceVariante = "autorizado" | "contingencia"

export type DanfceConsumidor =
  | { readonly kind: "ausente" }
  | { readonly kind: "cpf"; readonly cpf: string; readonly nome: string | null }
  | { readonly kind: "cnpj"; readonly cnpj: string; readonly nome: string | null }

export type DanfceItem = {
  readonly nItem: string
  readonly codigo: string
  readonly descricao: string
  readonly quantidade: string
  readonly unidade: string
  readonly valorUnitario: string
  readonly valorTotal: string
}

export type DanfcePagamento = {
  readonly tPag: string
  readonly descricao: string
  readonly valor: string
}

export type DanfceEmitente = {
  readonly razaoSocial: string
  readonly nomeFantasia: string | null
  readonly cnpj: string
  readonly ie: string | null
  readonly endereco: string
}

export type DanfceModel = {
  readonly documento: typeof DANFCE_DOCUMENTO
  readonly layout: typeof DANFCE_LAYOUT
  readonly variante: DanfceVariante
  readonly ambiente: DanfceAmbiente
  readonly tpAmb: "1" | "2"
  readonly tpEmis: string
  readonly homologacaoSemValorFiscal: boolean
  readonly contingencia: boolean
  readonly emitente: DanfceEmitente
  readonly consumidor: DanfceConsumidor
  readonly itens: readonly DanfceItem[]
  readonly quantidadeTotalItens: string
  readonly valorTotal: string
  readonly vProd: string | null
  readonly vDesc: string | null
  readonly vTotTrib: string | null
  readonly pagamentos: readonly DanfcePagamento[]
  readonly troco: string | null
  readonly numero: string
  readonly serie: string
  readonly dhEmi: string
  readonly chaveAcesso: string
  readonly protocolo: string | null
  readonly dataAutorizacao: string | null
  readonly qrCodeData: string
  readonly urlConsulta: string
  readonly mensagensFiscais: readonly string[]
  readonly informacoesAdicionais: string | null
  readonly tributosResumo: string | null
  readonly notaFiscalId: string
  readonly storeId: string
}

export type DanfceReprintLocator = {
  readonly storeId: string
  readonly notaFiscalId: string
  readonly vendaId?: string
}

export type DanfceParseErrorCode =
  | "xml_ausente"
  | "xml_invalido"
  | "chave_ausente"
  | "qr_ausente"
  | "qr_divergente"
  | "url_nao_oficial"
  | "store_id_obrigatorio"
  | "nota_nao_encontrada"

export class DanfceParseError extends Error {
  readonly code: DanfceParseErrorCode
  constructor(code: DanfceParseErrorCode, message: string) {
    super(message)
    this.name = "DanfceParseError"
    this.code = code
  }
}

export const DANFCE_MSG_HOMOLOGACAO = "EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO – SEM VALOR FISCAL"
export const DANFCE_MSG_CONTINGENCIA = "EMITIDA EM CONTINGÊNCIA"
export const DANFCE_MSG_CONTINGENCIA_PENDENTE = "Pendente de autorização"
export const DANFCE_MSG_SEM_PROTOCOLO = "Documento em contingência — sem protocolo de autorização"
export const DANFCE_MSG_CONSULTA = "Consulte pela Chave de Acesso em"
export const DANFCE_TITULO_AUTORIZADO = "DANFC-e"
export const DANFCE_TITULO_CONTINGENCIA = "DANFC-e — CONTINGÊNCIA"
export const DANFCE_SUBTITULO = "Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica"
export const DOCUMENTO_NAO_FISCAL_LABEL = "DOCUMENTO NÃO FISCAL"
export const DOCUMENTO_NAO_FISCAL_NAO_E_DANFCE = "Este comprovante não é DANFC-e / NFC-e."
