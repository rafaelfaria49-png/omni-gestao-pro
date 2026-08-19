/**
 * Consumo fail-closed do `fiscalPaymentHandoff` persistido na Venda.
 *
 * Preferido ao `paymentBreakdown` quando presente. Versão desconhecida ou
 * handoff inconsistente BLOQUEIA — nunca cai para dinheiro / tPag=01 / legado.
 *
 * PURO. Sem Prisma, Caixa, Financeiro, PDV vivo ou SEFAZ.
 */

import {
  FISCAL_PAYMENT_HANDOFF_VERSION,
  HANDOFF_TPAG_COMPROVADO,
  type FiscalPaymentHandoffLinha,
  type HandoffFormaComTPagComprovado,
} from "@/lib/vendas/fiscal-payment-handoff"
import {
  FORMAS_INTERNAS_COM_TPAG,
  PAGAMENTO_FISCAL_CONTRATO_VERSAO,
  type FormaInternaComTPag,
  type PagamentoFiscalCanonico,
  type PagamentoFiscalDetalhe,
  type PagamentoFiscalDeriveResult,
  type PagamentoFiscalErro,
} from "./types"
import { isTPagOficial } from "./tpag-catalog"
import { derivePagamentoFiscalFromBreakdown } from "./from-venda-breakdown"

const FORMAS_COM_TPAG: ReadonlySet<string> = new Set(FORMAS_INTERNAS_COM_TPAG)

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

function tPagComprovadoDaForma(formaOrigem: string): string | null {
  if (formaOrigem === "dinheiro" || formaOrigem === "cartaoDebito" || formaOrigem === "cartaoCredito") {
    return HANDOFF_TPAG_COMPROVADO[formaOrigem as HandoffFormaComTPagComprovado]
  }
  return null
}

function asLinha(raw: unknown, index: number): FiscalPaymentHandoffLinha | PagamentoFiscalDeriveResult {
  if (!isPlainObject(raw)) {
    return erro("PAGAMENTO_HANDOFF_INVALIDO", `Linha ${index} do handoff não é um objeto.`, `venda.fiscalPaymentHandoff.linhas[${index}]`)
  }
  const formaOrigem = typeof raw.formaOrigem === "string" ? raw.formaOrigem : ""
  if (!formaOrigem) {
    return erro("PAGAMENTO_HANDOFF_INVALIDO", `Linha ${index} sem formaOrigem.`, `venda.fiscalPaymentHandoff.linhas[${index}].formaOrigem`)
  }
  const valor = typeof raw.valor === "number" ? raw.valor : Number(raw.valor)
  const capability = raw.capability
  const status = raw.status
  if (capability !== "supported" && capability !== "blocked") {
    return erro("PAGAMENTO_HANDOFF_INVALIDO", `Linha ${index} com capability inválida.`, `venda.fiscalPaymentHandoff.linhas[${index}].capability`)
  }
  if (status !== "ok" && status !== "blocked") {
    return erro("PAGAMENTO_HANDOFF_INVALIDO", `Linha ${index} com status inválido.`, `venda.fiscalPaymentHandoff.linhas[${index}].status`)
  }
  const tPag = typeof raw.tPag === "string" ? raw.tPag : undefined
  const linha: FiscalPaymentHandoffLinha = {
    formaOrigem,
    valor: Number.isFinite(valor) ? valor : Number.NaN,
    capability,
    status,
    ...(tPag !== undefined ? { tPag } : {}),
    ...(typeof raw.motivo === "string" ? { motivo: raw.motivo } : {}),
    ...(typeof raw.dadoAdicionalNecessario === "string"
      ? { dadoAdicionalNecessario: raw.dadoAdicionalNecessario }
      : {}),
  }
  return linha
}

/**
 * Consome o handoff versionado. Não relê paymentBreakdown, Caixa, Financeiro ou PDV.
 */
