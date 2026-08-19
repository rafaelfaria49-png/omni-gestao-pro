/**
 * Handoff canônico e versionado de pagamento fiscal — lado da Venda.
 *
 * Produzido UMA vez no motor central (`upsertVendaInTransaction`) no instante em
 * que a venda é persistida. Congelado em `Venda.payload.fiscalPaymentHandoff`.
 *
 * Fiscal é somente consumidor. Este módulo é PURO: sem Prisma, Caixa, Financeiro,
 * PaymentModal ou SEFAZ. Não inventa tPag, grupo `card` nem troco.
 *
 * PIX: tPag 17/20/23 só quando `pixQrKind` conhecido é observado. Sem default.
 * tPag enviado pelo cliente é ignorado — o servidor deriva pelo catálogo oficial.
 *
 * Autoridade de códigos: IT 2024.002 v1.11 + XSD `PL_010e_v1.02` (`tPag` = `[0-9]{2}`).
 */

import {
  isPixQrKind,
  tPagFromPixQrKind,
  type PixQrKind,
} from "@/lib/fiscal/payment/pix-qr-kind"

export const FISCAL_PAYMENT_HANDOFF_VERSION = 1 as const

export const FISCAL_PAYMENT_HANDOFF_CATALOGO_TPAG = "IT-2024.002-v1.11" as const

export type { PixQrKind }

/** Formas internas persistidas pelos PDVs ativos (`PaymentBreakdownFull`). */
export const HANDOFF_FORMAS_ORIGEM = [
  "dinheiro",
  "pix",
  "cartaoDebito",
  "cartaoCredito",
  "carne",
  "aPrazo",
  "creditoVale",
] as const

export type HandoffFormaOrigem = (typeof HANDOFF_FORMAS_ORIGEM)[number]

/**
 * Únicas formas com tPag oficial unívoco a partir da chave persistida sozinha.
 * PIX entra só quando `pixQrKind` conhecido acompanha o valor — nunca pela chave `pix`.
 */
export const HANDOFF_FORMAS_COM_TPAG_COMPROVADO = ["dinheiro", "cartaoDebito", "cartaoCredito"] as const

export type HandoffFormaComTPagComprovado = (typeof HANDOFF_FORMAS_COM_TPAG_COMPROVADO)[number]

/** Mapeamento comprovado — não é semelhança de nome; cada par tem evidência no relatório 075. */
export const HANDOFF_TPAG_COMPROVADO: Readonly<Record<HandoffFormaComTPagComprovado, string>> = {
  dinheiro: "01",
  cartaoCredito: "03",
  cartaoDebito: "04",
}

export type FiscalPaymentHandoffCapability = "supported" | "blocked"
export type FiscalPaymentHandoffStatus = "ok" | "blocked"

export type FiscalPaymentHandoffLinha = {
  readonly formaOrigem: string
  readonly valor: number
  /** Presente somente quando o tPag é unívoco (forma persistida ou pixQrKind oficial). */
  readonly tPag?: string
  /** Discriminador observado de PIX. Ausente = subtipo não informado. */
  readonly pixQrKind?: PixQrKind
  readonly capability: FiscalPaymentHandoffCapability
  readonly status: FiscalPaymentHandoffStatus
  readonly motivo?: string
  readonly dadoAdicionalNecessario?: string
}

/**
 * Contrato mínimo congelado no payload da Venda.
 * `vTroco` / `valorEntregue` são omitidos: o PDV descarta o valor entregue
 * (`normalizePaymentsToMatchTotal`) e só persiste o líquido aplicado à venda.
 */
export type FiscalPaymentHandoff = {
  readonly version: typeof FISCAL_PAYMENT_HANDOFF_VERSION
  readonly catalogoTPag: typeof FISCAL_PAYMENT_HANDOFF_CATALOGO_TPAG
  readonly linhas: readonly FiscalPaymentHandoffLinha[]
}

const FORMAS_ORIGEM: ReadonlySet<string> = new Set(HANDOFF_FORMAS_ORIGEM)
const FORMAS_COMPROVADAS: ReadonlySet<string> = new Set(HANDOFF_FORMAS_COM_TPAG_COMPROVADO)

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function bloqueioPix(): Pick<FiscalPaymentHandoffLinha, "motivo" | "dadoAdicionalNecessario"> {
  return {
    motivo: "pix_subtipo_nao_discriminado",
    dadoAdicionalNecessario:
      "Informar pixQrKind (dinamico | estatico | automatico) no instante do pagamento. A forma genérica `pix` não autoriza inferir tPag 17/20/23.",
  }
}

function bloqueioPixQrKindDesconhecido(): Pick<FiscalPaymentHandoffLinha, "motivo" | "dadoAdicionalNecessario"> {
  return {
    motivo: "pix_qr_kind_desconhecido",
    dadoAdicionalNecessario:
      "pixQrKind deve ser dinamico (tPag 17), estatico (tPag 20) ou automatico (tPag 23). Valor desconhecido não autoriza tPag.",
  }
}

function linhaPixComprovada(valor: number, pixQrKind: PixQrKind): FiscalPaymentHandoffLinha {
  return {
    formaOrigem: "pix",
    valor,
    pixQrKind,
    tPag: tPagFromPixQrKind(pixQrKind),
    capability: "supported",
    status: "ok",
  }
}

function bloqueioCarne(): Pick<FiscalPaymentHandoffLinha, "motivo" | "dadoAdicionalNecessario"> {
  return {
    motivo: "carne_tpag_ambiguo",
    dadoAdicionalNecessario:
      "Discriminar tPag 05 (crediário / private label) vs 15 (boleto). O PDV colapsa `carne` e `boleto` na mesma chave persistida.",
  }
}

