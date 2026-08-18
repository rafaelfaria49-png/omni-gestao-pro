/**
 * Planner PURO da recuperação administrada de vendas em quarentena
 * (GOAL PDV-VENDAS-QUARENTENA-RECOVERY-ALL-P0-006A).
 *
 * Uma venda entra em `LOCAL_QUARANTINED` quando o `pedidoId` escolhido pelo cliente
 * (writer v1: `MAX+1` no navegador) já estava ocupado no servidor — ver
 * `lib/vendas/sale-identity-conflict.ts`. A venda é REAL: existe apenas na cópia
 * local, nunca foi persistida, e por isso NENHUM efeito server-side foi aplicado
 * sob o número antigo (o que existe sob aquele número pertence à venda OCUPANTE).
 *
 * Este módulo decide, e só decide. Zero Prisma, zero I/O, zero relógio, zero
 * aleatoriedade: recebe os fatos já lidos pela rota (`QuarantineServerFacts`) e
 * devolve uma classe explícita por candidata. A execução vive em
 * `lib/vendas/quarantine-recovery-service.ts`.
 *
 * Regra de ouro do fail-closed (modo `live-stock-rules`): qualquer dúvida vira
 * `BLOCKED`, nunca `READY`. O objetivo é "0 quarentenas legítimas recuperáveis
 * pendentes", nunca "0 badges".
 *
 * O modo `historical-recovery` é a exceção ADMIN-only: vendas históricas reais
 * que já aconteceram não podem ser apagadas pelo estoque/catálogo/caixa de hoje.
 * Só o recovery administrativo usa esse modo — o PDV normal continua fail-closed.
 */

import { valorAVistaVenda } from "@/lib/financeiro/correcao-pagamento-plan"
import { isVirtualSaleLine } from "@/lib/os-pdv-virtual-lines"
import { isLegacySaleFactsComparable } from "@/lib/vendas/legacy-sale-fingerprint"
import { isSaleIdentityConflictCode } from "@/lib/vendas/sale-identity-conflict"
import { parseClientSaleId } from "@/lib/vendas/sale-identity-contracts"
import type { PaymentBreakdownFull } from "@/lib/operations-sale-types"

// ─────────────────────────────────────────────────────────────────────────────
// Classes
// ─────────────────────────────────────────────────────────────────────────────

export const QUARANTINE_RECOVERY_CLASS = Object.freeze({
  /** Recuperável agora, sem confirmação extra. */
  READY: "READY",
  /** Já existe venda server-side com o mesmo `(storeId, clientSaleId)`. Só reconciliar o local. */
  ALREADY_RECOVERED: "ALREADY_RECOVERED",
  /** Sessão de caixa ORIGINAL existe, é desta loja, mas está FECHADA. Exige autorização explícita. */
  REQUIRES_CLOSED_SESSION_CONFIRM: "REQUIRES_CLOSED_SESSION_CONFIRM",

  // ── Bloqueios ─────────────────────────────────────────────────────────────
  /** A entrada local não está em quarentena de identidade — não é caso deste fluxo. */
  NOT_QUARANTINED: "NOT_QUARANTINED",
  /** Sem identidade técnica utilizável e sem como cunhar uma com segurança. */
  MISSING_CLIENT_SALE_ID: "MISSING_CLIENT_SALE_ID",
  /**
   * A venda move a gaveta mas não há sessão original identificável (sem `sessaoId`,
   * ou sessão inexistente / de outra loja). Recuperar aqui jogaria a receita na
   * sessão ABERTA de hoje — exatamente o que o incidente proíbe.
   */
  MISSING_ORIGINAL_SESSION: "MISSING_ORIGINAL_SESSION",
  /** Não há venda ocupando o número antigo: não existe conflito. Usar o reenvio normal. */
  OCCUPANT_NOT_FOUND: "OCCUPANT_NOT_FOUND",
  /** Fatos centrais ausentes/corrompidos — não persistir às cegas. */
  INVALID_PAYLOAD: "INVALID_PAYLOAD",
  /** A cópia local declara outra loja. */
  STORE_MISMATCH: "STORE_MISMATCH",
  /** Linha de produto físico que não casa com nenhum `Produto` da loja. */
  PRODUCT_UNRESOLVED: "PRODUCT_UNRESOLVED",
  /** Estoque atual não cobre a baixa — `enforceStock` abortaria a transação (PDV ao vivo). */
  INSUFFICIENT_STOCK_RISK: "INSUFFICIENT_STOCK_RISK",
  /** Bloqueio sem causa mapeada. Nunca vira `READY`. */
  BLOCKED_UNKNOWN: "BLOCKED_UNKNOWN",
} as const)

