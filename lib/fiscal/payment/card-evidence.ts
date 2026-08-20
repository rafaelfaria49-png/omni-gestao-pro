/**
 * Evidência YA04 (grupo `card`) para tPag 03/04.
 *
 * Capacidade deste slice: somente `tpIntegra="2"` (POS não integrado).
 * TEF (`tpIntegra="1"`) e filhos YA05–YA11 / NSU são fail-closed.
 * PIX 17 + YA04 NÃO é tratado aqui — residual de GOAL separado.
 *
 * PURO. Sem Prisma, Caixa, Financeiro, PDV vivo, adquirente ou SEFAZ.
 */

import {
  TPINTEGRA_INTEGRADO,
  TPINTEGRA_POS_NAO_INTEGRADO,
  isTpIntegra,
  type PagamentoFiscalErro,
} from "./types"

export const CAMPOS_CARTAO_PROIBIDOS = [
  "CNPJ",
  "tBand",
  "cAut",
  "CNPJReceb",
  "idTermPag",
  "NSU",
  "card",
  "maquininhaId",
] as const

export function isTPagCartao(tPag: string): tPag is "03" | "04" {
  return tPag === "03" || tPag === "04"
}

export function isFormaCartao(forma: string): forma is "cartaoDebito" | "cartaoCredito" {
  return forma === "cartaoDebito" || forma === "cartaoCredito"
}

export const MSG_CARTAO_LEGADO =
  "Cartão legado sem evidência explícita de tpIntegra. Emissão futura exige fiscalPaymentHandoff com tpIntegra=2 (POS não integrado). Sem presumir POS simples a partir do paymentBreakdown histórico."

export const MSG_CARTAO_TPINTEGRA_AUSENTE =
  "tPag 03/04 exige tpIntegra explícito. Sem evidência, Fiscal não omite o grupo card e não inventa POS simples."

export const MSG_CARTAO_TPINTEGRA_INVALIDO =
  "tpIntegra inválido. Valores oficiais: 1 (integrado) ou 2 (POS não integrado)."

export const MSG_CARTAO_INTEGRADO_NAO_SUPORTADO =
  "tpIntegra=1 (pagamento integrado / TEF) não é capacidade suportada. Este fluxo é POS não integrado; não fabricar CNPJ, tBand, cAut nem autorização."

export const MSG_CARTAO_DADOS_NAO_SUPORTADOS =
  "Campos de cartão além de tpIntegra=2 não são suportados (CNPJ, tBand, cAut, CNPJReceb, idTermPag, NSU). Não fabricar evidência de adquirente."

function erro(code: PagamentoFiscalErro["code"], mensagem: string, campo: string | null): PagamentoFiscalErro {
  return { code, mensagem, campo }
}

export function campoCartaoProibidoPresente(raw: Record<string, unknown>): string | null {
  for (const key of CAMPOS_CARTAO_PROIBIDOS) {
    if (key in raw && raw[key] !== undefined && raw[key] !== null) return key
  }
  return null
}

/**
 * Valida tpIntegra para uma linha/detalhe 03/04.
 * `undefined` = ausente. Qualquer outro valor não oficial = inválido.
 */
export function erroTpIntegraCartao(
  tpIntegra: unknown,
  campo: string,
): PagamentoFiscalErro | null {
  if (tpIntegra === undefined || tpIntegra === null || tpIntegra === "") {
    return erro("PAGAMENTO_CARTAO_TPINTEGRA_AUSENTE", MSG_CARTAO_TPINTEGRA_AUSENTE, campo)
  }
  if (!isTpIntegra(tpIntegra)) {
    return erro("PAGAMENTO_CARTAO_TPINTEGRA_INVALIDO", MSG_CARTAO_TPINTEGRA_INVALIDO, campo)
  }
  if (tpIntegra === TPINTEGRA_INTEGRADO) {
    return erro("PAGAMENTO_CARTAO_INTEGRADO_NAO_SUPORTADO", MSG_CARTAO_INTEGRADO_NAO_SUPORTADO, campo)
  }
  if (tpIntegra !== TPINTEGRA_POS_NAO_INTEGRADO) {
    return erro("PAGAMENTO_CARTAO_TPINTEGRA_INVALIDO", MSG_CARTAO_TPINTEGRA_INVALIDO, campo)
  }
  return null
}

export function tpIntegraCartaoValido(value: unknown): value is typeof TPINTEGRA_POS_NAO_INTEGRADO {
  return value === TPINTEGRA_POS_NAO_INTEGRADO
}
