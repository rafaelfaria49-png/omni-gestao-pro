/**
 * Validação ESTRUTURAL do XML NFC-e (BL-FISCAL-004 — TAREFA 4).
 *
 * Verifica, ANTES de montar o XML, se o snapshot tem o mínimo obrigatório do layout 4.00:
 * emitente válido, UF mapeável (cUF), itens, NCM/CFOP por item, e tributação congelada e
 * alinhada (consumida do snapshot — nunca recalculada). Erros são BLOQUEANTES; pendências
 * (numeração placeholder, IE/GTIN/origem ausentes) NÃO bloqueiam, apenas avisam.
 *
 * PURO: sem I/O, sem Prisma. Recebe snapshot + contexto e devolve diagnóstico.
 */

import { isValidCnpj, onlyDigits } from "../fiscal-validators"
import type { VendaFiscalSnapshot } from "../venda-fiscal-snapshot"
import { codigoUf } from "./nfce-chave-acesso"
import type { NfceValidationIssue, NfceValidationResult, NfceXmlContext, NfceXmlErrorCode } from "./nfce-xml.types"
import { assertPagamentoFiscalCanonico, type PagamentoFiscalErroCode } from "../payment"

function isNcmValido(ncm: string): boolean {
  return /^\d{8}$/.test(onlyDigits(ncm))
}

function round2(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100
}

function pagamentoErroToXml(code: PagamentoFiscalErroCode): NfceXmlErrorCode {
  switch (code) {
    case "PAGAMENTO_AUSENTE":
      return "pagamento_ausente"
    case "PAGAMENTO_FORMATO_INVALIDO":
      return "pagamento_formato_invalido"
    case "PAGAMENTO_VALOR_INVALIDO":
      return "pagamento_valor_invalido"
    case "PAGAMENTO_FORMA_DESCONHECIDA":
      return "pagamento_forma_desconhecida"
    case "PAGAMENTO_FORMA_SEM_CAPACIDADE_FISCAL":
      return "pagamento_forma_sem_capacidade"
    case "PAGAMENTO_PIX_LEGADO_SEM_EVIDENCIA":
      return "pagamento_pix_legado_sem_evidencia"
    case "PAGAMENTO_SOMA_DIVERGENTE":
      return "pagamento_soma_divergente"
    case "PAGAMENTO_CANONICO_AUSENTE":
      return "pagamento_canonico_ausente"
    case "PAGAMENTO_HANDOFF_INVALIDO":
      return "pagamento_formato_invalido"
    case "PAGAMENTO_HANDOFF_VERSAO_DESCONHECIDA":
      return "pagamento_canonico_ausente"
  }
}