export type QuarantineRecoveryClass =
  (typeof QUARANTINE_RECOVERY_CLASS)[keyof typeof QUARANTINE_RECOVERY_CLASS]

/** Agrupamento operacional usado pelo preview e pela execução em lote. */
export const QUARANTINE_RECOVERY_BUCKET = Object.freeze({
  READY: "READY",
  ALREADY_RECOVERED: "ALREADY_RECOVERED",
  REQUIRES_CONFIRMATION: "REQUIRES_CONFIRMATION",
  BLOCKED: "BLOCKED",
} as const)

export type QuarantineRecoveryBucket =
  (typeof QUARANTINE_RECOVERY_BUCKET)[keyof typeof QUARANTINE_RECOVERY_BUCKET]

export function bucketForClass(klass: QuarantineRecoveryClass): QuarantineRecoveryBucket {
  if (klass === QUARANTINE_RECOVERY_CLASS.READY) return QUARANTINE_RECOVERY_BUCKET.READY
  if (klass === QUARANTINE_RECOVERY_CLASS.ALREADY_RECOVERED) {
    return QUARANTINE_RECOVERY_BUCKET.ALREADY_RECOVERED
  }
  if (klass === QUARANTINE_RECOVERY_CLASS.REQUIRES_CLOSED_SESSION_CONFIRM) {
    return QUARANTINE_RECOVERY_BUCKET.REQUIRES_CONFIRMATION
  }
  return QUARANTINE_RECOVERY_BUCKET.BLOCKED
}

/** Somente estas duas classes autorizam uma escrita. */
export function isExecutableClass(klass: QuarantineRecoveryClass): boolean {
  return (
    klass === QUARANTINE_RECOVERY_CLASS.READY ||
    klass === QUARANTINE_RECOVERY_CLASS.REQUIRES_CLOSED_SESSION_CONFIRM
  )
}

/** Como o planner interpreta estoque, catálogo e sessão. */
export const QUARANTINE_CLASSIFY_MODE = Object.freeze({
  /** Regras do PDV ao vivo: estoque/produto/sessão bloqueiam. */
  LIVE_STOCK_RULES: "live-stock-rules",
  /**
   * Recovery administrativo de venda histórica real. Estoque atual insuficiente,
   * produto sem cadastro atual e sessão original não identificável NÃO apagam a
   * venda. Nunca usado pelo PDV normal.
   */
  HISTORICAL_RECOVERY: "historical-recovery",
} as const)

export type QuarantineClassifyMode =
  (typeof QUARANTINE_CLASSIFY_MODE)[keyof typeof QUARANTINE_CLASSIFY_MODE]

export const HISTORICAL_RECOVERY_STOCK_POLICY = "historical-ledger-allows-deficit" as const

export type HistoricalRecoveryCaixaPolicy =
  | "original-session"
  | "unidentified-session-no-current-caixa"

export function historicalRecoveryCaixaPolicy(
  status: OriginalSessionStatus,
): HistoricalRecoveryCaixaPolicy {
  return status === "ABERTA" || status === "FECHADA"
    ? "original-session"
    : "unidentified-session-no-current-caixa"
}

/**
 * Opções de persistência do recovery histórico. Isoladas do PDV ao vivo:
 * `enforceStock` permanece `true` no writer V2 padrão.
 */
