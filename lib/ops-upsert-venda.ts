import type { Prisma } from "@/generated/prisma"
import { isVirtualSaleLine } from "@/lib/os-pdv-virtual-lines"
import type { PaymentBreakdownFull } from "@/lib/operations-sale-types"
import type { SaleLineItemType } from "@/lib/sale-line-classification"
import { valorAVistaVenda } from "@/lib/financeiro/correcao-pagamento-plan"
import type { AccessorySelectionV1 } from "@/lib/acessorios/types"
import { sanitizeSaleLinesPayload } from "@/lib/vendas/sanitize-sale-line-payload"
import { stripClientSyncFlags } from "@/lib/vendas/sale-sync-flags"
import {
  buildLegacySaleFingerprint,
  isLegacySaleFactsComparable,
} from "@/lib/vendas/legacy-sale-fingerprint"

/**
 * Lançada pela baixa de estoque do PDV quando `enforceStock` está ativo e o saldo
 * do produto não cobre a quantidade vendida (anti-negativo / anti-oversell — DT-B).
 * O caller (rota `venda-persist`) traduz para HTTP 409 explícito.
 */
export class InsufficientStockError extends Error {
  readonly code = "ESTOQUE_INSUFICIENTE"
  readonly produtoId: string
  readonly produtoNome: string
  readonly disponivel: number
  readonly solicitado: number
  constructor(produtoId: string, produtoNome: string, disponivel: number, solicitado: number) {
    super(
      `Estoque insuficiente para "${produtoNome}": disponível ${disponivel}, solicitado ${solicitado}.`,
    )
    this.name = "InsufficientStockError"
    this.produtoId = produtoId
    this.produtoNome = produtoNome
    this.disponivel = disponivel
    this.solicitado = solicitado
  }
}

/**
 * Lançada no fluxo PDV ao vivo (`enforceStock`) quando uma linha de produto físico
 * referencia um `inventoryId` que não casa com nenhum `Produto` (id/sku/barcode) da
 * loja. Antes (P1 OPS-SALE-SAFETY) a venda era gravada mesmo assim e só logava
 * `estoque-nao-baixado`, deixando venda/financeiro sem baixa de estoque. Agora a
 * transação inteira é abortada — nada é gravado. Linhas virtuais (O.S./serviço/avulso) são
 * isentas via `isVirtualSaleLine`. O caller (`venda-persist`) traduz para HTTP 409.
 */
export class UnresolvedProductError extends Error {
  readonly code = "PRODUTO_NAO_RESOLVIDO"
  readonly inventoryIds: string[]
  constructor(inventoryIds: string[]) {
    super(
      "Produto não encontrado para baixa de estoque. Revise o item antes de finalizar a venda.",
    )
    this.name = "UnresolvedProductError"
    this.inventoryIds = inventoryIds
  }
}

/**
 * Lançada quando `requireCaixaSession` está ativo e a venda gera entrada no caixa
 * (valorImediato > 0) mas NÃO há `SessaoCaixa` ABERTA válida para a loja: sessão
 * inexistente, de OUTRA loja, ou (quando a venda não referencia uma sessão específica)
 * nenhuma sessão aberta no terminal. Nunca abre caixa automaticamente. O caller
 * (`venda-persist`) traduz para HTTP 409. Note: quando a venda referencia uma
 * `sessaoId` que EXISTE e é DESTA loja mas está `FECHADA`, o erro é o mais específico
 * `CaixaOriginalFechadoError` (ver abaixo) — não este.
 */
export class CaixaSessaoInvalidaError extends Error {
  readonly code = "CAIXA_FECHADO"
  constructor() {
    super("Caixa fechado ou sessão inválida. Abra o caixa antes de finalizar a venda.")
    this.name = "CaixaSessaoInvalidaError"
  }
}

/**
 * Lançada quando a venda referencia uma `sessaoId` que EXISTE e é DESTA loja, mas já
 * está `FECHADA` (fechamento diário já rodou) — típico de venda pendente de dia
 * anterior tentando reenviar depois do fechamento de caixa daquele dia. Diferente de
 * `CaixaSessaoInvalidaError` (sessão inexistente/de outra loja): aqui a sessão é
 * legítima, só que encerrada. NUNCA sincroniza automaticamente no caixa atual (a
 * movimentação usaria `sale.at` original e ficaria fora da janela `abertaEm..fechadaEm`
 * de qualquer sessão — invisível em toda conferência/fechamento). Só é contornável com
 * `allowClosedOriginalSession: true` (ação manual explícita do operador/gerente),
 * gravando na PRÓPRIA sessão original fechada. O caller (`venda-persist`) traduz para
 * HTTP 409 com `code: "CAIXA_ORIGINAL_FECHADO"`.
 */
export class CaixaOriginalFechadoError extends Error {
  readonly code = "CAIXA_ORIGINAL_FECHADO"
  constructor() {
    super(
      "Esta venda pertence a uma sessão de caixa já fechada. Para sincronizar, confirme o lançamento retroativo na sessão original.",
    )
    this.name = "CaixaOriginalFechadoError"
  }
}

