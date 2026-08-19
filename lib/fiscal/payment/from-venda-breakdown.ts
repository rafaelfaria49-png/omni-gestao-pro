/**
 * Derivação fail-closed do contrato de pagamento fiscal a partir do
 * `Venda.payload.paymentBreakdown` persistido.
 *
 * Formato comprovado pelos PDVs ativos: objeto plano `PaymentBreakdownFull`
 * `{ dinheiro, pix, cartaoDebito, cartaoCredito, carne, aPrazo, creditoVale }`
 * com números. Não há array `{forma, valor}`, não há tPag na origem, não há
 * metadata de cartão/TEF, não há valor entregue/troco persistidos.
 *
 * Não inventa forma, não converte desconhecido em 99, não corrige soma.
 */

import {
  FORMAS_INTERNAS_COM_TPAG,
  FORMAS_INTERNAS_PERSISTIDAS,
  PAGAMENTO_FISCAL_CONTRATO_VERSAO,
  type FormaInternaComTPag,
  type FormaInternaPersistida,
  type PagamentoFiscalCanonico,
  type PagamentoFiscalDetalhe,
  type PagamentoFiscalDeriveResult,
  type PagamentoFiscalErro,
} from "./types"
import { isTPagOficial } from "./tpag-catalog"
import { TPAG_PIX_QR_KIND } from "./pix-qr-kind"

const FORMAS_COM_TPAG: ReadonlySet<string> = new Set(FORMAS_INTERNAS_COM_TPAG)
const FORMAS_PERSISTIDAS: ReadonlySet<string> = new Set(FORMAS_INTERNAS_PERSISTIDAS)

const FORMA_PARA_TPAG: Record<FormaInternaComTPag, string> = {
  dinheiro: "01",
  cartaoCredito: "03",
  cartaoDebito: "04",
  /**
   * LEGADO (vendas históricas sem `fiscalPaymentHandoff`): o PDV persistia apenas
   * `pix` (número). IT 2024.002 cinde PIX em 17/20/23. Este mapeamento para 17
   * permanece só no caminho legado; o handoff (GOAL 075/077) NÃO infere
   * o subtipo — tPag 17/20/23 só com pixQrKind.
   */
  pix: "17",
}

