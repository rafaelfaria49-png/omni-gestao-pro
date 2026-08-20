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
 * Formas com evidência persistida E mapeamento `tPag` comprovado neste contrato.
 * Carne / a prazo existem na venda mas NÃO entram aqui (gap B).
 * creditoVale entra só via handoff (tPag 21); o breakdown legado permanece
 * fail-closed — não reclassifica venda histórica.
 */
export const FORMAS_INTERNAS_COM_TPAG = [
  "dinheiro",
  "pix",
  "cartaoDebito",
  "cartaoCredito",
  "creditoVale",
] as const

export type FormaInternaComTPag = (typeof FORMAS_INTERNAS_COM_TPAG)[number]

export const PAGAMENTO_FISCAL_ERRO_CODES = [
  "PAGAMENTO_AUSENTE",
  "PAGAMENTO_FORMATO_INVALIDO",
  "PAGAMENTO_VALOR_INVALIDO",
  "PAGAMENTO_FORMA_DESCONHECIDA",
  "PAGAMENTO_FORMA_SEM_CAPACIDADE_FISCAL",
  "PAGAMENTO_PIX_LEGADO_SEM_EVIDENCIA",
  "PAGAMENTO_PIX_TPINTEGRA_AUSENTE",
  "PAGAMENTO_PIX_TPINTEGRA_INVALIDO",
  "PAGAMENTO_PIX_INTEGRADO_NAO_SUPORTADO",
  "PAGAMENTO_CARTAO_TPINTEGRA_AUSENTE",
  "PAGAMENTO_CARTAO_TPINTEGRA_INVALIDO",
  "PAGAMENTO_CARTAO_INTEGRADO_NAO_SUPORTADO",
  "PAGAMENTO_CARTAO_LEGADO_SEM_EVIDENCIA",
  "PAGAMENTO_CARTAO_DADOS_NAO_SUPORTADOS",
  "PAGAMENTO_SOMA_DIVERGENTE",
  "PAGAMENTO_CANONICO_AUSENTE",
  "PAGAMENTO_HANDOFF_INVALIDO",
  "PAGAMENTO_HANDOFF_VERSAO_DESCONHECIDA",
] as const

export type PagamentoFiscalErroCode = (typeof PAGAMENTO_FISCAL_ERRO_CODES)[number]

/**
 * YA04a `tpIntegra` (XSD PL_010e_v1.02):
 * 1 = pagamento integrado (TEF / e-commerce / POS integrado / PSP) — capacidade ausente;
 * 2 = pagamento não integrado (POS simples / PIX dinâmico manual) — única capacidade
 *     suportada para tPag 03/04 e 17.
 */
export const TPINTEGRA_VALORES = ["1", "2"] as const
export type TpIntegraFiscal = (typeof TPINTEGRA_VALORES)[number]
export const TPINTEGRA_POS_NAO_INTEGRADO: TpIntegraFiscal = "2"
export const TPINTEGRA_INTEGRADO: TpIntegraFiscal = "1"

export function isTpIntegra(value: unknown): value is TpIntegraFiscal {
  return value === "1" || value === "2"
}

export type PagamentoFiscalErro = {
  readonly code: PagamentoFiscalErroCode
  readonly mensagem: string
  readonly campo: string | null
}

/**
 * Uma parcela de `detPag`.
 *
 * Cartão 03/04 e PIX dinâmico 17 (contrato novo): `tpIntegra` obrigatório.
 * Única capacidade = `"2"` (não integrado). Sem CNPJ / tBand / cAut / CNPJReceb /
 * idTermPag / NSU / e2eid. tPag 20/23 não carregam tpIntegra (YA04-10 não os lista).
 * Sem `xPag`. Sem `indPag` inventado.
 */
export type PagamentoFiscalDetalhe = {
  readonly formaInterna: FormaInternaComTPag
  readonly tPag: TPagOficial
  readonly vPag: number
  /** Presente em tPag 03/04 e 17 com evidência. Valor suportado neste slice: `"2"`. */
  readonly tpIntegra?: TpIntegraFiscal
}

/**
 * Pagamento fiscal congelado.
 *
 * `soma` = Σ detPag.vPag (valores informados no XML, não o líquido da venda).
 * `vTroco` = null quando não há evidência de dinheiro entregue acima do aplicado;
 * caso contrário é Σ(vPag) − vNF, derivado no servidor a partir de `cashTendered`.
 * Invariância oficial (NT 2016.002 YA09-10): soma − (vTroco ?? 0) === total da venda.
 */
export type PagamentoFiscalFonte =
  | "venda.payload.paymentBreakdown"
  | "venda.payload.fiscalPaymentHandoff"

export type PagamentoFiscalCanonico = {
  readonly versao: typeof PAGAMENTO_FISCAL_CONTRATO_VERSAO
  readonly fonte: PagamentoFiscalFonte
  readonly catalogoTPag: "IT-2024.002-v1.11"
  readonly det: readonly PagamentoFiscalDetalhe[]
  readonly soma: number
  readonly vTroco: number | null
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
