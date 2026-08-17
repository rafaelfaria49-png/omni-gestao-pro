"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import type { OrdemServico } from "@/components/dashboard/os/ordens-servico"
import type { Orcamento } from "@/lib/orcamento-types"
import { normalizeDocDigits } from "@/lib/cpf"
import { OPS_KEY_LEGACY } from "@/lib/loja-ativa"
import { opsLojaIdFromStorageKey } from "@/lib/ops-loja-id"
import { ASSISTEC_LOJA_HEADER } from "@/lib/assistec-headers"
import { LEGACY_PRIMARY_STORE_ID } from "@/lib/store-defaults"
import type { APrazoConfig, CaixaOperacaoRecord, DevolucaoRecord, PaymentBreakdownFull, SaleLineRecord, SaleRecord } from "@/lib/operations-sale-types"
import { mergeSalesById } from "@/lib/operations-sales-merge"
import { isVirtualSaleLine } from "@/lib/os-pdv-virtual-lines"
import { resolveSaleLineItemType, type SaleLineItemType } from "@/lib/sale-line-classification"
import { saleLineRecordFromFinalizeInput } from "@/lib/operations-sale-line"
import { readSelectedTerminal } from "@/lib/pdv-terminal"
import { emitEvent } from "@/lib/events/event-bus"
import { initAutomationEngineClient } from "@/lib/automation/automation-engine"
import { registrarOperacaoCaixaServer } from "@/lib/pdv-caixa-operacao"
import {
  applyCaixaSessionDecision,
  createSingleFlight,
  isCaixaSessionRejectionCode,
  reconcileCaixaSession,
  type CaixaRefreshOutcome,
} from "@/lib/pdv-caixa-session"
import { toast } from "@/components/ui/use-toast"
import type { AccessorySelectionV1, ProdutoAcessoriosMetadataV1 } from "@/lib/acessorios/types"
import {
  isSaleIdentityConflictCode,
  preserveSaleIdentityConflictCodes,
  SALE_IDENTITY_CONFLICT_GUIDANCE,
  SALE_IDENTITY_CONFLICT_TITLE,
} from "@/lib/vendas/sale-identity-conflict"
import {
  assertGeneratedClientSaleId,
  buildProvisionalSaleRef,
  generateClientSaleId,
  isProvisionalSaleRef,
  saleLocalKey,
} from "@/lib/vendas/local-sale-identity"
import {
  classifySaleWriterCapability,
  extractConfirmedVenda,
  parseSalePersistError,
  recoverQuarantinedSaleUrl,
  quarantineRecoveryPreviewUrl,
  quarantineRecoveryBatchUrl,
  shouldFallbackV2ToV1,
  vendaByClientSaleIdUrl,
  vendaPersistV2Url,
  type SaleWriterCapability,
} from "@/lib/vendas/sale-client-sync"
import {
  QUARANTINE_RECOVERY_CHUNK,
  applyRecoveryConfirmations,
  buildRecoveryConfirmations,
  chunk,
  isQuarantinedLocalSale,
  summarizePlanItems,
  summarizeRecoveryResults,
  type RecoveryConfirmation,
} from "@/lib/vendas/quarantine-local-reconciliation"

const VENDA_AUTO_RETRY_HOLD_MS = 5 * 60_000

export type { APrazoConfig, CaixaOperacaoRecord, DevolucaoRecord, PaymentBreakdownFull, SaleLineRecord, SaleRecord } from "@/lib/operations-sale-types"

/** Variação de produto (tamanho, cor, sabor, etc.) */
export type ProdutoAtributoDef = {
  id: string
  nome: string
  opcoes: string[]
}

export interface InventoryItem {
  id: string
  name: string
  /** Código de barras (EAN/GTIN) — usado no PDV Alta Performance. */
  barcode?: string
  /** SKU interno (Prisma `sku`) quando diferente do `id` operacional. */
  sku?: string
  /** Id persistido no banco (cuid) — bipe/código pode referenciar o registro. */
  dbId?: string
  /** Código interno de balcão (alias de SKU / id legado). */
  codigo?: string
  /** Alias de `barcode` para buscas e integrações. */
  codigoBarras?: string
  stock: number
  cost: number
  price: number
  category: string
  /** Se true, `price` é preço por kg; venda = preço/kg × peso da balança. */
  vendaPorPeso?: boolean
  /** Quando `vendaPorPeso`, deve refletir o mesmo que `price` (R$/kg). */
  precoPorKg?: number
  atributos?: ProdutoAtributoDef[]
  /** Configuração saneada e opcional projetada por `/api/ops/inventory`. */
  accessoryConfig?: ProdutoAcessoriosMetadataV1
}

export interface CaixaState {
  isOpen: boolean
  saldoInicial: number
  dataAbertura: Date | null
  totalEntradas: number
  totalSaidas: number
}

/** Resumo do dia para fechamento cego (por forma de pagamento). */
export interface DailyLedger {
  date: string
  vendasDinheiro: number
  /** Valor faturado à prazo (Contas a Receber) — excluído do caixa físico. */
  vendasAPrazo: number
  vendasPix: number
  vendasCartaoDebito: number
  vendasCartaoCredito: number
  vendasCarne: number
  /** Valor de compras pagas com crédito/vale de troca (não é dinheiro físico). */
  vendasCreditoVale: number
  totalVendas: number
  osAbertas: number
}

function todayStr(): string {
  return new Date().toISOString().split("T")[0]
}

function emptyLedger(): DailyLedger {
  return {
    date: todayStr(),
    vendasDinheiro: 0,
    vendasPix: 0,
    vendasCartaoDebito: 0,
    vendasCartaoCredito: 0,
    vendasCarne: 0,
    vendasAPrazo: 0,
    vendasCreditoVale: 0,
    totalVendas: 0,
    osAbertas: 0,
  }
}

/** Migra ledger antigo (vendasCartao) e garante campos novos. */
export function ensureLedger(ledger: DailyLedger | undefined): DailyLedger {
  const t = todayStr()
  if (!ledger || ledger.date !== t) return emptyLedger()
  const legacy = ledger as DailyLedger & { vendasCartao?: number }
  const oldC = legacy.vendasCartao ?? 0
  return {
    date: ledger.date,
    vendasDinheiro: ledger.vendasDinheiro ?? 0,
    vendasPix: ledger.vendasPix ?? 0,
    vendasCartaoDebito: (ledger.vendasCartaoDebito ?? 0) + oldC,
    vendasCartaoCredito: ledger.vendasCartaoCredito ?? 0,
    vendasCarne: ledger.vendasCarne ?? 0,
    vendasAPrazo: ledger.vendasAPrazo ?? 0,
    vendasCreditoVale: ledger.vendasCreditoVale ?? 0,
    totalVendas: ledger.totalVendas ?? 0,
    osAbertas: ledger.osAbertas ?? 0,
  }
}

function normalizePaymentBreakdown(pb?: Partial<PaymentBreakdownFull> & { cartao?: number }): PaymentBreakdownFull {
  const legacyCartao = pb?.cartao ?? 0
  return {
    dinheiro: pb?.dinheiro ?? 0,
    pix: pb?.pix ?? 0,
    cartaoDebito: pb?.cartaoDebito ?? legacyCartao,
    cartaoCredito: pb?.cartaoCredito ?? 0,
    carne: pb?.carne ?? 0,
    aPrazo: pb?.aPrazo ?? 0,
    creditoVale: pb?.creditoVale ?? 0,
  }
}

function nextSaleId(sales: SaleRecord[]): string {
  const year = new Date().getFullYear()
  let max = 0
  for (const s of sales) {
    const m = s.id.match(/^VDA-(\d{4})-(\d+)$/)
    if (m && parseInt(m[1], 10) === year) max = Math.max(max, parseInt(m[2], 10))
  }
  return `VDA-${year}-${String(max + 1).padStart(4, "0")}`
}

// `mergeSalesById` (pura) vive em `@/lib/operations-sales-merge` — importada acima e
// reutilizada por `loadDb` e `refreshSalesFromServer`. Mantida fora deste módulo client
// para permitir teste isolado em ambiente node.

function formatVendaPersistErrorBody(body: string, status: number): string {
  try {
    const j = JSON.parse(body) as { error?: string; detail?: string; code?: string }
    const parts = [j.error, j.detail, j.code ? `(${j.code})` : ""].filter(Boolean)
    if (parts.length > 0) return parts.join(" — ")
  } catch {
    /* raw text */
  }
  const trimmed = body.trim()
  return trimmed || `HTTP ${status}`
}

/** Extrai só o `code` do corpo de erro de `/api/ops/venda-persist` (ex.: `CAIXA_ORIGINAL_FECHADO`). */
function extractVendaPersistErrorCode(body: string): string | undefined {
  try {
    const j = JSON.parse(body) as { code?: string }
    return typeof j.code === "string" ? j.code : undefined
  } catch {
    return undefined
  }
}

function vendaPersistUrl(lojaId: string): string {
  return `/api/ops/venda-persist?storeId=${encodeURIComponent(lojaId)}`
}

function persistHeaders(lojaId: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    [ASSISTEC_LOJA_HEADER]: lojaId,
  }
}

function saleMatches(s: SaleRecord, token: { id: string; clientSaleId?: string }): boolean {
  if (token.clientSaleId && s.clientSaleId === token.clientSaleId) return true
  return s.id === token.id
}

function persistedSaleIdentityConflictCode(
  storageKey: string,
  sale: Pick<SaleRecord, "id" | "clientSaleId" | "syncBlockedCode">,
): string | undefined {
  if (isSaleIdentityConflictCode(sale.syncBlockedCode)) return sale.syncBlockedCode
  if (typeof window === "undefined") return undefined
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as { sales?: SaleRecord[] }
    const persisted = Array.isArray(parsed.sales)
      ? parsed.sales.find((candidate) => saleMatches(candidate, sale))
      : undefined
    return isSaleIdentityConflictCode(persisted?.syncBlockedCode)
      ? persisted.syncBlockedCode
      : undefined
  } catch {
    return undefined
  }
}

function mergeCustomerCredits(
  local: Record<string, { nome: string; saldo: number }>,
  remote: Record<string, { nome: string; saldo: number }>,
  pendingDevs: DevolucaoRecord[],
  pendingSales: SaleRecord[]
): Record<string, { nome: string; saldo: number }> {
  const merged = { ...local, ...remote }
  for (const k of Object.keys(merged)) {
    const remoteClient = remote[k]
    let saldo = remoteClient ? remoteClient.saldo : 0
    const nome = remoteClient ? remoteClient.nome : (local[k]?.nome ?? "Cliente")

    for (const dev of pendingDevs) {
      if (dev.syncPending && dev.customerCpf === k && dev.mode === "vale_credito") {
        saldo += dev.creditIssued
      }
    }

    for (const sale of pendingSales) {
      if (sale.syncPending && sale.customerCpf === k && sale.paymentBreakdown?.creditoVale > 0) {
        saldo -= sale.paymentBreakdown.creditoVale
      }
    }

    merged[k] = {
      nome,
      saldo: Math.max(0, Math.round(saldo * 100) / 100)
    }
  }
  return merged
}

function nextDevolucaoId(list: DevolucaoRecord[]): string {
  const year = new Date().getFullYear()
  let max = 0
  for (const d of list) {
    const m = d.id.match(/^DEV-(\d{4})-(\d+)$/)
    if (m && parseInt(m[1], 10) === year) max = Math.max(max, parseInt(m[2], 10))
  }
  return `DEV-${year}-${String(max + 1).padStart(4, "0")}`
}