function bloqueioAPrazo(): Pick<FiscalPaymentHandoffLinha, "motivo" | "dadoAdicionalNecessario"> {
  return {
    motivo: "aprazo_tpag_ambiguo",
    dadoAdicionalNecessario:
      "Discriminar tPag 05 (crediário), 15 (boleto) ou 91 (pagamento posterior). aPrazoConfig (parcelas/vencimento) é dado financeiro, não tPag.",
  }
}

function bloqueioCreditoVale(): Pick<FiscalPaymentHandoffLinha, "motivo" | "dadoAdicionalNecessario"> {
  return {
    motivo: "credito_vale_tpag_ambiguo",
    dadoAdicionalNecessario:
      "Discriminar tPag 19 (programa de fidelidade / cashback / crédito virtual) vs 21 (crédito em loja).",
  }
}

function linhaComprovada(formaOrigem: HandoffFormaComTPagComprovado, valor: number): FiscalPaymentHandoffLinha {
  return {
    formaOrigem,
    valor,
    tPag: HANDOFF_TPAG_COMPROVADO[formaOrigem],
    capability: "supported",
    status: "ok",
  }
}

function linhaBloqueada(
  formaOrigem: string,
  valor: number,
  extra: Pick<FiscalPaymentHandoffLinha, "motivo" | "dadoAdicionalNecessario">,
): FiscalPaymentHandoffLinha {
  return {
    formaOrigem,
    valor,
    capability: "blocked",
    status: "blocked",
    ...extra,
  }
}

function linhaDeForma(key: string, valor: number, pixQrKindHint: unknown): FiscalPaymentHandoffLinha {
  if (FORMAS_COMPROVADAS.has(key)) {
    return linhaComprovada(key as HandoffFormaComTPagComprovado, valor)
  }
  if (key === "pix") {
    if (pixQrKindHint == null || pixQrKindHint === "") {
      return linhaBloqueada(key, valor, bloqueioPix())
    }
    if (!isPixQrKind(pixQrKindHint)) {
      return linhaBloqueada(key, valor, bloqueioPixQrKindDesconhecido())
    }
    return linhaPixComprovada(valor, pixQrKindHint)
  }
  if (key === "carne") return linhaBloqueada(key, valor, bloqueioCarne())
  if (key === "aPrazo") return linhaBloqueada(key, valor, bloqueioAPrazo())
  if (key === "creditoVale") return linhaBloqueada(key, valor, bloqueioCreditoVale())
  if (FORMAS_ORIGEM.has(key)) {
    return linhaBloqueada(key, valor, {
      motivo: "forma_sem_capacidade_fiscal",
      dadoAdicionalNecessario: "Informar tPag oficial explícito no instante do pagamento.",
    })
  }
  return linhaBloqueada(key, valor, {
    motivo: "forma_desconhecida",
    dadoAdicionalNecessario: "Não converter para tPag=99. Registrar a forma fiscal real antes de emitir.",
  })
}

export type FiscalPaymentHandoffHints = {
  readonly pixQrKind?: unknown
}

/**
 * Constrói o handoff a partir do `paymentBreakdown` já persistido.
 * Nunca lança — a venda continua fechando; o Fiscal decide se emite.
 * Não lê PaymentMethod[], maquininha, Caixa, valor entregue nem tPag do cliente.
 * `hints.pixQrKind` é o discriminador observado; tPag é derivado só pelo catálogo.
 */
export function buildFiscalPaymentHandoff(
  breakdown: unknown,
  _totalReferencia?: number,
  hints?: FiscalPaymentHandoffHints,
): FiscalPaymentHandoff {
  const linhas: FiscalPaymentHandoffLinha[] = []
  const pixQrKindHint = hints?.pixQrKind

  if (breakdown == null) {
    return { version: FISCAL_PAYMENT_HANDOFF_VERSION, catalogoTPag: FISCAL_PAYMENT_HANDOFF_CATALOGO_TPAG, linhas }
  }

  if (!isPlainObject(breakdown)) {
    return {
      version: FISCAL_PAYMENT_HANDOFF_VERSION,
      catalogoTPag: FISCAL_PAYMENT_HANDOFF_CATALOGO_TPAG,
      linhas: [
        linhaBloqueada("?", 0, {
          motivo: "formato_invalido",
          dadoAdicionalNecessario: "paymentBreakdown deve ser o objeto plano persistido pelos PDVs ativos.",
        }),
      ],
    }
  }

  for (const key of Object.keys(breakdown)) {
    const raw = breakdown[key]
    if (raw == null) continue
    const n = typeof raw === "number" ? raw : Number(raw)
    if (typeof raw === "number" && raw === 0) continue
    if (n === 0 && Number.isFinite(n)) continue

    if (!Number.isFinite(n) || n < 0) {
      linhas.push(
        linhaBloqueada(key, Number.isFinite(n) ? round2(n) : 0, {
          motivo: "valor_invalido",
          dadoAdicionalNecessario: "Valor de pagamento deve ser número finito ≥ 0.",
        }),
      )
      continue
    }

    linhas.push(linhaDeForma(key, round2(n), pixQrKindHint))
  }

  linhas.sort((a, b) => (a.formaOrigem < b.formaOrigem ? -1 : a.formaOrigem > b.formaOrigem ? 1 : 0))

  return {
    version: FISCAL_PAYMENT_HANDOFF_VERSION,
    catalogoTPag: FISCAL_PAYMENT_HANDOFF_CATALOGO_TPAG,
    linhas,
  }
}