/**
 * Lançada quando o `pedidoId` recebido JÁ EXISTE no banco pertencendo a OUTRA loja.
 *
 * `Venda.pedidoId` é `@unique` GLOBAL, mas o número `VDA-YYYY-NNNN` é gerado por um
 * contador LOCAL do navegador (`nextSaleId` em `lib/operations-store.tsx`), que reinicia
 * em `0001` em cada loja. Duas lojas chegam ao mesmo número, e o `upsert` por `pedidoId`
 * encontrava a venda da outra loja e a REESCREVIA (o `update` chegava a reatribuir
 * `storeId`): a venda da loja A trocava de dono, seus `ItemVenda` eram apagados e
 * recriados com os itens da loja B, enquanto estoque/financeiro originais ficavam órfãos
 * na loja A — e o novo lançamento entrava na loja B com a data original, fora da janela
 * de qualquer sessão de caixa (invisível em conferência/fechamento).
 *
 * Comprovado em PDV-PENDENCIAS-FANTASMAS-SERVER-PAYLOAD-AUDIT-001: a loja-2 tem
 * `VDA-2026-0001..0505` com exatamente 5 buracos (0046, 0047, 0111, 0221, 0288), todos
 * ocupados por vendas íntegras da loja-1.
 *
 * Fail-closed: nada é gravado. O caller (`venda-persist`) traduz para HTTP 409. NÃO é
 * contornável por `allowClosedOriginalSession` — o guard roda antes de qualquer outra
 * validação ou efeito. A recuperação das vendas bloqueadas exige renumeração
 * administrada (GOAL próprio), nunca reenvio.
 */
export class PedidoIdDeOutraLojaError extends Error {
  readonly code = "PEDIDO_ID_DE_OUTRA_LOJA"
  readonly pedidoId: string
  /** Loja que já é dona do `pedidoId` (para log estruturado — nunca exposto ao operador). */
  readonly ownerStoreId: string
  constructor(pedidoId: string, ownerStoreId: string) {
    super(
      "Este número de venda já pertence a outra loja. A venda não foi gravada para evitar sobrescrever dados.",
    )
    this.name = "PedidoIdDeOutraLojaError"
    this.pedidoId = pedidoId
    this.ownerStoreId = ownerStoreId
  }
}

/** Mesmo número e mesma loja, mas os fatos canônicos identificam outra venda. */
export class PedidoIdConflitoMesmaLojaError extends Error {
  readonly code = "PEDIDO_ID_CONFLITO_MESMA_LOJA"
  readonly pedidoId: string
  readonly incomingFingerprint: string
  readonly existingFingerprint: string
  constructor(pedidoId: string, incomingFingerprint: string, existingFingerprint: string) {
    super("Este número já identifica outra venda nesta loja. Nada foi alterado.")
    this.name = "PedidoIdConflitoMesmaLojaError"
    this.pedidoId = pedidoId
    this.incomingFingerprint = incomingFingerprint
    this.existingFingerprint = existingFingerprint
  }
}

/**
 * Sinal interno: o `Venda.create` perdeu uma corrida na unique global de `pedidoId`.
 * A transação já está abortada; o caller deve reler o vencedor fora dela.
 */
export class VendaCreateUniqueConflictError extends Error {
  readonly code = "P2002"
  readonly pedidoId: string
  constructor(pedidoId: string, cause: unknown) {
    super("Conflito concorrente ao criar venda.")
    this.name = "VendaCreateUniqueConflictError"
    this.pedidoId = pedidoId
    ;(this as Error & { cause?: unknown }).cause = cause
  }
}

export function isPrismaUniqueConstraintError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  )
}

export type UpsertVendaOptions = {
  /**
   * Quando `true`, a baixa de estoque bloqueia qualquer decremento que deixaria o saldo
   * negativo, falhando com `InsufficientStockError`. Usado no fluxo PDV ao vivo
   * (`/api/ops/venda-persist`). O replay legado (`/api/ops/sync-legacy-vendas`) mantém
   * o default `false` para não quebrar a importação histórica.
   *
   * Também ativa o bloqueio de produto físico não resolvido (`UnresolvedProductError`):
   * item com `inventoryId` que não casa com nenhum `Produto` da loja aborta a venda em
   * vez de gravar venda/financeiro sem baixa de estoque.
   */
  enforceStock?: boolean
  /**
   * Quando `true`, vendas que geram entrada no caixa (valorImediato > 0) exigem uma
   * `SessaoCaixa` ABERTA válida da loja — falha com `CaixaSessaoInvalidaError`. Usado no
   * fluxo PDV ao vivo (`/api/ops/venda-persist`). O replay legado mantém o default
   * `false` (não revalida caixa de vendas históricas). Nunca abre caixa automaticamente.
   */
  requireCaixaSession?: boolean
  /**
   * Autoriza explicitamente a sincronização de uma venda cuja `sessaoId` original
   * existe e é DESTA loja, mas já está `FECHADA` — ação manual do operador/gerente
   * (nunca ligado por padrão, nunca inferido automaticamente). Quando `true` e esse
   * for o caso, a venda é gravada normalmente (mesma sessão original, mesma data),
   * e o payload ganha os metadados de auditoria `retroactiveSync`/`originalSessionClosed`/
   * `syncedAt`/`reason`. Sem esse flag, o mesmo cenário falha com `CaixaOriginalFechadoError`.
   */
  allowClosedOriginalSession?: boolean
}