type OpsState = {
  inventory: InventoryItem[]
  ordens: OrdemServico[]
  caixa: CaixaState
  /** ID da sessão de caixa persistida no servidor (POST /api/ops/caixa/abrir). */
  caixaSessaoId: string | null
  dailyLedger: DailyLedger
  sales: SaleRecord[]
  devolucoes: DevolucaoRecord[]
  pendingCaixaOperations: CaixaOperacaoRecord[]
  orcamentos: Orcamento[]
  /** chave = CPF/CNPJ só dígitos */
  customerCredits: Record<string, { nome: string; saldo: number }>
}

type SaleLine = {
  inventoryId: string
  quantity: number
}

const defaultState: OpsState = {
  inventory: [],
  ordens: [],
  caixa: {
    isOpen: false,
    saldoInicial: 0,
    dataAbertura: null,
    totalEntradas: 0,
    totalSaidas: 0,
  },
  dailyLedger: emptyLedger(),
  sales: [],
  devolucoes: [],
  pendingCaixaOperations: [],
  orcamentos: [],
  customerCredits: {},
  caixaSessaoId: null,
}

interface OperationsContextType {
  inventory: InventoryItem[]
  ordens: OrdemServico[]
  caixa: CaixaState
  caixaSessaoId: string | null
  dailyLedger: DailyLedger
  sales: SaleRecord[]
  devolucoes: DevolucaoRecord[]
  pendingCaixaOperations: CaixaOperacaoRecord[]
  orcamentos: Orcamento[]
  customerCredits: Record<string, { nome: string; saldo: number }>
  setOrdens: React.Dispatch<React.SetStateAction<OrdemServico[]>>
  setInventory: React.Dispatch<React.SetStateAction<InventoryItem[]>>
  setOrcamentos: React.Dispatch<React.SetStateAction<Orcamento[]>>
  abrirCaixa: (saldoInicial: number) => void
  fecharCaixa: () => void
  adicionarEntrada: (valor: number) => void
  adicionarSaida: (valor: number) => void
  getSaldoAtual: () => number
  setCaixaSessaoId: (id: string | null) => void
  /**
   * Reconsulta a sessão de caixa ABERTA da loja atual e re-hidrata o estado local
   * (servidor é a fonte da verdade). Substitui referência local obsoleta/ausente sem
   * exigir fechar e abrir outro caixa. Nunca adota caixa de outra loja, nunca decide
   * antes da hidratação do estado persistido, e não toca no carrinho nem na fila de
   * vendas pendentes. Chamadas concorrentes compartilham a mesma consulta em voo.
   */
  refreshCaixaSession: () => Promise<CaixaRefreshOutcome>
  incrementOsAbertasDia: () => void
  getSaldoCreditoCliente: (cpf: string) => number
  finalizeSaleTransaction: (input: {
    lines: Array<
      SaleLine & {
        name?: string
        unitPrice?: number
        itemType?: SaleLineItemType
        /** Marca item avulso (Venda Avulsa via INSERT no PDV) — não toca estoque. */
        isAvulso?: boolean
        /** Custo unitário opcional informado pelo operador no balcão. `null`/ausente = desconhecido. */
        custoUnitario?: number | null
        /** Seleção de modelo/cor do acessório (dado passivo, ver SaleLineRecord). */
        accessorySelection?: AccessorySelectionV1
        serviceId?: string
        serviceCategory?: string
        warrantyDays?: number
        serviceTerms?: string
      }
    >
    total: number
    linkedOsId?: string | null
    paymentBreakdown?: Partial<PaymentBreakdownFull> & { cartao?: number }
    customerCpf?: string
    customerName?: string
    /** FK real para o cliente cadastrado (cuid de Cliente). Nulo em consumidor final. */
    clienteId?: string
    openCaixaIfClosed?: boolean
    saldoInicialAoAbrir?: number
    auditMeta?: {
      cashierId?: string
      discountAuthorizedByAdminId?: string
      discountReais?: number
      discountPercent?: number
    }
    aPrazoConfig?: APrazoConfig
  }) => Promise<
    | { ok: true; saleId: string; pending?: boolean; clientSaleId?: string; serverId?: string }
    | { ok: false; reason: string }
  >
  registrarDevolucao: (input: {
    saleId: string
    lines: { inventoryId: string; quantity: number }[]
    mode: "vale_credito" | "somente_estoque"
    customerCpf: string
    customerName: string
    sessaoId?: string
    tipo?: "vale_credito" | "somente_estoque" | "troca" | "devolucao"
    motivo?: string
    observacao?: string
    payload?: any
  }) => { ok: true; devolucaoId: string; creditIssued: number } | { ok: false; reason: string }
  registrarOperacaoCaixa: (input: {
    sessaoId: string
    tipo: "sangria" | "suprimento"
    valor: number
    motivo: string
    localId: string
    operador?: string
  }) => Promise<{ ok: true; deduped?: boolean } | { ok: false; reason: string }>
  /**
   * Re-busca as vendas do servidor (`/api/ops/vendas-list`) e reconcilia o estado local,
   * propagando o `status` autoritativo (ex.: cancelamento feito na tela Vendas) para o
   * caixa/fechamento. Best-effort: erro de rede não altera o estado.
   */
  refreshSalesFromServer: () => Promise<void>
  /**
   * Reenvia ao servidor uma venda local marcada como `syncPending`. Em sucesso,
   * limpa `syncPending`. Em erro, mantém o estado pendente e devolve o motivo.
   */
  retrySyncSale: (saleId: string) => Promise<{ ok: true } | { ok: false; reason: string; code?: string }>
  /**
   * Ação manual explícita (nunca automática): reenvia uma venda pendente cuja sessão de
   * caixa original existe e é desta loja, mas já está `FECHADA`
   * (`sale.syncBlockedCode === "CAIXA_ORIGINAL_FECHADO"`), autorizando o servidor a
   * gravá-la retroativamente na PRÓPRIA sessão original (nunca no caixa atual). A UI deve
   * pedir confirmação antes de chamar.
   */
  retrySyncSaleRetroactive: (
    saleId: string,
  ) => Promise<{ ok: true } | { ok: false; reason: string; code?: string }>
  recoverQuarantinedSale: (input: {
    saleId: string
    motivo: string
    allowClosedOriginalSession?: boolean
  }) => Promise<{ ok: true; saleId: string; replayed?: boolean } | { ok: false; reason: string; code?: string }>
  /**
   * Verifica no servidor se a venda existe antes de descartar localmente.
   * - Se o servidor tem (HTTP 200): NÃO descarta — apenas reconcilia `syncPending=false`.
   * - Se o servidor NÃO tem (HTTP 404): remove a venda do estado local.
   * - Outros erros: aborta sem alterar estado.
   * Limpeza local pura — não toca em estoque, financeiro ou caixa.
   */
  discardLocalPendingSale: (saleId: string) => Promise<
    | { ok: true; mode: "discarded" }
    | { ok: true; mode: "reconciled"; reason: string }
    | { ok: false; reason: string }
  >
  /**
   * Para CADA venda local com `syncPending=true`, consulta o servidor: descarta as
   * ausentes (404), reconcilia as presentes (200), contabiliza conflitos (outros).
   * Limpeza local pura — não toca em estoque/financeiro/caixa.
   */
  bulkDiscardLocalPendingSales: () => Promise<{
    ok: true
    total: number
    discarded: number
    reconciled: number
    conflicts: number
  }>
  /**
   * DRY-RUN de TODAS as vendas locais em quarentena. Read-only no servidor: apenas
   * classifica. Cunha e persiste localmente a identidade técnica que estiver faltando
   * ANTES de qualquer chamada — assim a execução (e qualquer retry posterior) reusa a
   * MESMA chave de idempotência, sem risco de criar venda duplicada.
   */
  previewQuarantineRecovery: () => Promise<
    | {
        ok: true
        writerEnabled: boolean
        items: QuarantineRecoveryPlanItemView[]
        summary: QuarantineRecoverySummaryView
      }
    | { ok: false; reason: string; code?: string }
  >
  /**
   * Recuperação administrada EM LOTE. Uma transação por venda no servidor; o estado
   * local só é reconciliado para os itens com evidência server-side (`RECOVERED` /
   * `ALREADY_RECOVERED` com venda). Quarentena de item bloqueado permanece intacta.
   */
  recoverQuarantinedSalesBatch: (input: {
    motivo: string
    allowClosedOriginalSession?: boolean
  }) => Promise<
    | {
        ok: true
        results: QuarantineRecoveryResultView[]
        summary: {
          total: number
          recovered: number
          alreadyRecovered: number
          requiresConfirmation: number
          blocked: number
          failed: number
        }
        /** Quantas cópias locais saíram da quarentena (só com evidência server-side). */
        reconciled: number
      }
    | { ok: false; reason: string; code?: string }
  >
}

/** Recorte do item do planner consumido pela UI. */
export type QuarantineRecoveryPlanItemView = {
  conflictingPedidoId: string
  clientSaleId: string | null
  klass: string
  bucket: "READY" | "ALREADY_RECOVERED" | "REQUIRES_CONFIRMATION" | "BLOCKED"
  reason: string
  total: number
  valorAVista: number
  at: string | null
  customerName: string | null
  originalSessionStatus: string
  alreadyRecoveredPedidoId: string | null
}

export type QuarantineRecoverySummaryView = {
  total: number
  ready: number
  alreadyRecovered: number
  requiresConfirmation: number
  blocked: number
  valorTotal: number
  valorExecutavel: number
  byClass: Record<string, number>
}

export type QuarantineRecoveryResultView = {
  conflictingPedidoId: string
  clientSaleId: string | null
  status: "RECOVERED" | "ALREADY_RECOVERED" | "REQUIRES_CONFIRMATION" | "BLOCKED" | "FAILED"
  code: string | null
  reason: string
  venda: { id: string; pedidoId: string; clientSaleId: string | null } | null
  replayed: boolean
}

const OperationsContext = createContext<OperationsContextType | null>(null)

/** Restaurado só do localStorage (estoque e OS vêm do servidor). */
function parseLocalRest(raw: string, prev: OpsState): Partial<OpsState> | null {
  try {
    const parsed = JSON.parse(raw) as Partial<OpsState>
    return {
      dailyLedger: parsed.dailyLedger ? ensureLedger(parsed.dailyLedger as DailyLedger) : prev.dailyLedger,
      caixa: {
        ...prev.caixa,
        ...parsed.caixa,
        dataAbertura: parsed.caixa?.dataAbertura ? new Date(parsed.caixa.dataAbertura) : prev.caixa.dataAbertura,
      },
      caixaSessaoId:
        typeof (parsed as { caixaSessaoId?: unknown }).caixaSessaoId === "string"
          ? ((parsed as { caixaSessaoId: string }).caixaSessaoId || null)
          : prev.caixaSessaoId,
      sales: Array.isArray(parsed.sales) ? parsed.sales : prev.sales,
      devolucoes: Array.isArray(parsed.devolucoes) ? parsed.devolucoes : prev.devolucoes,
      pendingCaixaOperations: Array.isArray(parsed.pendingCaixaOperations) ? parsed.pendingCaixaOperations : prev.pendingCaixaOperations,
      customerCredits:
        parsed.customerCredits && typeof parsed.customerCredits === "object"
          ? parsed.customerCredits
          : prev.customerCredits,
      orcamentos: Array.isArray(parsed.orcamentos) ? parsed.orcamentos : prev.orcamentos,
    }
  } catch {
    return null
  }
}

