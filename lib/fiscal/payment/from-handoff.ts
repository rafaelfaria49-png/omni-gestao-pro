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
import { isPixQrKind, tPagFromPixQrKind } from "./pix-qr-kind"
import {
  FORMAS_INTERNAS_COM_TPAG,
  PAGAMENTO_FISCAL_CONTRATO_VERSAO,
  TPINTEGRA_POS_NAO_INTEGRADO,
  type FormaInternaComTPag,
  type PagamentoFiscalCanonico,
  type PagamentoFiscalDetalhe,
  type PagamentoFiscalDeriveResult,
  type PagamentoFiscalErro,
} from "./types"
import { isTPagOficial } from "./tpag-catalog"
import { derivePagamentoFiscalFromBreakdown } from "./from-venda-breakdown"
import {
  campoCartaoProibidoPresente,
  erroTpIntegraCartao,
  isFormaCartao,
  isTPagCartao,
  MSG_CARTAO_DADOS_NAO_SUPORTADOS,
} from "./card-evidence"

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

/** `undefined` = ausente; `"invalid"` = presente mas não é evidência. */
function parseHandoffCashTendered(handoff: Record<string, unknown>): number | undefined | "invalid" {
  if (!("cashTendered" in handoff) || handoff.cashTendered === undefined || handoff.cashTendered === null) {
    return undefined
  }
  const raw = handoff.cashTendered
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return "invalid"
  return round2(raw)
}

function tPagComprovadoDaLinha(linha: FiscalPaymentHandoffLinha): string | null {
  if (linha.formaOrigem === "dinheiro" || linha.formaOrigem === "cartaoDebito" || linha.formaOrigem === "cartaoCredito" || linha.formaOrigem === "creditoVale") {
    return HANDOFF_TPAG_COMPROVADO[linha.formaOrigem as HandoffFormaComTPagComprovado]
  }
  if (linha.formaOrigem === "pix" && isPixQrKind(linha.pixQrKind)) {
    return tPagFromPixQrKind(linha.pixQrKind)
  }
  return null
}