function tPagCompativelComFormaInterna(forma: FormaInternaComTPag, tPag: string): boolean {
  if (forma === "pix") return tPag in TPAG_PIX_QR_KIND
  return FORMA_PARA_TPAG[forma] === tPag
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function erro(code: PagamentoFiscalErro["code"], mensagem: string, campo: string | null = null): PagamentoFiscalDeriveResult {
  return { ok: false, erro: { code, mensagem, campo } }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function detSortKey(d: PagamentoFiscalDetalhe): string {
  return `${d.tPag}:${d.formaInterna}`
}

/**
 * Deriva o contrato canônico. `totalReferencia` é o total persistido da venda
 * (`Venda.total` / `snapshot.venda.total`). Soma divergente NÃO é corrigida.
 */
export function derivePagamentoFiscalFromBreakdown(
  breakdown: unknown,
  totalReferencia: number,
): PagamentoFiscalDeriveResult {
  if (breakdown == null) {
    return erro("PAGAMENTO_AUSENTE", "Pagamento ausente na venda persistida (paymentBreakdown nulo).", "venda.paymentBreakdown")
  }
  if (Array.isArray(breakdown)) {
    return erro(
      "PAGAMENTO_FORMATO_INVALIDO",
      "paymentBreakdown em array não é o formato persistido pelos PDVs ativos.",
      "venda.paymentBreakdown",
    )
  }
  if (!isPlainObject(breakdown)) {
    return erro("PAGAMENTO_FORMATO_INVALIDO", "paymentBreakdown não é um objeto plano persistido pela venda.", "venda.paymentBreakdown")
  }

  if (!Number.isFinite(totalReferencia) || totalReferencia < 0) {
    return erro("PAGAMENTO_VALOR_INVALIDO", "Total de referência da venda inválido (NaN/negativo/não-finito).", "venda.total")
  }

  const dets: PagamentoFiscalDetalhe[] = []

  for (const key of Object.keys(breakdown)) {
    const raw = breakdown[key]
    if (raw == null) continue

    const n = typeof raw === "number" ? raw : Number(raw)
    const zeroLike = typeof raw === "number" && raw === 0

    if (FORMAS_COM_TPAG.has(key)) {
      if (raw === "" || raw === false) continue
      if (!Number.isFinite(n)) {
        return erro("PAGAMENTO_VALOR_INVALIDO", `Valor inválido (NaN/não-finito) na forma "${key}".`, `venda.paymentBreakdown.${key}`)
      }
      if (n < 0) {
        return erro("PAGAMENTO_VALOR_INVALIDO", `Valor negativo na forma "${key}".`, `venda.paymentBreakdown.${key}`)
      }
      if (n === 0) continue
      const formaInterna = key as FormaInternaComTPag
      const tPag = FORMA_PARA_TPAG[formaInterna]
      if (!isTPagOficial(tPag)) {
        return erro("PAGAMENTO_FORMA_DESCONHECIDA", `tPag ${tPag} não pertence ao catálogo oficial ${"IT-2024.002-v1.11"}.`, `venda.paymentBreakdown.${key}`)
      }
      dets.push({ formaInterna, tPag, vPag: round2(n) })
      continue
    }

    if (FORMAS_PERSISTIDAS.has(key)) {
      if (zeroLike || n === 0) continue
      if (!Number.isFinite(n)) {
        return erro("PAGAMENTO_VALOR_INVALIDO", `Valor inválido na forma "${key}".`, `venda.paymentBreakdown.${key}`)
      }
      if (n < 0) {
        return erro("PAGAMENTO_VALOR_INVALIDO", `Valor negativo na forma "${key}".`, `venda.paymentBreakdown.${key}`)
      }
      const forma = key as FormaInternaPersistida
      return erro(
        "PAGAMENTO_FORMA_SEM_CAPACIDADE_FISCAL",
        `Forma persistida "${forma}" não possui mapeamento tPag comprovado neste contrato (gap B: informação fiscal insuficiente na venda).`,
        `venda.paymentBreakdown.${key}`,
      )
    }

    if (zeroLike || n === 0) continue
    return erro(
      "PAGAMENTO_FORMA_DESCONHECIDA",
      `Forma de pagamento desconhecida "${key}" — Fiscal não inventa tPag e não usa fallback de dinheiro.`,
      `venda.paymentBreakdown.${key}`,
    )
  }

  if (dets.length === 0) {
    return erro("PAGAMENTO_AUSENTE", "Nenhuma forma de pagamento com valor positivo na venda persistida.", "venda.paymentBreakdown")
  }

  dets.sort((a, b) => (detSortKey(a) < detSortKey(b) ? -1 : detSortKey(a) > detSortKey(b) ? 1 : 0))

  const soma = round2(dets.reduce((s, d) => s + d.vPag, 0))
  const totalR = round2(totalReferencia)
  if (soma !== totalR) {
    const lado = soma < totalR ? "abaixo" : "acima"
    return erro(
      "PAGAMENTO_SOMA_DIVERGENTE",
      `Soma do pagamento (${soma.toFixed(2)}) está ${lado} do total da venda (${totalR.toFixed(2)}). Sem correção automática.`,
      "venda.paymentBreakdown",
    )
  }

  const pagamento: PagamentoFiscalCanonico = {
    versao: PAGAMENTO_FISCAL_CONTRATO_VERSAO,
    fonte: "venda.payload.paymentBreakdown",
    catalogoTPag: "IT-2024.002-v1.11",
    det: dets,
    soma,
    vTroco: null,
  }
  return { ok: true, pagamento }
}

/** Revalida um contrato já congelado (XML / snapshot legado malformado). Não relê breakdown. */
export function assertPagamentoFiscalCanonico(
  pagamento: PagamentoFiscalCanonico,
  totalReferencia: number,
): PagamentoFiscalDeriveResult {
  if (!pagamento || pagamento.versao !== PAGAMENTO_FISCAL_CONTRATO_VERSAO) {
    return erro("PAGAMENTO_CANONICO_AUSENTE", "Contrato de pagamento fiscal ausente ou de versão desconhecida.", "venda.pagamentoFiscal")
  }
  if (pagamento.vTroco !== null) {
    return erro("PAGAMENTO_FORMATO_INVALIDO", "vTroco não pode ser fabricado: a venda persistida não grava troco.", "venda.pagamentoFiscal.vTroco")
  }
  if (!Array.isArray(pagamento.det) || pagamento.det.length === 0) {
    return erro("PAGAMENTO_AUSENTE", "Contrato canônico sem detPag.", "venda.pagamentoFiscal.det")
  }
  for (const d of pagamento.det) {
    if (!FORMAS_COM_TPAG.has(d.formaInterna) || !isTPagOficial(d.tPag)) {
      return erro("PAGAMENTO_FORMA_DESCONHECIDA", `detPag com forma/tPag inválido (${d.formaInterna}/${d.tPag}).`, "venda.pagamentoFiscal.det")
    }
    if (!tPagCompativelComFormaInterna(d.formaInterna as FormaInternaComTPag, d.tPag)) {
      return erro("PAGAMENTO_FORMA_DESCONHECIDA", `tPag ${d.tPag} não corresponde à forma interna ${d.formaInterna}.`, "venda.pagamentoFiscal.det")
    }
    if (!Number.isFinite(d.vPag) || d.vPag <= 0) {
      return erro("PAGAMENTO_VALOR_INVALIDO", `vPag inválido no detPag ${d.tPag}.`, "venda.pagamentoFiscal.det")
    }
  }
  const soma = round2(pagamento.det.reduce((s, d) => s + d.vPag, 0))
  if (soma !== round2(pagamento.soma)) {
    return erro("PAGAMENTO_SOMA_DIVERGENTE", "soma do contrato não confere com os detPag.", "venda.pagamentoFiscal.soma")
  }
  const totalR = round2(totalReferencia)
  if (soma !== totalR) {
    const lado = soma < totalR ? "abaixo" : "acima"
    return erro(
      "PAGAMENTO_SOMA_DIVERGENTE",
      `Soma do pagamento canônico (${soma.toFixed(2)}) está ${lado} do total (${totalR.toFixed(2)}).`,
      "venda.pagamentoFiscal.soma",
    )
  }
  return { ok: true, pagamento }
}
