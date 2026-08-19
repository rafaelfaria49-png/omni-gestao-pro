/**
 * Contrato canônico e versionado de pagamento fiscal (NFC-e).
 *
 * Representa SOMENTE o que a NFC-e precisa, derivado do que a venda JÁ persistiu
 * no instante do snapshot. O XML consome este contrato — nunca o `paymentBreakdown`
 * bruto, nunca Caixa/Financeiro/PDV vivo.
 *
 * Fiscal NÃO executa, confirma, liquida nem altera pagamento.
 */

import type { TPagOficial } from "./tpag-catalog"

export const PAGAMENTO_FISCAL_CONTRATO_VERSAO = 1 as const

/**
 * Chaves do `Venda.payload.paymentBreakdown` comprovadas nos PDVs ativos
 * (`PaymentBreakdownFull` / `reducePaymentsToBreakdown` / persistência da venda).
 */
export const FORMAS_INTERNAS_PERSISTIDAS = [
  "dinheiro",
  "pix",
  "cartaoDebito",
  "cartaoCredito",
  "carne",
  "aPrazo",
  "creditoVale",
] as const

export type FormaInternaPersistida = (typeof FORMAS_INTERNAS_PERSISTIDAS)[number]

/**
 * Formas com evidência persistida E mapeamento `tPag` comprovado neste GOAL.
 * Carne / a prazo / crédito-vale existem na venda mas NÃO entram aqui (gap B).
 */
export const FORMAS_INTERNAS_COM_TPAG = ["dinheiro", "pix", "cartaoDebito", "cartaoCredito"] as const

export type FormaInternaComTPag = (typeof FORMAS_INTERNAS_COM_TPAG)[number]

export const PAGAMENTO_FISCAL_ERRO_CODES = [
  "PAGAMENTO_AUSENTE",
  "PAGAMENTO_FORMATO_INVALIDO",
  "PAGAMENTO_VALOR_INVALIDO",
  "PAGAMENTO_FORMA_DESCONHECIDA",
  "PAGAMENTO_FORMA_SEM_CAPACIDADE_FISCAL",
  "PAGAMENTO_SOMA_DIVERGENTE",
  "PAGAMENTO_CANONICO_AUSENTE",
] as const

export type PagamentoFiscalErroCode = (typeof PAGAMENTO_FISCAL_ERRO_CODES)[number]

export type PagamentoFiscalErro = {
  readonly code: PagamentoFiscalErroCode
  readonly mensagem: string
  readonly campo: string | null
}

/**
 * Uma parcela de `detPag`. Sem grupo `card` (tpIntegra/CNPJ/tBand/cAut) — a venda
 * persistida não carrega esses campos. Sem `xPag`. Sem `indPag` inventado.
 */
export type PagamentoFiscalDetalhe = {
  readonly formaInterna: FormaInternaComTPag
  readonly tPag: TPagOficial
  readonly vPag: number
}

/**
 * Pagamento fiscal congelado. `vTroco` é sempre `null` neste contrato: o PDV
 * normaliza o dinheiro ao total antes de persistir e não grava valor entregue/troco.
 */
export type PagamentoFiscalCanonico = {
  readonly versao: typeof PAGAMENTO_FISCAL_CONTRATO_VERSAO
  readonly fonte: "venda.payload.paymentBreakdown"
  readonly catalogoTPag: "IT-2024.002-v1.11"
  readonly det: readonly PagamentoFiscalDetalhe[]
  readonly soma: number
  readonly vTroco: null
}

export type PagamentoFiscalDeriveOk = {
  readonly ok: true
  readonly pagamento: PagamentoFiscalCanonico
}

export type PagamentoFiscalDeriveErro = {
  readonly ok: false
  readonly erro: PagamentoFiscalErro
}

export type PagamentoFiscalDeriveResult = PagamentoFiscalDeriveOk | PagamentoFiscalDeriveErro