export function validateNfceSnapshot(
  snapshot: VendaFiscalSnapshot,
  contexto?: NfceXmlContext,
): NfceValidationResult {
  const erros: NfceValidationIssue[] = []
  const pendencias: string[] = []

  const erro = (
    code: NfceValidationIssue["code"],
    mensagem: string,
    itemIndex: number | null = null,
    campo: string | null = null,
  ) => erros.push({ code, mensagem, itemIndex, campo })

  // 1) Snapshot mínimo.
  if (!snapshot || typeof snapshot !== "object") {
    erro("snapshot_invalido", "Snapshot ausente ou inválido.")
    return { ok: false, erros, pendencias, chaveAcessoCalculavel: false }
  }

  // 2) Emitente.
  const emit = snapshot.emitente
  let chaveAcessoCalculavel = true
  if (!emit || !isValidCnpj(emit.cnpj)) {
    erro("emitente_invalido", "Emitente sem CNPJ válido.", null, "emitente.cnpj")
    chaveAcessoCalculavel = false
  }
  const cUf = emit ? codigoUf(emit.endereco?.uf) : null
  if (!cUf) {
    erro("uf_invalida", "UF do emitente inválida ou não mapeável para cUF (IBGE).", null, "emitente.endereco.uf")
    chaveAcessoCalculavel = false
  }
  if (emit && onlyDigits(emit.inscricaoEstadual).length === 0) {
    pendencias.push("Inscrição Estadual do emitente ausente (obrigatória para autorizar).")
  }
  if (emit && onlyDigits(emit.endereco?.codigoMunicipioIbge).length !== 7) {
    pendencias.push("Código IBGE do município do emitente ausente/!=7 dígitos.")
  }

  // 3) Itens.
  const itens = Array.isArray(snapshot.itens) ? snapshot.itens : []
  if (itens.length === 0) {
    erro("sem_itens", "Venda sem itens — nada a serializar.")
  }

  // 4) Tributação congelada (consumida, nunca recalculada).
  const trib = snapshot.tributacao
  if (!trib) {
    erro("tributacao_ausente", "Tributação não congelada no snapshot (rode o builder do snapshot atualizado).")
  } else if (trib.ok === false) {
    erro(
      "tributacao_pendente",
      `Tributação pendente (fora do baseline): ${trib.pendencias.join("; ") || "motivo não informado"}.`,
    )
  } else if (itens.length > 0 && trib.itens.length !== itens.length) {
    erro(
      "tributacao_desalinhada",
      `Tributação congelada tem ${trib.itens.length} item(ns), mas a venda tem ${itens.length}.`,
    )
  }

  // 5) Campos obrigatórios por item.
  for (const it of itens) {
    if (!isNcmValido(it.ncm)) {
      erro("item_sem_ncm", `Item ${it.numeroItem}: NCM ausente/ inválido (8 dígitos).`, it.numeroItem, "ncm")
    }
    if (onlyDigits(it.cfop).length !== 4) {
      erro("item_sem_cfop", `Item ${it.numeroItem}: CFOP ausente/ inválido (4 dígitos).`, it.numeroItem, "cfop")
    }
    if (onlyDigits(it.origemMercadoria).length === 0) {
      pendencias.push(`Item ${it.numeroItem}: origem da mercadoria ausente (assumida 0).`)
    }
    if (onlyDigits(it.gtin).length === 0) {
      pendencias.push(`Item ${it.numeroItem}: sem GTIN (será emitido "SEM GTIN").`)
    }
  }

  // 6) Destinatário (NFC-e: opcional; se informado, documento deve ser válido).
  const dest = snapshot.destinatario
  if (dest && (dest.tipo === "cpf" || dest.tipo === "cnpj")) {
    const len = onlyDigits(dest.documento ?? "").length
    if (dest.tipo === "cpf" && len !== 11) {
      erro("destinatario_invalido", "Destinatário CPF com tamanho inválido (11 dígitos).", null, "destinatario.documento")
    }
    if (dest.tipo === "cnpj" && len !== 14) {
      erro("destinatario_invalido", "Destinatário CNPJ com tamanho inválido (14 dígitos).", null, "destinatario.documento")
    }
  }

  // 8) Pagamento fiscal canônico (GOAL 030). Nunca relê paymentBreakdown, Caixa ou PDV.
  const venda = snapshot.venda
  const totalVenda = round2(Number(venda?.total) || 0)
  if (!venda || venda.pagamentoFiscal == null) {
    if (venda?.pagamentoFiscalErro) {
      erro(
        pagamentoErroToXml(venda.pagamentoFiscalErro.code),
        venda.pagamentoFiscalErro.mensagem,
        null,
        venda.pagamentoFiscalErro.campo,
      )
    } else {
      erro(
        "pagamento_canonico_ausente",
        "Snapshot sem contrato de pagamento fiscal canônico. Emissão bloqueada — sem reconstrução a partir de dado vivo.",
        null,
        "venda.pagamentoFiscal",
      )
    }
  } else {
    const checked = assertPagamentoFiscalCanonico(venda.pagamentoFiscal, totalVenda)
    if (!checked.ok) {
      erro(pagamentoErroToXml(checked.erro.code), checked.erro.mensagem, null, checked.erro.campo)
    }
  }

  // 9) Numeração (não vem do snapshot — placeholder quando ausente no contexto).
  const numero = contexto?.numero ?? 0
  const serie = contexto?.serie ?? 0
  if (!Number.isFinite(numero) || Number(numero) <= 0) {
    pendencias.push("Numeração não alocada (série/número placeholder) — alocar via lib/fiscal/numbering antes de emitir.")
  } else if (!Number.isFinite(serie)) {
    pendencias.push("Série inválida no contexto de emissão.")
  }

  return { ok: erros.length === 0, erros, pendencias, chaveAcessoCalculavel }
}
