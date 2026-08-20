"use client"

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Barcode,
  Clock,
  User,
  Wrench,
  Plus,
  Minus,
  Pencil,
  Settings2,
  X,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Lock,
  Unlock,
  RotateCcw,
  Check,
  ChevronDown,
  ChevronUp,
  Keyboard,
  Search,
  Star,
  Loader2,
  Zap,
  ShoppingCart,
  PackageSearch,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { playPdvRapidoItemBeepIfEnabled } from "@/lib/pdv-rapido-feedback"
import { useOperationsStore } from "@/lib/operations-store"
import { getOrCreatePdvOperatorId } from "@/lib/pdv-operator-id"
import { useSession } from "next-auth/react"
import { operatorDisplayName } from "@/lib/pdv-operator-label"
import { usePdvOperadorNome } from "@/lib/pdv-operador-nome"
import { type PdvCatalogProduct } from "@/lib/pdv-catalog"
import { SelecionarAcessorioDialog } from "./acessorios/selecionar-acessorio-dialog"
import {
  accessoryConfigRequiresSelection,
  sameAccessoryCartLine,
  type AccessoryCartLineSnapshot,
  type AccessorySelectionV1,
} from "@/lib/acessorios/cart-line"
import { findPdvProductByScan } from "@/lib/pdv-scan-product"
import { lookupPdvScanRemote } from "@/lib/pdv-scan-lookup"
import { filterPdvCatalogBySearch } from "@/lib/pdv-product-search"
import { CaixaStatusBar } from "../caixa/caixa-status-bar"
import { useGarantirSessaoCaixa } from "../caixa/use-atualizar-caixa"
import { useCaixa } from "../caixa/caixa-provider"
import { useToast } from "@/hooks/use-toast"
import { computePdvCartTotals } from "@/lib/pdv-cart-totals"
import { useStoreSettings } from "@/lib/store-settings-provider"
import {
  buildAssistenciaPayMethods,
  defaultFormasPagamento,
} from "@/lib/pdv-formas-pagamento"
import { useLojaAtiva } from "@/lib/loja-ativa"
import { appendAuditLog } from "@/lib/audit-log"
import { useClienteSearch } from "@/lib/hooks/use-cliente-search"
import { PdvClientePicker, type PdvClienteResult } from "./pdv-cliente-picker"
import { PaymentModal, type PaymentMethod, type PaymentMethodType } from "./payment-modal"
import { appendContaReceberTituloPdvAprazo } from "@/lib/pdv-append-conta-receber"
import { displaySaleNumber } from "@/lib/vendas/local-sale-identity"
import { TrocasDevolucao } from "./trocas-devolucao"
import { ItemAvulsoModal, type ItemAvulsoPayload } from "./item-avulso-modal"
import { PdvRecebimentoModal } from "./pdv-recebimento-modal"
import { avulsoInventoryId } from "@/lib/os-pdv-virtual-lines"
import { resolveSaleLineItemType, type SaleLineItemType } from "@/lib/sale-line-classification"
import {
  atalhoEntryFromCatalogItem,
  buildServicoCartLine,
  fromPdvAtalhoEntry,
  isServicoCatalogItem,
  normalizeServicoRow,
  resolveActiveShortcutItems,
  toPdvAtalhoEntry,
  type PdvAtalhoEntry as AtalhoEntry,
  type PdvAtalhoSaved as AtalhoSaved,
  type PdvServicoCatalogItem,
  type ServicoApiRow,
} from "@/lib/pdv-assistencia-shortcuts"
import {
  construirProdutosACadastrar,
  enfileirarProdutosACadastrar,
  acharProdutoPorCodigoExato,
} from "@/lib/pdv-produtos-a-cadastrar"
import { AUDIT_DISCOUNT_ALERT_PCT } from "@/lib/audit-constants"
import { printPdvSaleReceipt } from "@/lib/pdv-print-runtime"
import { resolveCupomRodape } from "@/lib/pdv-impressao-config"
import { buildPagamentosResumo, type PdvReceiptInput } from "@/lib/escpos"
import { PdvPostSaleDialog } from "./pdv-post-sale-dialog"
import { VendaEsperaModal } from "./venda-espera-modal"
import {
  getHeldSales,
  saveHeldSale,
  removeHeldSale,
  newHoldId,
  nextHoldLabel,
  type HeldSale,
} from "@/lib/pdv-hold"
import { readSelectedTerminal } from "@/lib/pdv-terminal"
import { isServicoDisponivelParaVenda } from "@/lib/servicos/servico-pdv"

// ─── Cart persistence ─────────────────────────────────────────────────────────

const CART_STORAGE_KEY = (storeId: string) => `omnigestao:pdv-assistencia-cart:${storeId}`
const CART_MAX_AGE_MS = 12 * 60 * 60 * 1000 // 12h

type DiscountType = "reais" | "percent"

type CartPersisted = {
  cart: CartLine[]
  customerName: string
  clienteId?: string | null
  clienteDoc?: string | null
  /** Valor efetivo em R$ (legado + snapshot) */
  discount: number
  discountType?: DiscountType
  discountReais?: number
  discountPercent?: number
  savedAt: string
}

// ─── Atalhos types + helpers ──────────────────────────────────────────────────

const SHORTCUTS_STORAGE_KEY = (storeId: string) => `omnigestao:pdv-shortcuts:${storeId}`

const MAX_SVC = 8
const MAX_PRD = 8

// ─── Types ────────────────────────────────────────────────────────────────────

type CartLine = {
  lineId: string
  inventoryId: string
  title: string
  price: number
  qty: number
  itemType: Extract<SaleLineItemType, "produto" | "servico" | "avulso">
  /** Item Avulso (INSERT): não baixa estoque, persistido no payload da venda. */
  isAvulso?: boolean
  /** Custo unitário opcional informado no balcão. `null` = desconhecido. */
  custoUnitario?: number | null
  /** Código de barras/SKU do item avulso → fila "Produtos a cadastrar". */
  codigoAvulso?: string | null
  /** Metadata do `Servico` real preservada no carrinho e no snapshot da venda. */
  serviceId?: string
  serviceCategory?: string
  warrantyDays?: number
  serviceTerms?: string
  /** Snapshot da seleção de acessório (modelo/cor). NÃO é variação de estoque. */
  accessorySelection?: AccessorySelectionV1
  /** Chave determinística produto+modelo+cor para agrupar linhas iguais. */
  cartLineKey?: string
}

type PayMethod = "dinheiro" | "pix" | "credito" | "debito" | "a_prazo" | "multiplo"

/** Mapeia a forma nativa da Assistência para o intent do modal compartilhado. */
function assistMethodToRuntime(method: PayMethod): PaymentMethodType | null {
  switch (method) {
    case "dinheiro": return "dinheiro"
    case "pix": return "pix"
    case "credito": return "cartao_credito"
    case "debito": return "cartao_debito"
    case "a_prazo": return "a_prazo"
    case "multiplo": return null
  }
}

const DEFAULT_PAY_METHODS = buildAssistenciaPayMethods(defaultFormasPagamento())

// ─── Helpers ──────────────────────────────────────────────────────────────────

function brl(n: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n)
}

function computeMerchandiseDiscount(
  subtotal: number,
  type: DiscountType,
  reais: number,
  percent: number,
): { amount: number; overTotal: boolean } {
  if (subtotal <= 0) return { amount: 0, overTotal: false }
  if (type === "percent") {
    if (percent <= 0.009) return { amount: 0, overTotal: false }
    if (percent > 100 + 0.0001) return { amount: 0, overTotal: true }
    const raw = (subtotal * percent) / 100
    if (raw > subtotal + 0.001) return { amount: 0, overTotal: true }
    return { amount: Math.round(Math.min(subtotal, raw) * 100) / 100, overTotal: false }
  }
  if (reais <= 0.009) return { amount: 0, overTotal: false }
  if (reais > subtotal + 0.001) return { amount: 0, overTotal: true }
  return { amount: Math.min(subtotal, reais), overTotal: false }
}

function newLineId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Converte um preço digitado no balcão (moeda BR ou número simples) em `number`.
 * Aceita "80", "80,00", "80.00", "120,50" e ignora "R$"/espaços. Vírgula = decimal;
 * pontos viram milhar quando há vírgula. Retorna `NaN` para entrada não numérica —
 * o caller exige `> 0`, então NaN/0/negativo são rejeitados. Arredonda a 2 casas.
 */
function parsePrecoManual(raw: string): number {
  let s = String(raw ?? "").trim().replace(/[^\d.,-]/g, "")
  if (!s) return NaN
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".")
  const v = Number(s)
  if (!Number.isFinite(v)) return NaN
  return Math.round(v * 100) / 100
}

/** Formata um preço (>0) para preencher o input de edição no padrão BR ("80,00"). */
function precoParaInput(price: number): string {
  if (!(price > 0)) return ""
  return (Math.round(price * 100) / 100).toFixed(2).replace(".", ",")
}

// ─── QuickCard ────────────────────────────────────────────────────────────────

function QuickCard({
  item,
  onAdd,
  isPickHighlight,
  reservedQty = 0,
}: {
  item: PdvCatalogProduct
  onAdd: (item: PdvCatalogProduct) => void
  isPickHighlight?: boolean
  reservedQty?: number
}) {
  const isService = isServicoCatalogItem(item)
  const availableStock = Math.max(0, item.stock - reservedQty)
  const outOfStock = !isService && item.stock < 999 && availableStock <= 0
  const lowStock = !isService && !outOfStock && availableStock <= 5 && item.stock < 999
  const hasReservation = !isService && reservedQty > 0 && item.stock < 999

  return (
    <Card
      className={cn(
        "group cursor-pointer rounded-2xl border border-border bg-card p-4 shadow-sm",
        "transition-all duration-150",
        "hover:border-primary/30 hover:bg-accent/60 hover:shadow-md",
        "active:scale-[0.97] active:shadow-sm",
        isPickHighlight && "ring-2 ring-primary ring-offset-2 ring-offset-background",
        outOfStock && "opacity-55 hover:opacity-70"
      )}
      onClick={() => onAdd(item)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{item.name}</p>
          <p className="mt-0.5 text-[10px] font-medium text-muted-foreground">
            {isService ? item.serviceCategory : item.category}
          </p>
        </div>
        <Badge
          variant="secondary"
          className="shrink-0 rounded-xl px-2 py-0.5 text-xs font-bold tabular-nums"
        >
          {brl(item.price)}
        </Badge>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span className={cn(
          "text-[10px] font-medium",
          outOfStock
            ? "text-destructive/80"
            : lowStock
              ? "text-amber-500 dark:text-amber-300"
              : hasReservation
                ? "text-primary/70"
                : "text-muted-foreground"
        )}>
          {isService
            ? "Serviço"
            : outOfStock
              ? "Sem estoque"
              : lowStock
                ? `Baixo: ${availableStock} unid.`
                : hasReservation
                  ? `${availableStock} disp. · ${reservedQty} res.`
                  : `${availableStock} em estoque`}
        </span>
        <span className={cn(
          "grid h-6 w-6 place-items-center rounded-lg transition-all duration-150",
          outOfStock
            ? "bg-muted/60 text-muted-foreground/40"
            : "bg-primary/10 text-primary opacity-0 group-hover:opacity-100"
        )}>
          <Plus className="h-3.5 w-3.5" />
        </span>
      </div>
    </Card>
  )
}

// ─── ServicoCard — card da aba Serviços (catálogo real do model `Servico`) ────

function ServicoCard({
  item,
  onAdd,
}: {
  item: PdvServicoCatalogItem
  onAdd: (item: PdvServicoCatalogItem) => void
}) {
  const semPreco = !(item.price > 0)
  const descricao = item.serviceCategory.trim()
  const garantia = item.warrantyDays

  return (
    <Card
      className={cn(
        "group cursor-pointer rounded-2xl border border-border bg-card p-4 shadow-sm",
        "transition-all duration-150",
        "hover:border-primary/30 hover:bg-accent/60 hover:shadow-md",
        "active:scale-[0.97] active:shadow-sm",
      )}
      onClick={() => onAdd(item)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{item.name}</p>
          {descricao && (
            <p className="mt-0.5 truncate text-[10px] font-medium text-muted-foreground">{descricao}</p>
          )}
        </div>
        <Badge
          variant="secondary"
          className="shrink-0 rounded-xl px-2 py-0.5 text-xs font-bold tabular-nums"
        >
          {semPreco ? "sem preço" : brl(item.price)}
        </Badge>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Badge
            variant="outline"
            className="shrink-0 rounded-lg border-primary/30 px-1.5 py-0 text-[9px] font-semibold text-primary"
          >
            <Wrench className="mr-1 h-2.5 w-2.5" />
            Serviço
          </Badge>
          {garantia > 0 && (
            <span className="truncate text-[10px] text-muted-foreground">Garantia padrão: {garantia} dias</span>
          )}
        </div>
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary opacity-0 transition-all duration-150 group-hover:opacity-100">
          <Plus className="h-3.5 w-3.5" />
        </span>
      </div>
    </Card>
  )
}

// ─── QuickRow — linha compacta para lista de resultados de busca ──────────────

function QuickRow({
  item,
  onAdd,
  isPickHighlight,
  reservedQty = 0,
}: {
  item: PdvCatalogProduct
  onAdd: (item: PdvCatalogProduct) => void
  isPickHighlight?: boolean
  reservedQty?: number
}) {
  const isService = isServicoCatalogItem(item)
  const availableStock = Math.max(0, item.stock - reservedQty)
  const outOfStock = !isService && item.stock < 999 && availableStock <= 0
  const lowStock = !isService && !outOfStock && availableStock <= 5 && item.stock < 999
  const codeLabel = [item.sku, item.codigoBarras || item.barcode].filter(Boolean).join(" · ")

  return (
    <div
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-xl border border-transparent px-3 py-2",
        "transition-all duration-100 hover:border-border hover:bg-accent/50",
        isPickHighlight && "border-primary/40 bg-primary/5 ring-1 ring-primary/30",
        outOfStock && "opacity-55",
      )}
      onClick={() => onAdd(item)}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-tight text-foreground">{item.name}</p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">
          {isService ? item.serviceCategory : codeLabel ? `${codeLabel} · ${item.category}` : item.category}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-bold tabular-nums text-foreground">{brl(item.price)}</p>
        <p className={cn(
          "text-[10px]",
          outOfStock ? "text-destructive/80" : lowStock ? "text-amber-500 dark:text-amber-300" : "text-muted-foreground",
        )}>
          {isService ? "Serviço" : outOfStock ? "Sem estoque" : lowStock ? `Baixo: ${availableStock}un.` : `${availableStock} un.`}
        </p>
      </div>
      <div className={cn(
        "grid h-7 w-7 shrink-0 place-items-center rounded-lg transition-all duration-100",
        outOfStock ? "text-muted-foreground/30" : "bg-primary/10 text-primary",
      )}>
        <Plus className="h-3.5 w-3.5" />
      </div>
    </div>
  )
}

