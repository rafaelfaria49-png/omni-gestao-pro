/**
 * Evidência YA04 (grupo `card`) para tPag 17 (PIX dinâmico).
 *
 * Não é analogia com cartão 03/04. Autoridade: NT 2025.001 v1.02 YA04-10
 * (msg 391) — NFC-e modelo 65 com tPag 03, 04 **ou 17** deve informar `card`.
 * YA05-10 (CNPJ + cAut) só quando `tpIntegra=1`.
 *
 * Capacidade deste slice: somente `tpIntegra="2"` (pagamento não integrado).
 * Fluxo auditado: OmniGestão não gera cobrança PIX, não gera QR via PSP, não
 * consulta PSP, não recebe e2eid; o operador confirma manualmente. XSD
 * PL_010e_v1.02: 2 = “não integrado com o sistema de automação”.
 *
 * tPag 20/23 NÃO entram aqui (YA04-10 não os lista; sem obrigação nova).
 * TEF / PSP / e2eid fictício: fail-closed.
 *
 * PURO. Sem Prisma, Caixa, Financeiro, PDV vivo, adquirente ou SEFAZ.
 */

import {
  TPINTEGRA_INTEGRADO,
  TPINTEGRA_POS_NAO_INTEGRADO,
  isTpIntegra,
  type PagamentoFiscalErro,
} from "./types"

export function isTPagPixDinamico(tPag: string): tPag is "17" {
  return tPag === "17"
}

export const MSG_PIX_TPINTEGRA_AUSENTE =
  "tPag 17 (PIX dinâmico) exige tpIntegra explícito. Sem evidência, Fiscal não omite o grupo card e não presume POS/PSP não integrado a partir do handoff histórico."

export const MSG_PIX_TPINTEGRA_INVALIDO =
  "tpIntegra inválido para PIX dinâmico. Valores oficiais: 1 (integrado) ou 2 (não integrado)."

export const MSG_PIX_INTEGRADO_NAO_SUPORTADO =
  "tpIntegra=1 (pagamento integrado / PSP) não é capacidade suportada. O fluxo PIX dinâmico atual não gera cobrança, QR via PSP, consulta nem e2eid; não fabricar autorização."

function erro(code: PagamentoFiscalErro["code"], mensagem: string, campo: string | null): PagamentoFiscalErro {
  return { code, mensagem, campo }
}

/**
 * Valida tpIntegra para uma linha/detalhe tPag 17.
 * `undefined` = ausente. Qualquer outro valor não oficial = inválido.
 */
export function erroTpIntegraPixDinamico(
  tpIntegra: unknown,
  campo: string,
): PagamentoFiscalErro | null {
  if (tpIntegra === undefined || tpIntegra === null || tpIntegra === "") {
    return erro("PAGAMENTO_PIX_TPINTEGRA_AUSENTE", MSG_PIX_TPINTEGRA_AUSENTE, campo)
  }
  if (!isTpIntegra(tpIntegra)) {
    return erro("PAGAMENTO_PIX_TPINTEGRA_INVALIDO", MSG_PIX_TPINTEGRA_INVALIDO, campo)
  }
  if (tpIntegra === TPINTEGRA_INTEGRADO) {
    return erro("PAGAMENTO_PIX_INTEGRADO_NAO_SUPORTADO", MSG_PIX_INTEGRADO_NAO_SUPORTADO, campo)
  }
  if (tpIntegra !== TPINTEGRA_POS_NAO_INTEGRADO) {
    return erro("PAGAMENTO_PIX_TPINTEGRA_INVALIDO", MSG_PIX_TPINTEGRA_INVALIDO, campo)
  }
  return null
}

export function tpIntegraPixDinamicoValido(value: unknown): value is typeof TPINTEGRA_POS_NAO_INTEGRADO {
  return value === TPINTEGRA_POS_NAO_INTEGRADO
}