export type SalePayload = {
  id?: string
  at?: string
  total?: number
  customerName?: string
  /** CPF/CNPJ somente dígitos — usado para debitar ClienteCredito quando creditoVale > 0. */
  customerCpf?: string
  /** FK real para Cliente (cuid). Nulo em consumidor final. */
  clienteId?: string
  /** Operador/caixa que realizou a venda (extraído de SaleRecord.cashierId). */
  cashierId?: string
  /**
   * Sessão de caixa ativa no momento da venda (servidor-confirmada — `caixaSessaoId`
   * do PDV). Usada para validar `SessaoCaixa` ABERTA quando `requireCaixaSession`.
   */
  sessaoId?: string | null
  /**
   * Terminal PDV (PDV1, PDV2...) em que a venda foi feita. Fase 1: persiste apenas no
   * `Venda.payload` (este campo) — a coluna `Venda.terminalId` é preparada no schema
   * para a Fase 2 (filtros/relatórios por terminal via SQL).
   */
  terminalId?: string | null
  /** Vínculo operacional da venda com uma O.S., quando existente. */
  linkedOsId?: string | null
  /** Formas de pagamento — usado para gerar MovimentacaoFinanceira por forma. */
  paymentBreakdown?: Partial<PaymentBreakdownFull>
  /**
   * Metadados de auditoria gravados pelo SERVIDOR (nunca enviados pelo cliente) quando
   * `allowClosedOriginalSession` é usado para sincronizar uma venda pendente cuja sessão
   * de caixa original já está fechada — ver `CaixaOriginalFechadoError`.
   */
  retroactiveSync?: boolean
  originalSessionClosed?: boolean
  syncedAt?: string
  reason?: string
  /** Configuração de parcelamento para venda à prazo. */
  aPrazoConfig?: {
    parcelas?: number
    primeiroVencimento?: string // DD/MM/YYYY
    intervalDias?: number
    /** Observação opcional do operador (espelhada no payload do título). */
    observacao?: string
  }
  lines?: Array<{
    inventoryId?: string
    name?: string
    quantity?: number
    unitPrice?: number
    lineTotal?: number
    qtyReturned?: number
    itemType?: SaleLineItemType
    /** Item avulso (Venda Avulsa via INSERT no PDV) — não baixa estoque. */
    isAvulso?: boolean
    /** Custo unitário opcional informado no balcão para relatórios de margem. */
    custoUnitario?: number | null
    /**
     * Seleção de modelo/cor do acessório (PDV-ACESSORIOS-SELETOR-MODELO-COR-003).
     * Dado passivo/complementar — nunca participa de resolução de produto, baixa de
     * estoque, financeiro ou fiscal. Sempre resaneada por `sanitizeSaleLinesPayload`
     * (via `sanitizeAccessorySelection`) antes de ser gravada em `Venda.payload`.
     */
    accessorySelection?: AccessorySelectionV1
    serviceId?: string
    serviceCategory?: string
    warrantyDays?: number
    serviceTerms?: string
  }>
}

type SalePayloadLine = NonNullable<SalePayload["lines"]>[number]

export const VENDA_REPLAY_SELECT = {
  id: true,
  storeId: true,
  pedidoId: true,
  payload: true,
  total: true,
  at: true,
  clienteNome: true,
  clienteId: true,
  terminalId: true,
  status: true,
} satisfies Prisma.VendaSelect

export type VendaReplayRecord = Prisma.VendaGetPayload<{ select: typeof VENDA_REPLAY_SELECT }>

export type VendaPersistView = {
  id: string
  storeId: string
  pedidoId: string
  total: number
  at: string
  clienteNome: string | null
  clienteId: string | null
  terminalId: string | null
  status: string
}