export function derivePagamentoFiscalFromHandoff(
  handoff: unknown,
  totalReferencia: number,
): PagamentoFiscalDeriveResult {
  if (handoff == null) {
    return erro("PAGAMENTO_HANDOFF_INVALIDO", "Handoff de pagamento fiscal nulo.", "venda.fiscalPaymentHandoff")
  }
  if (!isPlainObject(handoff)) {
    return erro("PAGAMENTO_HANDOFF_INVALIDO", "Handoff de pagamento fiscal não é um objeto.", "venda.fiscalPaymentHandoff")
  }
  if (handoff.version !== FISCAL_PAYMENT_HANDOFF_VERSION) {
    return erro(
      "PAGAMENTO_HANDOFF_VERSAO_DESCONHECIDA",
      `Versão de fiscalPaymentHandoff desconhecida (${String(handoff.version)}). Sem fallback para paymentBreakdown.`,
      "venda.fiscalPaymentHandoff.version",
    )
  }
  if (!Number.isFinite(totalReferencia) || totalReferencia < 0) {
    return erro("PAGAMENTO_VALOR_INVALIDO", "Total de referência da venda inválido (NaN/negativo/não-finito).", "venda.total")
  }
  if (!Array.isArray(handoff.linhas)) {
    return erro("PAGAMENTO_HANDOFF_INVALIDO", "Handoff sem array de linhas.", "venda.fiscalPaymentHandoff.linhas")
  }

  const parsed: FiscalPaymentHandoffLinha[] = []
  for (let i = 0; i < handoff.linhas.length; i++) {
    const linhaOrErr = asLinha(handoff.linhas[i], i)
    if ("ok" in linhaOrErr) return linhaOrErr
    parsed.push(linhaOrErr)
  }

  if (parsed.length === 0) {
    return erro("PAGAMENTO_AUSENTE", "Handoff sem linhas de pagamento com valor.", "venda.fiscalPaymentHandoff.linhas")
  }

  const dets: PagamentoFiscalDetalhe[] = []

  for (const linha of parsed) {
    if (!Number.isFinite(linha.valor) || linha.valor < 0) {
      return erro("PAGAMENTO_VALOR_INVALIDO", `Valor inválido na forma "${linha.formaOrigem}".`, "venda.fiscalPaymentHandoff.linhas")
    }
    if (linha.valor === 0) continue

    if (linha.motivo === "valor_invalido") {
      return erro("PAGAMENTO_VALOR_INVALIDO", `Valor inválido na forma "${linha.formaOrigem}".`, "venda.fiscalPaymentHandoff.linhas")
    }
    if (linha.motivo === "formato_invalido") {
      return erro("PAGAMENTO_FORMATO_INVALIDO", "Handoff indica paymentBreakdown em formato inválido.", "venda.fiscalPaymentHandoff")
    }
    if (linha.motivo === "forma_desconhecida") {
      return erro(
        "PAGAMENTO_FORMA_DESCONHECIDA",
        `Forma de pagamento desconhecida "${linha.formaOrigem}" — Fiscal não inventa tPag e não usa fallback de dinheiro.`,
        "venda.fiscalPaymentHandoff.linhas",
      )
    }

    const tPagEsperado = tPagComprovadoDaForma(linha.formaOrigem)

    if (linha.tPag !== undefined) {
      if (!isTPagOficial(linha.tPag)) {
        return erro(
          "PAGAMENTO_HANDOFF_INVALIDO",
          `tPag ${linha.tPag} no handoff não pertence ao catálogo oficial IT-2024.002-v1.11.`,
          "venda.fiscalPaymentHandoff.linhas",
        )
      }
      if (tPagEsperado == null) {
        return erro(
          "PAGAMENTO_HANDOFF_INVALIDO",
          `Handoff atribuiu tPag ${linha.tPag} à forma "${linha.formaOrigem}" sem evidência unívoca. Sem fallback.`,
          "venda.fiscalPaymentHandoff.linhas",
        )
      }
      if (linha.tPag !== tPagEsperado) {
        return erro(
          "PAGAMENTO_HANDOFF_INVALIDO",
          `tPag ${linha.tPag} inconsistente com a forma "${linha.formaOrigem}" (esperado ${tPagEsperado}). Sem fallback.`,
          "venda.fiscalPaymentHandoff.linhas",
        )
      }
      if (linha.capability !== "supported" || linha.status !== "ok") {
        return erro(
          "PAGAMENTO_HANDOFF_INVALIDO",
          `Handoff com tPag comprovado mas capability/status bloqueado na forma "${linha.formaOrigem}".`,
          "venda.fiscalPaymentHandoff.linhas",
        )
      }
    } else if (linha.capability === "supported" || linha.status === "ok") {
      return erro(
        "PAGAMENTO_HANDOFF_INVALIDO",
        `Handoff marca "${linha.formaOrigem}" como suportado sem tPag explícito.`,
        "venda.fiscalPaymentHandoff.linhas",
      )
    }

    if (linha.capability === "blocked" || linha.status === "blocked" || linha.tPag === undefined) {
      return erro(
        "PAGAMENTO_FORMA_SEM_CAPACIDADE_FISCAL",
        `Forma "${linha.formaOrigem}" no handoff não possui tPag comprovado (gap B: informação fiscal insuficiente na venda).`,
        "venda.fiscalPaymentHandoff.linhas",
      )
    }

    if (!FORMAS_COM_TPAG.has(linha.formaOrigem)) {
      return erro(
        "PAGAMENTO_FORMA_DESCONHECIDA",
        `Forma "${linha.formaOrigem}" não é uma forma interna com tPag no contrato fiscal.`,
        "venda.fiscalPaymentHandoff.linhas",
      )
    }

    dets.push({
      formaInterna: linha.formaOrigem as FormaInternaComTPag,
      tPag: linha.tPag,
      vPag: round2(linha.valor),
    })
  }

  if (dets.length === 0) {
    return erro("PAGAMENTO_AUSENTE", "Nenhuma forma de pagamento com valor positivo no handoff.", "venda.fiscalPaymentHandoff.linhas")
  }

  dets.sort((a, b) => (detSortKey(a) < detSortKey(b) ? -1 : detSortKey(a) > detSortKey(b) ? 1 : 0))

  const soma = round2(dets.reduce((s, d) => s + d.vPag, 0))
  const totalR = round2(totalReferencia)
  if (soma !== totalR) {
    const lado = soma < totalR ? "abaixo" : "acima"
    return erro(
      "PAGAMENTO_SOMA_DIVERGENTE",
      `Soma do handoff (${soma.toFixed(2)}) está ${lado} do total da venda (${totalR.toFixed(2)}). Sem correção automática.`,
      "venda.fiscalPaymentHandoff",
    )
  }

  const pagamento: PagamentoFiscalCanonico = {
    versao: PAGAMENTO_FISCAL_CONTRATO_VERSAO,
    fonte: "venda.payload.fiscalPaymentHandoff",
    catalogoTPag: "IT-2024.002-v1.11",
    det: dets,
    soma,
    vTroco: null,
  }
  return { ok: true, pagamento }
}

export function isFiscalPaymentHandoffPresent(value: unknown): boolean {
  return value !== undefined && value !== null
}

/**
 * Entrada única do Fiscal: handoff presente → só o handoff (sem fallback).
 * Venda histórica sem handoff → comportamento legado fail-closed do breakdown.
 */
export function derivePagamentoFiscal(
  breakdown: unknown,
  totalReferencia: number,
  handoff?: unknown,
): PagamentoFiscalDeriveResult {
  if (isFiscalPaymentHandoffPresent(handoff)) {
    return derivePagamentoFiscalFromHandoff(handoff, totalReferencia)
  }
  return derivePagamentoFiscalFromBreakdown(breakdown, totalReferencia)
}