function peekLegacyInventoryOrdens(raw: string | null): { inventory: InventoryItem[]; ordens: OrdemServico[] } {
  if (!raw) return { inventory: [], ordens: [] }
  try {
    const parsed = JSON.parse(raw) as Partial<OpsState>
    return {
      inventory: Array.isArray(parsed.inventory) ? parsed.inventory : [],
      ordens: Array.isArray(parsed.ordens) ? parsed.ordens : [],
    }
  } catch {
    return { inventory: [], ordens: [] }
  }
}

type CaixaPersisted = {
  isOpen: boolean
  saldoInicial: number
  dataAbertura: string | null
  totalEntradas: number
  totalSaidas: number
}

function caixaStorageKeyForLoja(storeId: string): string {
  return `omnigestao:caixa:${storeId}`
}

function loadCaixaSnapshot(storeId: string): CaixaState | null {
  if (typeof window === "undefined") return null
  try {
    const raw = localStorage.getItem(caixaStorageKeyForLoja(storeId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CaixaPersisted>
    if (!parsed || typeof parsed !== "object") return null
    const isOpen = parsed.isOpen === true
    const saldoInicial = Number(parsed.saldoInicial) || 0
    const totalEntradas = Number(parsed.totalEntradas) || 0
    const totalSaidas = Number(parsed.totalSaidas) || 0
    const dataAbertura =
      typeof parsed.dataAbertura === "string" && parsed.dataAbertura.trim()
        ? new Date(parsed.dataAbertura)
        : null
    return { isOpen, saldoInicial, dataAbertura, totalEntradas, totalSaidas }
  } catch {
    return null
  }
}

function saveCaixaSnapshot(storeId: string, caixa: CaixaState): void {
  if (typeof window === "undefined") return
  try {
    const payload: CaixaPersisted = {
      isOpen: !!caixa.isOpen,
      saldoInicial: Number(caixa.saldoInicial) || 0,
      dataAbertura: caixa.dataAbertura ? caixa.dataAbertura.toISOString() : null,
      totalEntradas: Number(caixa.totalEntradas) || 0,
      totalSaidas: Number(caixa.totalSaidas) || 0,
    }
    localStorage.setItem(caixaStorageKeyForLoja(storeId), JSON.stringify(payload))
  } catch {
    /* ignore quota */
  }
}

function toPersistedRest(state: OpsState): Omit<OpsState, "inventory" | "ordens"> {
  return {
    caixa: state.caixa,
    caixaSessaoId: state.caixaSessaoId,
    dailyLedger: state.dailyLedger,
    sales: state.sales,
    devolucoes: state.devolucoes,
    pendingCaixaOperations: state.pendingCaixaOperations,
    orcamentos: state.orcamentos,
    customerCredits: state.customerCredits,
  }
}

export function OperationsProvider({
  children,
  storageKey = OPS_KEY_LEGACY,
}: {
  children: ReactNode
  /** Por unidade (multiloja); padrão único = assistec-pro-ops-v1 */
  storageKey?: string
}) {
  useEffect(() => {
    // Camada de inteligência (eventos/automações) em modo simulado.
    // Não altera lógica de venda/estoque existente.
    initAutomationEngineClient()
  }, [])
  const [state, setState] = useState<OpsState>({
    ...defaultState,
    dailyLedger: emptyLedger(),
  })
  const [opsDbReady, setOpsDbReady] = useState(false)
  const stateRef = useRef(state)
  const lastSentOpsRef = useRef<string>("")
  const bootstrapDoneRef = useRef(false)
  /**
   * Hidratação do estado persistido, como sinal de COMMIT — não de ref.
   *
   * `bootstrapDoneRef` é marcado dentro do próprio efeito de bootstrap, então
   * ainda vale para o commit em que `state` é o PADRÃO: os `setState` de
   * restauração só aparecem no render seguinte. Quem decidir sobre o caixa
   * apoiado nele enxerga "caixa fechado, sem sessão" e nunca o que estava
   * guardado — a regressão A0. Este `useState` só fica preenchido num commit em
   * que `state` (e, pelo efeito abaixo, `stateRef.current`) já está restaurado.
   *
   * Guarda a CHAVE hidratada, não um booleano: numa troca de loja o `storageKey`
   * muda antes de o estado da nova loja ser restaurado, e um booleano continuaria
   * `true` — reabrindo A0 justamente na troca de loja.
   */
  const [caixaHydratedFor, setCaixaHydratedFor] = useState<string | null>(null)
  const caixaHydratedForRef = useRef<string | null>(null)
  const storageKeyRef = useRef(storageKey)
  const caixaHydrated = caixaHydratedFor === storageKey

  useEffect(() => {
    stateRef.current = state
    // Espelhado no mesmo efeito que publica o estado: qualquer fluxo assíncrono
    // que leia `caixaHydratedForRef` encontra `stateRef` já restaurado.
    caixaHydratedForRef.current = caixaHydratedFor
  }, [state, caixaHydratedFor])

  useEffect(() => {
    storageKeyRef.current = storageKey
  }, [storageKey])

  useEffect(() => {
    try {
      const lojaId = opsLojaIdFromStorageKey(storageKey)
      const raw = localStorage.getItem(storageKey)
      if (raw) {
        const partial = parseLocalRest(raw, stateRef.current)
        if (partial) {
          setState((prev) => ({ ...prev, ...partial }))
        }
        const snap = loadCaixaSnapshot(lojaId)
        if (snap) setState((prev) => ({ ...prev, caixa: snap }))
        bootstrapDoneRef.current = true
        return
      }
      if (storageKey !== OPS_KEY_LEGACY && storageKey.endsWith(`-${LEGACY_PRIMARY_STORE_ID}`)) {
        const legacy = localStorage.getItem(OPS_KEY_LEGACY)
        if (legacy) {
          const partial = parseLocalRest(legacy, stateRef.current)
          if (partial) {
            setState((prev) => ({ ...prev, ...partial }))
            localStorage.setItem(storageKey, legacy)
          }
        }
      }
      const snap = loadCaixaSnapshot(lojaId)
      if (snap) setState((prev) => ({ ...prev, caixa: snap }))
    } catch {
      // ignore
    } finally {
      bootstrapDoneRef.current = true
      // Enfileirado junto com os `setState` de restauração acima: o commit que
      // marca esta chave como hidratada é o mesmo que traz o caixa restaurado.
      setCaixaHydratedFor(storageKey)
    }
  }, [storageKey])

  useEffect(() => {
    if (!bootstrapDoneRef.current) return
    try {
      const persisted = toPersistedRest(state)
      const currentRaw = localStorage.getItem(storageKey)
      if (currentRaw) {
        const current = JSON.parse(currentRaw) as { sales?: SaleRecord[] }
        if (Array.isArray(current.sales)) {
          persisted.sales = preserveSaleIdentityConflictCodes(persisted.sales, current.sales)
        }
      }
      localStorage.setItem(storageKey, JSON.stringify(persisted))
    } catch {
      // ignore
    }
  }, [state, storageKey])

  // Quarentena é monotônica entre abas: o `storage` event traz o código permanente
  // descoberto por outra aba, impedindo foco/online/intervalo de reativar a tentativa.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== storageKey || !event.newValue) return
      try {
        const incoming = JSON.parse(event.newValue) as { sales?: SaleRecord[] }
        if (!Array.isArray(incoming.sales)) return
        setState((prev) => ({
          ...prev,
          sales: preserveSaleIdentityConflictCodes(prev.sales, incoming.sales ?? []),
        }))
      } catch {
        // Snapshot inválido de outra aba não altera o estado atual.
      }
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [storageKey])

  useEffect(() => {
    // `caixaHydrated` (e não `bootstrapDoneRef`): antes da hidratação `state.caixa`
    // ainda é o padrão, e gravar aqui sobrescreveria o snapshot guardado.
    if (!caixaHydrated) return
    const lojaId = opsLojaIdFromStorageKey(storageKey)
    saveCaixaSnapshot(lojaId, state.caixa)
  }, [caixaHydrated, state.caixa, storageKey])

  useEffect(() => {
    setOpsDbReady(false)
    let cancelled = false
    async function loadDb() {
      const lj = opsLojaIdFromStorageKey(storageKey)
      const headers: HeadersInit = {
        "Content-Type": "application/json",
        "x-assistec-loja-id": lj,
      }
      try {
        const [rInv, rOs] = await Promise.all([
          fetch(`/api/ops/inventory?lojaId=${encodeURIComponent(lj)}`, { credentials: "include" }),
          fetch(`/api/ops/ordens?lojaId=${encodeURIComponent(lj)}`, { credentials: "include" }),
        ])
        if (cancelled) return
        if (!rInv.ok || !rOs.ok) {
          lastSentOpsRef.current = JSON.stringify({
            inv: stateRef.current.inventory,
            ord: stateRef.current.ordens,
          })
          return
        }
        const jInv = (await rInv.json()) as { items?: InventoryItem[] }
        const jOs = (await rOs.json()) as { ordens?: OrdemServico[] }
        let items = jInv.items ?? []
        let ordens = jOs.ordens ?? []

        // Migração legada localStorage → DB: SOMENTE para a loja primária legada.
        // Lojas novas (multiloja) nunca recebem seed/migração automática — server é a
        // fonte da verdade e uma loja vazia deve permanecer 100% vazia (sem resíduo/mock).
        if (lj === LEGACY_PRIMARY_STORE_ID && items.length === 0 && ordens.length === 0) {
          const raw = localStorage.getItem(storageKey)
          const peek = peekLegacyInventoryOrdens(raw)
          const legInv = peek.inventory
          const legOrd = peek.ordens
          if (legInv.length > 0 || legOrd.length > 0) {
            // LEGACY_INVENTORY_SYNC_DISABLED: não persistir snapshot inteiro do client.
            // O estoque legado do localStorage NÃO é mais enviado por PUT (servidor é a
            // fonte da verdade; o endpoint PUT está quarentenado). `legInv` segue apenas
            // como cache visual desta sessão na loja primária legada — persistir estoque
            // deve ocorrer por fluxo granular do servidor (OPS-INVENTORY-SYNC-SAFETY-001).
            // O migrate de ORDENS (escopo Operações, fora deste GOAL) permanece.
            await fetch("/api/ops/ordens", {
              method: "PUT",
              credentials: "include",
              headers,
              body: JSON.stringify({ ordens: legOrd }),
            })
            items = legInv
            ordens = legOrd
          }
        }

        const snap = JSON.stringify({ inv: items, ord: ordens })
        lastSentOpsRef.current = snap

        let remoteSales: SaleRecord[] = []
        try {
          const rV = await fetch(`/api/ops/vendas-list?lojaId=${encodeURIComponent(lj)}`, {
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
              [ASSISTEC_LOJA_HEADER]: lj,
            },
          })
          if (rV.ok) {
            const jV = (await rV.json()) as { sales?: SaleRecord[] }
            remoteSales = jV.sales ?? []
          }
        } catch {
          /* ignore */
        }

        if (!cancelled) {
          setState((prev) => {
            const adjustedItems = items.map((i) => ({ ...i }))
            // Deduct pending offline sales
            const pendingSales = prev.sales.filter((s) => s.syncPending === true)
            for (const sale of pendingSales) {
              for (const line of sale.lines) {
                if (isVirtualSaleLine(line.inventoryId)) continue
                const item = adjustedItems.find((i) => i.id === line.inventoryId)
                if (item) {
                  item.stock = Math.max(0, item.stock - line.quantity)
                }
              }
            }
            // Add back pending offline returns
            const pendingDevs = prev.devolucoes.filter((d) => d.syncPending === true)
            for (const dev of pendingDevs) {
              for (const line of dev.lines) {
                const item = adjustedItems.find((i) => i.id === line.inventoryId)
                if (item) {
                  item.stock += line.quantity
                }
              }
            }
            return {
              ...prev,
              inventory: adjustedItems,
              ordens,
              sales: mergeSalesById(prev.sales, remoteSales),
            }
          })
        }

        // A reconciliação da sessão de caixa NÃO vive mais aqui. Ficava depois de
        // `inventory`/`ordens`, então qualquer 4xx/5xx nessas duas rotas abortava
        // `loadDb` antes de chegar no caixa e o estado local nunca era reconciliado.
        // Agora roda em fluxo próprio — `refreshCaixaSession`, abaixo —, independente
        // de estoque e de OS.

        // Reconcilia créditos do cliente com o servidor (best-effort).
        // DB é fonte de verdade: saldos conhecidos no DB sobrescrevem localStorage.
        // Docs apenas locais são mantidos (fallback offline).
        try {
          const rCred = await fetch(
            `/api/ops/credito-cliente?lojaId=${encodeURIComponent(lj)}`,
            { credentials: "include", headers }
          )
          if (!cancelled && rCred.ok) {
            const jCred = (await rCred.json()) as {
              creditos?: Record<string, { nome: string; saldo: number }>
            }
            const dbCreditos = jCred.creditos ?? {}
            if (Object.keys(dbCreditos).length > 0) {
              setState((prev) => ({
                ...prev,
                customerCredits: mergeCustomerCredits(
                  prev.customerCredits,
                  dbCreditos,
                  prev.devolucoes,
                  prev.sales
                ),
              }))
            }
          }
        } catch {
          /* ignorar — reconciliação é best-effort */
        }
      } catch {
        if (!cancelled) {
          lastSentOpsRef.current = JSON.stringify({
            inv: stateRef.current.inventory,
            ord: stateRef.current.ordens,
          })
        }
      } finally {
        if (!cancelled) {
          setOpsDbReady(true)
        }
      }
    }
    void loadDb()
    return () => {
      cancelled = true
    }
  }, [storageKey])

  /**
   * Reconcilia a sessão de caixa com o servidor — fonte da verdade.
   *
   * Independente de estoque/OS de propósito: antes, a reconciliação vivia dentro
   * do `loadDb` e qualquer falha de `/api/ops/inventory` ou `/api/ops/ordens`
   * deixava o caixa local desatualizado para sempre (PDV-CAIXA-SESSION-RECOVERY-001).
   *
   * Serializado por `createSingleFlight`: cliques repetidos em "Atualizar caixa"
   * (ou o refresh automático coincidindo com o clique) compartilham a mesma
   * consulta em voo, em vez de disparar N requisições e N decisões.
   *
   * Nunca toca no carrinho nem na fila de vendas (`sales`/`syncPending`): a
   * recuperação do caixa não pode apagar, renumerar nem reenviar venda alguma.
   */
  const caixaSyncSingleFlightRef = useRef(createSingleFlight<CaixaRefreshOutcome>())

  // Troca de loja invalida o serializador: a consulta em voo pertence à loja
  // anterior e não pode ser reaproveitada como resposta da loja nova.
  useEffect(() => {
    caixaSyncSingleFlightRef.current = createSingleFlight<CaixaRefreshOutcome>()
  }, [storageKey])

  const refreshCaixaSession = useCallback(async (): Promise<CaixaRefreshOutcome> => {
    const lj = opsLojaIdFromStorageKey(storageKey)
    return caixaSyncSingleFlightRef.current(async () => {
      const local = stateRef.current
      const { outcome, decision } = await reconcileCaixaSession({
        storeId: lj,
        // Sessão de caixa é POR TERMINAL: sem este escopo a consulta devolvia a
        // sessão mais recente da loja e o PDV1 passava a operar (e a fechar) a
        // sessão do PDV2 — F-01 da readiness 002A. Lido na hora da consulta
        // porque o operador pode trocar de terminal sem remontar o provider.
        terminalId: readSelectedTerminal(lj)?.id ?? null,
        // A0: antes da hidratação, `stateRef.current` ainda é o estado PADRÃO.
        // Decidir aqui adotaria/sobrescreveria saldo com o caixa "fechado" que
        // ninguém persistiu — e tornaria o fechamento inalcançável.
        hydrated: caixaHydratedForRef.current === storageKey,
        local: { isOpen: local.caixa.isOpen, sessaoId: local.caixaSessaoId },
        fetchImpl: fetch,
      })

      // Consulta falhou (rede, HTTP, resposta inválida ou ainda não hidratado):
      // nada muda no estado local — nunca fechar um caixa que pode estar aberto
      // no servidor só porque a rede caiu.
      if (!decision) return outcome

      // A loja ativa mudou enquanto a consulta estava em voo: a resposta é de
      // outra loja e não pode ser aplicada.
      if (storageKeyRef.current !== storageKey) {
        return { ok: false, status: "falha", reason: "loja-trocada" }
      }

      // Transição feita pelo módulo puro: `sales`, `devolucoes` e demais campos
      // saem por referência — a fila de pendências não é tocada.
      setState((prev) => applyCaixaSessionDecision(prev, decision))

      return outcome
    })
  }, [storageKey])

  // Reconciliação automática: montagem (só DEPOIS da hidratação), troca de loja,
  // volta do foco e retorno da rede. Cobre F5, nova aba, novo login e reinício
  // do computador. Não depende de `opsDbReady` — estoque/OS podem falhar.
  useEffect(() => {
    if (!caixaHydrated) return
    void refreshCaixaSession()
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshCaixaSession()
    }
    const onOnline = () => void refreshCaixaSession()
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("online", onOnline)
    return () => {
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("online", onOnline)
    }
  }, [caixaHydrated, refreshCaixaSession])

  useEffect(() => {
    if (!opsDbReady) return
    const snap = JSON.stringify({ inv: state.inventory, ord: state.ordens })
    if (snap === lastSentOpsRef.current) return
    const t = setTimeout(() => {
      lastSentOpsRef.current = snap
      const lj = opsLojaIdFromStorageKey(storageKey)
      const headers: HeadersInit = {
        "Content-Type": "application/json",
        "x-assistec-loja-id": lj,
      }
      // LEGACY_INVENTORY_SYNC_DISABLED: servidor é fonte da verdade; não enviar
      // snapshot inteiro do client. O `PUT /api/ops/inventory` automático sobrescrevia
      // o estoque REAL da loja com o estado local/desatualizado do navegador a cada
      // mudança (baixa de venda local, cache de outra loja, localStorage antigo).
      // Removido em OPS-INVENTORY-SYNC-SAFETY-001 (auditoria PDV-WHATSAPP-SALE-AUDIT-001).
      // A baixa de estoque é feita no servidor (/api/ops/venda-persist); o catálogo é
      // lido por GET /api/ops/inventory. O endpoint PUT está quarentenado (410).
      // O sync de ORDENS (escopo Operações, fora deste GOAL) permanece inalterado.
      void fetch("/api/ops/ordens", {
        method: "PUT",
        credentials: "include",
        headers,
        body: JSON.stringify({ ordens: state.ordens }),
      }).catch(() => {})
    }, 750)
    return () => clearTimeout(t)
  }, [opsDbReady, state.inventory, state.ordens, storageKey])

  const ledgerKey = JSON.stringify(state.dailyLedger)
  useEffect(() => {
    let cancelled = false
    const t = setTimeout(() => {
      void (async () => {
        try {
          const lj = opsLojaIdFromStorageKey(storageKey)
          const res = await fetch("/api/ops/sync-ledger", {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
              [ASSISTEC_LOJA_HEADER]: lj,
            },
            body: ledgerKey,
          })
          if (cancelled) return
          if (!res.ok && process.env.NODE_ENV === "development") {
            const txt = await res.text().catch(() => "")
            console.warn("[ops] sync-ledger HTTP", res.status, txt)
          }
        } catch (e) {
          if (!cancelled && process.env.NODE_ENV === "development") {
            console.warn("[ops] sync-ledger", e)
          }
        }
      })()
    }, 1200)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [ledgerKey, storageKey])

  // Cooldown do re-sync automático por venda: rejeição de REGRA (HTTP 4xx, ex.:
  // 409 caixa fechado / produto não resolvido) não muda re-POSTando a cada 30s —
  // só quando o operador age. Segura a re-tentativa automática dessa venda pelo
  // período abaixo; erros de rede/5xx (transitórios) seguem o ciclo normal e o
  // reenvio MANUAL (retrySyncSale) ignora o cooldown. NUNCA envia
  // `allowClosedOriginalSession`/`retroactiveClosedSession` — sync retroativo de sessão
  // original fechada é sempre ação manual e explícita (ver `retrySyncSaleRetroactive`).
  const vendaAutoRetryHoldRef = useRef<Map<string, number>>(new Map())
  const writerCapabilityRef = useRef<SaleWriterCapability>("unknown")

  const probeWriterCapability = useCallback(async (lojaId: string): Promise<SaleWriterCapability> => {
    const cached = writerCapabilityRef.current
    if (cached === "v1" || cached === "v2") return cached
    try {
      const res = await fetch(vendaPersistV2Url(lojaId), {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: persistHeaders(lojaId),
      })
      if (!res.ok) return "unknown"
      const body: unknown = await res.json().catch(() => null)
      const cap = classifySaleWriterCapability(body)
      if (cap === "v1" || cap === "v2") writerCapabilityRef.current = cap
      return cap
    } catch {
      return "unknown"
    }
  }, [])

  const markSaleConfirmed = useCallback(
    (token: { id: string; clientSaleId?: string }, confirmed?: { pedidoId: string; id: string; clientSaleId?: string | null }) => {
      vendaAutoRetryHoldRef.current.delete(token.id)
      if (token.clientSaleId) vendaAutoRetryHoldRef.current.delete(token.clientSaleId)
      setState((prev) => ({
        ...prev,
        sales: prev.sales.map((s) => {
          if (!saleMatches(s, token)) return s
          if (!confirmed) {
            return { ...s, syncPending: false, syncBlockedCode: undefined }
          }
          return {
            ...s,
            id: confirmed.pedidoId,
            serverId: confirmed.id,
            clientSaleId: s.clientSaleId ?? confirmed.clientSaleId ?? undefined,
            syncPending: false,
            syncBlockedCode: undefined,
          }
        }),
      }))
    },
    [],
  )

  const markSaleBlocked = useCallback((token: { id: string; clientSaleId?: string }, code?: string) => {
    if (!code) return
    setState((prev) => ({
      ...prev,
      sales: prev.sales.map((s) => (saleMatches(s, token) ? { ...s, syncBlockedCode: code } : s)),
    }))
  }, [])

  const postV1Sale = useCallback(
    async (lojaId: string, sale: SaleRecord, retroactive: boolean) => {
      return fetch(vendaPersistUrl(lojaId), {
        method: "POST",
        credentials: "include",
        headers: persistHeaders(lojaId),
        body: JSON.stringify(retroactive ? { sale, allowClosedOriginalSession: true } : { sale }),
      })
    },
    [],
  )

  const postV2Sale = useCallback(
    async (lojaId: string, sale: SaleRecord, retroactive: boolean) => {
      return fetch(vendaPersistV2Url(lojaId), {
        method: "POST",
        credentials: "include",
        headers: persistHeaders(lojaId),
        body: JSON.stringify({
          sale,
          clientSaleId: sale.clientSaleId,
          ...(retroactive ? { allowClosedOriginalSession: true } : {}),
        }),
      })
    },
    [],
  )

  const convertPendingV2ToV1 = useCallback(
    (sale: SaleRecord): SaleRecord => {
      const sales = stateRef.current.sales
      const withoutSelf = sales.filter((s) => !saleMatches(s, sale))
      const vda = nextSaleId(withoutSelf)
      const converted: SaleRecord = { ...sale, id: vda }
      setState((prev) => ({
        ...prev,
        sales: prev.sales.map((s) => (saleMatches(s, sale) ? converted : s)),
      }))
      writerCapabilityRef.current = "v1"
      return converted
    },
    [],
  )

  const persistPendingSale = useCallback(
    async (
      sale: SaleRecord,
      lojaId: string,
      retroactive: boolean,
    ): Promise<{
      ok: true
      pedidoId?: string
      serverId?: string
      clientSaleId?: string
    } | { ok: false; reason: string; code?: string; networkError?: boolean }> => {
      const token = { id: sale.id, clientSaleId: sale.clientSaleId }
      const useV2 = Boolean(sale.clientSaleId) && (isProvisionalSaleRef(sale.id) || writerCapabilityRef.current !== "v1")
      try {
        const res = useV2 ? await postV2Sale(lojaId, sale, retroactive) : await postV1Sale(lojaId, sale, retroactive)
        const body = await res.text().catch(() => "")
        if (res.ok) {
          let confirmed: ReturnType<typeof extractConfirmedVenda> = null
          try {
            confirmed = extractConfirmedVenda(JSON.parse(body) as unknown)
          } catch {
            confirmed = null
          }
          markSaleConfirmed(token, confirmed ?? undefined)
          return {
            ok: true,
            pedidoId: confirmed?.pedidoId,
            serverId: confirmed?.id,
            clientSaleId: sale.clientSaleId ?? confirmed?.clientSaleId ?? undefined,
          }
        }
        const parsed = parseSalePersistError(body)
        const code = parsed.code ?? extractVendaPersistErrorCode(body)
        if (useV2 && shouldFallbackV2ToV1({ httpStatus: res.status, code })) {
          const converted = convertPendingV2ToV1(sale)
          const v1 = await postV1Sale(lojaId, converted, retroactive)
          const v1Body = await v1.text().catch(() => "")
          if (v1.ok) {
            markSaleConfirmed({ id: converted.id, clientSaleId: converted.clientSaleId })
            return { ok: true, pedidoId: converted.id, clientSaleId: converted.clientSaleId }
          }
          const v1Parsed = parseSalePersistError(v1Body)
          markSaleBlocked({ id: converted.id, clientSaleId: converted.clientSaleId }, v1Parsed.code)
          return { ok: false, reason: `HTTP ${v1.status} — ${v1Parsed.message}`, code: v1Parsed.code }
        }
        markSaleBlocked(token, code)
        return { ok: false, reason: `HTTP ${res.status} — ${parsed.message}`, ...(code ? { code } : {}) }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { ok: false, reason: `Falha de rede: ${msg}`, networkError: true }
      }
    },
    [convertPendingV2ToV1, markSaleBlocked, markSaleConfirmed, postV1Sale, postV2Sale],
  )

  const flushPendingSales = useCallback(() => {
    const pending = stateRef.current.sales.filter((s) => s.syncPending === true)
    if (pending.length === 0) return
    const lj = opsLojaIdFromStorageKey(storageKey)
    const agora = Date.now()
    for (const sale of pending) {
      if (persistedSaleIdentityConflictCode(storageKey, sale)) continue
      if ((vendaAutoRetryHoldRef.current.get(saleLocalKey(sale)) ?? 0) > agora) continue
      void persistPendingSale(sale, lj, false).then((result) => {
        if (result.ok) return
        if (result.code && !result.networkError) {
          vendaAutoRetryHoldRef.current.set(saleLocalKey(sale), Date.now() + VENDA_AUTO_RETRY_HOLD_MS)
        }
        console.warn("[venda-persist] re-sync", sale.id, "lojaId:", lj, result.reason)
      })
    }
  }, [persistPendingSale, storageKey])

  const refreshSalesFromServer = useCallback<OperationsContextType["refreshSalesFromServer"]>(
    async () => {
      const lj = opsLojaIdFromStorageKey(storageKey)
      try {
        const rV = await fetch(`/api/ops/vendas-list?lojaId=${encodeURIComponent(lj)}`, {
          credentials: "include",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            [ASSISTEC_LOJA_HEADER]: lj,
          },
        })
        if (!rV.ok) return
        const jV = (await rV.json()) as { sales?: SaleRecord[] }
        const remoteSales = jV.sales ?? []
        setState((prev) => {
          const merged = mergeSalesById(prev.sales, remoteSales)
          return merged === prev.sales ? prev : { ...prev, sales: merged }
        })
      } catch {
        /* best-effort — reconciliação não bloqueia o caixa */
      }
    },
    [storageKey],
  )

  /**
   * Reenvio manual de uma venda pendente. `retroactive: true` acrescenta
   * `allowClosedOriginalSession` ao corpo — usado SOMENTE pela ação explícita
   * "Sincronizar retroativo" (nunca pelo retry automático nem pelo reenvio normal).
   */
  const doRetrySyncSale = useCallback(
    async (
      saleId: string,
      retroactive: boolean,
    ): Promise<{ ok: true } | { ok: false; reason: string; code?: string }> => {
      const sale = stateRef.current.sales.find(
        (s) => s.syncPending === true && (s.id === saleId || s.clientSaleId === saleId),
      )
      if (!sale) {
        return { ok: false, reason: "Venda local pendente não encontrada (talvez já tenha sincronizado)." }
      }
      const permanentCode = persistedSaleIdentityConflictCode(storageKey, sale)
      if (permanentCode) {
        return {
          ok: false,
          reason: `${SALE_IDENTITY_CONFLICT_TITLE}. ${SALE_IDENTITY_CONFLICT_GUIDANCE}`,
          code: permanentCode,
        }
      }
      const lj = opsLojaIdFromStorageKey(storageKey)
      const result = await persistPendingSale(sale, lj, retroactive)
      if (result.ok) return { ok: true }
      console.warn("[venda-persist] retry", saleId, "lojaId:", lj, result.reason)
      return { ok: false, reason: result.reason, ...(result.code ? { code: result.code } : {}) }
    },
    [persistPendingSale, storageKey],
  )

  const retrySyncSale = useCallback<OperationsContextType["retrySyncSale"]>(
    (saleId) => doRetrySyncSale(saleId, false),
    [doRetrySyncSale],
  )

  /**
   * Ação manual explícita: sincroniza uma venda pendente cuja sessão de caixa original
   * existe e é desta loja, mas já está `FECHADA` (`syncBlockedCode === "CAIXA_ORIGINAL_FECHADO"`).
   * A venda é gravada na PRÓPRIA sessão original — nunca no caixa atual. Requer confirmação
   * explícita na UI antes de chamar (ver `vendas-arquivo-geral.tsx`).
   */
  const retrySyncSaleRetroactive = useCallback<OperationsContextType["retrySyncSaleRetroactive"]>(
    (saleId) => doRetrySyncSale(saleId, true),
    [doRetrySyncSale],
  )

  const recoverQuarantinedSale = useCallback<OperationsContextType["recoverQuarantinedSale"]>(
    async ({ saleId, motivo, allowClosedOriginalSession }) => {
      const sale = stateRef.current.sales.find(
        (s) => s.syncPending === true && (s.id === saleId || s.clientSaleId === saleId),
      )
      if (!sale) return { ok: false, reason: "Venda local em quarentena não encontrada." }
      if (!isSaleIdentityConflictCode(sale.syncBlockedCode) && !persistedSaleIdentityConflictCode(storageKey, sale)) {
        return { ok: false, reason: "Esta venda não está em conflito de identificação." }
      }
      const clientSaleId = sale.clientSaleId ?? assertGeneratedClientSaleId(generateClientSaleId())
      if (!sale.clientSaleId) {
        setState((prev) => ({
          ...prev,
          sales: prev.sales.map((s) => (saleMatches(s, sale) ? { ...s, clientSaleId } : s)),
        }))
      }
      const lj = opsLojaIdFromStorageKey(storageKey)
      try {
        const res = await fetch(recoverQuarantinedSaleUrl(lj), {
          method: "POST",
          credentials: "include",
          headers: persistHeaders(lj),
          body: JSON.stringify({
            sale: { ...sale, clientSaleId },
            clientSaleId,
            motivo,
            conflictingPedidoId: sale.id,
            conflictCode: sale.syncBlockedCode,
            ...(allowClosedOriginalSession ? { allowClosedOriginalSession: true } : {}),
          }),
        })
        const body = await res.text().catch(() => "")
        if (!res.ok) {
          const parsed = parseSalePersistError(body)
          return { ok: false, reason: parsed.message, code: parsed.code }
        }
        let confirmed: ReturnType<typeof extractConfirmedVenda> = null
        try {
          confirmed = extractConfirmedVenda(JSON.parse(body) as unknown)
        } catch {
          confirmed = null
        }
        markSaleConfirmed({ id: sale.id, clientSaleId }, confirmed ?? undefined)
        return { ok: true, saleId: confirmed?.pedidoId ?? sale.id, replayed: confirmed ? undefined : true }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { ok: false, reason: `Falha de rede: ${msg}` }
      }
    },
    [markSaleConfirmed, storageKey],
  )

  /**
   * Coleta TODAS as vendas locais em quarentena e garante que cada uma tenha
   * `clientSaleId`, persistindo o que for cunhado ANTES de qualquer rede.
   *
   * Cunhar antes é requisito de segurança, não conveniência: se a identidade técnica
   * fosse gerada a cada tentativa, um retry após timeout criaria uma SEGUNDA venda
   * para a mesma venda física. A chave é sempre a mesma, então o servidor reconhece
   * replay e devolve a venda já criada.
   */
  const collectQuarantinedCandidates = useCallback((): SaleRecord[] => {
    const current = stateRef.current.sales
    const mintedByIndex = new Map<number, string>()
    const candidates: SaleRecord[] = []

    current.forEach((sale, index) => {
      if (!sale.id || sale.syncPending !== true) return
      const quarantined =
        isQuarantinedLocalSale(sale) || Boolean(persistedSaleIdentityConflictCode(storageKey, sale))
      if (!quarantined) return
      if (sale.clientSaleId) {
        candidates.push(sale)
        return
      }
      const clientSaleId = assertGeneratedClientSaleId(generateClientSaleId())
      mintedByIndex.set(index, clientSaleId)
      candidates.push({ ...sale, clientSaleId })
    })

    if (mintedByIndex.size > 0) {
      setState((prev) => ({
        ...prev,
        sales: prev.sales.map((sale, index) => {
          const minted = mintedByIndex.get(index)
          // `!sale.clientSaleId` evita sobrescrever identidade já existente.
          return minted && !sale.clientSaleId ? { ...sale, clientSaleId: minted } : sale
        }),
      }))
    }

    return candidates
  }, [storageKey])

  /**
   * Tira da quarentena SOMENTE as cópias locais com evidência server-side, casando
   * por `clientSaleId` EXATO.
   *
   * Não reutiliza `markSaleConfirmed` de propósito: `saleMatches` cai no `id` quando o
   * `clientSaleId` não bate, e duas quarentenas distintas podem compartilhar o MESMO
   * número antigo (é justamente a colisão que gerou o incidente). Casar por id ali
   * confirmaria a venda errada e apagaria o bloqueio de uma venda que nunca foi
   * persistida.
   */
  const reconcileRecoveredSales = useCallback(
    (confirmations: readonly RecoveryConfirmation[]): number => {
      if (confirmations.length === 0) return 0
      for (const confirmation of confirmations) {
        vendaAutoRetryHoldRef.current.delete(confirmation.clientSaleId)
        vendaAutoRetryHoldRef.current.delete(confirmation.pedidoId)
      }
      setState((prev) => ({
        ...prev,
        sales: applyRecoveryConfirmations(prev.sales, confirmations).sales,
      }))
      return applyRecoveryConfirmations(stateRef.current.sales, confirmations).reconciled
    },
    [],
  )

  const previewQuarantineRecovery = useCallback<
    OperationsContextType["previewQuarantineRecovery"]
  >(async () => {
    const candidates = collectQuarantinedCandidates()
    if (candidates.length === 0) {
      return {
        ok: true,
        writerEnabled: false,
        items: [],
        summary: {
          total: 0,
          ready: 0,
          alreadyRecovered: 0,
          requiresConfirmation: 0,
          blocked: 0,
          valorTotal: 0,
          valorExecutavel: 0,
          byClass: {},
        },
      }
    }
    const lj = opsLojaIdFromStorageKey(storageKey)
    const items: QuarantineRecoveryPlanItemView[] = []
    let writerEnabled = false
    try {
      for (const slice of chunk(candidates, QUARANTINE_RECOVERY_CHUNK)) {
        const res = await fetch(quarantineRecoveryPreviewUrl(lj), {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: persistHeaders(lj),
          body: JSON.stringify({ candidates: slice }),
        })
        const body = await res.text().catch(() => "")
        if (!res.ok) {
          const parsed = parseSalePersistError(body)
          return { ok: false, reason: parsed.message, code: parsed.code }
        }
        const json = JSON.parse(body) as {
          writerEnabled?: boolean
          items?: QuarantineRecoveryPlanItemView[]
        }
        writerEnabled = json.writerEnabled === true
        if (Array.isArray(json.items)) items.push(...json.items)
      }
      return { ok: true, writerEnabled, items, summary: summarizePlanItems(items) }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, reason: `Falha de rede: ${msg}` }
    }
  }, [collectQuarantinedCandidates, storageKey])

  const recoverQuarantinedSalesBatch = useCallback<
    OperationsContextType["recoverQuarantinedSalesBatch"]
  >(
    async ({ motivo, allowClosedOriginalSession }) => {
      const candidates = collectQuarantinedCandidates()
      if (candidates.length === 0) {
        return { ok: false, reason: "Nenhuma venda em quarentena para recuperar." }
      }
      const lj = opsLojaIdFromStorageKey(storageKey)
      const results: QuarantineRecoveryResultView[] = []
      try {
        // Fatias sequenciais: mantém cada requisição curta e abaixo do teto da rota.
        // Uma fatia que falhe na rede não desfaz as anteriores — as vendas já
        // recuperadas continuam recuperadas, e o retry as reconhece como replay.
        for (const slice of chunk(candidates, QUARANTINE_RECOVERY_CHUNK)) {
          const res = await fetch(quarantineRecoveryBatchUrl(lj), {
            method: "POST",
            credentials: "include",
            headers: persistHeaders(lj),
            body: JSON.stringify({
              candidates: slice,
              motivo,
              ...(allowClosedOriginalSession ? { allowClosedOriginalSession: true } : {}),
            }),
          })
          const body = await res.text().catch(() => "")
          if (!res.ok) {
            // Reconcilia o que já foi confirmado antes de relatar a falha.
            reconcileRecoveredSales(buildRecoveryConfirmations(results))
            const parsed = parseSalePersistError(body)
            return { ok: false, reason: parsed.message, code: parsed.code }
          }
          const json = JSON.parse(body) as { results?: QuarantineRecoveryResultView[] }
          if (Array.isArray(json.results)) results.push(...json.results)
        }

        // Só sai da quarentena o que tem venda real no servidor. `REQUIRES_CONFIRMATION`,
        // `BLOCKED` e `FAILED` preservam a cópia local intacta.
        const reconciled = reconcileRecoveredSales(buildRecoveryConfirmations(results))
        return { ok: true, results, summary: summarizeRecoveryResults(results), reconciled }
      } catch (err) {
        reconcileRecoveredSales(buildRecoveryConfirmations(results))
        const msg = err instanceof Error ? err.message : String(err)
        return { ok: false, reason: `Falha de rede: ${msg}` }
      }
    },
    [collectQuarantinedCandidates, reconcileRecoveredSales, storageKey],
  )

  const discardLocalPendingSale = useCallback<OperationsContextType["discardLocalPendingSale"]>(
    async (saleId) => {
      const sale = stateRef.current.sales.find(
        (s) => s.syncPending === true && (s.id === saleId || s.clientSaleId === saleId),
      )
      if (!sale) {
        return { ok: false, reason: "Venda local pendente não encontrada." }
      }
      if (persistedSaleIdentityConflictCode(storageKey, sale)) {
        return {
          ok: false,
          reason: `${SALE_IDENTITY_CONFLICT_TITLE}. ${SALE_IDENTITY_CONFLICT_GUIDANCE}`,
        }
      }
      const lj = opsLojaIdFromStorageKey(storageKey)
      try {
        if (sale.clientSaleId) {
          const res = await fetch(vendaByClientSaleIdUrl(lj, sale.clientSaleId), {
            credentials: "include",
            cache: "no-store",
            headers: persistHeaders(lj),
          })
          if (res.ok) {
            const body: unknown = await res.json().catch(() => null)
            const confirmed = extractConfirmedVenda(body)
            markSaleConfirmed({ id: sale.id, clientSaleId: sale.clientSaleId }, confirmed ?? undefined)
            return {
              ok: true,
              mode: "reconciled",
              reason: "Venda já existe no servidor — marcada como sincronizada (não descartada).",
            }
          }
          if (res.status === 404) {
            setState((prev) => ({
              ...prev,
              sales: prev.sales.filter((s) => !saleMatches(s, sale)),
            }))
            return { ok: true, mode: "discarded" }
          }
          const body = await res.text().catch(() => "")
          return {
            ok: false,
            reason: `Verificação no servidor falhou (HTTP ${res.status}). Nada foi descartado. ${body.trim().slice(0, 160)}`,
          }
        }
        const res = await fetch(`/api/vendas/${encodeURIComponent(saleId)}`, {
          credentials: "include",
          cache: "no-store",
          headers: { [ASSISTEC_LOJA_HEADER]: lj },
        })
        if (res.ok) {
          // Venda EXISTE no servidor — não pode ser descartada. Apenas reconcilia.
          setState((prev) => ({
            ...prev,
            sales: prev.sales.map((s) => (s.id === saleId ? { ...s, syncPending: false } : s)),
          }))
          return {
            ok: true,
            mode: "reconciled",
            reason: "Venda já existe no servidor — marcada como sincronizada (não descartada).",
          }
        }
        if (res.status === 404) {
          // Servidor confirma que a venda NÃO existe — limpeza local segura.
          // Nenhum efeito em estoque/financeiro: a venda nunca tocou o banco.
          setState((prev) => ({
            ...prev,
            sales: prev.sales.filter((s) => s.id !== saleId),
          }))
          return { ok: true, mode: "discarded" }
        }
        const body = await res.text().catch(() => "")
        const snippet = body.trim().slice(0, 160)
        return {
          ok: false,
          reason: `Verificação no servidor falhou (HTTP ${res.status}). Nada foi descartado. ${snippet}`,
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { ok: false, reason: `Falha de rede ao verificar no servidor: ${msg}` }
      }
    },
    [markSaleConfirmed, storageKey],
  )

  const bulkDiscardLocalPendingSales = useCallback<
    OperationsContextType["bulkDiscardLocalPendingSales"]
  >(async () => {
    const pending = stateRef.current.sales.filter((s) => s.syncPending === true)
    const total = pending.length
    if (total === 0) {
      return { ok: true, total: 0, discarded: 0, reconciled: 0, conflicts: 0 }
    }
    const lj = opsLojaIdFromStorageKey(storageKey)
    const discardedIds = new Set<string>()
    const reconciledIds = new Set<string>()
    let conflicts = 0
    for (const sale of pending) {
      if (persistedSaleIdentityConflictCode(storageKey, sale)) {
        conflicts += 1
        continue
      }
      try {
        const res = await fetch(`/api/vendas/${encodeURIComponent(sale.id)}`, {
          credentials: "include",
          cache: "no-store",
          headers: { [ASSISTEC_LOJA_HEADER]: lj },
        })
        if (res.ok) {
          reconciledIds.add(sale.id)
        } else if (res.status === 404) {
          discardedIds.add(sale.id)
        } else {
          conflicts += 1
        }
      } catch {
        conflicts += 1
      }
    }
    if (discardedIds.size > 0 || reconciledIds.size > 0) {
      setState((prev) => ({
        ...prev,
        sales: prev.sales
          .filter((s) => !discardedIds.has(s.id))
          .map((s) => (reconciledIds.has(s.id) ? { ...s, syncPending: false } : s)),
      }))
    }
    return {
      ok: true,
      total,
      discarded: discardedIds.size,
      reconciled: reconciledIds.size,
      conflicts,
    }
  }, [storageKey])

  const flushPendingDevolucoes = useCallback(() => {
    const pending = stateRef.current.devolucoes.filter((d) => d.syncPending === true)
    if (pending.length === 0) return
    const lj = opsLojaIdFromStorageKey(storageKey)
    for (const dev of pending) {
      const itensServidor = dev.lines.map((it) => {
        const sale = stateRef.current.sales.find((s) => s.id === dev.saleId)
        const saleLine = sale?.lines.find((l) => l.inventoryId === it.inventoryId)
        const valorUnitario = saleLine ? (saleLine.lineTotal / saleLine.quantity) : 0
        return {
          inventoryId: it.inventoryId,
          nome: it.name,
          quantidade: it.quantity,
          valorUnitario,
          valorTotal: it.valor,
        }
      })

      fetch("/api/ops/devolucao", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-assistec-loja-id": lj,
        },
        body: JSON.stringify({
          localId: dev.id,
          vendaLocalId: dev.saleId,
          sessaoId: dev.sessaoId || undefined,
          tipo: dev.tipo || dev.mode,
          valorTotal: dev.lines.reduce((sum, l) => sum + l.valor, 0),
          creditoEmitido: dev.creditIssued,
          clienteNome: dev.customerName,
          clienteDoc: dev.customerCpf,
          operador: "",
          motivo: dev.motivo || "",
          observacao: dev.observacao || "",
          itens: itensServidor,
          payload: dev.payload || { saleId: dev.saleId, linhas: dev.lines.map(l => ({ inventoryId: l.inventoryId, quantity: l.quantity })), modo: dev.tipo || dev.mode, motivo: dev.motivo || "" },
        }),
      })
        .then(async (res) => {
          if (res.ok) {
            setState((prev) => ({
              ...prev,
              devolucoes: prev.devolucoes.map((d) => (d.id === dev.id ? { ...d, syncPending: false } : d)),
            }))
          } else {
            const body = await res.text().catch(() => "")
            console.warn("[devolucao-persist] re-sync HTTP", res.status, dev.id, "lojaId:", lj, "body:", body)
          }
        })
        .catch((err: unknown) => {
          console.warn("[devolucao-persist] re-sync rede", dev.id, "lojaId:", lj, err)
        })
    }
  }, [storageKey])

  const flushPendingCaixaOperations = useCallback(() => {
    const pending = stateRef.current.pendingCaixaOperations?.filter((op) => op.syncPending === true) ?? []
    if (pending.length === 0) return
    const lj = opsLojaIdFromStorageKey(storageKey)
    for (const op of pending) {
      void registrarOperacaoCaixaServer({
        lojaId: lj,
        sessaoId: op.sessaoId,
        tipo: op.tipo,
        valor: op.valor,
        motivo: op.motivo,
        localId: op.id,
        operador: op.operador,
        maxAttempts: 1,
      })
        .then((res) => {
          if (res.ok) {
            setState((prev) => ({
              ...prev,
              pendingCaixaOperations: prev.pendingCaixaOperations.map((o) =>
                o.id === op.id ? { ...o, syncPending: false } : o
              ),
            }))
          } else {
            console.warn("[caixa-persist] re-sync HTTP", res.reason, op.id)
          }
        })
        .catch((err: unknown) => {
          console.warn("[caixa-persist] re-sync rede", op.id, err)
        })
    }
  }, [storageKey])

  // Recupera pendências ao montar/abrir o PDV (bootstrap).
  useEffect(() => {
    if (!opsDbReady) return
    flushPendingSales()
    flushPendingDevolucoes()
    flushPendingCaixaOperations()
  }, [opsDbReady, flushPendingSales, flushPendingDevolucoes, flushPendingCaixaOperations])

  // Rede de segurança em sessão: re-tenta pendências quando a conexão volta,
  // quando a aba reganha foco e periodicamente.
  useEffect(() => {
    if (!opsDbReady) return
    const onWake = () => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) return
      flushPendingSales()
      flushPendingDevolucoes()
      flushPendingCaixaOperations()
      // Reconcilia status autoritativo das vendas (ex.: cancelamento feito na tela
      // Vendas) ao voltar o foco/rede — caixa/fechamento atualizam sem reload manual.
      void refreshSalesFromServer()
    }
    const onVisible = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") onWake()
    }
    window.addEventListener("online", onWake)
    document.addEventListener("visibilitychange", onVisible)
    const interval = window.setInterval(onWake, 30_000)
    return () => {
      window.removeEventListener("online", onWake)
      document.removeEventListener("visibilitychange", onVisible)
      window.clearInterval(interval)
    }
  }, [opsDbReady, flushPendingSales, flushPendingDevolucoes, flushPendingCaixaOperations, refreshSalesFromServer])

  const setOrdens: OperationsContextType["setOrdens"] = useCallback((updater) => {
    setState((prev) => ({
      ...prev,
      ordens: typeof updater === "function" ? (updater as (value: OrdemServico[]) => OrdemServico[])(prev.ordens) : updater,
    }))
  }, [])

  const setInventory: OperationsContextType["setInventory"] = useCallback((updater) => {
    setState((prev) => ({
      ...prev,
      inventory:
        typeof updater === "function"
          ? (updater as (value: InventoryItem[]) => InventoryItem[])(prev.inventory)
          : updater,
    }))
  }, [])

  const setOrcamentos: OperationsContextType["setOrcamentos"] = useCallback((updater) => {
    setState((prev) => ({
      ...prev,
      orcamentos:
        typeof updater === "function"
          ? (updater as (value: Orcamento[]) => Orcamento[])(prev.orcamentos)
          : updater,
    }))
  }, [])

  const abrirCaixa = useCallback((saldoInicial: number) => {
    setState((prev) => ({
      ...prev,
      caixa: {
        isOpen: true,
        saldoInicial,
        dataAbertura: new Date(),
        totalEntradas: 0,
        totalSaidas: 0,
      },
    }))
  }, [])

  const fecharCaixa = useCallback(() => {
    setState((prev) => ({
      ...prev,
      caixaSessaoId: null,
      caixa: {
        isOpen: false,
        saldoInicial: 0,
        dataAbertura: null,
        totalEntradas: 0,
        totalSaidas: 0,
      },
    }))
  }, [])

  const setCaixaSessaoId = useCallback((id: string | null) => {
    setState((prev) => ({ ...prev, caixaSessaoId: id }))
  }, [])

  const adicionarEntrada = useCallback((valor: number) => {
    setState((prev) => ({
      ...prev,
      caixa: { ...prev.caixa, totalEntradas: prev.caixa.totalEntradas + valor },
    }))
  }, [])

  const adicionarSaida = useCallback((valor: number) => {
    setState((prev) => ({
      ...prev,
      caixa: { ...prev.caixa, totalSaidas: prev.caixa.totalSaidas + valor },
    }))
  }, [])

  const getSaldoAtual = useCallback(() => {
    const c = stateRef.current.caixa
    return c.saldoInicial + c.totalEntradas - c.totalSaidas
  }, [])

  const getSaldoCreditoCliente = useCallback((cpf: string) => {
    const k = normalizeDocDigits(cpf)
    if (!k) return 0
    return stateRef.current.customerCredits[k]?.saldo ?? 0
  }, [])

  const incrementOsAbertasDia = useCallback(() => {
    setState((prev) => {
      const dailyLedger = ensureLedger(prev.dailyLedger)
      dailyLedger.osAbertas += 1
      return { ...prev, dailyLedger }
    })
  }, [])

  const finalizeSaleTransaction = useCallback<OperationsContextType["finalizeSaleTransaction"]>(
    async ({
      lines,
      total,
      linkedOsId,
      paymentBreakdown,
      customerCpf,
      customerName,
      clienteId,
      openCaixaIfClosed,
      saldoInicialAoAbrir,
      auditMeta,
      aPrazoConfig,
    }) => {
      const current = stateRef.current
      const next: OpsState = {
        inventory: current.inventory.map((i) => ({ ...i })),
        ordens: current.ordens.map((o) => ({ ...o })),
        caixa: { ...current.caixa },
        caixaSessaoId: current.caixaSessaoId,
        dailyLedger: ensureLedger(current.dailyLedger),
        sales: [...current.sales],
        devolucoes: [...current.devolucoes],
        pendingCaixaOperations: [...current.pendingCaixaOperations],
        orcamentos: [...current.orcamentos],
        customerCredits: { ...current.customerCredits },
      }

      if (!next.caixa.isOpen) {
        if (openCaixaIfClosed) {
          next.caixa = {
            isOpen: true,
            saldoInicial: saldoInicialAoAbrir ?? 0,
            dataAbertura: new Date(),
            totalEntradas: 0,
            totalSaidas: 0,
          }
        } else {
          return { ok: false, reason: "Caixa fechado." }
        }
      }

      for (const line of lines) {
        // Linhas virtuais (O.S. ou Item Avulso) não tocam estoque: validam apenas qtd.
        const itemType = resolveSaleLineItemType(line)
        if (itemType !== "produto" || isVirtualSaleLine(line.inventoryId)) {
          if (line.quantity <= 0) return { ok: false, reason: "Quantidade inválida." }
          continue
        }
        const item = next.inventory.find((i) => i.id === line.inventoryId)
        if (!item) return { ok: false, reason: `Item de estoque não encontrado: ${line.inventoryId}` }
        if (line.quantity <= 0) return { ok: false, reason: "Quantidade inválida." }
        if (item.stock < line.quantity) {
          return { ok: false, reason: `Estoque insuficiente para ${item.name}.` }
        }
      }

      if (linkedOsId) {
        const os = next.ordens.find((o) => o.id === linkedOsId)
        if (!os) return { ok: false, reason: "O.S. vinculada não encontrada." }
      }

      const pb = normalizePaymentBreakdown(paymentBreakdown)
      const sumPb =
        pb.dinheiro +
        pb.pix +
        pb.cartaoDebito +
        pb.cartaoCredito +
        pb.carne +
        pb.aPrazo +
        pb.creditoVale
      if (Math.abs(sumPb - total) > 0.02) {
        return { ok: false, reason: "Soma das formas de pagamento difere do total." }
      }

      const cpfNorm = customerCpf ? normalizeDocDigits(customerCpf) : ""
      if (pb.aPrazo > 0 && !cpfNorm) {
        return { ok: false, reason: "Selecione o cliente (com CPF) para venda à prazo em Contas a Receber." }
      }
      if (pb.creditoVale > 0) {
        if (!cpfNorm) return { ok: false, reason: "Informe o cliente (CPF) para usar crédito/vale." }
        const saldo = next.customerCredits[cpfNorm]?.saldo ?? 0
        if (pb.creditoVale > saldo + 0.01) {
          return { ok: false, reason: "Saldo de crédito insuficiente." }
        }
        const nome = customerName?.trim() || next.customerCredits[cpfNorm]?.nome || "Cliente"
        next.customerCredits[cpfNorm] = {
          nome,
          saldo: Math.round((saldo - pb.creditoVale) * 100) / 100,
        }
      }

      for (const line of lines) {
        // Linhas virtuais (O.S. / Item Avulso) não decrementam estoque local.
        if (resolveSaleLineItemType(line) !== "produto" || isVirtualSaleLine(line.inventoryId)) continue
        const item = next.inventory.find((i) => i.id === line.inventoryId)!
        item.stock -= line.quantity
      }

      // Apenas receita imediata entra no caixa físico; saldo à prazo vai para Contas a Receber.
      next.caixa.totalEntradas += total - pb.aPrazo

      next.dailyLedger.totalVendas += total
      next.dailyLedger.vendasDinheiro += pb.dinheiro
      next.dailyLedger.vendasPix += pb.pix
      next.dailyLedger.vendasCartaoDebito += pb.cartaoDebito
      next.dailyLedger.vendasCartaoCredito += pb.cartaoCredito
      next.dailyLedger.vendasCarne += pb.carne
      next.dailyLedger.vendasAPrazo = (next.dailyLedger.vendasAPrazo ?? 0) + pb.aPrazo
      next.dailyLedger.vendasCreditoVale += pb.creditoVale

      const lj = opsLojaIdFromStorageKey(storageKey)
      const capability = await probeWriterCapability(lj)
      const useV2 = capability !== "v1"
      const clientSaleId = useV2 ? assertGeneratedClientSaleId(generateClientSaleId()) : undefined
      const saleId = useV2 && clientSaleId ? buildProvisionalSaleRef(clientSaleId) : nextSaleId(next.sales)
      const saleLines: SaleLineRecord[] = lines.map((ln) => {
        const itemType = resolveSaleLineItemType(ln)
        const item = itemType === "produto"
          ? next.inventory.find((inventoryItem) => inventoryItem.id === ln.inventoryId)
          : undefined
        const record = saleLineRecordFromFinalizeInput(
          ln,
          item ? { name: item.name, price: item.price } : undefined,
        )
        return ln.accessorySelection ? { ...record, accessorySelection: ln.accessorySelection } : record
      })
      next.sales.push({
        id: saleId,
        ...(clientSaleId ? { clientSaleId } : {}),
        at: new Date().toISOString(),
        lines: saleLines,
        total,
        customerCpf: cpfNorm || undefined,
        customerName: customerName?.trim() || undefined,
        clienteId: clienteId?.trim() || undefined,
        paymentBreakdown: pb,
        cashierId: auditMeta?.cashierId,
        sessaoId: current.caixaSessaoId ?? undefined,
        terminalId: readSelectedTerminal(opsLojaIdFromStorageKey(storageKey))?.id || undefined,
        linkedOsId: linkedOsId?.trim() || undefined,
        discountAuthorizedByAdminId: auditMeta?.discountAuthorizedByAdminId,
        discountReais: auditMeta?.discountReais,
        discountPercent: auditMeta?.discountPercent,
        ...(aPrazoConfig ? { aPrazoConfig } : {}),
        syncPending: true,
      })

      if (linkedOsId) {
        next.ordens = next.ordens.map((o) =>
          o.id === linkedOsId
            ? {
                ...o,
                status: "finalizado",
                dataSaida: new Date().toISOString().split("T")[0],
                horaSaida: `${String(new Date().getHours()).padStart(2, "0")}:${String(new Date().getMinutes()).padStart(2, "0")}`,
              }
            : o
        )
      }

      setState(next)
      const saleRow = next.sales[next.sales.length - 1]
      if (saleRow) {
        emitEvent("venda_finalizada", {
          storeId: lj,
          entityId: saleRow.clientSaleId ?? saleRow.id,
          data: saleRow,
        })
        const persistResult = await persistPendingSale(saleRow, lj, false)
        if (persistResult.ok) {
          const confirmedId = persistResult.pedidoId ?? saleRow.id
          const pending = isProvisionalSaleRef(confirmedId)
          return {
            ok: true,
            saleId: confirmedId,
            pending,
            clientSaleId: persistResult.clientSaleId ?? saleRow.clientSaleId,
            serverId: persistResult.serverId,
          }
        }
        const code = persistResult.code
        console.error("[venda-persist]", saleRow.id, "lojaId:", lj, persistResult.reason)
        toast({
          variant: "destructive",
          title: isSaleIdentityConflictCode(code)
            ? SALE_IDENTITY_CONFLICT_TITLE
            : isProvisionalSaleRef(saleRow.id)
              ? "Venda pendente — aguardando número do servidor"
              : `Venda ${saleRow.id} ficou pendente (HTTP)`,
          description: isSaleIdentityConflictCode(code)
            ? SALE_IDENTITY_CONFLICT_GUIDANCE
            : `${persistResult.reason.slice(0, 200)} · Abra "Vendas" e use Reenviar sync para tentar novamente.`,
        })
        if (isCaixaSessionRejectionCode(code)) {
          void refreshCaixaSession()
        }
        return {
          ok: true,
          saleId: saleRow.id,
          pending: true,
          clientSaleId: saleRow.clientSaleId,
        }
      }
      return { ok: true, saleId, pending: useV2, clientSaleId }
    },
    [persistPendingSale, probeWriterCapability, refreshCaixaSession, storageKey]
  )

  const registrarDevolucao = useCallback<OperationsContextType["registrarDevolucao"]>((input) => {
    const { saleId, lines, mode, customerCpf, customerName, sessaoId, tipo, motivo, observacao, payload } = input
    const k = normalizeDocDigits(customerCpf)
    if (!k) return { ok: false, reason: "CPF/CNPJ do cliente obrigatório." }

    const prev = stateRef.current
    const sale = prev.sales.find((s) => s.id === saleId)
    if (!sale) return { ok: false, reason: "Venda/cupom não encontrado." }

    const next: OpsState = {
      ...prev,
      inventory: prev.inventory.map((i) => ({ ...i })),
      sales: prev.sales.map((s) =>
        s.id === saleId ? { ...s, lines: s.lines.map((l) => ({ ...l })) } : { ...s }
      ),
      devolucoes: [...prev.devolucoes],
      customerCredits: { ...prev.customerCredits },
    }

    const saleCopy = next.sales.find((s) => s.id === saleId)!
    let creditIssued = 0
    const outLines: DevolucaoRecord["lines"] = []

    for (const req of lines) {
      const saleLine = saleCopy.lines.find((l) => l.inventoryId === req.inventoryId)
      if (!saleLine) {
        return { ok: false, reason: `Item não consta na venda: ${req.inventoryId}` }
      }
      const already = saleLine.qtyReturned ?? 0
      const canReturn = saleLine.quantity - already
      if (req.quantity <= 0) {
        return { ok: false, reason: "Quantidade inválida." }
      }
      if (canReturn < req.quantity) {
        return { ok: false, reason: `Devolução maior que o disponível para ${saleLine.name}.` }
      }
      const inv = next.inventory.find((i) => i.id === req.inventoryId)
      if (!inv) return { ok: false, reason: "Produto não está mais no cadastro de estoque." }

      const unit = saleLine.lineTotal / saleLine.quantity
      const valor = Math.round(unit * req.quantity * 100) / 100
      inv.stock += req.quantity
      saleLine.qtyReturned = already + req.quantity
      creditIssued += mode === "vale_credito" ? valor : 0
      outLines.push({
        inventoryId: req.inventoryId,
        name: saleLine.name,
        quantity: req.quantity,
        valor,
      })
    }

    if (outLines.length === 0) {
      return { ok: false, reason: "Nenhuma linha de devolução válida." }
    }

    const devolucaoId = nextDevolucaoId(next.devolucoes)
    if (mode === "vale_credito" && creditIssued > 0) {
      const cur = next.customerCredits[k]?.saldo ?? 0
      const nome = customerName.trim() || next.customerCredits[k]?.nome || "Cliente"
      next.customerCredits[k] = {
        nome,
        saldo: Math.round((cur + creditIssued) * 100) / 100,
      }
    }

    next.devolucoes.push({
      id: devolucaoId,
      at: new Date().toISOString(),
      saleId,
      customerCpf: k,
      customerName: customerName.trim(),
      lines: outLines,
      mode,
      creditIssued: mode === "vale_credito" ? creditIssued : 0,
      syncPending: true,
      sessaoId: sessaoId || undefined,
      tipo: tipo || mode,
      motivo: motivo || "",
      observacao: observacao || "",
      payload,
    })

    setState(next)

    const devRow = next.devolucoes[next.devolucoes.length - 1]
    if (devRow) {
      const lj = opsLojaIdFromStorageKey(storageKey)
      const itensServidor = devRow.lines.map((it) => {
        const sale = next.sales.find((s) => s.id === devRow.saleId)
        const saleLine = sale?.lines.find((l) => l.inventoryId === it.inventoryId)
        const valorUnitario = saleLine ? (saleLine.lineTotal / saleLine.quantity) : 0
        return {
          inventoryId: it.inventoryId,
          nome: it.name,
          quantidade: it.quantity,
          valorUnitario,
          valorTotal: it.valor,
        }
      })

      void fetch("/api/ops/devolucao", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-assistec-loja-id": lj,
        },
        body: JSON.stringify({
          localId: devRow.id,
          vendaLocalId: devRow.saleId,
          sessaoId: devRow.sessaoId || undefined,
          tipo: devRow.tipo || devRow.mode,
          valorTotal: devRow.lines.reduce((sum, l) => sum + l.valor, 0),
          creditoEmitido: devRow.creditIssued,
          clienteNome: devRow.customerName,
          clienteDoc: devRow.customerCpf,
          operador: "",
          motivo: devRow.motivo || "",
          observacao: devRow.observacao || "",
          itens: itensServidor,
          payload: devRow.payload || { saleId: devRow.saleId, linhas: devRow.lines.map(l => ({ inventoryId: l.inventoryId, quantity: l.quantity })), modo: devRow.tipo || devRow.mode, motivo: devRow.motivo || "" },
        }),
      })
        .then(async (res) => {
          if (res.ok) {
            setState((prev) => ({
              ...prev,
              devolucoes: prev.devolucoes.map((d) => (d.id === devolucaoId ? { ...d, syncPending: false } : d)),
            }))
          } else {
            const body = await res.text().catch(() => "")
            console.error("[devolucao-persist] HTTP", res.status, devRow.id, "lojaId:", lj, "body:", body)
          }
        })
        .catch((err: unknown) => {
          console.error("[devolucao-persist] rede", devRow.id, "lojaId:", lj, err)
        })
    }

    return { ok: true, devolucaoId, creditIssued: mode === "vale_credito" ? creditIssued : 0 }
  }, [storageKey])

  const registrarOperacaoCaixa = useCallback<OperationsContextType["registrarOperacaoCaixa"]>(
    async ({ sessaoId, tipo, valor, motivo, localId, operador }) => {
      const prev = stateRef.current
      const next: OpsState = {
        ...prev,
        caixa: { ...prev.caixa },
        pendingCaixaOperations: [...(prev.pendingCaixaOperations ?? [])],
      }

      if (tipo === "sangria") {
        next.caixa.totalSaidas += valor
      } else {
        next.caixa.totalEntradas += valor
      }

      next.pendingCaixaOperations.push({
        id: localId,
        at: new Date().toISOString(),
        sessaoId,
        tipo,
        valor,
        motivo,
        operador,
        syncPending: true,
      })

      setState(next)

      const lj = opsLojaIdFromStorageKey(storageKey)
      try {
        const r = await registrarOperacaoCaixaServer({
          lojaId: lj,
          sessaoId,
          tipo,
          valor,
          motivo,
          localId,
          operador,
          maxAttempts: 4,
        })
        if (r.ok) {
          setState((prev) => ({
            ...prev,
            pendingCaixaOperations: prev.pendingCaixaOperations.map((o) =>
              o.id === localId ? { ...o, syncPending: false } : o
            ),
          }))
          return { ok: true, deduped: r.deduped }
        } else {
          return { ok: false, reason: r.reason }
        }
      } catch (err) {
        return { ok: false, reason: "network" }
      }
    },
    [storageKey]
  )

  const value = useMemo<OperationsContextType>(
    () => ({
      inventory: state.inventory,
      ordens: state.ordens,
      caixa: state.caixa,
      caixaSessaoId: state.caixaSessaoId,
      dailyLedger: state.dailyLedger,
      sales: state.sales,
      devolucoes: state.devolucoes,
      pendingCaixaOperations: state.pendingCaixaOperations,
      orcamentos: state.orcamentos,
      customerCredits: state.customerCredits,
      setOrdens,
      setInventory,
      setOrcamentos,
      abrirCaixa,
      fecharCaixa,
      adicionarEntrada,
      adicionarSaida,
      getSaldoAtual,
      setCaixaSessaoId,
      refreshCaixaSession,
      incrementOsAbertasDia,
      getSaldoCreditoCliente,
      finalizeSaleTransaction,
      registrarDevolucao,
      registrarOperacaoCaixa,
      refreshSalesFromServer,
      retrySyncSale,
      retrySyncSaleRetroactive,
      recoverQuarantinedSale,
      previewQuarantineRecovery,
      recoverQuarantinedSalesBatch,
      discardLocalPendingSale,
      bulkDiscardLocalPendingSales,
    }),
    [
      state,
      setOrdens,
      setInventory,
      setOrcamentos,
      abrirCaixa,
      fecharCaixa,
      adicionarEntrada,
      adicionarSaida,
      getSaldoAtual,
      setCaixaSessaoId,
      refreshCaixaSession,
      incrementOsAbertasDia,
      getSaldoCreditoCliente,
      finalizeSaleTransaction,
      registrarDevolucao,
      registrarOperacaoCaixa,
      refreshSalesFromServer,
      retrySyncSale,
      retrySyncSaleRetroactive,
      recoverQuarantinedSale,
      previewQuarantineRecovery,
      recoverQuarantinedSalesBatch,
      discardLocalPendingSale,
      bulkDiscardLocalPendingSales,
    ]
  )

  return <OperationsContext.Provider value={value}>{children}</OperationsContext.Provider>
}

export function useOperationsStore() {
  const ctx = useContext(OperationsContext)
  if (!ctx) {
    throw new Error("useOperationsStore must be used within OperationsProvider")
  }
  return ctx
}
