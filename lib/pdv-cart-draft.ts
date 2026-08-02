/**
 * Rascunho local do carrinho dos PDVs — sobrevive a F5, nova aba, logout/login,
 * travamento do navegador e reinício do computador.
 *
 * Guarda SÓ o necessário para remontar o carrinho. Nunca guarda venda concluída,
 * pagamento confirmado ou qualquer coisa que pareça persistência real: é um
 * rascunho de digitação, revalidado contra o catálogo na hora de restaurar.
 *
 * Isolado por `storeId` + modalidade do PDV + terminal (quando há), para um
 * rascunho da Loja 2 nunca aparecer na Loja 1 nem no PDV ao lado.
 *
 * Módulo puro: recebe o `Storage` por parâmetro (testável em ambiente node).
 */

import { isVirtualSaleLine } from "@/lib/os-pdv-virtual-lines"

export const CART_DRAFT_VERSION = 1

const CART_DRAFT_PREFIX = "omnigestao:pdv-cart-draft"

/** Modalidade do PDV — o "Rápido" é o Clássico em modo rápido, mesmo carrinho. */
export type PdvModalidade = "classico" | "supermercado" | "assistencia" | "venda-completa"

export type CartDraftLine = {
  lineId: string
  inventoryId: string
  name: string
  price: number
  quantity: number
  /** Item avulso (INSERT): não baixa estoque, não existe no catálogo. */
  isAvulso?: boolean
  custoUnitario?: number | null
  codigoAvulso?: string | null
  vendaPorPeso?: boolean
  atributosLabel?: string
  lineDetail?: string
  complementos?: string[]
  /** Snapshot da seleção de acessório (modelo/cor). Dado passivo. */
  accessorySelection?: unknown
  cartLineKey?: string
}

export type CartDraftCustomer = {
  id?: string
  name: string
  cpf?: string
  phone?: string
}

export type CartDraft = {
  v: number
  storeId: string
  modalidade: PdvModalidade
  terminalId: string | null
  savedAt: string
  /** Sessão de caixa vigente quando o rascunho foi montado (informativo). */
  caixaSessaoId: string | null
  lines: CartDraftLine[]
  customer: CartDraftCustomer | null
  discountReais: number
  discountPercent: number
  observacao?: string
}

export type CartDraftScope = {
  storeId: string
  modalidade: PdvModalidade
  terminalId?: string | null
}

/** Subconjunto de `Storage` usado aqui — permite injetar um fake nos testes. */
export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

export function cartDraftStorageKey(scope: CartDraftScope): string {
  const terminal = trimmed(scope.terminalId)
  const base = `${CART_DRAFT_PREFIX}:${trimmed(scope.storeId)}:${scope.modalidade}`
  return terminal ? `${base}:${terminal}` : base
}

function sanitizeLine(raw: unknown): CartDraftLine | null {
  if (!raw || typeof raw !== "object") return null
  const l = raw as Record<string, unknown>
  const lineId = trimmed(l.lineId)
  const inventoryId = trimmed(l.inventoryId)
  const quantity = Number(l.quantity)
  if (!lineId || !inventoryId) return null
  if (!Number.isFinite(quantity) || quantity <= 0) return null

  const line: CartDraftLine = {
    lineId,
    inventoryId,
    name: typeof l.name === "string" ? l.name : "",
    price: Number.isFinite(Number(l.price)) ? Number(l.price) : 0,
    quantity,
  }
  if (l.isAvulso === true) line.isAvulso = true
  if (l.custoUnitario === null || Number.isFinite(Number(l.custoUnitario))) {
    if (l.custoUnitario !== undefined) line.custoUnitario = l.custoUnitario === null ? null : Number(l.custoUnitario)
  }
  if (typeof l.codigoAvulso === "string") line.codigoAvulso = l.codigoAvulso
  if (l.vendaPorPeso === true) line.vendaPorPeso = true
  if (typeof l.atributosLabel === "string") line.atributosLabel = l.atributosLabel
  if (typeof l.lineDetail === "string") line.lineDetail = l.lineDetail
  if (Array.isArray(l.complementos)) line.complementos = l.complementos.filter((c): c is string => typeof c === "string")
  if (l.accessorySelection && typeof l.accessorySelection === "object") line.accessorySelection = l.accessorySelection
  if (typeof l.cartLineKey === "string") line.cartLineKey = l.cartLineKey
  return line
}