// ─── PaymentModal ─────────────────────────────────────────────────────────────
// O modal de pagamento da Assistência agora reutiliza o componente compartilhado
// `./payment-modal` (mesmo motor de Clássico/Supermercado/Venda Completa/Black):
// pagamento misto, à prazo + entrada/parcelas/vencimento/observação, Conta a Receber
// e cadastro rápido de cliente. Antes havia um PaymentModal local duplicado aqui.

// ─── HelpOverlay ─────────────────────────────────────────────────────────────

const HELP_SHORTCUTS: { key: string; label: string; status: "ok" | "partial" | "soon" }[] = [
  { key: "F1",  label: "Finalizar venda (Dinheiro)",  status: "ok" },
  { key: "F2",  label: "Buscar / Selecionar cliente", status: "ok" },
  { key: "F3",  label: "Foco na busca / bipe",        status: "ok" },
  { key: "F4",  label: "Alterar quantidade (último item)", status: "ok" },
  { key: "F6",  label: "Cancelar último item",        status: "ok" },
  { key: "F8",  label: "Troca / Devolução",           status: "ok" },
  { key: "F9",  label: "Limpar carrinho",             status: "ok" },
  { key: "F10", label: "Desconto / Acréscimo",        status: "ok" },
  { key: "F11", label: "Tela cheia / Modo foco",      status: "ok" },
  { key: "F12", label: "Pagamento avançado",          status: "ok" },
  { key: "END", label: "Esta ajuda",                  status: "ok" },
  { key: "DEL", label: "Cancelar último item",        status: "ok" },
  { key: "ESC", label: "Fechar modal / painel",       status: "ok" },
]

function HelpOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md rounded-2xl border-border bg-card p-0 shadow-lg">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle className="flex items-center gap-2 text-base font-bold text-foreground">
            <Keyboard className="h-4 w-4 text-primary" />
            Atalhos de Teclado — PDV Assistência
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[65vh]">
          <div className="divide-y divide-border px-2 py-1">
            {HELP_SHORTCUTS.map(({ key, label, status }) => (
              <div key={key} className="flex items-center gap-3 px-4 py-2.5">
                <kbd className="w-12 shrink-0 rounded-lg border border-border bg-muted px-2 py-1 text-center text-xs font-bold text-foreground">
                  {key}
                </kbd>
                <span className="flex-1 text-sm text-foreground">{label}</span>
                <span className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                  status === "ok"
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : status === "partial"
                      ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                      : "bg-muted text-muted-foreground",
                )}>
                  {status === "ok" ? "Ativo" : status === "partial" ? "Parcial" : "Em breve"}
                </span>
              </div>
            ))}
          </div>
        </ScrollArea>
        <DialogFooter className="border-t border-border px-6 py-3">
          <p className="flex-1 text-xs text-muted-foreground">
            Pressione{" "}
            <kbd className="rounded border border-border bg-muted px-1 font-bold">END</kbd>{" "}
            a qualquer momento para abrir esta ajuda.
          </p>
          <Button variant="outline" size="sm" className="rounded-xl" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── EditarAtalhosModal ───────────────────────────────────────────────────────