function asLinha(raw: unknown, index: number): FiscalPaymentHandoffLinha | PagamentoFiscalDeriveResult {
  if (!isPlainObject(raw)) {
    return erro("PAGAMENTO_HANDOFF_INVALIDO", `Linha ${index} do handoff não é um objeto.`, `venda.fiscalPaymentHandoff.linhas[${index}]`)
  }
  const campoLinha = `venda.fiscalPaymentHandoff.linhas[${index}]`
  const proibido = campoCartaoProibidoPresente(raw)
  if (proibido) {
    return erro("PAGAMENTO_CARTAO_DADOS_NAO_SUPORTADOS", MSG_CARTAO_DADOS_NAO_SUPORTADOS, `${campoLinha}.${proibido}`)
  }
  const formaOrigem = typeof raw.formaOrigem === "string" ? raw.formaOrigem : ""
  if (!formaOrigem) {
    return erro("PAGAMENTO_HANDOFF_INVALIDO", `Linha ${index} sem formaOrigem.`, `${campoLinha}.formaOrigem`)
  }
  const valor = typeof raw.valor === "number" ? raw.valor : Number(raw.valor)
  const capability = raw.capability
  const status = raw.status
  if (capability !== "supported" && capability !== "blocked") {
    return erro("PAGAMENTO_HANDOFF_INVALIDO", `Linha ${index} com capability inválida.`, `${campoLinha}.capability`)
  }
  if (status !== "ok" && status !== "blocked") {
    return erro("PAGAMENTO_HANDOFF_INVALIDO", `Linha ${index} com status inválido.`, `${campoLinha}.status`)
  }
  const tPag = typeof raw.tPag === "string" ? raw.tPag : undefined
  const pixQrKindRaw = raw.pixQrKind
  if (pixQrKindRaw !== undefined && pixQrKindRaw !== null && !isPixQrKind(pixQrKindRaw)) {
    return erro(
      "PAGAMENTO_HANDOFF_INVALIDO",
      `Linha ${index} com pixQrKind desconhecido.`,
      `${campoLinha}.pixQrKind`,
    )
  }
  const tpIntegraRaw = raw.tpIntegra
  if (tpIntegraRaw !== undefined && tpIntegraRaw !== null && typeof tpIntegraRaw !== "string") {
    return erro("PAGAMENTO_CARTAO_TPINTEGRA_INVALIDO", `Linha ${index} com tpIntegra em formato inválido.`, `${campoLinha}.tpIntegra`)
  }
  const linha: FiscalPaymentHandoffLinha = {
    formaOrigem,
    valor: Number.isFinite(valor) ? valor : Number.NaN,
    capability,
    status,
    ...(tPag !== undefined ? { tPag } : {}),
    ...(isPixQrKind(pixQrKindRaw) ? { pixQrKind: pixQrKindRaw } : {}),
    ...(typeof tpIntegraRaw === "string" ? { tpIntegra: tpIntegraRaw as FiscalPaymentHandoffLinha["tpIntegra"] } : {}),
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
  const proibidoHandoff = campoCartaoProibidoPresente(handoff)
  if (proibidoHandoff) {
    return erro(
      "PAGAMENTO_CARTAO_DADOS_NAO_SUPORTADOS",
      MSG_CARTAO_DADOS_NAO_SUPORTADOS,
      `venda.fiscalPaymentHandoff.${proibidoHandoff}`,
    )
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

    const tPagEsperado = tPagComprovadoDaLinha(linha)

    if (linha.formaOrigem === "pix" && linha.tPag !== undefined && linha.pixQrKind === undefined) {
      return erro(
        "PAGAMENTO_HANDOFF_INVALIDO",
        `Handoff atribuiu tPag ${linha.tPag} à forma "pix" sem pixQrKind. tPag do cliente não é autoridade.`,
        "venda.fiscalPaymentHandoff.linhas",
      )
    }

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

    const tPagLinha = linha.tPag
    const cartao = isFormaCartao(linha.formaOrigem) || isTPagCartao(tPagLinha)
    if (cartao) {
      const errCard = erroTpIntegraCartao(linha.tpIntegra, "venda.fiscalPaymentHandoff.linhas")
      if (errCard) return { ok: false, erro: errCard }
    } else if (linha.tpIntegra !== undefined) {
      return erro(
        "PAGAMENTO_CARTAO_DADOS_NAO_SUPORTADOS",
        `tpIntegra não se aplica à forma "${linha.formaOrigem}" (tPag ${tPagLinha}). PIX 17 + YA04 permanece residual; não analogizar POS simples.`,
        "venda.fiscalPaymentHandoff.linhas",
      )
    }

    dets.push({
      formaInterna: linha.formaOrigem as FormaInternaComTPag,
      tPag: tPagLinha,
      vPag: round2(linha.valor),
      ...(cartao ? { tpIntegra: TPINTEGRA_POS_NAO_INTEGRADO } : {}),
    })
  }

  if (dets.length === 0) {
    return erro("PAGAMENTO_AUSENTE", "Nenhuma forma de pagamento com valor positivo no handoff.", "venda.fiscalPaymentHandoff.linhas")
  }

  dets.sort((a, b) => (detSortKey(a) < detSortKey(b) ? -1 : detSortKey(a) > detSortKey(b) ? 1 : 0))

  const applied = dets.map((d) => ({ ...d }))
  const dinheiroIdx = applied.findIndex((d) => d.formaInterna === "dinheiro")
  const dinheiroAplicado = dinheiroIdx >= 0 ? applied[dinheiroIdx]!.vPag : 0
  const cashParsed = parseHandoffCashTendered(handoff)

  if (cashParsed === "invalid") {
    return erro(
      "PAGAMENTO_VALOR_INVALIDO",
      "cashTendered inválido (NaN/negativo/não-finito). Não é aceito como evidência fiscal e não gera vTroco.",
      "venda.fiscalPaymentHandoff.cashTendered",
    )
  }

  let vTroco: number | null = null
  if (cashParsed != null) {
    if (dinheiroAplicado <= 0) {
      // só relevante quando dinheiro > 0 — ignora o campo, não inventa troco
    } else if (cashParsed < dinheiroAplicado) {
      return erro(
        "PAGAMENTO_VALOR_INVALIDO",
        `cashTendered (${cashParsed.toFixed(2)}) menor que o dinheiro aplicado (${dinheiroAplicado.toFixed(2)}). Não é evidência fiscal.`,
        "venda.fiscalPaymentHandoff.cashTendered",
      )
    } else if (cashParsed > dinheiroAplicado) {
      applied[dinheiroIdx] = { ...applied[dinheiroIdx]!, vPag: cashParsed }
      vTroco = round2(cashParsed - dinheiroAplicado)
    }
  }

  const soma = round2(applied.reduce((s, d) => s + d.vPag, 0))
  const totalR = round2(totalReferencia)
  const troco = vTroco == null ? 0 : vTroco
  const liquido = round2(soma - troco)
  if (liquido !== totalR) {
    const lado = liquido < totalR ? "abaixo" : "acima"
    return erro(
      "PAGAMENTO_SOMA_DIVERGENTE",
      `Σ(vPag) − vTroco (${soma.toFixed(2)} − ${troco.toFixed(2)}) está ${lado} do total da venda (${totalR.toFixed(2)}). NT 2016.002 YA09-10. Sem correção automática.`,
      "venda.fiscalPaymentHandoff",
    )
  }

  const pagamento: PagamentoFiscalCanonico = {
    versao: PAGAMENTO_FISCAL_CONTRATO_VERSAO,
    fonte: "venda.payload.fiscalPaymentHandoff",
    catalogoTPag: "IT-2024.002-v1.11",
    det: applied,
    soma,
    vTroco,
  }
  return { ok: true, pagamento }
}

export function isFiscalPaymentHandoffPresent(value: unknown): boolean {
  return value !== undefined && value !== null
}

/**
 * Entrada única do Fiscal: handoff presente → só o handoff (sem fallback).
 * Venda histórica sem handoff → breakdown fail-closed (PIX sem evidência de subtipo).
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