function sanitizeCustomer(raw: unknown): CartDraftCustomer | null {
  if (!raw || typeof raw !== "object") return null
  const c = raw as Record<string, unknown>
  const name = trimmed(c.name)
  if (!name) return null
  const customer: CartDraftCustomer = { name }
  if (trimmed(c.id)) customer.id = trimmed(c.id)
  if (trimmed(c.cpf)) customer.cpf = trimmed(c.cpf)
  if (trimmed(c.phone)) customer.phone = trimmed(c.phone)
  return customer
}

export type WriteCartDraftInput = CartDraftScope & {
  lines: CartDraftLine[]
  customer?: CartDraftCustomer | null
  discountReais?: number
  discountPercent?: number
  observacao?: string
  caixaSessaoId?: string | null
  /** Injetável para teste; default `Date.now`. */
  now?: () => Date
}

/**
 * Persiste o rascunho. Carrinho vazio REMOVE a chave — rascunho vazio não é
 * rascunho, e assim "Limpar carrinho" não deixa lixo para a próxima venda.
 */
export function writeCartDraft(input: WriteCartDraftInput, storage: DraftStorage): void {
  const key = cartDraftStorageKey(input)
  const lines = input.lines.map((l) => sanitizeLine(l)).filter((l): l is CartDraftLine => l !== null)

  if (lines.length === 0) {
    try {
      storage.removeItem(key)
    } catch {
      /* storage indisponível não pode quebrar o PDV */
    }
    return
  }

  const draft: CartDraft = {
    v: CART_DRAFT_VERSION,
    storeId: trimmed(input.storeId),
    modalidade: input.modalidade,
    terminalId: trimmed(input.terminalId) || null,
    savedAt: (input.now?.() ?? new Date()).toISOString(),
    caixaSessaoId: trimmed(input.caixaSessaoId) || null,
    lines,
    customer: sanitizeCustomer(input.customer),
    discountReais: Number(input.discountReais) || 0,
    discountPercent: Number(input.discountPercent) || 0,
  }
  if (trimmed(input.observacao)) draft.observacao = trimmed(input.observacao)

  try {
    storage.setItem(key, JSON.stringify(draft))
  } catch {
    /* quota estourada não pode quebrar a venda em andamento */
  }
}

/**
 * Lê o rascunho da loja/modalidade/terminal pedidos.
 *
 * Devolve `null` quando não há rascunho, quando o JSON é inválido, quando a
 * versão não bate ou quando o conteúdo pertence a outro escopo — rascunho de
 * uma loja nunca vaza para outra, mesmo se a chave for adulterada.
 */
export function readCartDraft(scope: CartDraftScope, storage: DraftStorage): CartDraft | null {
  let raw: string | null
  try {
    raw = storage.getItem(cartDraftStorageKey(scope))
  } catch {
    return null
  }
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== "object") return null

  const d = parsed as Record<string, unknown>
  if (Number(d.v) !== CART_DRAFT_VERSION) return null
  if (trimmed(d.storeId) !== trimmed(scope.storeId)) return null
  if (d.modalidade !== scope.modalidade) return null
  const scopeTerminal = trimmed(scope.terminalId) || null
  if ((trimmed(d.terminalId) || null) !== scopeTerminal) return null

  const lines = Array.isArray(d.lines)
    ? d.lines.map((l) => sanitizeLine(l)).filter((l): l is CartDraftLine => l !== null)
    : []
  if (lines.length === 0) return null

  return {
    v: CART_DRAFT_VERSION,
    storeId: trimmed(d.storeId),
    modalidade: scope.modalidade,
    terminalId: scopeTerminal,
    savedAt: typeof d.savedAt === "string" ? d.savedAt : "",
    caixaSessaoId: trimmed(d.caixaSessaoId) || null,
    lines,
    customer: sanitizeCustomer(d.customer),
    discountReais: Number(d.discountReais) || 0,
    discountPercent: Number(d.discountPercent) || 0,
    ...(trimmed(d.observacao) ? { observacao: trimmed(d.observacao) } : {}),
  }
}