function EditarAtalhosModal({
  open,
  catalog = [],
  catalogForAdd = [],
  serviceCatalog = [],
  serviceCatalogReady = false,
  savedAtalhos,
  onSave,
  onClose,
}: {
  open: boolean
  /** Catálogo completo (inclui base mock) — usado apenas para resolver atalhos já salvos. */
  catalog?: PdvCatalogProduct[]
  /** Apenas itens reais do estoque — exibidos na aba "Adicionar do Catálogo". */
  catalogForAdd?: PdvCatalogProduct[]
  /** Serviços reais ativos/completos da unidade. */
  serviceCatalog?: PdvServicoCatalogItem[]
  serviceCatalogReady?: boolean
  savedAtalhos: AtalhoSaved[]
  onSave: (atalhos: AtalhoSaved[]) => void
  onClose: () => void
}) {
  const [entries, setEntries] = useState<AtalhoEntry[]>([])
  const [modalTab, setModalTab] = useState<"atalhos" | "adicionar">("atalhos")
  const [addKind, setAddKind] = useState<"produto" | "servico">("produto")
  const [catSearch, setCatSearch] = useState("")
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setEntries(savedAtalhos.map((a) => toPdvAtalhoEntry(a, catalog, serviceCatalog, {
      productCatalogReady: (catalog?.length ?? 0) > 0,
      serviceCatalogReady,
    })))
    setModalTab("atalhos")
    setAddKind("produto")
    setCatSearch("")
    setIsSaving(false)
  }, [open, savedAtalhos, catalog, serviceCatalog, serviceCatalogReady])

  // ── Derived ──────────────────────────────────────────────────────────────────
  const svcEntries = useMemo(
    () => entries.map((e, i) => ({ ...e, _idx: i })).filter((e) => e.kind === "servico"),
    [entries],
  )
  const prdEntries = useMemo(
    () => entries.map((e, i) => ({ ...e, _idx: i })).filter((e) => e.kind === "produto"),
    [entries],
  )
  const svcActive = svcEntries.filter((e) => e.ativo).length
  const prdActive = prdEntries.filter((e) => e.ativo).length
  const addedIds = useMemo(() => new Set(entries.map((e) => e.id)), [entries])

  const catSearchLow = catSearch.toLowerCase().trim()
  const selectedCatalog = addKind === "servico" ? serviceCatalog : catalogForAdd
  const catalogFiltered = useMemo(
    () =>
      catSearchLow
        ? selectedCatalog.filter(
            (p) =>
              p.name.toLowerCase().includes(catSearchLow) ||
              (isServicoCatalogItem(p) ? p.serviceCategory : p.category).toLowerCase().includes(catSearchLow) ||
              (p.sku ?? "").toLowerCase().includes(catSearchLow) ||
              (p.barcode ?? "").includes(catSearchLow),
          )
        : selectedCatalog,
    [selectedCatalog, catSearchLow],
  )

  // ── Mutations ─────────────────────────────────────────────────────────────────
  const moveWithinGroup = (idx: number, dir: -1 | 1) => {
    const isService = entries[idx].kind === "servico"
    const step = dir < 0 ? -1 : 1
    let target = -1
    for (let i = idx + step; i >= 0 && i < entries.length; i += step) {
      if ((entries[i].kind === "servico") === isService) { target = i; break }
    }
    if (target === -1) return
    setEntries((prev) => {
      const next = [...prev]
      ;[next[idx], next[target]] = [next[target], next[idx]]
      return next
    })
  }

  const toggleAtivo = (idx: number) =>
    setEntries((prev) => prev.map((e, i) => (i === idx ? { ...e, ativo: !e.ativo } : e)))

  const toggleFavorito = (idx: number) =>
    setEntries((prev) => prev.map((e, i) => (i === idx ? { ...e, favorito: !e.favorito } : e)))

  const removeEntry = (idx: number) =>
    setEntries((prev) => prev.filter((_, i) => i !== idx))

  const addFromCatalog = (p: PdvCatalogProduct) => {
    if (addedIds.has(p.id)) return
    const isService = isServicoCatalogItem(p)
    if (isService && svcEntries.length >= MAX_SVC) return
    if (!isService && prdEntries.length >= MAX_PRD) return
    setEntries((prev) => [
      ...prev,
      atalhoEntryFromCatalogItem(p),
    ])
  }

  const handleSave = () => {
    setIsSaving(true)
    onSave(entries.map(fromPdvAtalhoEntry))
    onClose()
  }

  // ── Row ────────────────────────────────────────────────────────────────────
  const renderRow = (e: AtalhoEntry & { _idx: number }, isFirstInGroup: boolean, isLastInGroup: boolean) => {
    const isService = e.kind === "servico"
    const outOfStock = !isService && e.stockAtual <= 0

    return (
      <div
        key={e.id}
        className={cn(
          "flex items-center gap-1.5 rounded-xl border px-2.5 py-2 transition-all",
          e.ativo ? "border-border bg-background" : "border-border/50 bg-muted/30 opacity-60",
          e.orphan && "border-destructive/40 bg-destructive/5",
        )}
      >
        {/* Reorder */}
        <div className="flex shrink-0 flex-col">
          <button type="button" disabled={isFirstInGroup} onClick={() => moveWithinGroup(e._idx, -1)}
            className="grid h-5 w-5 place-items-center rounded text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-20">
            <ChevronUp className="h-3 w-3" />
          </button>
          <button type="button" disabled={isLastInGroup} onClick={() => moveWithinGroup(e._idx, 1)}
            className="grid h-5 w-5 place-items-center rounded text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-20">
            <ChevronDown className="h-3 w-3" />
          </button>
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{e.nome}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            <span className="text-[10px] text-muted-foreground">{e.categoria}</span>
            {e.sku && <span className="rounded bg-muted px-1 text-[9px] text-muted-foreground">{e.sku}</span>}
            {outOfStock && (
              <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 px-1 py-px text-[9px] font-semibold text-amber-600 dark:text-amber-400">
                sem estoque
              </Badge>
            )}
            {e.orphan && (
              <Badge variant="outline" className="border-destructive/40 bg-destructive/10 px-1 py-px text-[9px] font-semibold text-destructive">
                indisponível nesta unidade
              </Badge>
            )}
          </div>
        </div>

        {/* Price */}
        <span className="shrink-0 text-xs font-bold tabular-nums text-foreground">{brl(e.preco)}</span>

        {/* Favorito */}
        <button type="button" onClick={() => toggleFavorito(e._idx)} title={e.favorito ? "Remover dos favoritos" : "Favorito"}
          className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-lg transition",
            e.favorito ? "text-amber-500 hover:text-amber-600" : "text-muted-foreground hover:text-amber-500")}>
          <Star className={cn("h-3.5 w-3.5", e.favorito && "fill-current")} />
        </button>

        {/* Ativo toggle */}
        <button type="button" onClick={() => toggleAtivo(e._idx)} title={e.ativo ? "Desativar" : "Ativar"}
          className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", e.ativo ? "bg-primary" : "bg-muted")}>
          <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-background shadow transition-transform",
            e.ativo ? "translate-x-4" : "translate-x-0.5")} />
        </button>

        {/* Remove */}
        <button type="button" onClick={() => removeEntry(e._idx)}
          className="grid h-6 w-6 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-xl flex-col gap-0 overflow-hidden rounded-2xl border-border bg-card p-0">
        {/* Header — fixo */}
        <DialogHeader className="shrink-0 border-b border-border px-6 py-4">
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <Settings2 className="h-5 w-5 text-primary" />
            Gerenciar Atalhos Rápidos
          </DialogTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Configure até {MAX_SVC} serviços e {MAX_PRD} produtos. Reordene, ative/desative e marque favoritos.
          </p>
        </DialogHeader>

        {/* Tab nav — fixo */}
        <div className="flex shrink-0 gap-5 border-b border-border px-6 pt-3">
          {([
            { id: "atalhos" as const, label: `Atalhos (${entries.length})` },
            { id: "adicionar" as const, label: "Adicionar do Catálogo" },
          ] as const).map((t) => (
            <button key={t.id} type="button" onClick={() => setModalTab(t.id)}
              className={cn("pb-2.5 text-sm font-semibold transition-colors border-b-2 -mb-px",
                modalTab === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Área de conteúdo — scrollável, ocupa espaço restante */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {modalTab === "atalhos" ? (
            /* ── Tab: Atalhos ── */
            <div className="space-y-4 px-6 py-4">
              {/* Serviços */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Serviços</p>
                  <Badge variant={svcActive >= MAX_SVC ? "destructive" : "secondary"} className="text-xs">
                    {svcActive}/{MAX_SVC} ativos
                  </Badge>
                </div>
                {svcEntries.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nenhum serviço. Adicione na aba &ldquo;Adicionar do Catálogo&rdquo;.</p>
                ) : (
                  <div className="space-y-1.5">
                    {svcEntries.map((e, gi) =>
                      renderRow(e, gi === 0, gi === svcEntries.length - 1)
                    )}
                  </div>
                )}
              </div>

              <Separator className="bg-border" />

              {/* Produtos */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Produtos</p>
                  <Badge variant={prdActive >= MAX_PRD ? "destructive" : "secondary"} className="text-xs">
                    {prdActive}/{MAX_PRD} ativos
                  </Badge>
                </div>
                {prdEntries.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nenhum produto. Adicione na aba &ldquo;Adicionar do Catálogo&rdquo;.</p>
                ) : (
                  <div className="space-y-1.5">
                    {prdEntries.map((e, gi) =>
                      renderRow(e, gi === 0, gi === prdEntries.length - 1)
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* ── Tab: Adicionar ── */
            <div className="flex flex-col">
              {/* Busca — sticky */}
              <div className="sticky top-0 z-10 space-y-3 border-b border-border bg-card px-6 py-3">
                <div className="grid grid-cols-2 rounded-xl bg-muted p-1" aria-label="Tipo de catálogo">
                  {([
                    { id: "produto" as const, label: `Produtos (${catalogForAdd.length})` },
                    { id: "servico" as const, label: `Serviços (${serviceCatalog.length})` },
                  ]).map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => {
                        setAddKind(option.id)
                        setCatSearch("")
                      }}
                      className={cn(
                        "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                        addKind === option.id
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    autoFocus
                    value={catSearch}
                    onChange={(e) => setCatSearch(e.target.value)}
                    placeholder="Buscar por nome, categoria, SKU ou código de barras…"
                    className="h-9 w-full rounded-xl border-border bg-background pl-9 text-sm"
                  />
                </div>
              </div>

              {/* Lista de itens reais */}
              <div className="space-y-1 px-6 py-3">
                {selectedCatalog.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-10 text-center">
                    <AlertTriangle className="h-6 w-6 text-muted-foreground/40" />
                    <p className="text-sm font-medium text-muted-foreground">
                      Nenhum {addKind === "servico" ? "serviço disponível" : "produto real"} encontrado nesta loja.
                    </p>
                    <p className="text-xs text-muted-foreground/60">
                      {addKind === "servico"
                        ? "Cadastre e ative serviços completos no Cadastros HUB."
                        : "Cadastre itens em Estoque para adicioná-los como atalhos."}
                    </p>
                  </div>
                ) : catalogFiltered.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    Nenhum resultado para &ldquo;{catSearch}&rdquo;.
                  </p>
                ) : (
                  catalogFiltered.map((p) => {
                    const isAdded = addedIds.has(p.id)
                    const isService = isServicoCatalogItem(p)
                    const outOfStock = !isService && p.stock <= 0
                    const atLimit = isService ? svcEntries.length >= MAX_SVC : prdEntries.length >= MAX_PRD
                    const disabled = isAdded || atLimit

                    return (
                      <div key={p.id}
                        className={cn("flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-all",
                          isAdded ? "border-border/50 bg-muted/20 opacity-60" : "border-border bg-background hover:border-primary/30 hover:bg-muted/40")}>
                        <div className="min-w-0 flex-1">
                          <p className={cn("truncate font-medium", isAdded ? "text-muted-foreground" : "text-foreground")}>{p.name}</p>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1">
                            <span className="text-[10px] text-muted-foreground">
                              {isService ? p.serviceCategory : p.category}
                            </span>
                            {p.sku && <span className="rounded bg-muted px-1 text-[9px] text-muted-foreground">{p.sku}</span>}
                            {outOfStock && (
                              <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 px-1 py-px text-[9px] font-semibold text-amber-600">
                                sem estoque
                              </Badge>
                            )}
                          </div>
                        </div>
                        <span className="shrink-0 text-xs font-bold tabular-nums text-muted-foreground">{brl(p.price)}</span>
                        {!isService && p.stock < 999 && (
                          <span className={cn("shrink-0 text-[10px] tabular-nums", outOfStock ? "text-amber-500" : "text-muted-foreground")}>
                            {p.stock}⬟
                          </span>
                        )}
                        <button type="button" disabled={disabled} onClick={() => addFromCatalog(p)}
                          className={cn("flex h-7 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-bold transition",
                            isAdded ? "cursor-default text-muted-foreground"
                              : atLimit ? "cursor-not-allowed text-muted-foreground opacity-40"
                                : "bg-primary/10 text-primary hover:bg-primary/20")}>
                          {isAdded ? <><Check className="h-3 w-3" /> Adicionado</> : <><Plus className="h-3 w-3" /> Adicionar</>}
                        </button>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer — fixo */}
        <DialogFooter className="shrink-0 border-t border-border px-6 py-4">
          <Button variant="outline" className="rounded-xl" onClick={onClose}>Cancelar</Button>
          <Button disabled={isSaving} className="rounded-xl" onClick={handleSave}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
            Salvar Atalhos
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function PdvAssistenciaEnterprise({ isModoRapido = false }: { isModoRapido?: boolean } = {}) {
  const { inventory, setInventory, finalizeSaleTransaction, getSaldoCreditoCliente } = useOperationsStore()
  const { pdvParams, blob, save: saveStoreSettings, hydrated: settingsHydrated, impressaoConfig } = useStoreSettings()
  const { lojaAtivaId, empresaDocumentos, getEnderecoDocumentos } = useLojaAtiva()
  // Chave dos atalhos: estritamente a unidade ativa, sem fallback silencioso para
  // loja-1 (alinhado à política multi-loja). A grade só monta com unidade ativa.
  const shortcutsKey = useMemo(
    () => SHORTCUTS_STORAGE_KEY((lojaAtivaId ?? "").trim()),
    [lojaAtivaId]
  )
  const cashierId = useMemo(() => getOrCreatePdvOperatorId(), [])
  const { data: session } = useSession()
  const operadorNomeAbertura = usePdvOperadorNome((lojaAtivaId ?? "").trim())
  const operatorLabel = operatorDisplayName({ aberturaNome: operadorNomeAbertura, session })
  const { caixa, sessaoId } = useCaixa()
  const { garantirSessao } = useGarantirSessaoCaixa()
  const storeIdKey = useMemo(
    () => (lojaAtivaId ?? "").trim(),
    [lojaAtivaId]
  )
  const [clienteQuery, setClienteQuery] = useState("")
  const { clientes: clienteSugestoes, isLoading: buscandoCliente } = useClienteSearch(clienteQuery, storeIdKey)
  const [showCustomerSidebarDropdown, setShowCustomerSidebarDropdown] = useState(false)
  const cartHydratedRef = useRef(false)
  const cartPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [postSalePrintOpen, setPostSalePrintOpen] = useState(false)
  const [postSalePrintInput, setPostSalePrintInput] = useState<PdvReceiptInput | null>(null)

  // Somente itens reais do estoque — única fonte de catálogo no PDV Assistência
  const realCatalog = useMemo((): PdvCatalogProduct[] => {
    if (!Array.isArray(inventory) || inventory.length === 0) return []
    return inventory.map((inv) => {
      const unit = inv.vendaPorPeso ? (inv.precoPorKg ?? inv.price) : inv.price
      return {
        id: inv.id,
        name: inv.name,
        barcode: inv.barcode,
        dbId: inv.dbId,
        sku: inv.sku,
        codigo: inv.codigo ?? inv.sku ?? inv.id,
        codigoBarras: inv.codigoBarras ?? inv.barcode,
        price: unit,
        stock: inv.stock,
        category: inv.category ?? "Outros",
        vendaPorPeso: inv.vendaPorPeso,
        precoPorKg: inv.precoPorKg,
        atributos: inv.atributos,
        ...(inv.accessoryConfig ? { accessoryConfig: inv.accessoryConfig } : {}),
      }
    })
  }, [inventory])

  // ── Serviços reais (model `Servico`) — catálogo da aba Serviços ──────────────
  // Leitura-only via /api/ops/servicos (reaproveita `listServicos`), escopada à
  // loja ativa. Sem loja ativa não busca (política multi-loja, sem fallback loja-1).
  const [servicosRows, setServicosRows] = useState<ServicoApiRow[]>([])
  const [servicosLoaded, setServicosLoaded] = useState(false)
  useEffect(() => {
    const lj = storeIdKey
    if (!lj) {
      setServicosRows([])
      setServicosLoaded(true)
      return
    }
    let cancelled = false
    setServicosLoaded(false)
    fetch(`/api/ops/servicos?lojaId=${encodeURIComponent(lj)}`, {
      credentials: "include",
      headers: { "x-assistec-loja-id": lj },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { items?: ServicoApiRow[] } | null) => {
        if (cancelled) return
        setServicosRows(Array.isArray(j?.items) ? j.items : [])
        setServicosLoaded(true)
      })
      .catch(() => {
        if (cancelled) return
        setServicosRows([])
        setServicosLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [storeIdKey])

  const inputRef = useRef<HTMLInputElement | null>(null)
  const customerInputRef = useRef<HTMLInputElement | null>(null)
  const { toast } = useToast()

  // ── Time ────────────────────────────────────────────────────────────────────
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(t)
  }, [])

  useEffect(() => {
    if (!isModoRapido) return
    const t = window.setTimeout(() => inputRef.current?.focus(), 200)
    return () => window.clearTimeout(t)
  }, [isModoRapido])

  // ── Search + catalog tab ─────────────────────────────────────────────────────
  const [search, setSearch] = useState("")
  const [tab, setTab] = useState<"servicos" | "produtos" | "favoritos">("servicos")

  // ── Cart ─────────────────────────────────────────────────────────────────────
  const [cart, setCart] = useState<CartLine[]>([])
  const [rapidoFlashLineId, setRapidoFlashLineId] = useState<string | null>(null)
  const [rapidoPickIdx, setRapidoPickIdx] = useState(0)
  const [discountType, setDiscountType] = useState<DiscountType>("reais")
  const [discountReais, setDiscountReais] = useState(0)
  const [discountPercent, setDiscountPercent] = useState(0)
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  const [showItemAvulsoModal, setShowItemAvulsoModal] = useState(false)
  const [recebimentoOpen, setRecebimentoOpen] = useState(false)
  const [vendaEsperaOpen, setVendaEsperaOpen] = useState(false)
  // Acessório com modelo/cor: produto aguardando seleção no modal compartilhado.
  const [accessoryTarget, setAccessoryTarget] = useState<{
    item: PdvCatalogProduct
    priceOverride?: number
  } | null>(null)

  // ── Customer ──────────────────────────────────────────────────────────────────
  const [customerName, setCustomerName] = useState("")
  const [selectedClienteId, setSelectedClienteId] = useState<string | null>(null)
  const [selectedClienteDoc, setSelectedClienteDoc] = useState<string | null>(null)
  const [customerCreditFetched, setCustomerCreditFetched] = useState<number | null>(null)

  useEffect(() => {
    setCustomerCreditFetched(null)
    const docNorm = (selectedClienteDoc ?? "").replace(/\D/g, "")
    const cId = selectedClienteId
    if (!docNorm && !cId) return
    const params = new URLSearchParams({ lojaId: storeIdKey })
    if (docNorm) params.set("doc", docNorm)
    else if (cId) params.set("clienteId", cId)
    fetch(`/api/ops/credito-cliente?${params.toString()}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { creditos?: Record<string, { nome: string; saldo: number }> } | null) => {
        const saldo = j?.creditos ? Object.values(j.creditos).reduce((s, v) => s + v.saldo, 0) : 0
        setCustomerCreditFetched(saldo)
      })
      .catch(() => setCustomerCreditFetched(null))
  }, [selectedClienteDoc, selectedClienteId, storeIdKey])

  const customerCredit = customerCreditFetched ?? (selectedClienteDoc ? getSaldoCreditoCliente(selectedClienteDoc) : 0)

  const payMethods = useMemo(
    () => buildAssistenciaPayMethods(pdvParams.formasPagamento ?? defaultFormasPagamento()),
    [pdvParams.formasPagamento],
  )

  // ── Modals ───────────────────────────────────────────────────────────────────
  const [paymentOpen, setPaymentOpen] = useState(false)
  /** Intent passado ao modal compartilhado (forma pré-selecionada) e flag de múltiplo. */
  const [paymentInstantIntent, setPaymentInstantIntent] = useState<PaymentMethodType | null>(null)
  const [paymentMultipay, setPaymentMultipay] = useState(false)
  const paymentDiscountSnapshotRef = useRef<{
    discountType: DiscountType
    discountReais: number
    discountPercent: number
  } | null>(null)
  const [trocasOpen, setTrocasOpen] = useState(false)
  const [editAtalhosOpen, setEditAtalhosOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [clientePickerOpen, setClientePickerOpen] = useState(false)
  const [f4QtdOpen, setF4QtdOpen] = useState(false)
  const [f4QtdValue, setF4QtdValue] = useState("")
  const [f4LineId, setF4LineId] = useState<string | null>(null)
  const f4InputRef = useRef<HTMLInputElement>(null)
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null)
  // Preço manual de serviço real: alvo do modal (add|edit) + valor digitado.
  const [servicoPrecoTarget, setServicoPrecoTarget] = useState<
    | { kind: "add"; item: PdvServicoCatalogItem }
    | { kind: "edit"; lineId: string; title: string }
    | null
  >(null)
  const [servicoPrecoInput, setServicoPrecoInput] = useState("")

  // ── Custom atalhos ────────────────────────────────────────────────────────────
  const [localAtalhos, setLocalAtalhos] = useState<AtalhoSaved[]>([])

  // Serviços reais aptos para venda. O endpoint já filtra; a defesa no cliente
  // impede que resposta stale/incompleta seja oferecida silenciosamente.
  const servicosCatalog = useMemo<PdvServicoCatalogItem[]>(() => {
    return servicosRows.filter(isServicoDisponivelParaVenda).map(normalizeServicoRow)
  }, [servicosRows])

  // Metadata só dos serviços REAIS (por id virtual) — usada para enriquecer a
  // linha do carrinho ao adicionar. Produtos-compat seguem o fluxo normal de produto.
  const servicoMetaById = useMemo(() => {
    const m = new Map<string, PdvServicoCatalogItem>()
    for (const it of servicosCatalog) {
      m.set(it.id, it)
    }
    return m
  }, [servicosCatalog])

  const quickProducts = useMemo(() => {
    return resolveActiveShortcutItems(localAtalhos, realCatalog, servicosCatalog, { kind: "produto" })
  }, [localAtalhos, realCatalog, servicosCatalog])

  const quickServices = useMemo(() => {
    return resolveActiveShortcutItems(localAtalhos, realCatalog, servicosCatalog, { kind: "servico" })
      .filter(isServicoCatalogItem)
  }, [localAtalhos, realCatalog, servicosCatalog])

  const quickFavorites = useMemo(() => {
    return resolveActiveShortcutItems(localAtalhos, realCatalog, servicosCatalog, { favoritesOnly: true })
  }, [localAtalhos, realCatalog, servicosCatalog])

  // ── Hydratação dos atalhos: localStorage (fast-path) → banco (fallback) ──────
  // Re-hidrata por loja: `hydratedShortcutsKeyRef` guarda a chave da última loja
  // hidratada. Ao trocar de loja, descarta os atalhos da loja anterior e hidrata
  // do zero — sem vazamento entre lojas e sem fallback para a loja primária.
  const [hydratedFromDb, setHydratedFromDb] = useState(false)
  const hydratedShortcutsKeyRef = useRef<string | null>(null)
  useEffect(() => {
    // Loja ativa mudou: zera o estado e reexibe o skeleton até a nova carga.
    if (hydratedShortcutsKeyRef.current !== null && hydratedShortcutsKeyRef.current !== shortcutsKey) {
      hydratedShortcutsKeyRef.current = null
      setHydratedFromDb(false)
      setLocalAtalhos([])
      return
    }
    if (hydratedFromDb) return

    // Fast-path: localStorage por loja (disponível antes da resposta do servidor)
    try {
      const raw = localStorage.getItem(shortcutsKey)
      if (raw) {
        const parsed = JSON.parse(raw) as AtalhoSaved[]
        if (Array.isArray(parsed)) {
          setLocalAtalhos(parsed)
          hydratedShortcutsKeyRef.current = shortcutsKey
          setHydratedFromDb(true)
          return
        }
      }
    } catch { /* ignore */ }

    // Server fallback: aguarda hidratação do banco da loja ativa
    if (!settingsHydrated) return
    const saved = pdvParams.atalhosRapidos ?? []
    setLocalAtalhos(saved)
    hydratedShortcutsKeyRef.current = shortcutsKey
    setHydratedFromDb(true)
  }, [shortcutsKey, settingsHydrated, hydratedFromDb, pdvParams.atalhosRapidos])

  // ── Normalizar atalhos legados para kind/referência explícitos ──────────────
  useEffect(() => {
    if (!hydratedFromDb || !servicosLoaded || localAtalhos.length === 0) return
    const needsPatch = localAtalhos.some((a) => !a.kind || (a.kind === "servico" && !a.serviceId) || !a.categoria)
    if (!needsPatch) return
    const patched = localAtalhos.map((a) => fromPdvAtalhoEntry(toPdvAtalhoEntry(
      a,
      realCatalog,
      servicosCatalog,
      { productCatalogReady: realCatalog.length > 0, serviceCatalogReady: servicosLoaded },
    )))
    setLocalAtalhos(patched)
    try { localStorage.setItem(shortcutsKey, JSON.stringify(patched)) } catch { /* ignore */ }
  }, [hydratedFromDb, localAtalhos, realCatalog, servicosCatalog, servicosLoaded, shortcutsKey])

  // ── Restaurar carrinho do localStorage ──────────────────────────────────────
  useEffect(() => {
    cartHydratedRef.current = false
    try {
      const raw = localStorage.getItem(CART_STORAGE_KEY(storeIdKey))
      if (raw) {
        const data = JSON.parse(raw) as CartPersisted
        const age = Date.now() - new Date(data.savedAt).getTime()
        if (age < CART_MAX_AGE_MS && Array.isArray(data.cart) && data.cart.length > 0) {
          const restoredCart = data.cart.map((line) => ({
            ...line,
            itemType: resolveSaleLineItemType(line),
            isAvulso: resolveSaleLineItemType(line) === "avulso" ? true : undefined,
          })) as CartLine[]
          const restoredSubtotal = restoredCart.reduce((s, l) => s + l.price * l.qty, 0)
          setCart(restoredCart)
          setCustomerName(data.customerName ?? "")
          setSelectedClienteId(data.clienteId ?? null)
          setSelectedClienteDoc(data.clienteDoc ?? null)
          const restoredType: DiscountType = data.discountType === "percent" ? "percent" : "reais"
          setDiscountType(restoredType)
          if (restoredType === "percent") {
            const pct = typeof data.discountPercent === "number" ? data.discountPercent : 0
            setDiscountPercent(pct > 0.009 && pct <= 100 ? pct : 0)
            setDiscountReais(0)
          } else {
            let dr =
              typeof data.discountReais === "number"
                ? data.discountReais
                : typeof data.discount === "number"
                  ? data.discount
                  : 0
            if (dr > restoredSubtotal + 0.001) dr = 0
            setDiscountReais(Math.max(0, dr))
            setDiscountPercent(0)
          }
          window.setTimeout(() => {
            toast({
              title: "Carrinho restaurado",
              description: `${data.cart.length} item${data.cart.length !== 1 ? "ns" : ""} da sessão anterior recuperados.`,
            })
          }, 600)
        }
      }
    } catch { /* ignore */ }
    cartHydratedRef.current = true
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeIdKey])

  // ── Computed totals ────────────────────────────────────────────────────────────
  const subtotal = useMemo(() => cart.reduce((s, l) => s + l.price * l.qty, 0), [cart])
  const discountCalc = useMemo(
    () => computeMerchandiseDiscount(subtotal, discountType, discountReais, discountPercent),
    [subtotal, discountType, discountReais, discountPercent],
  )
  const desconto = discountCalc.amount
  const discountOverTotal = discountCalc.overTotal
  const { impostoEstimado, total } = useMemo(
    () => computePdvCartTotals(subtotal, desconto, pdvParams),
    [subtotal, desconto, pdvParams],
  )

  const resetDiscountState = useCallback(() => {
    setDiscountType("reais")
    setDiscountReais(0)
    setDiscountPercent(0)
  }, [])

  const closePaymentModal = useCallback((revertDiscount: boolean) => {
    setPaymentOpen(false)
    if (revertDiscount && paymentDiscountSnapshotRef.current) {
      const snap = paymentDiscountSnapshotRef.current
      setDiscountType(snap.discountType)
      setDiscountReais(snap.discountReais)
      setDiscountPercent(snap.discountPercent)
    }
    paymentDiscountSnapshotRef.current = null
  }, [])

  useEffect(() => {
    if (!cartHydratedRef.current) return
    if (cart.length === 0) {
      resetDiscountState()
    }
  }, [cart.length, resetDiscountState])

  // ── Persistir carrinho no localStorage (debounced 500ms) ─────────────────────
  useEffect(() => {
    if (!cartHydratedRef.current) return
    if (cartPersistTimerRef.current) clearTimeout(cartPersistTimerRef.current)
    cartPersistTimerRef.current = setTimeout(() => {
      try {
        if (cart.length === 0) {
          localStorage.removeItem(CART_STORAGE_KEY(storeIdKey))
        } else {
          const data: CartPersisted = {
            cart,
            customerName,
            clienteId: selectedClienteId,
            clienteDoc: selectedClienteDoc,
            discount: desconto,
            discountType,
            discountReais,
            discountPercent,
            savedAt: new Date().toISOString(),
          }
          localStorage.setItem(CART_STORAGE_KEY(storeIdKey), JSON.stringify(data))
        }
      } catch { /* ignore */ }
    }, 500)
    return () => { if (cartPersistTimerRef.current) clearTimeout(cartPersistTimerRef.current) }
  }, [cart, customerName, selectedClienteId, selectedClienteDoc, discountType, discountReais, discountPercent, desconto, storeIdKey])

  // ── Limpar selectedLineId quando a linha é removida ──────────────────────────
  useEffect(() => {
    if (selectedLineId && !cart.some((l) => l.lineId === selectedLineId)) {
      setSelectedLineId(null)
    }
  }, [cart, selectedLineId])

  // ── Reserva operacional: qtd de cada inventoryId já no carrinho ─────────────
  const cartQtyByInventoryId = useMemo(() => {
    const map: Record<string, number> = {}
    for (const l of cart) {
      map[l.inventoryId] = (map[l.inventoryId] ?? 0) + l.qty
    }
    return map
  }, [cart])

  // ── Full-catalog search (somente itens reais do estoque) ─────────────────────
  const fullSearch = useMemo(() => {
    const raw = search.trim()
    if (!raw) return []
    const exact = findPdvProductByScan(raw, realCatalog)
    if (exact) return [exact]
    return filterPdvCatalogBySearch(realCatalog, raw).slice(0, 50)
  }, [search, realCatalog])

  useEffect(() => {
    setRapidoPickIdx(0)
  }, [search, fullSearch.length])

  // ── Global keyboard shortcuts ─────────────────────────────────────────────────
  // Sem cliente, à prazo/carnê NÃO barram mais: o modal compartilhado abre e pede o
  // seletor de cliente (com cadastro rápido) via onRequireCustomer. `method = null`
  // abre em estado neutro (ex.: F10 = Desconto), sem pré-selecionar forma.
  const openPaymentModal = (method: PayMethod | null = null) => {
    if (method && !payMethods.some((p) => p.id === method)) return
    if (cart.length === 0) return
    if (discountOverTotal) {
      toast({
        title: "Desconto inválido",
        description: "O desconto não pode ser maior que o subtotal.",
        variant: "destructive",
      })
      return
    }
    // Caixa fechado na tela ou sem referência de sessão utilizável: reconsulta a
    // sessão ativa da loja antes de recusar. Mesma regra dos demais PDVs — o
    // carrinho é mantido e a venda não é enviada; o operador finaliza de novo.
    if (!caixa.isOpen || !sessaoId?.trim()) {
      void garantirSessao()
      return
    }
    const discountPct = subtotal > 0 ? (desconto / subtotal) * 100 : 0
    appendAuditLog({
      action: "pdv_pagamento_iniciado",
      userLabel: cashierId.slice(0, 8),
      detail: `Método: ${method ?? "balcão"} — Total: ${brl(total)}${discountPct >= AUDIT_DISCOUNT_ALERT_PCT ? ` — DESCONTO ${discountPct.toFixed(1)}%` : ""}`,
    })
    if (discountPct >= AUDIT_DISCOUNT_ALERT_PCT) {
      appendAuditLog({
        action: "desconto_elevado",
        userLabel: cashierId.slice(0, 8),
        detail: `Desconto de ${discountPct.toFixed(1)}% aplicado — ${brl(desconto)} de ${brl(subtotal)}`,
      })
    }
    paymentDiscountSnapshotRef.current = {
      discountType,
      discountReais,
      discountPercent,
    }
    setPaymentMultipay(method === "multiplo")
    setPaymentInstantIntent(method && method !== "multiplo" ? assistMethodToRuntime(method) : null)
    setPaymentOpen(true)
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey) return
      // Ctrl+L — Limpar carrinho (migrado de F9 para liberar F9 = Recebimento de Contas,
      // alinhando ao keymap canônico do projeto). Cobre o muscle memory do operador
      // do Assistência sem colidir com o atalho canônico.
      if (e.ctrlKey && (e.key === "l" || e.key === "L")) {
        const target = e.target as HTMLElement | null
        const isInput =
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          (target instanceof HTMLElement && target.isContentEditable)
        if (isInput) return
        if (cart.length > 0) {
          e.preventDefault()
          e.stopPropagation()
          setClearConfirmOpen(true)
        }
        return
      }
      if (e.altKey) return
      if (e.ctrlKey) return

      const active = document.activeElement
      const inInput =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement ||
        (active instanceof HTMLElement && active.isContentEditable)

      const anyModalOpen = paymentOpen || clearConfirmOpen || trocasOpen || editAtalhosOpen || helpOpen || clientePickerOpen || f4QtdOpen || vendaEsperaOpen || recebimentoOpen || postSalePrintOpen || showItemAvulsoModal || servicoPrecoTarget !== null || accessoryTarget !== null

      // END — toggle help overlay (always works)
      if (e.key === "End") {
        e.preventDefault()
        setHelpOpen((o) => !o)
        return
      }

      // DEL — cancelar item selecionado ou último (não em input, não em modal)
      if (e.key === "Delete" && !inInput && !anyModalOpen) {
        if (cart.length > 0) {
          e.preventDefault()
          if (selectedLineId) {
            const line = cart.find((l) => l.lineId === selectedLineId)
            if (line) {
              appendAuditLog({ action: "pdv_item_removido", userLabel: cashierId.slice(0, 8), detail: `${line.title} (qty: ${line.qty})` })
              setCart((prev) => prev.filter((l) => l.lineId !== selectedLineId))
              setSelectedLineId(null)
            }
          } else {
            const line = cart[cart.length - 1]
            if (line) {
              appendAuditLog({ action: "pdv_item_removido", userLabel: cashierId.slice(0, 8), detail: `${line.title} (qty: ${line.qty})` })
            }
            setCart((prev) => prev.slice(0, -1))
          }
          queueMicrotask(() => inputRef.current?.focus())
        }
        return
      }

      // ↑↓ — navegar carrinho | Enter — abrir F4 na linha selecionada
      if (!inInput && !anyModalOpen && cart.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault()
          setSelectedLineId((prev) => {
            const idx = cart.findIndex((l) => l.lineId === prev)
            if (idx === -1 || idx === cart.length - 1) return cart[0]!.lineId
            return cart[idx + 1]!.lineId
          })
          return
        }
        if (e.key === "ArrowUp") {
          e.preventDefault()
          setSelectedLineId((prev) => {
            const idx = cart.findIndex((l) => l.lineId === prev)
            if (idx <= 0) return cart[cart.length - 1]!.lineId
            return cart[idx - 1]!.lineId
          })
          return
        }
        if (e.key === "Enter" && selectedLineId) {
          e.preventDefault()
          const target = cart.find((l) => l.lineId === selectedLineId)
          if (target) {
            setF4LineId(target.lineId)
            setF4QtdValue(String(target.qty))
            setF4QtdOpen(true)
          }
          return
        }
      }

      // INSERT — Item Avulso (venda de balcão sem cadastro). Tratado ANTES do guard
      // de F_KEYS abaixo: senão o early-return em "Insert ∉ F_KEYS" matava esse
      // caminho e o `case "Insert"` ficava inalcançável.
      //
      // Consistência com Clássico/Supermercado (todos os 3 PDVs respondem ao INSERT):
      // INSERT abre Item Avulso SEMPRE que não há modal aberto, independente de qual
      // campo está focado. Antes bloqueava em inputs ≠ busca, o que tornava o atalho
      // dependente do foco ("às vezes funciona, às vezes não"). INSERT não digita
      // caractere, então abrir o avulso a partir de qualquer campo é seguro.
      // Limpa a busca se ela estava focada (evita texto residual após o avulso).
      if (e.key === "Insert") {
        if (anyModalOpen) return
        e.preventDefault()
        if (active === inputRef.current) setSearch("")
        setShowItemAvulsoModal(true)
        return
      }

      const F_KEYS = ["F1","F2","F3","F4","F5","F6","F7","F8","F9","F10","F11","F12"]
      if (!F_KEYS.includes(e.key)) return
      e.preventDefault()

      // F2 / F3 funcionam mesmo com modais não-bloqueantes abertos
      if (anyModalOpen && e.key !== "F2" && e.key !== "F3") return

      switch (e.key) {
        case "F1": {
          const m = payMethods.find((p) => p.id === "dinheiro") ?? payMethods[0]
          if (m) openPaymentModal(m.id)
          break
        }
        case "F2":  setClientePickerOpen((o) => !o); break
        case "F3":  inputRef.current?.focus(); break
        case "F4":
          if (cart.length > 0) {
            const target = cart.find((l) => l.lineId === selectedLineId) ?? cart[cart.length - 1]!
            setF4LineId(target.lineId)
            setF4QtdValue(String(target.qty))
            setF4QtdOpen(true)
          }
          break
        case "F5":
          if (!inInput && cart.length > 0) {
            if (selectedLineId) {
              const line = cart.find((l) => l.lineId === selectedLineId)
              if (line) appendAuditLog({ action: "pdv_item_removido", userLabel: cashierId.slice(0, 8), detail: `${line.title} (qty: ${line.qty})` })
              setCart((prev) => prev.filter((l) => l.lineId !== selectedLineId))
              setSelectedLineId(null)
            } else {
              const line = cart[cart.length - 1]
              if (line) appendAuditLog({ action: "pdv_item_removido", userLabel: cashierId.slice(0, 8), detail: `${line.title} (qty: ${line.qty})` })
              setCart((prev) => prev.slice(0, -1))
            }
            queueMicrotask(() => inputRef.current?.focus())
          }
          break
        case "F6":
          if (!inInput && cart.length > 0) {
            if (selectedLineId) {
              const line = cart.find((l) => l.lineId === selectedLineId)
              if (line) appendAuditLog({ action: "pdv_item_removido", userLabel: cashierId.slice(0, 8), detail: `${line.title} (qty: ${line.qty})` })
              setCart((prev) => prev.filter((l) => l.lineId !== selectedLineId))
              setSelectedLineId(null)
            } else {
              const line = cart[cart.length - 1]
              if (line) appendAuditLog({ action: "pdv_item_removido", userLabel: cashierId.slice(0, 8), detail: `${line.title} (qty: ${line.qty})` })
              setCart((prev) => prev.slice(0, -1))
            }
            queueMicrotask(() => inputRef.current?.focus())
          }
          break
        case "F7":
          setVendaEsperaOpen(true)
          break
        case "F8":
          appendAuditLog({ action: "pdv_troca_aberta", userLabel: cashierId.slice(0, 8), detail: "Painel de trocas/devoluções aberto via F8" })
          setTrocasOpen(true)
          break
        case "F9":
          // Convergência operacional com Clássico/Supermercado e keymap canônico:
          // F9 abre o Recebimento de Contas a Receber. "Limpar carrinho" migrou para Ctrl+L.
          setRecebimentoOpen(true)
          break
        case "F10":
          // Desconto agora vive no modal de pagamento compartilhado (campos R$/%
          // no topo). F10 abre o modal em estado neutro para aplicar o desconto.
          if (!isModoRapido) {
            if (cart.length > 0 && caixa.isOpen) {
              openPaymentModal()
            } else {
              toast({ title: "F10 — Desconto", description: "Abra o caixa e adicione itens; o desconto fica no modal de pagamento." })
            }
          } else {
            toast({ title: "F10 — Desconto", description: "Disponível no modo padrão." })
          }
          break
        case "F11":
          if (!document.fullscreenElement) {
            void document.documentElement.requestFullscreen().catch(() => {})
          } else {
            void document.exitFullscreen().catch(() => {})
          }
          break
        case "F12":
          if (payMethods.some((p) => p.id === "multiplo")) openPaymentModal("multiplo")
          break
        // INSERT é tratado ANTES do guard F_KEYS acima (caso contrário ficaria
        // inalcançável). Mantemos o switch só com as F-keys reais.
      }
    }
    window.addEventListener("keydown", onKeyDown, { capture: true })
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true } as EventListenerOptions)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, selectedLineId, isModoRapido, paymentOpen, clearConfirmOpen, trocasOpen, editAtalhosOpen, helpOpen, clientePickerOpen, f4QtdOpen, recebimentoOpen, vendaEsperaOpen, postSalePrintOpen, showItemAvulsoModal, servicoPrecoTarget, accessoryTarget])

  // ── Cart actions ────────────────────────────────────────────────────────────────
  const addItem = (item: PdvCatalogProduct, priceOverride?: number) => {
    const svcMeta = servicoMetaById.get(item.id)
    // Atalhos entram com o preço atual do catálogo; override só existe ao editar a linha.
    const effectivePrice = priceOverride !== undefined ? priceOverride : item.price
    // Serviço real precisa de preço > 0. Via modal de preço manual isso já foi
    // validado; guarda defensiva para o caminho direto.
    if (svcMeta && !(effectivePrice > 0)) {
      toast({
        title: "Serviço sem preço",
        description: "Informe um preço de venda para adicionar este serviço.",
        variant: "destructive",
      })
      return
    }
    const isService = isServicoCatalogItem(item)
    if (!isService && item.stock < 999) {
      const reserved = cartQtyByInventoryId[item.id] ?? 0
      if (reserved >= item.stock) {
        toast({
          title: "Estoque insuficiente",
          description: `"${item.name}" não tem mais unidades disponíveis (${item.stock} em estoque, ${reserved} no carrinho).`,
          variant: "destructive",
        })
        return
      }
    }
    // Acessório configurado (modelo/cor): intercepta ANTES da mutação do carrinho.
    // Serviços e itens virtuais nunca abrem o modal.
    if (!svcMeta && !isService && accessoryConfigRequiresSelection(item.accessoryConfig)) {
      setAccessoryTarget({
        item,
        ...(priceOverride !== undefined ? { priceOverride } : {}),
      })
      return
    }
    appendAuditLog({
      action: "pdv_item_adicionado",
      userLabel: cashierId.slice(0, 8),
      detail: `${item.name} — ${brl(effectivePrice)}`,
    })
    let flashId: string | null = null
    setCart((prev) => {
      // `!l.cartLineKey`: linha de acessório (modelo/cor) nunca é alvo do merge legado.
      const hit = prev.find((l) => l.inventoryId === item.id && Math.abs(l.price - effectivePrice) < 0.001 && !l.cartLineKey)
      if (hit) {
        flashId = hit.lineId
        return prev.map((l) => (l.lineId === hit.lineId ? { ...l, qty: l.qty + 1 } : l))
      }
      const nid = newLineId()
      flashId = nid
      return [
        ...prev,
        svcMeta
          ? buildServicoCartLine(svcMeta, nid, effectivePrice)
          : {
              lineId: nid,
              inventoryId: item.id,
              title: item.name,
              price: effectivePrice,
              qty: 1,
              itemType: "produto" as const,
            },
      ]
    })
    if (isModoRapido && flashId) {
      setRapidoFlashLineId(flashId)
      window.setTimeout(() => setRapidoFlashLineId((h) => (h === flashId ? null : h)), 150)
      playPdvRapidoItemBeepIfEnabled()
    }
    // Limpa a busca após adicionar em QUALQUER modo (clique no resultado, Enter ou scan):
    // mantém o scan contínuo sem o operador apagar o termo. (GOAL limpeza pós-ação)
    setSearch("")
    queueMicrotask(() => {
      inputRef.current?.focus()
      if (isModoRapido) {
        window.requestAnimationFrame(() => inputRef.current?.focus())
      }
    })
  }

  /**
   * Confirmação do modal "Configurar acessório": mesma combinação
   * produto+modelo+cor (e mesmo preço) incrementa a linha; combinação nova vira
   * linha separada. O estoque segue agregado pelo produto real (`inventoryId`),
   * somando todas as linhas/seleções. Retorna `false` para manter o modal aberto.
   */
  const confirmAccessorySelection = (line: AccessoryCartLineSnapshot): boolean => {
    const target = accessoryTarget
    if (!target) return false
    const { item } = target
    const effectivePrice = target.priceOverride !== undefined ? target.priceOverride : item.price
    if (item.stock < 999) {
      const reserved = cartQtyByInventoryId[item.id] ?? 0
      if (reserved >= item.stock) {
        toast({
          title: "Estoque insuficiente",
          description: `"${item.name}" não tem mais unidades disponíveis (${item.stock} em estoque, ${reserved} no carrinho).`,
          variant: "destructive",
        })
        return false
      }
    }
    appendAuditLog({
      action: "pdv_item_adicionado",
      userLabel: cashierId.slice(0, 8),
      detail: `${line.lineDescription} — ${brl(effectivePrice)}`,
    })
    let flashId: string | null = null
    setCart((prev) => {
      const hit = prev.find(
        (l) =>
          l.inventoryId === item.id &&
          Math.abs(l.price - effectivePrice) < 0.001 &&
          sameAccessoryCartLine(l.cartLineKey, line.cartLineKey),
      )
      if (hit) {
        flashId = hit.lineId
        return prev.map((l) => (l.lineId === hit.lineId ? { ...l, qty: l.qty + 1 } : l))
      }
      const nid = newLineId()
      flashId = nid
      return [
        ...prev,
        {
          lineId: nid,
          inventoryId: item.id,
          title: line.lineDescription,
          price: effectivePrice,
          qty: 1,
          itemType: "produto" as const,
          accessorySelection: line.selection,
          cartLineKey: line.cartLineKey,
        },
      ]
    })
    if (isModoRapido && flashId) {
      setRapidoFlashLineId(flashId)
      window.setTimeout(() => setRapidoFlashLineId((h) => (h === flashId ? null : h)), 150)
      playPdvRapidoItemBeepIfEnabled()
    }
    setSearch("")
    setAccessoryTarget(null)
    queueMicrotask(() => inputRef.current?.focus())
    return true
  }

  // ── Preço manual de serviço real (Fase 2) ───────────────────────────────────
  // Serviço real abre um modal leve p/ confirmar/editar o preço antes de entrar
  // no carrinho; e permite ajustar o preço da linha de serviço já adicionada.
  const openServicoPreco = (item: PdvServicoCatalogItem) => {
    setServicoPrecoInput(item.price > 0 ? precoParaInput(item.price) : "")
    setServicoPrecoTarget({ kind: "add", item })
  }
  const openServicoPrecoEdit = (l: CartLine) => {
    setServicoPrecoInput(precoParaInput(l.price))
    setServicoPrecoTarget({ kind: "edit", lineId: l.lineId, title: l.title })
  }
  const closeServicoPreco = () => {
    setServicoPrecoTarget(null)
    setServicoPrecoInput("")
    queueMicrotask(() => inputRef.current?.focus())
  }
  const confirmServicoPreco = () => {
    const target = servicoPrecoTarget
    if (!target) return
    const preco = parsePrecoManual(servicoPrecoInput)
    if (!(preco > 0)) {
      toast({
        title: "Preço inválido",
        description:
          target.kind === "add"
            ? "Informe um preço de venda para adicionar este serviço."
            : "Informe um preço de venda válido para este serviço.",
        variant: "destructive",
      })
      return // mantém o modal aberto para correção
    }
    if (target.kind === "add") {
      addItem(target.item, preco)
    } else {
      const lineId = target.lineId
      setCart((prev) => prev.map((l) => (l.lineId === lineId ? { ...l, price: preco } : l)))
    }
    closeServicoPreco()
  }

  const changeQty = (id: string, delta: number) => {
    if (delta > 0) {
      const line = cart.find((l) => l.lineId === id)
      if (line) {
        const product = realCatalog.find((p) => p.id === line.inventoryId)
        if (product && product.stock < 999) {
          const reserved = cartQtyByInventoryId[line.inventoryId] ?? 0
          if (reserved >= product.stock) {
            toast({
              title: "Estoque insuficiente",
              description: `"${line.title}" não tem mais unidades disponíveis.`,
              variant: "destructive",
            })
            return
          }
        }
      }
    }
    setCart((prev) =>
      prev
        .map((l) => (l.lineId === id ? { ...l, qty: Math.max(0, l.qty + delta) } : l))
        .filter((l) => l.qty > 0),
    )
  }

  const removeLine = (id: string) => {
    const line = cart.find((l) => l.lineId === id)
    if (line) {
      appendAuditLog({ action: "pdv_item_removido", userLabel: cashierId.slice(0, 8), detail: `${line.title} (qty: ${line.qty})` })
    }
    setCart((prev) => prev.filter((l) => l.lineId !== id))
  }

  // ── Payment confirm ────────────────────────────────────────────────────────────
  const handlePaymentConfirm = async (
    payments: PaymentMethod[],
    meta?: { cashierId?: string; discountAuthorizedByAdminId?: string; discountReais?: number; discountPercent?: number; pixQrKind?: string; cashTendered?: number },
  ) => {
    if (cart.length === 0 || discountOverTotal) return

    // Reduz as formas do modal compartilhado para o breakdown do motor (mesma regra
    // de Clássico/Supermercado/Venda Completa/Black — sem duplicar lógica).
    let dinheiro = 0, pix = 0, cartaoDebito = 0, cartaoCredito = 0, carne = 0, aPrazo = 0, creditoVale = 0
    let aPrazoConfig: import("@/lib/operations-sale-types").APrazoConfig | undefined
    for (const p of payments) {
      if (p.type === "dinheiro") dinheiro += p.value
      else if (p.type === "pix") pix += p.value
      else if (p.type === "cartao_debito") cartaoDebito += p.value
      else if (p.type === "cartao_credito") cartaoCredito += p.value
      else if (p.type === "carne") carne += p.value
      else if (p.type === "a_prazo") { aPrazo += p.value; if (p.aPrazoConfig) aPrazoConfig = p.aPrazoConfig }
      else if (p.type === "credito_vale") creditoVale += p.value
    }

    // Capturar dados de impressão ANTES de limpar o cart
    const _nomeFantasia = (empresaDocumentos?.nomeFantasia || "").trim() || "Loja"
    const _cnpj = (empresaDocumentos?.cnpj || "").trim()
    const _footer = resolveCupomRodape(impressaoConfig, undefined)
    const _printInput: PdvReceiptInput = {
      nomeFantasia: _nomeFantasia,
      cnpj: _cnpj,
      enderecoLinha: getEnderecoDocumentos?.() ?? "",
      receiptFooter: _footer,
      operador: operatorLabel,
      clienteNome: customerName.trim() || undefined,
      clienteCpf: selectedClienteDoc ?? undefined,
      pagamentos: buildPagamentosResumo({
        dinheiro,
        pix,
        cartaoDebito,
        cartaoCredito,
        aPrazo,
        creditoVale,
      }),
      itens: cart.map((l) => ({ name: l.title, quantity: l.qty, unitPrice: l.price, lineTotal: l.price * l.qty })),
      subtotal,
      taxes: impostoEstimado,
      discount: desconto,
      total,
      dataHora: new Date().toLocaleString("pt-BR"),
    }
    const _hadItems = cart.length > 0

    const result = await finalizeSaleTransaction({
      lines: cart.map((l) => ({
        inventoryId: l.inventoryId,
        quantity: l.qty,
        name: l.title,
        unitPrice: l.price,
        itemType: l.itemType,
        ...(l.itemType === "avulso" ? { isAvulso: true as const } : {}),
        ...(l.custoUnitario !== undefined ? { custoUnitario: l.custoUnitario } : {}),
        ...(l.accessorySelection ? { accessorySelection: l.accessorySelection } : {}),
        ...(l.itemType === "servico"
          ? {
              serviceId: l.serviceId,
              serviceCategory: l.serviceCategory,
              warrantyDays: l.warrantyDays,
              serviceTerms: l.serviceTerms,
            }
          : {}),
      })),
      total,
      paymentBreakdown: {
        dinheiro,
        pix,
        cartaoDebito,
        cartaoCredito,
        carne,
        aPrazo,
        creditoVale,
      },
      customerName: customerName.trim() || undefined,
      customerCpf: selectedClienteDoc ?? undefined,
      clienteId: selectedClienteId ?? undefined,
      openCaixaIfClosed: false,
      auditMeta: {
        cashierId,
        discountReais: discountType === "reais" ? discountReais : desconto,
        discountPercent: discountType === "percent" ? discountPercent : (subtotal > 0 ? (desconto / subtotal) * 100 : 0),
        discountAuthorizedByAdminId: meta?.discountAuthorizedByAdminId,
      },
      aPrazoConfig,
      pixQrKind: meta?.pixQrKind,
      cashTendered: meta?.cashTendered,
    })

    if (!result.ok) {
      toast({ title: "Falha ao finalizar", description: result.reason, variant: "destructive" })
      return
    }
    _printInput.numeroVenda = displaySaleNumber(result.saleId, result.pending)
    // Saldo à prazo → Conta a Receber (cache local; o servidor é a fonte da verdade).
    if (aPrazo > 0.02 && (customerName.trim() || selectedClienteId) && !result.pending) {
      appendContaReceberTituloPdvAprazo({
        lojaId: storeIdKey,
        saleId: result.saleId,
        clienteNome: customerName.trim() || "Cliente",
        valor: aPrazo,
        aPrazoConfig,
      })
    }
    // Fila "Produtos a cadastrar": registra os itens avulsos vendidos para revisão posterior.
    // Não toca estoque/venda/caixa e nunca lança (não pode afetar a venda já concluída).
    try {
      const avulsosVendidos = cart.filter((l) => l.isAvulso)
      if (avulsosVendidos.length > 0) {
        enfileirarProdutosACadastrar(
          storeIdKey,
          construirProdutosACadastrar({
            storeId: storeIdKey,
            vendaId: result.saleId,
            operador: operatorLabel,
            itens: avulsosVendidos.map((l) => ({
              lineId: l.lineId,
              nome: l.title,
              codigo: l.codigoAvulso,
              precoVenda: l.price,
              custo: l.custoUnitario,
              quantidade: l.qty,
            })),
          })
        )
      }
    } catch {
      /* fila é auxiliar — não interrompe o pós-venda */
    }

    // Venda real concluída — limpa carrinho e persistência.
    paymentDiscountSnapshotRef.current = null
    try { localStorage.removeItem(CART_STORAGE_KEY(storeIdKey)) } catch { /* ignore */ }
    setCart([])
    setSearch("") // limpa termo + resultados de busca após finalizar (GOAL limpeza pós-ação)
    resetDiscountState()
    setCustomerName("")
    setSelectedClienteId(null)
    setSelectedClienteDoc(null)
    setClienteQuery("")
    setSelectedLineId(null)
    setRapidoFlashLineId(null)
    setRapidoPickIdx(0)
    closePaymentModal(false)
    toast({ title: "Venda finalizada", description: result.saleId, duration: 4000 })

    // Pós-venda: impressão automática ou popup de oferta
    if (impressaoConfig.imprimirAutomatico && _hadItems) {
      void printPdvSaleReceipt({ config: impressaoConfig, receiptFooter: _footer, input: _printInput })
    } else if (_hadItems) {
      setPostSalePrintInput(_printInput)
      setPostSalePrintOpen(true)
    }

    queueMicrotask(() => {
      inputRef.current?.focus()
      if (isModoRapido) {
        window.requestAnimationFrame(() => inputRef.current?.focus())
      }
    })
  }

  useEffect(() => {
    if (!isModoRapido) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return
      if (paymentOpen || clearConfirmOpen || trocasOpen || editAtalhosOpen || helpOpen || clientePickerOpen || f4QtdOpen || servicoPrecoTarget !== null || accessoryTarget !== null) return
      if (cart.length === 0) return
      e.preventDefault()
      e.stopPropagation()
      setCart((prev) => prev.slice(0, -1))
      queueMicrotask(() => {
        inputRef.current?.focus()
        window.requestAnimationFrame(() => inputRef.current?.focus())
      })
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [isModoRapido, paymentOpen, clearConfirmOpen, trocasOpen, editAtalhosOpen, helpOpen, clientePickerOpen, f4QtdOpen, servicoPrecoTarget, accessoryTarget, cart.length])

  // ─── Venda em espera ────────────────────────────────────────────────────────

  const terminalIdForHold = readSelectedTerminal(storeIdKey)?.id ?? "default"
  const heldSales = getHeldSales(storeIdKey, terminalIdForHold)

  function handleHoldSale() {
    const held: HeldSale = {
      id: newHoldId(),
      label: nextHoldLabel(heldSales),
      savedAt: new Date().toISOString(),
      // CartLine.title → HeldCartItem.name ; CartLine.qty → HeldCartItem.quantity
      items: cart.map((l) => ({
        lineId: l.lineId,
        inventoryId: l.inventoryId,
        name: l.title,
        price: l.price,
        quantity: l.qty,
        itemType: l.itemType,
        isAvulso: l.isAvulso,
        accessorySelection: l.accessorySelection,
        cartLineKey: l.cartLineKey,
        custoUnitario: l.custoUnitario,
        codigoAvulso: l.codigoAvulso,
        serviceId: l.serviceId,
        serviceCategory: l.serviceCategory,
        warrantyDays: l.warrantyDays,
        serviceTerms: l.serviceTerms,
      })),
      customer: selectedClienteId
        ? { id: selectedClienteId, name: customerName, cpf: selectedClienteDoc ?? undefined }
        : null,
      discountReais,
      discountPercent,
      pdvType: "assistencia",
    }
    saveHeldSale(storeIdKey, terminalIdForHold, held)
    setCart([])
    setCustomerName("")
    setSelectedClienteId(null)
    setSelectedClienteDoc(null)
    setDiscountReais(0)
    setDiscountPercent(0)
    toast({ title: "Venda em espera", description: `${held.label} guardada.` })
  }

  function handleResumeSale(sale: HeldSale) {
    // HeldCartItem.name → CartLine.title ; HeldCartItem.quantity → CartLine.qty
    setCart(
      sale.items.map((i) => ({
        lineId: i.lineId,
        inventoryId: i.inventoryId,
        title: i.name,
        price: i.price,
        qty: i.quantity,
        itemType: resolveSaleLineItemType(i) as CartLine["itemType"],
        isAvulso: resolveSaleLineItemType(i) === "avulso" ? true : i.isAvulso,
        accessorySelection: i.accessorySelection,
        cartLineKey: i.cartLineKey,
        custoUnitario: i.custoUnitario,
        codigoAvulso: i.codigoAvulso,
        serviceId: i.serviceId,
        serviceCategory: i.serviceCategory,
        warrantyDays: i.warrantyDays,
        serviceTerms: i.serviceTerms,
      })),
    )
    if (sale.customer) {
      setCustomerName(sale.customer.name)
      setSelectedClienteId(sale.customer.id)
      setSelectedClienteDoc(sale.customer.cpf ?? null)
    }
    setDiscountReais(sale.discountReais ?? 0)
    setDiscountPercent(sale.discountPercent ?? 0)
    removeHeldSale(storeIdKey, terminalIdForHold, sale.id)
  }

  function handleDiscardHeldSale(id: string) {
    removeHeldSale(storeIdKey, terminalIdForHold, id)
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  const modoRapido = isModoRapido === true

  return (
    <div className="relative flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-background text-foreground">
      {!modoRapido ? (
        <>
          <div className="pointer-events-none absolute -left-[10%] -top-[10%] h-[35%] w-[35%] rounded-full bg-primary/8 blur-[120px]" />
          <div className="pointer-events-none absolute -bottom-[10%] -right-[10%] h-[30%] w-[30%] rounded-full bg-primary/5 blur-[100px]" />
        </>
      ) : null}

      {/* ── Header: fluxo normal (evita recorte com position absolute + padding no body) ── */}
      <header
        className={cn(
          "relative z-10 flex shrink-0 items-center justify-between gap-2 border-b border-border bg-card/80 px-3 py-2 backdrop-blur-xl sm:px-4",
          modoRapido ? "min-h-11" : "min-h-14"
        )}
      >
        {/* Left: brand */}
        <div className="flex shrink-0 items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-primary text-primary-foreground shadow-md">
            <Wrench className="h-4 w-4" />
          </span>
          {!modoRapido ? (
            <div className="hidden leading-tight sm:block">
              <p className="text-sm font-bold tracking-tight text-foreground">OmniGestão PDV</p>
              <p className="text-[10px] text-muted-foreground">Assistência Técnica</p>
          </div>
          ) : null}
        </div>

        {/* Center: control buttons */}
        <div className="flex flex-1 items-center justify-center gap-2">
          {!modoRapido ? (
            <button
              type="button"
              onClick={() => {
                appendAuditLog({ action: "pdv_troca_aberta", userLabel: cashierId.slice(0, 8), detail: "Painel de trocas/devoluções aberto" })
                setTrocasOpen(true)
              }}
              className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-all hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Trocas
            </button>
          ) : null}
          {/* Cart summary chip — visible when cart has items */}
          {cart.length > 0 && (
            <div className="hidden items-center gap-1.5 rounded-xl border border-border bg-card px-2.5 py-1.5 sm:flex">
              <ShoppingCart className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs tabular-nums text-muted-foreground">
                <span className="font-bold text-foreground">{cart.length}</span>
                {" item"}{cart.length !== 1 ? "ns" : ""}{" · "}
                <span className="font-bold text-emerald-500">{brl(total)}</span>
              </span>
            </div>
          )}
        </div>

        {/* Right: caixa status + operator + clock */}
        <div className="flex shrink-0 items-center gap-2">
          {/* Caixa status indicator */}
          <div className={cn(
            "hidden items-center gap-1.5 rounded-xl border px-2.5 py-1.5 sm:flex",
            caixa.isOpen
              ? "border-emerald-500/30 bg-emerald-500/8"
              : "border-amber-500/30 bg-amber-500/8"
          )}>
            {caixa.isOpen
              ? <Unlock className="h-3.5 w-3.5 text-emerald-500" />
              : <Lock className="h-3.5 w-3.5 text-amber-500" />
            }
            <span className={cn(
              "text-xs font-semibold",
              caixa.isOpen ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
            )}>
              {caixa.isOpen ? "Aberto" : "Fechado"}
            </span>
          </div>
          {!modoRapido ? (
            <div className="hidden items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 sm:flex">
              <User className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                Op: <span className="font-semibold text-foreground">{operatorLabel}</span>
              </span>
            </div>
          ) : null}
          <div className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-2.5 py-1.5 sm:px-3">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold tabular-nums text-foreground">
              {now.toLocaleTimeString("pt-BR", {
                hour: "2-digit",
                minute: "2-digit",
                second: modoRapido ? undefined : "2-digit",
              })}
            </span>
          </div>
        </div>
      </header>

      {/* ── Body: ocupa exatamente o espaço abaixo do header, sem scroll na página ── */}
      <div className="relative z-0 flex min-h-0 w-full flex-1 flex-col overflow-hidden">
        <div className="shrink-0 border-b border-border bg-card/90 backdrop-blur-sm">
          <CaixaStatusBar variant="pdv" />
        </div>

        <div className="flex min-h-0 w-full min-w-0 flex-1 items-stretch overflow-hidden">
        {/* ── Center: search + catalog ── */}
        <main className="flex min-h-0 min-w-0 max-h-full flex-1 flex-col overflow-hidden border-r border-border bg-background">

          {/* Search */}
          <div className="shrink-0 p-4">
            <div className="relative">
              <Barcode className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={inputRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={async (e) => {
                  if (!search.trim()) return
                  if (e.key === "ArrowDown" && modoRapido) {
                    e.preventDefault()
                    setRapidoPickIdx((i) => Math.min(i + 1, Math.max(0, fullSearch.length - 1)))
                    return
                  }
                  if (e.key === "ArrowUp" && modoRapido) {
                    e.preventDefault()
                    setRapidoPickIdx((i) => Math.max(0, i - 1))
                    return
                  }
                  // Enter: adiciona automaticamente quando há 1 resultado (scan exato ou busca que
                  // narrou para 1 produto) OU em modoRapido (seta seleciona, Enter confirma).
                  if (e.key === "Enter" && fullSearch.length > 0) {
                    if (fullSearch.length === 1 || modoRapido) {
                      e.preventDefault()
                      const pick = modoRapido ? (fullSearch[rapidoPickIdx] ?? fullSearch[0]) : fullSearch[0]
                      if (pick) {
                        // addItem já limpa a busca após adicionar (scan contínuo em qualquer modo).
                        addItem(pick)
                      }
                    }
                    return
                  }
                  // Enter sem resultado local → busca autoritativa no catálogo INTEIRO da loja
                  // (snapshot pode estar defasado ou o item não veio na página carregada).
                  if (e.key === "Enter" && fullSearch.length === 0) {
                    e.preventDefault()
                    const code = search.trim()
                    const remote = await lookupPdvScanRemote({ code, storeId: (lojaAtivaId ?? "").trim(), setInventory })
                    if (remote.kind === "single") {
                      addItem(remote.product)
                      return
                    }
                    if (remote.kind === "multiple") {
                      // itens injetados no estoque — fullSearch recomputa e o operador escolhe na lista.
                      return
                    }
                    toast({
                      title: "Produto não encontrado",
                      description: `Produto não encontrado nesta loja para o código: ${code}`,
                    })
                  }
                }}
                placeholder="Bipe o produto ou busque por nome / código  [F3]"
                autoComplete="off"
                className="h-14 w-full rounded-2xl border border-border bg-card text-base font-medium text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/25"
                style={{ paddingLeft: "3rem", paddingRight: "2.5rem" }}
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : (
                !modoRapido ? (
                  <kbd className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
                    F2
                  </kbd>
                ) : null
              )}
            </div>
            {!modoRapido ? (
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Keyboard className="h-3 w-3" />
                  Atalhos:
                </span>
                {[
                  { key: "F1",  label: "Finalizar" },
                  { key: "F2",  label: "Cliente" },
                  { key: "F3",  label: "Busca" },
                  { key: "F6",  label: "Canc. item" },
                  { key: "F9",  label: "Limpar" },
                  { key: "F10", label: "Desconto" },
                  { key: "F12", label: "Pgto. múltiplo" },
                ].map(({ key, label }) => (
                  <span key={key} className="flex items-center gap-1">
                    <kbd className="rounded border border-border bg-muted px-1 py-px font-bold">{key}</kbd>
                    {label}
                  </span>
                ))}
                <button
                  type="button"
                  onClick={() => setHelpOpen(true)}
                  className="flex items-center gap-1 rounded border border-border bg-muted px-1.5 py-px text-[10px] font-bold text-muted-foreground hover:text-foreground"
                  title="Ver todos os atalhos"
                >
                  <Keyboard className="h-3 w-3" />
                  END Ajuda
                </button>
              </div>
            ) : null}
          </div>

          {/* Grid — scroll só na área da grade */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4">
            {search.trim() ? (
              <div className="flex min-h-0 flex-1 flex-col gap-2">
                <p className="shrink-0 text-xs font-semibold text-muted-foreground">
                  {fullSearch.length} resultado{fullSearch.length !== 1 ? "s" : ""} para &ldquo;{search}&rdquo;
                </p>
                <ScrollArea className="min-h-0 flex-1">
                  <div className="flex flex-col gap-0.5 pr-1">
                    {fullSearch.map((p, idx) => (
                      <QuickRow
                        key={p.id}
                        item={p}
                        onAdd={addItem}
                        isPickHighlight={modoRapido && idx === rapidoPickIdx}
                        reservedQty={cartQtyByInventoryId[p.id] ?? 0}
                      />
                    ))}
                    {fullSearch.length === 0 && (
                      <div className="flex flex-col items-center gap-3 py-12 text-center">
                        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-muted/60 text-muted-foreground/40">
                          <PackageSearch className="h-6 w-6" />
                        </div>
                        <div className="space-y-0.5">
                          <p className="text-sm font-medium text-muted-foreground">
                            Nenhum item encontrado
                          </p>
                          <p className="text-xs text-muted-foreground/70">
                            Tente outro nome, código de barras ou SKU.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </div>
            ) : (
            <Tabs
              value={tab}
              onValueChange={(v) => setTab(v as "servicos" | "produtos" | "favoritos")}
              className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden"
            >
                {/* Tab header + Editar Atalhos */}
                <div className="flex shrink-0 items-center gap-2">
                  <TabsList className={cn("flex-1 grid rounded-2xl border border-border bg-muted/60 p-1", quickFavorites.length > 0 ? "grid-cols-3" : "grid-cols-2")}>
                    <TabsTrigger
                      value="servicos"
                      className="rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                    >
                      Serviços ({quickServices.length})
                    </TabsTrigger>
                    <TabsTrigger
                      value="produtos"
                      className="rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                    >
                      Produtos ({quickProducts.length})
                    </TabsTrigger>
                    {quickFavorites.length > 0 && (
                      <TabsTrigger
                        value="favoritos"
                        className="rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                      >
                        <Star className="mr-1 h-3 w-3 fill-current text-amber-500" />
                        Favoritos ({quickFavorites.length})
                      </TabsTrigger>
                    )}
                  </TabsList>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-10 shrink-0 rounded-xl border-border px-3 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setEditAtalhosOpen(true)}
                    title="Editar Atalhos"
                  >
                    <Settings2 className="mr-1.5 h-3.5 w-3.5" />
                    Editar Atalhos
                  </Button>
                </div>

              <TabsContent
                value="servicos"
                className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden outline-none data-[state=inactive]:hidden"
              >
                  <ScrollArea className="min-h-0 flex-1">
                    <div className="grid gap-3 pr-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {!servicosLoaded || !hydratedFromDb ? (
                        Array.from({ length: 6 }).map((_, i) => (
                          <div key={i} className="h-24 animate-pulse rounded-2xl border border-border bg-muted/40" />
                        ))
                      ) : quickServices.length > 0 ? (
                        quickServices.map((p) => <ServicoCard key={p.id} item={p} onAdd={openServicoPreco} />)
                      ) : (
                        <div className="col-span-full flex flex-col items-center gap-3 py-12 text-center">
                          <p className="text-sm text-muted-foreground">Nenhum atalho de serviço configurado.</p>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="gap-1.5 rounded-xl"
                            onClick={() => setEditAtalhosOpen(true)}
                          >
                            <Zap className="h-3.5 w-3.5" />
                            Adicionar serviço
                          </Button>
                        </div>
                      )}
                    </div>
                </ScrollArea>
              </TabsContent>

              <TabsContent
                value="produtos"
                className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden outline-none data-[state=inactive]:hidden"
              >
                  <ScrollArea className="min-h-0 flex-1">
                    <div className="grid gap-3 pr-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {!hydratedFromDb ? (
                        Array.from({ length: 6 }).map((_, i) => (
                          <div key={i} className="h-24 animate-pulse rounded-2xl border border-border bg-muted/40" />
                        ))
                      ) : quickProducts.length > 0 ? (
                        quickProducts.map((p) => <QuickCard key={p.id} item={p} onAdd={addItem} reservedQty={cartQtyByInventoryId[p.id] ?? 0} />)
                      ) : (
                        <div className="col-span-full flex flex-col items-center gap-3 py-12 text-center">
                          <p className="text-sm text-muted-foreground">Nenhum atalho de produto configurado.</p>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="gap-1.5 rounded-xl"
                            onClick={() => setEditAtalhosOpen(true)}
                          >
                            <Zap className="h-3.5 w-3.5" />
                            Editar Atalhos
                          </Button>
                        </div>
                      )}
                    </div>
                </ScrollArea>
              </TabsContent>

              {quickFavorites.length > 0 && (
                <TabsContent
                  value="favoritos"
                  className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden outline-none data-[state=inactive]:hidden"
                >
                  <ScrollArea className="min-h-0 flex-1">
                    <div className="grid gap-3 pr-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {quickFavorites.map((p) => <QuickCard key={p.id} item={p} onAdd={addItem} reservedQty={cartQtyByInventoryId[p.id] ?? 0} />)}
                    </div>
                  </ScrollArea>
                </TabsContent>
              )}
            </Tabs>
            )}
          </div>
        </main>

        {/* ── Right: customer + cart + payment ── */}
        <aside
          className={cn(
            "flex min-h-0 min-w-0 max-h-full shrink-0 flex-col overflow-hidden border-l border-border bg-card self-stretch",
            modoRapido
              ? "w-[min(100%,400px)] min-w-[260px] max-w-[420px]"
              : "w-[420px] min-w-[360px] max-w-[480px]"
          )}
        >

          {/* Customer input */}
          <div className="shrink-0 border-b border-border px-4 py-3">
            <div className="relative">
              {buscandoCliente ? (
                <Loader2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
              ) : (
                <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              )}
              <input
                ref={customerInputRef}
                value={customerName}
                onChange={(e) => {
                  const v = e.target.value
                  setCustomerName(v)
                  setClienteQuery(v)
                  setSelectedClienteId(null)
                  setSelectedClienteDoc(null)
                  setShowCustomerSidebarDropdown(true)
                }}
                onFocus={() => {
                  if (clienteQuery.trim()) {
                    setShowCustomerSidebarDropdown(true)
                  }
                }}
                onBlur={() => setTimeout(() => setShowCustomerSidebarDropdown(false), 180)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") { setShowCustomerSidebarDropdown(false); setClienteQuery("") }
                  if (e.key === "Enter" && clienteSugestoes.length > 0) {
                    e.preventDefault()
                    const c = clienteSugestoes[0]!
                    setCustomerName(c.name)
                    setSelectedClienteId(c.id)
                    setSelectedClienteDoc(c.document ?? null)
                    setClienteQuery("")
                    setShowCustomerSidebarDropdown(false)
                  }
                }}
                placeholder="Cliente — A Prazo/Fiado  [F2]"
                autoComplete="off"
                className="h-9 w-full rounded-xl border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/25"
                style={{ paddingLeft: "2.25rem", paddingRight: "3.5rem" }}
              />
              {customerName.trim() ? (
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setCustomerName("")
                    setSelectedClienteId(null)
                    setSelectedClienteDoc(null)
                    setClienteQuery("")
                    setShowCustomerSidebarDropdown(false)
                    customerInputRef.current?.focus()
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : (
                <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-border bg-muted px-1.5 py-0.5 text-[9px] font-bold text-muted-foreground">
                  F2
                </kbd>
              )}
              {/* Crédito disponível */}
              {customerCredit > 0 && (
                <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400">
                  <span className="font-semibold">{brl(customerCredit)}</span>
                  <span className="text-muted-foreground">em crédito disponível</span>
                </div>
              )}
              {/* Inline dropdown */}
              {showCustomerSidebarDropdown && (clienteSugestoes.length > 0 || buscandoCliente) && (
                <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-52 overflow-y-auto rounded-md border border-border bg-card shadow-lg">
                  {buscandoCliente && clienteSugestoes.length === 0 ? (
                    <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Buscando…
                    </div>
                  ) : clienteSugestoes.length === 0 ? (
                    <p className="px-4 py-3 text-sm text-muted-foreground">
                      Nenhum resultado. Digite para continuar com nome livre.
                    </p>
                  ) : (
                    <div className="divide-y divide-border">
                      {clienteSugestoes.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-accent"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setCustomerName(c.name)
                            setSelectedClienteId(c.id)
                            setSelectedClienteDoc(c.document ?? null)
                            setClienteQuery("")
                            setShowCustomerSidebarDropdown(false)
                          }}
                        >
                          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                            {c.name.slice(0, 1).toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-foreground">{c.name}</p>
                            <p className="text-[10px] text-muted-foreground">
                              {c.phone ?? ""}
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Cart header */}
          <div className="shrink-0 border-b border-border px-4 py-2.5">
            <div className="flex items-center justify-between">
              <p className="font-bold text-foreground">
                Carrinho
                {cart.length > 0 && (
                  <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                    {cart.length}
                  </span>
                )}
                {selectedLineId && (
                  <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                    F4 selecionado
                  </span>
                )}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-destructive"
                onClick={() => {
                  if (cart.length > 0) setClearConfirmOpen(true)
                }}
                disabled={cart.length === 0}
              >
                Limpar
                <kbd className="rounded border border-border bg-muted px-1 py-0.5 text-[9px] font-bold">
                  F9
                </kbd>
              </Button>
            </div>
          </div>

          {/* Cart lines — scroll só aqui; não estoura a viewport */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {cart.length === 0 ? (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
                <div className="grid h-14 w-14 place-items-center rounded-2xl bg-muted/60 text-muted-foreground/50">
                  <ShoppingCart className="h-7 w-7" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-foreground">Carrinho vazio</p>
                  <p className="text-xs text-muted-foreground">
                    Selecione itens pela grade ou use a busca.
                  </p>
                </div>
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-hidden">
                <ScrollArea className="h-full max-h-full">
                  <div className="divide-y divide-border px-3 py-1">
                  {cart.map((l) => (
                    <div
                      key={l.lineId}
                      onClick={() => setSelectedLineId((prev) => prev === l.lineId ? null : l.lineId)}
                      className={cn(
                        "flex cursor-default select-none items-center gap-2 rounded-lg px-1 py-2.5 -mx-1 transition-colors duration-100",
                        selectedLineId === l.lineId
                          ? "bg-primary/8 ring-1 ring-inset ring-primary/20"
                          : "hover:bg-muted/40",
                        modoRapido && rapidoFlashLineId === l.lineId && "pdv-rapido-row-flash"
                      )}
                    >
                      {/* Title — limited width so controls always show */}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-foreground">{l.title}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{brl(l.price)} × {l.qty}</p>
                        </div>

                      {/* Qty controls — shrink-0 keeps them always visible */}
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => changeQty(l.lineId, -1)}
                          className="grid h-6 w-6 place-items-center rounded-lg border border-border bg-background text-muted-foreground transition hover:border-primary/40 hover:text-primary"
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <span className="w-5 text-center text-xs font-bold tabular-nums text-foreground">
                          {l.qty}
                        </span>
                        <button
                          type="button"
                          onClick={() => changeQty(l.lineId, 1)}
                          className="grid h-6 w-6 place-items-center rounded-lg border border-border bg-background text-muted-foreground transition hover:border-primary/40 hover:text-primary"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>

                      {/* Line total */}
                      <p className="w-20 shrink-0 text-right text-sm font-bold tabular-nums text-foreground">
                        {brl(l.price * l.qty)}
                      </p>

                      {/* Alterar preço — só para linha de serviço real (Fase 2) */}
                      {l.serviceId && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); openServicoPrecoEdit(l) }}
                          aria-label={`Alterar preço de ${l.title}`}
                          title="Alterar preço do serviço"
                          className="shrink-0 grid h-7 w-7 place-items-center rounded-xl border border-border bg-background text-muted-foreground transition hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}

                      {/* Delete — always visible (X) */}
                      <button
                        type="button"
                        onClick={() => removeLine(l.lineId)}
                        aria-label={`Remover ${l.title}`}
                        title="Remover item"
                        className="shrink-0 grid h-7 w-7 place-items-center rounded-xl border border-border bg-background text-muted-foreground transition hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  </div>
                </ScrollArea>
              </div>
            )}
          </div>

          {/* Totals + payment */}
          <div className="shrink-0 space-y-3 border-t border-border bg-card p-4">
            {/* Subtotal & discount */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-semibold tabular-nums text-foreground">{brl(subtotal)}</span>
              </div>
              {!modoRapido && desconto > 0.009 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    Desconto{discountType === "percent" ? ` (${discountPercent}%)` : ""}
                  </span>
                  <span className="font-semibold tabular-nums text-destructive">−{brl(desconto)}</span>
                </div>
              )}
              {impostoEstimado > 0.009 ? (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Imposto estimado</span>
                  <span className="font-semibold tabular-nums text-foreground">{brl(impostoEstimado)}</span>
                </div>
              ) : null}
              {discountOverTotal && desconto > 0.009 && (
                <p className="text-xs text-destructive">Desconto acima do subtotal — ajuste antes de finalizar (F7).</p>
              )}
              <Separator className="bg-border" />
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-semibold text-muted-foreground">TOTAL A PAGAR</span>
                <span className="text-3xl font-black tabular-nums tracking-tight text-emerald-500">
                  {brl(total)}
                </span>
              </div>
            </div>

            {/* Caixa fechado — aviso */}
            {!caixa.isOpen && cart.length > 0 && (
              <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/8 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                <Lock className="h-3.5 w-3.5 shrink-0" />
                Caixa fechado — abra o caixa para finalizar.
              </div>
            )}

            {/* Payment buttons — 3×2 grid */}
            <div className="grid grid-cols-3 gap-2">
              {payMethods.map((m) => (
              <Button
                  key={m.id}
                type="button"
                  disabled={cart.length === 0 || !caixa.isOpen || discountOverTotal}
                  onClick={() => openPaymentModal(m.id)}
                className={cn(
                    "relative rounded-2xl text-xs font-bold text-white",
                    "transition-all duration-150 ease-out",
                    "active:scale-[0.95] active:brightness-90",
                    "disabled:cursor-not-allowed disabled:opacity-30 disabled:shadow-none",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent",
                    modoRapido ? "h-11" : "h-12",
                    m.color,
                  )}
                >
                  <span className="flex flex-col items-center gap-0.5 leading-tight">
                    <span className="flex items-center gap-1">
                      <m.Icon className="h-4 w-4 shrink-0" />
                      <span className="tracking-wide">{m.shortLabel}</span>
                    </span>
                    {m.hotkey && (
                      <span className="rounded border border-white/25 bg-black/25 px-1 py-px text-[9px] font-bold leading-none tracking-widest">
                        {m.hotkey}
                      </span>
                    )}
                  </span>
              </Button>
              ))}
            </div>
          </div>
        </aside>
      </div>
      </div>

      {/* ── Modals ── */}
      {/* Modal de pagamento compartilhado (mesmo motor dos demais PDVs). O desconto
          R$/% vive dentro do modal; mapeamos as mudanças para o discountType da
          Assistência (snapshot/revert preservados via closePaymentModal). */}
      <PaymentModal
        isOpen={paymentOpen}
        twoColumn
        cartSubtotal={subtotal}
        impostoEstimado={impostoEstimado}
        total={total}
        discountReais={discountType === "reais" ? discountReais : 0}
        discountPercent={discountType === "percent" ? discountPercent : 0}
        onDiscountReaisChange={(v) => {
          setDiscountType("reais")
          setDiscountReais(v)
          setDiscountPercent(0)
        }}
        onDiscountPercentChange={(v) => {
          setDiscountType("percent")
          setDiscountPercent(v)
          setDiscountReais(0)
        }}
        selectedCustomer={
          selectedClienteId
            ? { id: selectedClienteId, name: customerName, cpf: (selectedClienteDoc ?? "").trim(), phone: "" }
            : null
        }
        customerStoreCredit={customerCredit}
        cashierId={cashierId}
        instantPayIntent={paymentInstantIntent}
        onInstantPayIntentConsumed={() => setPaymentInstantIntent(null)}
        multipayHint={paymentMultipay}
        onCustomerCpfUpdate={(id, cpf) => {
          if (id === selectedClienteId) setSelectedClienteDoc(cpf)
        }}
        onRequireCustomer={() => setClientePickerOpen(true)}
        onConfirm={handlePaymentConfirm}
        onClose={() => closePaymentModal(true)}
      />

      {/* Clear-cart confirmation */}
      <AlertDialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>
        <AlertDialogContent className="max-w-sm rounded-2xl border-border bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">Cancelar venda atual?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Todos os {cart.length} item{cart.length !== 1 ? "ns" : ""} do carrinho serão removidos. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Manter Venda</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                appendAuditLog({
                  action: "pdv_carrinho_limpo",
                  userLabel: cashierId.slice(0, 8),
                  detail: `${cart.length} item${cart.length !== 1 ? "ns" : ""} removidos do carrinho`,
                })
                try { localStorage.removeItem(CART_STORAGE_KEY(storeIdKey)) } catch { /* ignore */ }
                setCart([])
                setSearch("") // limpa termo + resultados de busca ao cancelar/limpar (GOAL limpeza pós-ação)
                resetDiscountState()
                setSelectedLineId(null)
                setClearConfirmOpen(false)
              }}
            >
              Cancelar Venda
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>


      {/* INSERT — Item Avulso (Venda Avulsa de balcão, não baixa estoque) */}
      <ItemAvulsoModal
        open={showItemAvulsoModal}
        onOpenChange={setShowItemAvulsoModal}
        checkCodigoExistente={(c) => acharProdutoPorCodigoExato(inventory, c)}
        onConfirm={(payload: ItemAvulsoPayload) => {
          const nid = newLineId()
          const inventoryId = avulsoInventoryId(nid)
          const qty = Math.max(1, Math.round(payload.quantity))
          const price = Math.max(0, Math.round(payload.unitPrice * 100) / 100)
          const custoUnitario =
            payload.custoUnitario !== null && payload.custoUnitario >= 0
              ? Math.round(payload.custoUnitario * 100) / 100
              : null
          setCart((prev) => [
            ...prev,
            {
              lineId: nid,
              inventoryId,
              title: payload.description,
              price,
              qty,
              itemType: "avulso",
              isAvulso: true,
              custoUnitario,
              codigoAvulso: payload.codigo,
            },
          ])
          setShowItemAvulsoModal(false)
          appendAuditLog({
            action: "pdv_item_avulso_adicionado",
            userLabel: cashierId.slice(0, 8),
            detail: `${payload.description} · ${qty}x R$ ${price.toFixed(2)}${custoUnitario !== null ? ` · custo R$ ${custoUnitario.toFixed(2)}` : " · custo n/i"}`,
          })
          queueMicrotask(() => inputRef.current?.focus())
        }}
      />

      <SelecionarAcessorioDialog
        open={accessoryTarget !== null}
        product={accessoryTarget?.item ?? null}
        onCancel={() => {
          setAccessoryTarget(null)
          queueMicrotask(() => inputRef.current?.focus())
        }}
        onConfirm={confirmAccessorySelection}
      />

      <VendaEsperaModal
        open={vendaEsperaOpen}
        onOpenChange={setVendaEsperaOpen}
        heldSales={heldSales}
        cartEmpty={cart.length === 0}
        onHold={handleHoldSale}
        onResume={handleResumeSale}
        onDiscard={handleDiscardHeldSale}
      />

      {/* F9 — Recebimento de Contas a Receber (convergência operacional) */}
      <PdvRecebimentoModal
        open={recebimentoOpen}
        onOpenChange={(open) => {
          setRecebimentoOpen(open)
          if (!open) queueMicrotask(() => inputRef.current?.focus())
        }}
        preselectedCustomerName={customerName?.trim() || null}
        formasPagamento={pdvParams.formasPagamento ?? []}
        impressaoConfig={impressaoConfig}
        hotkeyLabel="F9"
      />

      {/* F8 — Troca / Devolução real (reaproveita o fluxo TrocasDevolucao) */}
      <Dialog open={trocasOpen} onOpenChange={(o) => !o && setTrocasOpen(false)}>
        <DialogContent className="max-h-[min(90vh,680px)] w-[min(100vw-2rem,82rem)] sm:max-w-[82rem] border-border bg-card p-0 flex flex-col overflow-hidden">
          <DialogHeader className="border-b border-border px-4 py-3 sm:px-6">
            <DialogTitle className="text-base font-semibold text-foreground flex items-center gap-2">
              <RotateCcw className="h-4 w-4 text-primary" />
              Troca / Devolução
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto min-h-0 p-4 sm:p-6">
            <Suspense fallback={<div className="py-8 text-center text-muted-foreground">Carregando…</div>}>
              <TrocasDevolucao />
            </Suspense>
          </div>
        </DialogContent>
      </Dialog>

      <PdvPostSaleDialog
        open={postSalePrintOpen}
        onOpenChange={(o) => {
          if (!o) { setPostSalePrintOpen(false); setPostSalePrintInput(null) }
        }}
        printInput={postSalePrintInput}
        impressaoConfig={impressaoConfig}
        onAfterClose={() => queueMicrotask(() => inputRef.current?.focus())}
      />

      <HelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />

      {/* F4 — alterar quantidade do item selecionado (ou último) */}
      {(() => {
        const f4Target = cart.find((l) => l.lineId === f4LineId) ?? cart[cart.length - 1] ?? null
        const closeF4 = () => { setF4QtdOpen(false); setF4LineId(null); queueMicrotask(() => inputRef.current?.focus()) }
        const confirmF4 = () => {
          const qty = Math.max(1, Math.round(Number(f4QtdValue) || 1))
          if (f4Target) {
            const product = realCatalog.find((p) => p.id === f4Target.inventoryId)
            if (product && product.stock < 999) {
              const otherReserved = cart
                .filter((l) => l.inventoryId === f4Target.inventoryId && l.lineId !== f4Target.lineId)
                .reduce((s, l) => s + l.qty, 0)
              if (qty + otherReserved > product.stock) {
                toast({
                  title: "Estoque insuficiente",
                  description: `Disponível: ${Math.max(0, product.stock - otherReserved)} unid.`,
                  variant: "destructive",
                })
                return
              }
            }
            setCart((prev) => prev.map((l) => l.lineId === f4Target.lineId ? { ...l, qty } : l))
          }
          closeF4()
        }
        return (
          <Dialog open={f4QtdOpen} onOpenChange={(o) => { if (!o) closeF4() }}>
            <DialogContent className="max-w-xs rounded-2xl border-border bg-card p-0 shadow-lg">
              <DialogHeader className="border-b border-border px-6 py-4">
                <DialogTitle className="flex items-center gap-2 text-sm font-bold text-foreground">
                  <kbd className="rounded border border-border bg-muted px-2 py-0.5 text-[10px] font-bold">F4</kbd>
                  Alterar Quantidade
                </DialogTitle>
              </DialogHeader>
              <div className="px-6 py-4">
                {f4Target && (
                  <p className="mb-3 truncate text-xs font-medium text-muted-foreground">
                    {f4Target.title}
                  </p>
                )}
                <Input
                  ref={f4InputRef}
                  type="number"
                  min="1"
                  step="1"
                  value={f4QtdValue}
                  onChange={(e) => setF4QtdValue(e.target.value)}
                  onFocus={(e) => e.target.select()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); confirmF4() }
                    if (e.key === "Escape") { e.preventDefault(); closeF4() }
                  }}
                  autoFocus
                  className="h-12 rounded-xl text-center text-xl font-bold tabular-nums"
                  inputMode="numeric"
                />
                <p className="mt-2 text-center text-[10px] text-muted-foreground">
                  <kbd className="rounded border border-border bg-muted px-1 font-bold">Enter</kbd> confirmar ·{" "}
                  <kbd className="rounded border border-border bg-muted px-1 font-bold">ESC</kbd> cancelar
                </p>
              </div>
              <DialogFooter className="border-t border-border px-6 py-3">
                <Button variant="outline" size="sm" className="rounded-xl" onClick={closeF4}>
                  Cancelar
                </Button>
                <Button size="sm" className="rounded-xl" onClick={confirmF4}>
                  <Check className="mr-1.5 h-3.5 w-3.5" />
                  Confirmar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )
      })()}

      {/* Serviço — preço manual por linha ao adicionar e editar no carrinho. */}
      <Dialog open={servicoPrecoTarget !== null} onOpenChange={(o) => { if (!o) closeServicoPreco() }}>
        <DialogContent className="max-w-xs rounded-2xl border-border bg-card p-0 shadow-lg">
          <DialogHeader className="border-b border-border px-6 py-4">
            <DialogTitle className="flex items-center gap-2 text-sm font-bold text-foreground">
              <Wrench className="h-4 w-4 text-primary" />
              {servicoPrecoTarget?.kind === "edit" ? "Alterar preço do serviço" : "Preço do serviço"}
            </DialogTitle>
          </DialogHeader>
          <div className="px-6 py-4">
            <p className="mb-1 truncate text-xs font-semibold text-foreground">
              {servicoPrecoTarget?.kind === "add" ? servicoPrecoTarget.item.name : servicoPrecoTarget?.title}
            </p>
            {servicoPrecoTarget?.kind === "add" && (
              <p className="mb-3 text-[10px] text-muted-foreground">
                {servicoPrecoTarget.item.price > 0
                  ? `Preço padrão: ${brl(servicoPrecoTarget.item.price)} — mantenha ou altere.`
                  : "Serviço sem preço padrão — informe o valor de venda."}
              </p>
            )}
            <Label htmlFor="servico-preco-manual" className="text-[10px] text-muted-foreground">
              Preço de venda (R$)
            </Label>
            <Input
              id="servico-preco-manual"
              inputMode="decimal"
              value={servicoPrecoInput}
              onChange={(e) => setServicoPrecoInput(e.target.value)}
              onFocus={(e) => e.target.select()}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); confirmServicoPreco() }
                if (e.key === "Escape") { e.preventDefault(); closeServicoPreco() }
              }}
              autoFocus
              placeholder="0,00"
              className="mt-1 h-12 rounded-xl text-center text-xl font-bold tabular-nums"
            />
            <p className="mt-2 text-center text-[10px] text-muted-foreground">
              <kbd className="rounded border border-border bg-muted px-1 font-bold">Enter</kbd> confirmar ·{" "}
              <kbd className="rounded border border-border bg-muted px-1 font-bold">ESC</kbd> cancelar
            </p>
          </div>
          <DialogFooter className="border-t border-border px-6 py-3">
            <Button variant="outline" size="sm" className="rounded-xl" onClick={closeServicoPreco}>
              Cancelar
            </Button>
            <Button size="sm" className="rounded-xl" onClick={confirmServicoPreco}>
              <Check className="mr-1.5 h-3.5 w-3.5" />
              {servicoPrecoTarget?.kind === "edit" ? "Salvar preço" : "Adicionar serviço"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PdvClientePicker
        open={clientePickerOpen}
        storeId={(lojaAtivaId ?? "").trim()}
        onSelect={(c: PdvClienteResult) => {
          setCustomerName(c.name)
          setSelectedClienteId(c.id)
          setSelectedClienteDoc(c.document ?? null)
          setClientePickerOpen(false)
        }}
        onClose={() => setClientePickerOpen(false)}
      />

      <EditarAtalhosModal
        open={editAtalhosOpen}
        catalog={realCatalog}
        catalogForAdd={realCatalog}
        serviceCatalog={servicosCatalog}
        serviceCatalogReady={servicosLoaded}
        savedAtalhos={localAtalhos}
        onSave={(atalhos) => {
          // Anti-contaminação: só persiste se os atalhos em memória foram hidratados
          // para a unidade ativa atual — evita gravar atalhos de uma loja sob a chave
          // de outra durante uma troca de unidade em andamento.
          if (hydratedShortcutsKeyRef.current !== shortcutsKey) {
            toast({
              title: "Troca de unidade detectada",
              description: "Reabra os atalhos na loja ativa antes de salvar.",
              variant: "destructive",
            })
            return
          }
          setLocalAtalhos(atalhos)
          try { localStorage.setItem(shortcutsKey, JSON.stringify(atalhos)) } catch { /* ignore */ }
          void saveStoreSettings({
            printerConfig: {
              ...blob,
              pdvParams: { ...blob.pdvParams, atalhosRapidos: atalhos },
            },
          }).catch(() => {
            toast({
              title: "Atalhos salvos localmente",
              description: "Não foi possível sincronizar com o servidor.",
              variant: "destructive",
            })
          })
        }}
        onClose={() => setEditAtalhosOpen(false)}
      />
    </div>
  )
}