export function historicalRecoveryPersistOptions(input: {
  originalSessionStatus: OriginalSessionStatus
  allowClosedOriginalSession: boolean
}): {
  enforceStock: false
  requireCaixaSession: boolean
  allowClosedOriginalSession: boolean
} {
  const hasOriginalSession =
    input.originalSessionStatus === "ABERTA" || input.originalSessionStatus === "FECHADA"
  return {
    enforceStock: false,
    requireCaixaSession: hasOriginalSession,
    allowClosedOriginalSession:
      input.allowClosedOriginalSession === true && input.originalSessionStatus === "FECHADA",
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Entradas
// ─────────────────────────────────────────────────────────────────────────────

export type QuarantineCandidateLine = {
  readonly inventoryId?: unknown
  readonly name?: unknown
  readonly quantity?: unknown
  readonly unitPrice?: unknown
}

/**
 * Recorte da cópia LOCAL da venda. Estrutural de propósito: o mesmo shape serve ao
 * `SaleRecord` do PDV (cliente) e ao corpo JSON recebido pela rota (servidor).
 */
export type QuarantineCandidate = {
  /** Número comercial antigo, em conflito (`VDA-…`). Vira só trilha de auditoria. */
  readonly id?: unknown
  readonly clientSaleId?: unknown
  readonly syncBlockedCode?: unknown
  /** Loja declarada pela cópia local, quando existir. */
  readonly storeId?: unknown
  readonly at?: unknown
  readonly total?: unknown
  readonly sessaoId?: unknown
  readonly terminalId?: unknown
  readonly customerName?: unknown
  readonly lines?: readonly QuarantineCandidateLine[] | unknown
  readonly paymentBreakdown?: Partial<PaymentBreakdownFull> | null | unknown
}

export type OriginalSessionStatus =
  /** Sessão original existe, é desta loja e está aberta. */
  | "ABERTA"
  /** Sessão original existe, é desta loja, já fechada (fechamento do dia rodou). */
  | "FECHADA"
  /** `sessaoId` informado mas inexistente ou de outra loja. */
  | "NOT_FOUND"
  /** A cópia local não tem `sessaoId`. */
  | "NO_SESSION_ID"

export type QuarantineStockShortfall = {
  readonly produtoId: string
  readonly nome: string
  readonly disponivel: number
  readonly necessario: number
}

/** Fatos já lidos do banco pela rota. O planner nunca consulta nada. */
export type QuarantineServerFacts = {
  /** `pedidoId` da venda que já existe sob `(storeId, clientSaleId)`, quando houver. */
  readonly alreadyRecoveredPedidoId?: string | null
  /** `Venda.id` técnico correspondente, para reconciliação local. */
  readonly alreadyRecoveredVendaId?: string | null
  /** Existe venda ocupando o `pedidoId` antigo? */
  readonly occupantExists: boolean
  /** Loja da ocupante — pode ser outra loja. */
  readonly occupantStoreId?: string | null
  readonly originalSessionStatus: OriginalSessionStatus
  /**
   * Sessão original identificada (payload ou lookup determinístico por
   * storeId + terminalId + `sale.at` ∈ [abertaEm, fechadaEm]).
   */
  readonly resolvedSessaoId?: string | null
  /** `inventoryId` de linhas FÍSICAS sem `Produto` correspondente. */
  readonly unresolvedInventoryIds?: readonly string[]
  readonly stockShortfalls?: readonly QuarantineStockShortfall[]
}

export type QuarantineRecoveryPlanItem = {
  /** Número antigo, para exibição/auditoria. */
  readonly conflictingPedidoId: string
  readonly clientSaleId: string | null
  readonly klass: QuarantineRecoveryClass
  readonly bucket: QuarantineRecoveryBucket
  /** Motivo técnico legível. Nunca vazio quando `bucket !== READY`. */
  readonly reason: string
  /** Total apenas informativo — nunca usado como autoridade financeira. */
  readonly total: number
  /** Receita que move a gaveta (`total − aPrazo − creditoVale`). */
  readonly valorAVista: number
  readonly at: string | null
  readonly customerName: string | null
  readonly conflictCode: string | null
  readonly originalSessionStatus: OriginalSessionStatus
  readonly occupantStoreId: string | null
  /** `pedidoId` já existente quando `ALREADY_RECOVERED`. */
  readonly alreadyRecoveredPedidoId: string | null
  readonly alreadyRecoveredVendaId: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers puros
// ─────────────────────────────────────────────────────────────────────────────

function text(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed || null
}

function money(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0
  return Math.round(value * 100) / 100
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

/**
 * `paymentBreakdown` utilizável para o cálculo de receita à vista. Um breakdown
 * ausente cai em `valorAVistaVenda(total, null) === total` — conservador de
 * propósito: assume que a venda MOVE a gaveta e portanto exige sessão original.
 */
function breakdown(value: unknown): Partial<PaymentBreakdownFull> | null {
  return isPlainRecord(value) ? (value as Partial<PaymentBreakdownFull>) : null
}

// ─────────────────────────────────────────────────────────────────────────────
// Classificação
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classifica UMA candidata. A ordem das checagens é normativa:
 *
 *  1. idempotência — já recuperada vence tudo, inclusive bloqueios;
 *  2. quarentena de identidade (senão não é caso deste fluxo);
 *  3. identidade técnica;
 *  4. loja;
 *  5. integridade dos fatos;
 *  6. conflito realmente confirmado (ocupante);
 *  7. produto/estoque (omitidos no modo `historical-recovery`);
 *  8. caixa (última, porque é a única que pode virar "confirmável").
 *
 * A precedência de 6 sobre 8 espelha `upsertVendaInTransaction`, onde o guard de
 * colisão roda ANTES do gate de caixa justamente para que
 * `allowClosedOriginalSession` nunca contorne um conflito.
 */
export function classifyQuarantineCandidate(input: {
  storeId: string
  candidate: QuarantineCandidate
  facts: QuarantineServerFacts
  /** Default: regras do PDV ao vivo. O recovery administrativo passa `historical-recovery`. */
  mode?: QuarantineClassifyMode
}): QuarantineRecoveryPlanItem {
  const { storeId, candidate, facts } = input
  const historical = input.mode === QUARANTINE_CLASSIFY_MODE.HISTORICAL_RECOVERY

  const conflictingPedidoId = text(candidate.id) ?? ""
  const parsedClientSaleId = parseClientSaleId(candidate.clientSaleId)
  const clientSaleId = parsedClientSaleId.ok ? parsedClientSaleId.clientSaleId : null
  const conflictCode = text(candidate.syncBlockedCode)
  const total = money(candidate.total)
  const valorAVista = money(valorAVistaVenda(total, breakdown(candidate.paymentBreakdown)))
  const declaredStoreId = text(candidate.storeId)

  const base = {
    conflictingPedidoId,
    clientSaleId,
    total,
    valorAVista,
    at: text(candidate.at),
    customerName: text(candidate.customerName),
    conflictCode,
    originalSessionStatus: facts.originalSessionStatus,
    occupantStoreId: text(facts.occupantStoreId),
    alreadyRecoveredPedidoId: text(facts.alreadyRecoveredPedidoId),
    alreadyRecoveredVendaId: text(facts.alreadyRecoveredVendaId),
  } as const

  const decide = (
    klass: QuarantineRecoveryClass,
    reason: string,
  ): QuarantineRecoveryPlanItem => ({
    ...base,
    klass,
    bucket: bucketForClass(klass),
    reason,
  })

  // 1. Idempotência antes de tudo: se a venda JÁ existe no servidor sob a mesma
  //    identidade técnica, nada há a criar — nem mesmo se o payload local estiver
  //    ruim, a sessão fechada ou o código de quarentena já limpo. Só o estado local
  //    precisa ser reconciliado. Um caso idempotente nunca é relatado como erro.
  if (text(facts.alreadyRecoveredPedidoId)) {
    return decide(
      QUARANTINE_RECOVERY_CLASS.ALREADY_RECOVERED,
      "Já existe venda no servidor com esta identidade técnica. Nada será criado.",
    )
  }

  // 2. É mesmo quarentena de identidade?
  if (!isSaleIdentityConflictCode(conflictCode)) {
    return decide(
      QUARANTINE_RECOVERY_CLASS.NOT_QUARANTINED,
      "Esta venda não está em conflito de identificação.",
    )
  }

  // 3. Identidade técnica.
  if (!clientSaleId) {
    return decide(
      QUARANTINE_RECOVERY_CLASS.MISSING_CLIENT_SALE_ID,
      `Sem identidade técnica utilizável (${parsedClientSaleId.ok ? "—" : parsedClientSaleId.reason}).`,
    )
  }

  if (!conflictingPedidoId) {
    return decide(
      QUARANTINE_RECOVERY_CLASS.INVALID_PAYLOAD,
      "Cópia local sem número comercial de origem.",
    )
  }

  // 4. Loja. A cópia local pode declarar outra loja quando o navegador trocou de
  //    unidade — recuperar na loja errada moveria estoque e caixa alheios.
  if (declaredStoreId && declaredStoreId !== storeId) {
    return decide(
      QUARANTINE_RECOVERY_CLASS.STORE_MISMATCH,
      `Cópia local pertence à loja ${declaredStoreId}, não à loja ativa.`,
    )
  }

  // 5. Integridade dos fatos: o mesmo predicado que o motor usa para decidir replay.
  if (!isLegacySaleFactsComparable(candidate)) {
    return decide(
      QUARANTINE_RECOVERY_CLASS.INVALID_PAYLOAD,
      "Fatos centrais da venda ausentes ou inválidos (itens, total, datas).",
    )
  }

  // 6. O conflito é real? Sem ocupante não há colisão: renumerar seria inventar
  //    um número novo sem motivo. O caminho correto é o reenvio normal.
  if (!facts.occupantExists) {
    return decide(
      QUARANTINE_RECOVERY_CLASS.OCCUPANT_NOT_FOUND,
      "Nenhuma venda ocupa o número antigo. Use o reenvio normal, não a recuperação.",
    )
  }

  // 7. Produto e estoque — bloqueiam só no PDV ao vivo. Venda histórica real não
  //    deixa de existir porque o catálogo/estoque de hoje mudou.
  const unresolved = (facts.unresolvedInventoryIds ?? []).filter(
    (id) => typeof id === "string" && id.trim() && !isVirtualSaleLine(id),
  )
  const shortfalls = facts.stockShortfalls ?? []
  if (!historical) {
    if (unresolved.length > 0) {
      return decide(
        QUARANTINE_RECOVERY_CLASS.PRODUCT_UNRESOLVED,
        `Produto não encontrado no catálogo da loja: ${unresolved.slice(0, 3).join(", ")}.`,
      )
    }
    if (shortfalls.length > 0) {
      const first = shortfalls[0]
      return decide(
        QUARANTINE_RECOVERY_CLASS.INSUFFICIENT_STOCK_RISK,
        `Estoque insuficiente para ${first.nome} (disponível ${first.disponivel}, necessário ${first.necessario}).`,
      )
    }
  }

  // 8. Caixa. Só importa quando a venda move a gaveta: 100% à prazo ou 100%
  //    crédito-vale não geram `MovimentacaoFinanceira` e não exigem sessão.
  if (valorAVista > 0) {
    if (facts.originalSessionStatus === "FECHADA") {
      return decide(
        QUARANTINE_RECOVERY_CLASS.REQUIRES_CLOSED_SESSION_CONFIRM,
        "Sessão de caixa original já fechada. O lançamento é retroativo na própria sessão original e exige confirmação.",
      )
    }
    if (!historical) {
      if (facts.originalSessionStatus === "NO_SESSION_ID") {
        return decide(
          QUARANTINE_RECOVERY_CLASS.MISSING_ORIGINAL_SESSION,
          "Venda com receita à vista sem sessão de caixa original. Recuperar lançaria o valor no caixa de hoje.",
        )
      }
      if (facts.originalSessionStatus === "NOT_FOUND") {
        return decide(
          QUARANTINE_RECOVERY_CLASS.MISSING_ORIGINAL_SESSION,
          "Sessão de caixa original inexistente ou de outra loja.",
        )
      }
    }
  }

  if (historical && unresolved.length > 0) {
    return decide(
      QUARANTINE_RECOVERY_CLASS.READY,
      `Recuperável como venda histórica: produto sem cadastro atual preservado no snapshot (${unresolved.slice(0, 3).join(", ")}).`,
    )
  }
  if (historical && shortfalls.length > 0) {
    const first = shortfalls[0]
    return decide(
      QUARANTINE_RECOVERY_CLASS.READY,
      `Recuperável como venda histórica: déficit de estoque será registrado no ledger (${first.nome}: disponível ${first.disponivel}, necessário ${first.necessario}).`,
    )
  }
  if (
    historical &&
    valorAVista > 0 &&
    (facts.originalSessionStatus === "NO_SESSION_ID" ||
      facts.originalSessionStatus === "NOT_FOUND")
  ) {
    return decide(
      QUARANTINE_RECOVERY_CLASS.READY,
      "Recuperável como venda histórica: sessão original não identificável. A venda será persistida sem lançar no caixa atual.",
    )
  }

  return decide(QUARANTINE_RECOVERY_CLASS.READY, "Recuperável: novo número server-side.")
}

// ─────────────────────────────────────────────────────────────────────────────
// Plano do lote
// ─────────────────────────────────────────────────────────────────────────────

export type QuarantineRecoverySummary = {
  readonly total: number
  readonly ready: number
  readonly alreadyRecovered: number
  readonly requiresConfirmation: number
  readonly blocked: number
  /** Soma dos totais — informativo. Nunca autoridade financeira. */
  readonly valorTotal: number
  /** Soma dos totais das candidatas executáveis. */
  readonly valorExecutavel: number
  /** Contagem por classe, para o preview detalhar sem recontar no cliente. */
  readonly byClass: Readonly<Record<string, number>>
}

export type QuarantineRecoveryPlan = {
  readonly items: readonly QuarantineRecoveryPlanItem[]
  readonly summary: QuarantineRecoverySummary
}

export function summarizeQuarantinePlan(
  items: readonly QuarantineRecoveryPlanItem[],
): QuarantineRecoverySummary {
  const byClass: Record<string, number> = {}
  let ready = 0
  let alreadyRecovered = 0
  let requiresConfirmation = 0
  let blocked = 0
  let valorTotal = 0
  let valorExecutavel = 0

  for (const item of items) {
    byClass[item.klass] = (byClass[item.klass] ?? 0) + 1
    valorTotal = Math.round((valorTotal + item.total) * 100) / 100
    if (isExecutableClass(item.klass)) {
      valorExecutavel = Math.round((valorExecutavel + item.total) * 100) / 100
    }
    switch (item.bucket) {
      case QUARANTINE_RECOVERY_BUCKET.READY:
        ready += 1
        break
      case QUARANTINE_RECOVERY_BUCKET.ALREADY_RECOVERED:
        alreadyRecovered += 1
        break
      case QUARANTINE_RECOVERY_BUCKET.REQUIRES_CONFIRMATION:
        requiresConfirmation += 1
        break
      default:
        blocked += 1
    }
  }

  return {
    total: items.length,
    ready,
    alreadyRecovered,
    requiresConfirmation,
    blocked,
    valorTotal,
    valorExecutavel,
    byClass: Object.freeze(byClass),
  }
}

export function planQuarantineRecovery(
  entries: readonly {
    storeId: string
    candidate: QuarantineCandidate
    facts: QuarantineServerFacts
  }[],
  mode: QuarantineClassifyMode = QUARANTINE_CLASSIFY_MODE.LIVE_STOCK_RULES,
): QuarantineRecoveryPlan {
  const items = entries.map((entry) => classifyQuarantineCandidate({ ...entry, mode }))
  return { items, summary: summarizeQuarantinePlan(items) }
}