export function clearCartDraft(scope: CartDraftScope, storage: DraftStorage): void {
  try {
    storage.removeItem(cartDraftStorageKey(scope))
  } catch {
    /* ignore */
  }
}

/** Produto do catálogo atual usado para revalidar o rascunho. */
export type CartDraftCatalogItem = {
  id: string
  name?: string
  price: number
  stock?: number
}

export type CartDraftIssue =
  | { kind: "indisponivel"; lineId: string; name: string }
  | { kind: "preco-alterado"; lineId: string; name: string; de: number; para: number }
  | { kind: "estoque-insuficiente"; lineId: string; name: string; pedido: number; disponivel: number }

export type RevalidatedCartDraft = {
  lines: CartDraftLine[]
  issues: CartDraftIssue[]
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Revalida o rascunho contra o catálogo atual antes de devolver o carrinho ao operador.
 *
 * - linha virtual (O.S.) ou item avulso: passa direto — não existe no catálogo por definição;
 * - produto que sumiu do catálogo: REMOVIDO e reportado (nunca fica uma linha fantasma que
 *   seria silenciosamente descartada na finalização);
 * - preço diferente: adota o preço ATUAL e reporta (nunca vende com preço velho);
 * - estoque abaixo do pedido: mantém a linha e reporta, para o operador decidir.
 */
export function revalidateCartDraft(
  draft: Pick<CartDraft, "lines">,
  catalog: CartDraftCatalogItem[],
): RevalidatedCartDraft {
  const byId = new Map(catalog.map((item) => [item.id, item]))
  const lines: CartDraftLine[] = []
  const issues: CartDraftIssue[] = []

  for (const line of draft.lines) {
    if (line.isAvulso || isVirtualSaleLine(line.inventoryId)) {
      lines.push(line)
      continue
    }

    const item = byId.get(line.inventoryId)
    if (!item) {
      issues.push({ kind: "indisponivel", lineId: line.lineId, name: line.name })
      continue
    }

    const precoAtual = round2(Number(item.price) || 0)
    const precoRascunho = round2(Number(line.price) || 0)
    const restored: CartDraftLine = { ...line }

    if (precoAtual !== precoRascunho) {
      issues.push({
        kind: "preco-alterado",
        lineId: line.lineId,
        name: item.name || line.name,
        de: precoRascunho,
        para: precoAtual,
      })
      restored.price = precoAtual
    }

    const disponivel = Number(item.stock)
    if (Number.isFinite(disponivel) && disponivel < line.quantity) {
      issues.push({
        kind: "estoque-insuficiente",
        lineId: line.lineId,
        name: item.name || line.name,
        pedido: line.quantity,
        disponivel,
      })
    }

    lines.push(restored)
  }

  return { lines, issues }
}

/** Resumo em uma frase para o toast de recuperação. */
export function describeCartDraftIssues(issues: CartDraftIssue[]): string {
  if (issues.length === 0) return ""
  const indisponiveis = issues.filter((i) => i.kind === "indisponivel").length
  const precos = issues.filter((i) => i.kind === "preco-alterado").length
  const estoques = issues.filter((i) => i.kind === "estoque-insuficiente").length
  const partes: string[] = []
  if (indisponiveis > 0) {
    partes.push(`${indisponiveis} ite${indisponiveis === 1 ? "m" : "ns"} indisponíve${indisponiveis === 1 ? "l" : "is"} removido${indisponiveis === 1 ? "" : "s"}`)
  }
  if (precos > 0) partes.push(`${precos} com preço atualizado`)
  if (estoques > 0) partes.push(`${estoques} sem estoque suficiente`)
  return partes.join(" · ")
}
