/**
 * Fronteira canônica de pagamento fiscal: Venda persistida → contrato tipado → XML NFC-e.
 * PURO. Sem Prisma, sem Caixa, sem Financeiro, sem PDV vivo, sem SEFAZ.
 */

export {
  TPAG_CATALOGO_FONTE,
  TPAG_CATALOGO_XSD,
  TPAG_CATALOGO_OFICIAL,
  isTPagOficial,
  descricaoTPag,
} from "./tpag-catalog"
export type { TPagOficial, TPagCatalogoEntry } from "./tpag-catalog"

export {
  PIX_QR_KINDS,
  PIX_QR_KIND_TO_TPAG,
  TPAG_PIX_QR_KIND,
  PIX_QR_KIND_OPCOES_OPERADOR,
  isPixQrKind,
  tPagFromPixQrKind,
} from "./pix-qr-kind"
export type { PixQrKind } from "./pix-qr-kind"

export {
  PAGAMENTO_FISCAL_CONTRATO_VERSAO,
  FORMAS_INTERNAS_PERSISTIDAS,
  FORMAS_INTERNAS_COM_TPAG,
  PAGAMENTO_FISCAL_ERRO_CODES,
} from "./types"
export type {
  FormaInternaPersistida,
  FormaInternaComTPag,
  PagamentoFiscalErroCode,
  PagamentoFiscalErro,
  PagamentoFiscalDetalhe,
  PagamentoFiscalFonte,
  PagamentoFiscalCanonico,
  PagamentoFiscalDeriveResult,
} from "./types"

export { derivePagamentoFiscalFromBreakdown, assertPagamentoFiscalCanonico } from "./from-venda-breakdown"
export {
  derivePagamentoFiscalFromHandoff,
  derivePagamentoFiscal,
  isFiscalPaymentHandoffPresent,
} from "./from-handoff"