export type UpsertVendaResult = {
  replayed: boolean
  fingerprint: string
  venda: VendaPersistView
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function factsFromExistingVenda(existing: VendaReplayRecord): Record<string, unknown> {
  const payload = asRecord(existing.payload)
  return {
    ...payload,
    id: existing.pedidoId,
    at: "at" in payload ? payload.at : null,
    total: "total" in payload ? payload.total : existing.total,
    customerName: payload.customerName ?? existing.clienteNome,
    clienteId: payload.clienteId ?? existing.clienteId,
    terminalId: payload.terminalId ?? existing.terminalId,
  }
}

function vendaPersistView(existing: VendaReplayRecord): VendaPersistView {
  return {
    id: existing.id,
    storeId: existing.storeId,
    pedidoId: existing.pedidoId,
    total: existing.total,
    at: existing.at.toISOString(),
    clienteNome: existing.clienteNome,
    clienteId: existing.clienteId,
    terminalId: existing.terminalId,
    status: existing.status,
  }
}

/**
 * Classifica uma venda já existente sem executar I/O ou mutações.
 * Usado tanto no lookup inicial quanto após a transação perdedora de um P2002.
 */
export function classifyExistingVendaReplay(
  lojaId: string,
  sale: SalePayload,
  existing: VendaReplayRecord,
): UpsertVendaResult {
  if (existing.storeId !== lojaId) {
    throw new PedidoIdDeOutraLojaError(existing.pedidoId, existing.storeId)
  }

  const incomingFingerprint = buildLegacySaleFingerprint(sale)
  const existingFacts = factsFromExistingVenda(existing)
  const existingFingerprint = buildLegacySaleFingerprint(existingFacts)
  if (
    !isLegacySaleFactsComparable(sale) ||
    !isLegacySaleFactsComparable(existingFacts) ||
    incomingFingerprint !== existingFingerprint
  ) {
    throw new PedidoIdConflitoMesmaLojaError(
      existing.pedidoId,
      incomingFingerprint,
      existingFingerprint,
    )
  }

  return {
    replayed: true,
    fingerprint: incomingFingerprint,
    venda: vendaPersistView(existing),
  }
}

function asJsonPayload(sale: SalePayload): Prisma.InputJsonValue {
  return sale as unknown as Prisma.InputJsonValue
}

function arredonda2(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100
}

/** Valida FK de Cliente — evita P2003 quando o PDV envia id stale/outra loja. */
async function resolveClienteIdForStore(
  tx: Prisma.TransactionClient,
  lojaId: string,
  rawClienteId: string | null,
  pedidoId: string,
): Promise<string | null> {
  if (!rawClienteId) return null
  const found = await tx.cliente.findFirst({
    where: { id: rawClienteId, storeId: lojaId },
    select: { id: true },
  })
  if (!found) {
    console.warn(
      "[upsert-venda] clienteId-ignorado",
      JSON.stringify({ pedidoId, lojaId, clienteId: rawClienteId }),
    )
    return null
  }
  return found.id
}

/** Create-only de venda PDV, com replay fail-closed + efeitos na mesma transação. */
export async function upsertVendaInTransaction(
  tx: Prisma.TransactionClient,
  lojaId: string,
  sale: SalePayload,
  operadorLabel?: string,
  options?: UpsertVendaOptions
): Promise<UpsertVendaResult> {
  const enforceStock = options?.enforceStock === true
  const pedidoId = typeof sale.id === "string" && sale.id.trim() ? sale.id.trim() : ""
  if (!pedidoId) throw new Error("sale.id inválido")

  // ── GUARD FAIL-CLOSED: `pedidoId` já pertence a OUTRA loja ──────────────────
  // PRIMEIRA coisa depois de validar o id, ANTES de qualquer leitura de negócio,
  // validação de caixa, `Venda.create`, criação de itens, baixa de estoque, movimentação
  // financeira ou título a receber — nada foi escrito quando isto dispara. Rodar antes
  // do gate de caixa também garante que `allowClosedOriginalSession` (ação manual de
  // "Sincronizar retroativo") NUNCA contorne a colisão: o erro de colisão tem
  // precedência sobre `CAIXA_ORIGINAL_FECHADO`.
  const vendaExistente = await tx.venda.findUnique({
    where: { pedidoId },
    select: VENDA_REPLAY_SELECT,
  })
  if (vendaExistente) {
    // Replay legítimo retorna antes de caixa, itens, estoque, financeiro, crédito e
    // títulos. Fatos diferentes ou outra loja falham antes de qualquer escrita.
    return classifyExistingVendaReplay(lojaId, sale, vendaExistente)
  }

  const total = typeof sale.total === "number" && Number.isFinite(sale.total) ? sale.total : 0
  let at: Date
  try {
    at = sale.at ? new Date(sale.at) : new Date()
    if (Number.isNaN(at.getTime())) at = new Date()
  } catch {
    at = new Date()
  }

  const clienteNome =
    typeof sale.customerName === "string" && sale.customerName.trim() ? sale.customerName.trim() : null

  const rawClienteId =
    typeof sale.clienteId === "string" && sale.clienteId.trim() ? sale.clienteId.trim() : null
  const clienteId = await resolveClienteIdForStore(tx, lojaId, rawClienteId, pedidoId)

  const operador =
    operadorLabel?.trim() ||
    (typeof sale.cashierId === "string" && sale.cashierId.trim() ? sale.cashierId.trim() : null)

  const terminalId =
    typeof sale.terminalId === "string" && sale.terminalId.trim() ? sale.terminalId.trim() : null

  // Saneamento server-side (004B): nunca confiar em `accessorySelection` bruta do
  // client (sempre resaneada) nem persistir `cartLineKey` (derivável, só serve ao
  // carrinho). Seleção inválida é descartada com warning — nunca bloqueia a venda.
  const { lines: sanitizedLines, warnings: accessoryWarnings } = sanitizeSaleLinesPayload(sale.lines)
  for (const warning of accessoryWarnings) {
    console.warn(
      "[upsert-venda] accessory-selection-invalida",
      JSON.stringify({ code: warning.code, pedidoId, lojaId, index: warning.index }),
    )
  }
  const lines = sanitizedLines as SalePayloadLine[]

  // REGRA OFICIAL ÚNICA (GOAL_FATURAMENTO_VALE_ALINHAMENTO): receita à vista =
  // total − aPrazo − creditoVale (ver `valorAVistaVenda`). > 0 ⇒ a venda move a
  // gaveta (MovimentacaoFinanceira no passo 4) e, portanto, exige caixa aberto.
  const pb = sale.paymentBreakdown
  const valorImediato = valorAVistaVenda(total, pb)

  // ── 0. Caixa servidor obrigatório (P1 — OPS-SALE-SAFETY-P1-001) ─────────────
  // Vendas que geram entrada no caixa (valorImediato > 0) exigem uma `SessaoCaixa`
  // ABERTA da loja. Vendas 100% à prazo / 100% crédito-vale não movimentam a gaveta
  // e não exigem caixa. NUNCA abre caixa automaticamente; NUNCA usa fallback `loja-1`
  // (a loja vem do gate da rota). A resolução espelha de forma mínima
  // `lib/caixa/recebimento-cr-caixa.ts#resolveSessaoCaixaAberta` — duplicada aqui via
  // `tx` para manter este módulo livre de `@/lib/prisma` (testado em ambiente node com
  // TransactionClient fake) e a validação atômica dentro da própria transação da venda.
  // `true` quando a venda foi liberada via `allowClosedOriginalSession` numa sessão
  // original EXISTENTE-porém-FECHADA — usado abaixo para carimbar o payload (§1) com
  // metadados de auditoria. Nunca fica `true` no caminho "sem sessaoId" (sessão atual).
  let isRetroactiveSync = false
  if (options?.requireCaixaSession === true && valorImediato > 0) {
    const sessaoIdSale =
      typeof sale.sessaoId === "string" && sale.sessaoId.trim() ? sale.sessaoId.trim() : null
    if (sessaoIdSale) {
      // Com sessaoId: a sessão precisa existir e ser DESTA loja (qualquer status —
      // o status é avaliado a seguir para distinguir "fechada" de "inexistente").
      const sessao = await tx.sessaoCaixa.findFirst({
        where: { id: sessaoIdSale, storeId: lojaId },
        select: { id: true, status: true },
      })
      if (!sessao) {
        // Sessão inexistente ou de OUTRA loja — nunca aceitar, nunca fallback.
        throw new CaixaSessaoInvalidaError()
      }
      if (sessao.status !== "ABERTA") {
        // Sessão original existe e é desta loja, mas já foi fechada (fechamento diário
        // já rodou). Só prossegue com autorização explícita — nunca fallback silencioso
        // para a sessão atual (a movimentação usaria `sale.at` original e ficaria fora
        // da janela `abertaEm..fechadaEm` de qualquer sessão, invisível em toda
        // conferência — ver GOAL PDV-VENDA-PENDENTE-DIA-ANTERIOR-SYNC-AUDIT-001).
        if (options?.allowClosedOriginalSession !== true) {
          throw new CaixaOriginalFechadoError()
        }
        isRetroactiveSync = true
      }
    } else {
      // Sem sessaoId: aceita a sessão aberta mais recente da loja (do terminal, se houver).
      const sessao = await tx.sessaoCaixa.findFirst({
        where: { storeId: lojaId, status: "ABERTA", ...(terminalId ? { terminalId } : {}) },
        orderBy: { abertaEm: "desc" },
        select: { id: true },
      })
      if (!sessao) throw new CaixaSessaoInvalidaError()
    }
  }

  // Payload gravado em `Venda.payload`: primeiro removemos os marcadores de sincronização
  // que só existem no cliente (`syncPending`/`syncBlockedCode` — ver
  // `lib/vendas/sale-sync-flags.ts`). O PDV envia o `SaleRecord` inteiro, e gravar
  // `syncPending: true` fazia a venda voltar do servidor já classificada como pendente
  // em qualquer outro navegador (pendência fantasma). Blacklist, não whitelist: campos
  // legítimos ainda não tipados continuam sendo persistidos.
  const salePersistivel = stripClientSyncFlags(sale)

  // `lines` são as linhas já resaneadas por `sanitizeSaleLinesPayload` (acessórios) —
  // sobrescrevem as linhas cruas do cliente. Quando o sync foi retroativo (sessão original
  // fechada, autorizado explicitamente), carimba metadados de auditoria — nunca enviados
  // pelo cliente, calculados aqui no servidor no momento da gravação.
  const salePayloadForStorage: SalePayload = {
    ...salePersistivel,
    lines,
    ...(isRetroactiveSync
      ? {
          retroactiveSync: true,
          originalSessionClosed: true,
          syncedAt: new Date().toISOString(),
          reason: "pending_sale_closed_original_session",
        }
      : {}),
  }

  const fingerprint = buildLegacySaleFingerprint(sale)

  // ── 1. Create Venda ─────────────────────────────────────────────────────────
  // Multi-Terminais Fase 3: também popula a coluna `Venda.terminalId` (além do payload)
  // para permitir filtros SQL por terminal nos relatórios. Tudo nullable —
  // vendas sem terminal selecionado ou anteriores à feature continuam funcionando.
  // `at` continua sendo a data ORIGINAL da venda (nunca "agora") — inclusive no
  // caminho retroativo, para preservar a janela de conferência da sessão original.
  let v: VendaReplayRecord
  try {
    v = await tx.venda.create({
      data: {
        storeId: lojaId,
        pedidoId,
        payload: asJsonPayload(salePayloadForStorage),
        total,
        at,
        clienteNome,
        clienteId,
        operador,
        ...(terminalId ? { terminalId } : {}),
      },
      select: VENDA_REPLAY_SELECT,
    })
  } catch (error) {
    if (isPrismaUniqueConstraintError(error)) {
      // Não consultar nada nesta transação: Postgres/Prisma a considera abortada.
      throw new VendaCreateUniqueConflictError(pedidoId, error)
    }
    throw error
  }

  // ── 2. ItemVenda (somente o criador) + resolução de produto ─────────────────
  // inventoryId vindo do PDV pode ser SKU ou cuid; resolvemos via OR lookup e
  // armazenamos o cuid real em ItemVenda.inventoryId e no cache para o Step 3.
  type ResolvedProduct = {
    dbId: string
    stock: number
    precoCusto: number
    sku: string | null
    name: string
  }
  const resolvedProductMap = new Map<string, ResolvedProduct>()

  for (const line of lines) {
    const rawInvId = typeof line.inventoryId === "string" ? line.inventoryId.trim() : null
    const nome = typeof line.name === "string" ? line.name : ""
    const qRaw = typeof line.quantity === "number" && Number.isFinite(line.quantity) ? line.quantity : 0
    const quantidade = Math.max(0, Math.min(2_000_000_000, Math.round(qRaw)))
    const precoUnitario =
      typeof line.unitPrice === "number" && Number.isFinite(line.unitPrice) ? line.unitPrice : 0
    const lineTotal =
      typeof line.lineTotal === "number" && Number.isFinite(line.lineTotal)
        ? line.lineTotal
        : Math.round(precoUnitario * quantidade * 100) / 100

    // Resolve produto real via OR (id | sku | barcode); evita busca duplicada por linha
    if (rawInvId && !isVirtualSaleLine(rawInvId) && !resolvedProductMap.has(rawInvId)) {
      const produto = await tx.produto.findFirst({
        where: {
          storeId: lojaId,
          OR: [{ id: rawInvId }, { sku: rawInvId }, { barcode: rawInvId }],
        },
        select: { id: true, stock: true, precoCusto: true, sku: true, name: true },
      })
      if (produto) {
        resolvedProductMap.set(rawInvId, {
          dbId: produto.id,
          stock: produto.stock,
          precoCusto: produto.precoCusto,
          sku: produto.sku ?? null,
          name: produto.name,
        })
      }
    }

    // Usa o cuid real do banco; preserva rawInvId para linhas virtuais/serviço
    const resolvedProduct = rawInvId ? resolvedProductMap.get(rawInvId) : undefined
    const inventoryId = resolvedProduct ? resolvedProduct.dbId : rawInvId

    await tx.itemVenda.create({
      data: {
        vendaId: v.id,
        inventoryId,
        nome,
        quantidade,
        precoUnitario,
        lineTotal,
      },
    })
  }

  // ── 3. MovimentacaoEstoque (saída PDV) ──────────────────────────────────────
  // Agrega quantidade total por produto antes de criar o ledger.
  // Isso garante que 2 linhas de qty=1 para o mesmo produto gerem um único
  // decremento de qty=2, e que retry da mesma venda seja bloqueado pelo guard.
  const qtyByProdutoId = new Map<string, number>()
  const unresolvedInventoryIds: string[] = []
  for (const line of lines) {
    const rawInvId = typeof line.inventoryId === "string" ? line.inventoryId.trim() : ""
    if (!rawInvId || isVirtualSaleLine(rawInvId)) continue
    const resolved = resolvedProductMap.get(rawInvId)
    if (!resolved) {
      // Item vendido referencia inventoryId sem casamento por id/sku/barcode.
      // Causa típica: produto removido após cache do PDV ou SKU divergente. Sem ledger.
      unresolvedInventoryIds.push(rawInvId)
      continue
    }
    const qty = Math.max(0, Math.round(typeof line.quantity === "number" ? line.quantity : 0))
    if (qty === 0) continue
    qtyByProdutoId.set(resolved.dbId, (qtyByProdutoId.get(resolved.dbId) ?? 0) + qty)
  }
  if (unresolvedInventoryIds.length > 0) {
    if (enforceStock) {
      // P1 (OPS-SALE-SAFETY-P1-001): no fluxo PDV ao vivo, item de produto FÍSICO que
      // não casa com nenhum `Produto` (id/sku/barcode) da loja NÃO pode gerar
      // venda/financeiro sem baixa. Aborta a transação inteira — nada é gravado.
      // Linhas virtuais (O.S./serviço/avulso) já foram excluídas acima por `isVirtualSaleLine`.
      throw new UnresolvedProductError(unresolvedInventoryIds)
    }
    // Replay legado (`enforceStock` default false): preserva o histórico — apenas registra.
    console.warn(
      "[upsert-venda] estoque-nao-baixado",
      JSON.stringify({ pedidoId, lojaId, unresolvedInventoryIds }),
    )
  }

  // Mapa reverso dbId → resolved (para acessar sku/nome)
  const resolvedByDbId = new Map<string, ResolvedProduct>()
  for (const resolved of resolvedProductMap.values()) {
    resolvedByDbId.set(resolved.dbId, resolved)
  }

  for (const [produtoId, qty] of qtyByProdutoId) {
    const resolved = resolvedByDbId.get(produtoId)
    if (!resolved) continue

    // Idempotência: bloqueia retry da mesma venda (mesmo pedidoId + produto)
    const jaExiste = await tx.movimentacaoEstoque.findFirst({
      where: { storeId: lojaId, documento: pedidoId, produtoId, origem: "pdv" },
      select: { id: true },
    })
    if (jaExiste) continue

    // Re-lê stock atual dentro da transação para estoqueAntes preciso
    const produtoAtual = await tx.produto.findUnique({
      where: { id: produtoId },
      select: { stock: true, precoCusto: true },
    })
    if (!produtoAtual) continue

    const estoqueAntes = produtoAtual.stock
    const custo = arredonda2(Math.max(0, produtoAtual.precoCusto))

    if (enforceStock) {
      // Baixa atômica anti-negativo (DT-B): o predicado `stock >= qty` faz parte do
      // WHERE do UPDATE, reavaliado sob lock de linha pelo Postgres. Dois caixas
      // vendendo o mesmo SKU em paralelo serializam na linha — a 2ª transação que
      // não encontrar saldo retorna `count = 0` e falha de forma explícita, sem
      // nunca deixar `Produto.stock` abaixo de zero.
      const baixa = await tx.produto.updateMany({
        where: { id: produtoId, storeId: lojaId, stock: { gte: qty } },
        data: { stock: { decrement: qty } },
      })
      if (baixa.count === 0) {
        // Rollback de toda a transação da venda (atomicidade do $transaction).
        throw new InsufficientStockError(produtoId, resolved.name, estoqueAntes, qty)
      }
    } else {
      await tx.produto.update({
        where: { id: produtoId },
        data: { stock: { decrement: qty } },
      })
    }

    await tx.movimentacaoEstoque.create({
      data: {
        storeId: lojaId,
        produtoId,
        produtoSku: resolved.sku ?? null,
        produtoNome: resolved.name,
        tipo: "saida",
        origem: "pdv",
        quantidade: -qty,
        estoqueAntes,
        estoqueDepois: estoqueAntes - qty,
        custoUnitario: custo,
        custoMedioAntes: custo,
        custoMedioDepois: custo,
        valorTotal: arredonda2(qty * custo),
        documento: pedidoId,
        motivo: pedidoId,
        usuario: operador,
      },
    })
  }

  // ── 4. MovimentacaoFinanceira (receita à vista PDV) ─────────────────────────
  // `pb` e `valorImediato` já calculados no topo (regra única `valorAVistaVenda`):
  // aPrazo vira ContaReceberTitulo (passo 6); creditoVale abate ClienteCredito
  // (passo 5) — nenhum dos dois é dinheiro novo no caixa.
  const aPrazoVal = typeof pb?.aPrazo === "number" && pb.aPrazo > 0 ? pb.aPrazo : 0

  if (valorImediato > 0) {
    const dupFinanceiro = await tx.movimentacaoFinanceira.findFirst({
      where: { storeId: lojaId, referenciaId: pedidoId, origem: "venda", tipo: "entrada" },
      select: { id: true },
    })
    if (!dupFinanceiro) {
      const sufixoCliente =
        typeof sale.customerName === "string" && sale.customerName.trim()
          ? ` — ${sale.customerName.trim().slice(0, 80)}`
          : ""
      // createdAt = at (data real da venda no cliente). Sem isso, vendas offline
      // sincronizadas tardiamente cairiam na sessão de caixa errada — a query de
      // sessao-detalhe/fechamento filtra MovimentacaoFinanceira por createdAt entre
      // SessaoCaixa.abertaEm e fechadaEm.
      await tx.movimentacaoFinanceira.create({
        data: {
          storeId: lojaId,
          tipo: "entrada",
          valor: valorImediato,
          descricao: `Venda PDV ${pedidoId}${sufixoCliente}`,
          origem: "venda",
          referenciaId: pedidoId,
          createdAt: at,
        },
      })
    }
  }

  // ── 5. Debitar ClienteCredito (quando creditoVale foi usado na venda) ─────────
  // Dentro da mesma transação: se falhar, a venda inteira reverte — sem crédito perdido.
  const creditoValeUsado = arredonda2(pb?.creditoVale ?? 0)
  const cpfNorm = typeof sale.customerCpf === "string" ? sale.customerCpf.replace(/\D/g, "") : ""
  if (creditoValeUsado > 0 && cpfNorm) {
    const creditos = await tx.clienteCredito.findMany({
      where: { storeId: lojaId, clienteDoc: cpfNorm, status: "ativo", saldoAtual: { gt: 0 } },
      orderBy: { createdAt: "asc" },
    })
    let restante = creditoValeUsado
    for (const c of creditos) {
      if (restante <= 0.001) break
      const debit = arredonda2(Math.min(c.saldoAtual, restante))
      if (debit <= 0) continue
      const saldoAntes = c.saldoAtual
      const saldoDepois = arredonda2(c.saldoAtual - debit)
      await tx.clienteCredito.update({
        where: { id: c.id },
        data: {
          saldoAtual: saldoDepois,
          status: saldoDepois <= 0.001 ? "zerado" : "ativo",
        },
      })
      await tx.usoCreditoCliente.create({
        data: {
          creditoId: c.id,
          storeId: lojaId,
          vendaId: pedidoId,
          valor: debit,
          saldoAntes,
          saldoDepois,
          operador: operadorLabel ?? "",
        },
      })
      restante = arredonda2(restante - debit)
    }
    if (restante > 0.001) {
      console.warn("[upsert-venda] credito-sub-debitado", { pedidoId, cpfNorm, creditoValeUsado, restante })
    }
  }

  // ── 6. Título(s) à prazo (Contas a Receber) — DENTRO da transação ───────────
  // Cria um ContaReceberTitulo por parcela. Se não há config de parcelamento,
  // cria título único com vencimento em 30 dias (comportamento anterior).
  // localKey por parcela (`pdv-aprazo-{pedidoId}` ou `pdv-aprazo-{pedidoId}-{n}`)
  // garante idempotência em retries.
  if (aPrazoVal > 0) {
    const cfg = sale.aPrazoConfig
    const parcelas = Math.max(1, Math.min(24, Number(cfg?.parcelas) || 1))
    const intervalDias = Math.max(1, Number(cfg?.intervalDias) || 30)
    const aprazoCliente = clienteNome || "Cliente"
    const aprazoObs =
      typeof cfg?.observacao === "string" && cfg.observacao.trim()
        ? cfg.observacao.trim().slice(0, 500)
        : null

    // Resolve primeiro vencimento (DD/MM/YYYY → Date)
    let primeiroVenc: Date
    if (cfg?.primeiroVencimento) {
      const parts = cfg.primeiroVencimento.split("/")
      if (parts.length === 3) {
        const d = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]))
        primeiroVenc = isNaN(d.getTime()) ? new Date(at.getTime() + intervalDias * 86_400_000) : d
      } else {
        primeiroVenc = new Date(at.getTime() + intervalDias * 86_400_000)
      }
    } else {
      primeiroVenc = new Date(at.getTime() + intervalDias * 86_400_000)
    }

    const valorBase = arredonda2(aPrazoVal / parcelas)
    // Captura o id do primeiro título (n=1) para vincular em Venda.contaReceberTituloId.
    // O cancelamento da venda varre TODOS os títulos via `localKey startsWith pdv-aprazo-${pedidoId}`,
    // então o vínculo singular aqui é apenas indicação rápida para UI/relatórios.
    let firstTituloId: string | null = null
    for (let n = 1; n <= parcelas; n++) {
      // Última parcela absorve arredondamento
      const valorParcela = n === parcelas ? arredonda2(aPrazoVal - valorBase * (parcelas - 1)) : valorBase
      const aprazoLocalKey = parcelas === 1 ? `pdv-aprazo-${pedidoId}` : `pdv-aprazo-${pedidoId}-${n}`
      const vencDate = new Date(primeiroVenc)
      vencDate.setDate(vencDate.getDate() + (n - 1) * intervalDias)
      const vencStr = vencDate.toLocaleDateString("pt-BR")
      const aprazoDesc =
        parcelas === 1
          ? `Venda PDV ${pedidoId} — À prazo`
          : `Venda PDV ${pedidoId} — À prazo ${n}/${parcelas}`

      const aprazoPayload = {
        id: aprazoLocalKey,
        descricao: aprazoDesc,
        cliente: aprazoCliente,
        valor: valorParcela,
        vencimento: vencStr,
        status: "pendente",
        tipo: "pdv_aprazo",
        total_value: aPrazoVal,
        numeroParcela: n,
        totalParcelas: parcelas,
        ...(aprazoObs ? { observacao: aprazoObs } : {}),
        vendas: [{ saleId: pedidoId, total: aPrazoVal }],
      } as unknown as Prisma.InputJsonValue

      const upserted = await tx.contaReceberTitulo.upsert({
        where: { storeId_localKey: { storeId: lojaId, localKey: aprazoLocalKey } },
        create: {
          storeId: lojaId,
          localKey: aprazoLocalKey,
          descricao: aprazoDesc,
          cliente: aprazoCliente,
          valor: valorParcela,
          vencimento: vencStr,
          status: "pendente",
          payload: aprazoPayload,
        },
        // `status` fora do update para preservar baixas/pagamentos já feitos em re-sync.
        update: {
          descricao: aprazoDesc,
          cliente: aprazoCliente,
          valor: valorParcela,
          vencimento: vencStr,
          payload: aprazoPayload,
        },
        select: { id: true },
      })
      if (n === 1) firstTituloId = upserted.id
    }

    // Vincula a FK na venda (idempotente — re-sync aponta para o mesmo id pelo localKey único).
    if (firstTituloId) {
      await tx.venda.update({
        where: { id: v.id },
        data: { contaReceberTituloId: firstTituloId },
      })
    }
  }

  return {
    replayed: false,
    fingerprint,
    venda: vendaPersistView(v),
  }
}
