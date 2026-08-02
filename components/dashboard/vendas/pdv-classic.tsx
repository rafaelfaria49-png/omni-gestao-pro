"use client"

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { KeyboardEvent as ReactKeyboardEvent } from "react"
import { useRouter } from "next/navigation"
import {
  Search,
  Plus,
  Minus,
  Trash2,
  Barcode,
  CreditCard,
  Banknote,
  QrCode,
  Sparkles,
  ShoppingBag,
  Zap,
  FileText,
  User,
  UserPlus,
  Check,
  X,
  BookUser,
  Keyboard,
  Settings,
  ClipboardList,
  ScanLine,
  LayoutGrid,
  CalendarClock,
  Layers,
  RotateCcw,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { PaymentModal, type PaymentMethodType } from "./payment-modal"
import { PdvClientePicker, type PdvClienteResult } from "./pdv-cliente-picker"
import { PdvRecebimentoModal } from "./pdv-recebimento-modal"
import { useCaixa } from "@/components/dashboard/caixa/caixa-provider"
import { TrocasDevolucao } from "./trocas-devolucao"
import { getOrCreatePdvOperatorId } from "@/lib/pdv-operator-id"
import { useSession } from "next-auth/react"
import { operatorDisplayName } from "@/lib/pdv-operator-label"
import { usePdvOperadorNome } from "@/lib/pdv-operador-nome"
import { CaixaStatusBar } from "../caixa/caixa-status-bar"
import { useGarantirSessaoCaixa } from "../caixa/use-atualizar-caixa"
import { usePdvCartDraft } from "./use-pdv-cart-draft"
import { describeCartDraftIssues } from "@/lib/pdv-cart-draft"
// useCaixa removido no Lote 4 — sangria/suprimento vivem no CaixaStatusBar.
import { configPadrao, useConfigEmpresa } from "@/lib/config-empresa"
import { useLojaAtiva } from "@/lib/loja-ativa"
import { computePdvCartTotals } from "@/lib/pdv-cart-totals"
import {
  getActiveFormasPagamento,
  getFormaMultiplo,
  getFormaPagamentoIcon,
  formaPagamentoOutlineClasses,
  toPaymentMethodType,
} from "@/lib/pdv-formas-pagamento"
import { opsLojaIdFromStorageKey } from "@/lib/ops-loja-id"
import { appendContaReceberTituloPdvAprazo } from "@/lib/pdv-append-conta-receber"
import { cn } from "@/lib/utils"
import { normalizeDocDigits } from "@/lib/cpf"

function formatBrDocDisplay(digitsRaw: string): string {
  const d = normalizeDocDigits(digitsRaw)
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
  if (d.length === 14)
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
  return digitsRaw.trim()
}
import { resolveCupomRodape } from "@/lib/pdv-impressao-config"
import { printPdvSaleReceipt } from "@/lib/pdv-print-runtime"
import { buildPagamentosResumo, type PdvReceiptInput } from "@/lib/escpos"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { useOperationsStore } from "@/lib/operations-store"
import { PDV_KEYMAP } from "@/lib/pdv-keymap"
import { useStoreSettings } from "@/lib/store-settings-provider"
import { writePdvClassicLayout } from "@/lib/pdv-classic-layout"
import { ASSISTEC_LOJA_HEADER } from "@/lib/assistec-headers"
import {
  mergePdvCatalogWithInventory,
  newPdvLineId,
  type PdvCatalogProduct,
} from "@/lib/pdv-catalog"
import { findPdvProductByScan } from "@/lib/pdv-scan-product"
import { lookupPdvScanRemote } from "@/lib/pdv-scan-lookup"
import { playPdvRapidoItemBeepIfEnabled } from "@/lib/pdv-rapido-feedback"
import { PdvOmniClassicShell, type PdvOmniCartRow } from "./pdv-omni-classic-shell"
import { useStudioTheme } from "@/components/theme/ThemeProvider"
import { PDV_IMPORT_COMANDA_KEY, type PdvImportComandaPayload } from "@/lib/pdv-comanda-bridge"
import { AttrProductDialog, WeightProductDialog } from "./pdv-product-dialogs"
import { SelecionarAcessorioDialog } from "./acessorios/selecionar-acessorio-dialog"
import {
  accessoryConfigRequiresSelection,
  sameAccessoryCartLine,
  type AccessoryCartLineSnapshot,
  type AccessorySelectionV1,
} from "@/lib/acessorios/cart-line"
import {
  isWebSerialSupported,
  openScalePort,
  closeScalePort,
  waitForStableWeightKg,
  peekLastWeightKg,
} from "@/services/hardware-bridge"
import { appendAuditLog } from "@/lib/audit-log"
import { AUDIT_DISCOUNT_ALERT_PCT } from "@/lib/audit-constants"
import { formatEntradaRapidaResumo, mergeEntradaRapida } from "@/lib/os-entrada-checklist"
import {
  avulsoInventoryId,
  isAvulsoSaleLine,
  isOsVirtualSaleLine,
  osPecasInventoryId,
  osServicoInventoryId,
} from "@/lib/os-pdv-virtual-lines"
import { ItemAvulsoModal, type ItemAvulsoPayload } from "./item-avulso-modal"
import {
  construirProdutosACadastrar,
  enfileirarProdutosACadastrar,
  acharProdutoPorCodigoExato,
} from "@/lib/pdv-produtos-a-cadastrar"
import { PdvPostSaleDialog } from "./pdv-post-sale-dialog"
import { filterPdvCatalogBySearch } from "@/lib/pdv-product-search"
import { useClienteSearch } from "@/lib/hooks/use-cliente-search"
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

type Customer = {
  id: string
  name: string
  cpf: string
  phone: string
  saldoDevedor?: number
}

type CartItem = {
  lineId: string
  inventoryId: string
  name: string
  price: number
  quantity: number
  complementos?: string[]
  vendaPorPeso?: boolean
  atributosLabel?: string
  /** Resumo checklist entrada (O.S. / serviço). */
  lineDetail?: string
  /** Item avulso (INSERT): não baixa estoque, persistido no payload da venda. */
  isAvulso?: boolean
  /** Custo unitário opcional informado no balcão. `null` = desconhecido. */
  custoUnitario?: number | null
  /** Código de barras/SKU do item avulso → fila "Produtos a cadastrar". */
  codigoAvulso?: string | null
  /** Snapshot da seleção de acessório (modelo/cor). NÃO é variação de estoque. */
  accessorySelection?: AccessorySelectionV1
  /** Chave determinística produto+modelo+cor para agrupar linhas iguais. */
  cartLineKey?: string
}

type Product = PdvCatalogProduct

const PDV_UNCONTROLLED_STOCK_THRESHOLD = 999
const PDV_STOCK_EPSILON = 0.0001

function isServiceCategory(category?: string): boolean {
  return (category ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .startsWith("serv")
}

function hasControlledPdvStock(stock: number | null | undefined, category?: string): boolean {
  const n = Number(stock)
  return Number.isFinite(n) && n < PDV_UNCONTROLLED_STOCK_THRESHOLD && !isServiceCategory(category)
}

function formatPdvStockQty(qty: number, vendaPorPeso?: boolean): string {
  return qty.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: vendaPorPeso ? 3 : 2,
  })
}

/** Categorias que não aparecem na grade até o usuário buscar (filtro inteligente do PDV). */
const PDV_CATEGORIAS_OCULTAS_ATE_BUSCA = new Set(["telas", "baterias", "conectores"])

type PdvUiMode = "default" | "touch" | "scanner"

const PDV_UI_STORAGE_KEY = "assistec-pdv-ui-mode"

type ApiClienteResult = { id: string; name: string; phone?: string | null; email?: string | null; document?: string | null }

export interface VendasPDVProps {
  linkedOsId?: string | null
  onSaleCompleted?: () => void
  /** Item sugerido por comando de voz (adicionado ao carrinho ao montar/atualizar). */
  voiceCartSeed?: { key: number; itemName: string; price?: number } | null
  onVoiceCartSeedConsumed?: () => void
  voiceOpenCaixaSignal?: number
  onVoiceOpenCaixaConsumed?: () => void
  /** Shell visual do PDV. Sempre `omni-smart` em produção (vendas-pdv.tsx).
   *  Mantido como prop opcional para retrocompatibilidade do contrato; o
   *  tipo `default` foi removido no Lote 4 (era código morto). */
  uiShell?: "omni-smart"
  /** Vindo do Vendas HUB (`?modo=rapido`): foco automático no campo de código/produto após o PDV montar. */
  isModoRapido?: boolean
}

export function PdvClassic({
  linkedOsId = null,
  onSaleCompleted,
  voiceCartSeed = null,
  onVoiceCartSeedConsumed,
  voiceOpenCaixaSignal = 0,
  onVoiceOpenCaixaConsumed,
  uiShell = "omni-smart",
  isModoRapido = false,
}: VendasPDVProps) {
  const router = useRouter()
  const { config } = useConfigEmpresa()
  const { empresaDocumentos, getEnderecoDocumentos, lojaAtivaId, opsStorageKey, storesRefreshNonce } =
    useLojaAtiva()
  const { pdvParams, impressaoConfig, settings, storeId } = useStoreSettings()
  const { caixa, sessaoId } = useCaixa()
  const { garantirSessao } = useGarantirSessaoCaixa()
  const { mode: studioThemeMode } = useStudioTheme()
  const classicStudio = studioThemeMode === "classic"
  const lojaKey = lojaAtivaId ?? opsLojaIdFromStorageKey(opsStorageKey)
  // Caixa: apenas leitura do CaixaStatusBar/CaixaProvider via outros consumers.
  // `useCaixa()` legado (adicionarEntrada/Saida/sessaoId) só era usado pelo
  // `saveOperation` removido — fluxo migrado para o CaixaStatusBar compartilhado.
  const { inventory, setInventory, finalizeSaleTransaction, getSaldoCreditoCliente, ordens } = useOperationsStore()
  const cashierId = useMemo(() => getOrCreatePdvOperatorId(), [])
  const { data: session } = useSession()
  const operadorNomeAbertura = usePdvOperadorNome(lojaKey)
  const operatorLabel = operatorDisplayName({ aberturaNome: operadorNomeAbertura, session })
  const { toast } = useToast()
  const [searchTerm, setSearchTerm] = useState("")
  const [customerSearch, setCustomerSearch] = useState("")
  const { clientes: filteredCustomers, isLoading: buscandoCliente } = useClienteSearch(customerSearch, lojaKey)
  const [cart, setCart] = useState<CartItem[]>([])
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [emitirNota, setEmitirNota] = useState(false)
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false)
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false)
  const [pendingOnAccount, setPendingOnAccount] = useState(false)
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false)
  const [discountReais, setDiscountReais] = useState<number>(0)
  const [discountPercent, setDiscountPercent] = useState<number>(0)
  const [instantPayIntent, setInstantPayIntent] = useState<PaymentMethodType | null>(null)
  /** Seletor de cliente (com cadastro rápido) aberto por cima do modal de pagamento (à prazo). */
  const [aPrazoClientePickerOpen, setAPrazoClientePickerOpen] = useState(false)
  /** Convergência operacional: abre o modal compartilhado em modo Pagamento Múltiplo (F12 / botão "Múltiplo"). */
  const [multipayMode, setMultipayMode] = useState(false)
  const [showOperationsMenu, setShowOperationsMenu] = useState(false)
  const [pdvUiMode, setPdvUiMode] = useState<PdvUiMode>("default")
  const [weightDialogOpen, setWeightDialogOpen] = useState(false)
  const [weightProduct, setWeightProduct] = useState<Product | null>(null)
  const [weightKgInput, setWeightKgInput] = useState("")
  const [scaleBusy, setScaleBusy] = useState(false)
  const [attrDialogOpen, setAttrDialogOpen] = useState(false)
  const [attrProduct, setAttrProduct] = useState<Product | null>(null)
  const [attrSelections, setAttrSelections] = useState<Record<string, string>>({})
  // Acessório com modelo/cor: produto aguardando seleção no modal compartilhado.
  const [accessoryProduct, setAccessoryProduct] = useState<Product | null>(null)
  const accessoryQtyRef = useRef(1)
  const [fechamentoCaixaSignal, setFechamentoCaixaSignal] = useState(0)
  const [showDevolucaoModal, setShowDevolucaoModal] = useState(false)
  const [showItemAvulsoModal, setShowItemAvulsoModal] = useState(false)
  const [vendaEsperaOpen, setVendaEsperaOpen] = useState(false)
  const customerInputRef = useRef<HTMLInputElement>(null)
  const productInputRef = useRef<HTMLInputElement>(null)
  const quantityInputRef = useRef<HTMLInputElement>(null)
  const comandaImportDone = useRef(false)
  const linkedOsHydratedRef = useRef<string | null>(null)
  const shellBipeRef = useRef<HTMLInputElement>(null)
  const [bipeCode, setBipeCode] = useState("")
  const [shellNextQty, setShellNextQty] = useState("1")
  const [shellSeller, setShellSeller] = useState("01 — Caixa 1")
  const [shellInfo, setShellInfo] = useState("Sistema pronto. Bipe um produto ou pressione F3 para pesquisar.")
  const [shellHighlightLineId, setShellHighlightLineId] = useState<string | null>(null)
  /** Modo rápido: flash verde ~150ms na linha recém-adicionada. */
  const [rapidoFlashLineId, setRapidoFlashLineId] = useState<string | null>(null)
  const [selectedCartLineId, setSelectedCartLineId] = useState<string | null>(null)
  const [shellProductSearchOpen, setShellProductSearchOpen] = useState(false)
  const [shellClientSearchOpen, setShellClientSearchOpen] = useState(false)
  const [shellQtyEditOpen, setShellQtyEditOpen] = useState(false)
  const [shellCancelSaleOpen, setShellCancelSaleOpen] = useState(false)
  const [shellAdvancedOpen, setShellAdvancedOpen] = useState(false)
  const [shellReceivablesOpen, setShellReceivablesOpen] = useState(false)
  const [lastSaleTotal, setLastSaleTotal] = useState<number | null>(null)
  const [shellCustomerField, setShellCustomerField] = useState("CONSUMIDOR")
  const [customerCreditFetched, setCustomerCreditFetched] = useState<number | null>(null)

  /** Bloqueio do PDV até cadastrar Nome Fantasia (Store.name) da unidade no banco. */
  const [storePdvGate, setStorePdvGate] = useState<{ ready: boolean; block: boolean }>({
    ready: false,
    block: false,
  })
  /** Rodapé do cupom por unidade (StoreSettings). */
  const [pdvReceiptFooter, setPdvReceiptFooter] = useState("")
  const [storeLogoUrl, setStoreLogoUrl] = useState("")
  /** Fluxo pós-venda: oferecer impressão após a venda ser persistida. */
  const [postSalePrintOpen, setPostSalePrintOpen] = useState(false)
  const [postSalePrintInput, setPostSalePrintInput] = useState<PdvReceiptInput | null>(null)

  useEffect(() => {
    const id = (lojaAtivaId || "").trim()
    if (!id) {
      setStorePdvGate({ ready: true, block: false })
      setPdvReceiptFooter("")
      return
    }
    let cancelled = false
    setStorePdvGate({ ready: false, block: false })
    void (async () => {
      try {
        const [rs, rset] = await Promise.all([
          fetch(`/api/stores/${encodeURIComponent(id)}`, { credentials: "include", cache: "no-store" }),
          fetch(`/api/stores/${encodeURIComponent(id)}/settings`, {
            credentials: "include",
            cache: "no-store",
          }),
        ])
        const jStore = (await rs.json().catch(() => null)) as
          | { store?: { name?: string | null; logoUrl?: string | null } | null }
          | null
        const jSet = (await rset.json().catch(() => null)) as
          | { settings?: { receiptFooter?: string | null } | null }
          | null
        if (cancelled) return
        const name = String(jStore?.store?.name ?? "").trim()
        const footerCol = String(jSet?.settings?.receiptFooter ?? "").trim()
        setPdvReceiptFooter(footerCol)
        setStoreLogoUrl(String(jStore?.store?.logoUrl ?? "").trim())
        const block = !jStore?.store || name.length === 0
        setStorePdvGate({ ready: true, block })
      } catch {
        if (!cancelled) setStorePdvGate({ ready: true, block: false })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [lojaAtivaId, storesRefreshNonce])

  const auditUser = () => {
    const nome = (empresaDocumentos.nomeFantasia || "").trim() || "Loja"
    return `${nome || "Administrador"} (sessão local)`
  }
  const formatBrlAudit = (n: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PDV_UI_STORAGE_KEY) as PdvUiMode | null
      if (raw === "touch" || raw === "scanner" || raw === "default") setPdvUiMode(raw)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(PDV_UI_STORAGE_KEY, pdvUiMode)
    } catch {
      /* ignore */
    }
  }, [pdvUiMode])

  useEffect(() => {
    if (pdvUiMode !== "scanner") return
    const t = window.setTimeout(() => productInputRef.current?.focus(), 120)
    return () => window.clearTimeout(t)
  }, [pdvUiMode])

  useEffect(() => {
    if (comandaImportDone.current) return
    try {
      const raw = sessionStorage.getItem(PDV_IMPORT_COMANDA_KEY)
      if (!raw) return
      const data = JSON.parse(raw) as PdvImportComandaPayload
      if (!data?.lines?.length) {
        sessionStorage.removeItem(PDV_IMPORT_COMANDA_KEY)
        return
      }
      sessionStorage.removeItem(PDV_IMPORT_COMANDA_KEY)
      comandaImportDone.current = true
      setCart(
        data.lines.map((line) => ({
          lineId: newPdvLineId(line.inventoryId),
          inventoryId: line.inventoryId,
          name: line.name,
          price: line.price,
          quantity: line.quantity,
          complementos: [],
          vendaPorPeso: line.vendaPorPeso,
          atributosLabel: line.atributosLabel,
        }))
      )
      toast({
        title: "Comanda importada",
        description: data.mesaLabel
          ? `Itens da ${data.mesaLabel} carregados no caixa.`
          : "Itens carregados no caixa.",
      })
    } catch {
      sessionStorage.removeItem(PDV_IMPORT_COMANDA_KEY)
    }
  }, [toast])

  const quickItems = (pdvParams.atalhosRapidos || []).map((a) => ({
    id: a.id,
    name: a.nome,
    price: a.preco,
    stock: 999,
    category: "Atalho",
  }))

  const products = mergePdvCatalogWithInventory([], inventory)

  /** Terminal PDV ativo — isola venda em espera e rascunho do carrinho por caixa físico. */
  const terminalIdForHold = readSelectedTerminal(lojaKey)?.id ?? "default"

  // ── Rascunho do carrinho ────────────────────────────────────────────────────
  // Sobrevive a F5, nova aba, logout/login e reinício do computador. Só some com
  // venda confirmada ou "Limpar carrinho" — nunca por erro de caixa.
  const draftCatalog = useMemo(
    () => inventory.map((i) => ({ id: i.id, name: i.name, price: i.price, stock: i.stock })),
    [inventory]
  )
  const draftCustomer = useMemo(
    () =>
      selectedCustomer
        ? {
            id: selectedCustomer.id,
            name: selectedCustomer.name,
            cpf: selectedCustomer.cpf,
            phone: selectedCustomer.phone,
          }
        : null,
    [selectedCustomer]
  )
  const { clearDraft } = usePdvCartDraft({
    storeId: lojaKey,
    modalidade: "classico",
    terminalId: terminalIdForHold,
    ready: inventory.length > 0,
    catalog: draftCatalog,
    lines: cart,
    customer: draftCustomer,
    discountReais,
    discountPercent,
    caixaSessaoId: sessaoId,
    onRestore: ({ lines, customer, discountReais: dr, discountPercent: dp, issues, sessaoTrocada }) => {
      setCart(
        lines.map((l) => ({
          lineId: l.lineId,
          inventoryId: l.inventoryId,
          name: l.name,
          price: l.price,
          quantity: l.quantity,
          ...(l.complementos ? { complementos: l.complementos } : {}),
          ...(l.vendaPorPeso ? { vendaPorPeso: true } : {}),
          ...(l.atributosLabel ? { atributosLabel: l.atributosLabel } : {}),
          ...(l.lineDetail ? { lineDetail: l.lineDetail } : {}),
          ...(l.isAvulso ? { isAvulso: true } : {}),
          ...(l.custoUnitario !== undefined ? { custoUnitario: l.custoUnitario } : {}),
          ...(l.codigoAvulso !== undefined ? { codigoAvulso: l.codigoAvulso } : {}),
          ...(l.accessorySelection
            ? { accessorySelection: l.accessorySelection as AccessorySelectionV1 }
            : {}),
          ...(l.cartLineKey ? { cartLineKey: l.cartLineKey } : {}),
        }))
      )
      if (customer) {
        setSelectedCustomer({
          id: customer.id ?? "",
          name: customer.name,
          cpf: customer.cpf ?? "",
          phone: customer.phone ?? "",
        })
      }
      setDiscountReais(dr)
      setDiscountPercent(dp)
      const avisos = describeCartDraftIssues(issues)
      toast({
        title: "Carrinho recuperado",
        description: avisos
          ? `${lines.length} item(ns) restaurado(s). ${avisos}.`
          : `${lines.length} item(ns) restaurado(s) da sessão anterior.`,
        ...(avisos ? { variant: "destructive" as const } : {}),
      })
      if (sessaoTrocada) {
        // O carrinho veio de uma sessão de caixa que não é mais a aberta: a venda
        // será registrada na sessão ATUAL e o operador precisa confirmar de novo.
        toast({
          title: "Caixa mudou desde este carrinho",
          description: "A venda será registrada na sessão de caixa aberta agora. Revise antes de finalizar.",
        })
      }
    },
  })

  const searchTrim = searchTerm.trim()
  const hideCategoriesPdv = pdvParams.ocultarCategoriasNoPdv === true
  const hiddenCategoriesSet = useMemo(
    () => new Set((pdvParams.categoriasOcultasNoPdv ?? []).map((c) => c.toLowerCase())),
    [pdvParams.categoriasOcultasNoPdv]
  )

  const filteredProducts = useMemo(() => {
    if (searchTrim.length === 0) {
      return products.filter((p) => {
        const catLower = p.category.toLowerCase()
        if (PDV_CATEGORIAS_OCULTAS_ATE_BUSCA.has(catLower)) return false
        if (hideCategoriesPdv && hiddenCategoriesSet.has(catLower)) return false
        return true
      })
    }
    return filterPdvCatalogBySearch(products, searchTrim)
  }, [products, searchTrim, hideCategoriesPdv, hiddenCategoriesSet])

  const bipeSuggestions = useMemo(() => {
    const t = bipeCode.trim()
    if (!t) return []
    return filterPdvCatalogBySearch(products, t).slice(0, 50)
  }, [bipeCode, products])

  const storeDisplayName = useMemo(() => {
    const n = (empresaDocumentos.nomeFantasia || configPadrao.empresa.nomeFantasia || "Loja").trim()
    return n || "Loja"
  }, [empresaDocumentos.nomeFantasia])

  const shellClientOptions = useMemo(
    () => [{ id: "0", label: "CONSUMIDOR" }, ...filteredCustomers.map((c) => ({ id: c.id, label: `${c.name}${c.phone ? ` — ${c.phone}` : ""}` }))],
    [filteredCustomers]
  )

  const shellCartRows: PdvOmniCartRow[] = useMemo(
    () =>
      cart.map((i) => {
        const inv = inventory.find((x) => x.id === i.inventoryId)
        const code = isAvulsoSaleLine(i.inventoryId)
          ? "AVULSO"
          : isOsVirtualSaleLine(i.inventoryId)
            ? "OS"
            : (inv?.barcode && inv.barcode.trim()) || i.inventoryId
        return {
          lineId: i.lineId,
          code,
          description: i.name,
          detail: i.lineDetail,
          unit: i.vendaPorPeso ? "KG" : "UN",
          unitPrice: i.price,
          qty: i.quantity,
        }
      }),
    [cart, inventory]
  )

  const getCartStockProduct = useCallback(
    (item: CartItem) => {
      if (
        item.isAvulso ||
        item.inventoryId.startsWith("comp-") ||
        isAvulsoSaleLine(item.inventoryId) ||
        isOsVirtualSaleLine(item.inventoryId)
      ) {
        return null
      }
      return products.find((p) => p.id === item.inventoryId) ?? null
    },
    [products]
  )

  const showAggregatedStockToast = useCallback(
    (product: Pick<Product, "name" | "stock" | "vendaPorPeso">, requestedQty: number) => {
      const unit = product.vendaPorPeso ? "kg" : "unidade(s)"
      toast({
        title: "Estoque insuficiente",
        description: `${product.name} possui ${formatPdvStockQty(requestedQty, product.vendaPorPeso)} ${unit} no carrinho e o estoque disponível é ${formatPdvStockQty(product.stock, product.vendaPorPeso)}.`,
        variant: "destructive",
      })
    },
    [toast]
  )

  const validateAggregatedStockForProduct = useCallback(
    (product: Product, quantityForLine: number, excludeLineId?: string) => {
      if (!hasControlledPdvStock(product.stock, product.category)) return true

      const alreadyInCart = cart.reduce((sum, item) => {
        if (item.inventoryId !== product.id || item.lineId === excludeLineId) return sum
        return sum + item.quantity
      }, 0)
      const requestedQty = alreadyInCart + quantityForLine
      if (requestedQty > product.stock + PDV_STOCK_EPSILON) {
        showAggregatedStockToast(product, requestedQty)
        return false
      }
      return true
    },
    [cart, showAggregatedStockToast]
  )

  const validateCartAggregatedStock = useCallback(() => {
    const totals = new Map<string, { product: Product; quantity: number }>()
    for (const item of cart) {
      const product = getCartStockProduct(item)
      if (!product || !hasControlledPdvStock(product.stock, product.category)) continue
      const prev = totals.get(product.id)
      totals.set(product.id, {
        product,
        quantity: (prev?.quantity ?? 0) + item.quantity,
      })
    }

    for (const { product, quantity } of totals.values()) {
      if (quantity > product.stock + PDV_STOCK_EPSILON) {
        showAggregatedStockToast(product, quantity)
        return false
      }
    }
    return true
  }, [cart, getCartStockProduct, showAggregatedStockToast])

  const autoSelectCustomerByPhone = useCallback(
    async (tel: string) => {
      const q = tel.replace(/\D/g, "")
      if (q.length < 8) return
      try {
        const headers: Record<string, string> = {}
        if (lojaKey) headers[ASSISTEC_LOJA_HEADER] = lojaKey
        const res = await fetch(`/api/clientes?q=${encodeURIComponent(q)}`, { headers, cache: "no-store" })
        const data = (await res.json().catch(() => null)) as { clientes?: ApiClienteResult[] } | null
        const list = data?.clientes ?? []
        const matched = list.find((c) => (c.phone ?? "").replace(/\D/g, "") === q)
        if (matched) {
          setSelectedCustomer({ id: matched.id, name: matched.name, cpf: matched.document ?? "", phone: matched.phone ?? "" })
        }
      } catch {
        /* ignore — best effort */
      }
    },
    [lojaKey]
  )

  useEffect(() => {
    if (!linkedOsId) {
      linkedOsHydratedRef.current = null
      return
    }
    if (linkedOsHydratedRef.current === linkedOsId) {
      const osEarly = ordens.find((o) => o.id === linkedOsId)
      const telEarly = String(osEarly?.cliente?.telefone || "").replace(/\D/g, "")
      if (telEarly.length >= 8) {
        void autoSelectCustomerByPhone(telEarly)
      }
      return
    }
    const os = ordens.find((o) => o.id === linkedOsId)
    if (!os) return
    linkedOsHydratedRef.current = linkedOsId

    const er = mergeEntradaRapida(os.entradaRapida)
    const resumo = formatEntradaRapidaResumo(er)
    const next: CartItem[] = []
    if (os.valorServico > 0.001) {
      next.push({
        lineId: newPdvLineId(osServicoInventoryId(os.id)),
        inventoryId: osServicoInventoryId(os.id),
        name: `Serviço · ${os.numero}`,
        price: os.valorServico,
        quantity: 1,
        complementos: [],
        lineDetail: resumo,
      })
    }
    if (os.valorPecas > 0.001) {
      next.push({
        lineId: newPdvLineId(osPecasInventoryId(os.id)),
        inventoryId: osPecasInventoryId(os.id),
        name: `Peças · ${os.numero}`,
        price: os.valorPecas,
        quantity: 1,
        complementos: [],
        lineDetail: os.valorServico > 0.001 ? undefined : resumo,
      })
    }
    if (next.length) {
      setCart(next)
      const lastId = next[next.length - 1]!.lineId
      setSelectedCartLineId(lastId)
      setShellHighlightLineId(lastId)
      window.setTimeout(() => {
        setShellHighlightLineId((h) => (h === lastId ? null : h))
      }, 1400)
      queueMicrotask(() => shellBipeRef.current?.focus())
    }
    const tel = String(os.cliente?.telefone || "").replace(/\D/g, "")
    if (tel.length >= 8) {
      void autoSelectCustomerByPhone(tel)
    }
  }, [linkedOsId, ordens, autoSelectCustomerByPhone, uiShell])

  const qtyEditDefault = useMemo(() => {
    const line = cart.find((i) => i.lineId === selectedCartLineId)
    return line ? String(line.quantity) : "1"
  }, [cart, selectedCartLineId])

  useEffect(() => {
    setShellCustomerField(selectedCustomer?.name ?? "CONSUMIDOR")
  }, [selectedCustomer])

  useEffect(() => {
    setCustomerCreditFetched(null)
    const docNorm = (selectedCustomer?.cpf ?? "").replace(/\D/g, "")
    const cId = selectedCustomer?.id
    if (!docNorm && !cId) return
    const params = new URLSearchParams({ lojaId: lojaKey })
    if (docNorm) params.set("doc", docNorm)
    else if (cId) params.set("clienteId", cId)
    fetch(`/api/ops/credito-cliente?${params.toString()}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { creditos?: Record<string, { nome: string; saldo: number }> } | null) => {
        const saldo = j?.creditos ? Object.values(j.creditos).reduce((s, v) => s + v.saldo, 0) : 0
        setCustomerCreditFetched(saldo)
      })
      .catch(() => setCustomerCreditFetched(null))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCustomer?.cpf, selectedCustomer?.id, lojaKey])

  const updateCustomerCpf = useCallback((customerId: string, cpfDigits: string) => {
    const display = formatBrDocDisplay(cpfDigits)
    setSelectedCustomer((prev) => (prev?.id === customerId ? { ...prev, cpf: display } : prev))
  }, [])

  const pushCartLine = (params: {
    inventoryId: string
    name: string
    price: number
    quantity: number
    vendaPorPeso?: boolean
    atributosLabel?: string
    lineDetail?: string
    accessorySelection?: AccessorySelectionV1
    cartLineKey?: string
  }) => {
    const lineId = newPdvLineId(params.inventoryId)
    setCart((prev) => [
      ...prev,
      {
        lineId,
        inventoryId: params.inventoryId,
        name: params.name,
        price: params.price,
        quantity: params.quantity,
        complementos: [],
        vendaPorPeso: params.vendaPorPeso,
        atributosLabel: params.atributosLabel,
        lineDetail: params.lineDetail,
        accessorySelection: params.accessorySelection,
        cartLineKey: params.cartLineKey,
      },
    ])
    setSelectedCartLineId(lineId)
    if (isModoRapido) {
      setRapidoFlashLineId(lineId)
      window.setTimeout(() => {
        setRapidoFlashLineId((h) => (h === lineId ? null : h))
      }, 150)
      setSearchTerm("")
      setBipeCode("")
      playPdvRapidoItemBeepIfEnabled()
    }
    setShellHighlightLineId(lineId)
    window.setTimeout(() => {
      setShellHighlightLineId((h) => (h === lineId ? null : h))
    }, 1400)
    queueMicrotask(() => {
      shellBipeRef.current?.focus()
      if (isModoRapido) {
        window.requestAnimationFrame(() => shellBipeRef.current?.focus())
      }
    })
    // Branch legado `uiShell=default` (que focava productInputRef em modo rápido)
    // removida no Lote 4. omni-smart usa shellBipeRef como único campo de bipagem.
  }

  const addToCart = (product: Product, presetQty?: number) => {
    const baseQty = presetQty ?? 1
    const controlledStock = hasControlledPdvStock(product.stock, product.category)
    if (controlledStock && product.stock <= 0) {
      toast({ title: "Sem estoque", description: `${product.name} está sem saldo no estoque.` })
      return false
    }
    if (controlledStock && !product.vendaPorPeso && baseQty > product.stock) {
      toast({
        title: "Sem estoque",
        description: `${product.name}: solicitado ${baseQty}, disponível ${product.stock}.`,
        variant: "destructive",
      })
      return false
    }
    if (!product.vendaPorPeso && !validateAggregatedStockForProduct(product, baseQty)) {
      return false
    }
    // Acessório configurado (modelo/cor): intercepta ANTES da mutação do carrinho.
    // Atalhos/entradas sem `accessoryConfig` resolvem a config pelo catálogo real.
    const accessoryConfig =
      product.accessoryConfig ?? products.find((p) => p.id === product.id)?.accessoryConfig
    if (!product.vendaPorPeso && accessoryConfigRequiresSelection(accessoryConfig)) {
      accessoryQtyRef.current = baseQty
      setAccessoryProduct({ ...product, accessoryConfig })
      return true
    }
    if (product.atributos && product.atributos.length > 0) {
      setAttrProduct(product)
      const init: Record<string, string> = {}
      for (const a of product.atributos) {
        init[a.id] = a.opcoes[0] ?? ""
      }
      setAttrSelections(init)
      setAttrDialogOpen(true)
      return true
    }
    if (product.vendaPorPeso) {
      setAttrSelections({})
      setWeightProduct(product)
      setWeightKgInput("")
      setWeightDialogOpen(true)
      return true
    }
    pushCartLine({
      inventoryId: product.id,
      name: product.name,
      price: product.price,
      quantity: baseQty,
    })
    setSelectedProduct(product)
    return true
  }

  const addQuickItem = (item: Product) => {
    addToCart(item)
  }

  /**
   * Confirmação do modal "Configurar acessório": mesma combinação
   * produto+modelo+cor incrementa a linha existente; combinação nova vira linha
   * separada. O estoque segue agregado pelo produto real (`inventoryId`).
   * Retorna `false` para manter o modal aberto quando a inclusão falha.
   */
  const confirmAccessorySelection = (line: AccessoryCartLineSnapshot): boolean => {
    const product = accessoryProduct
    if (!product) return false
    const qty = accessoryQtyRef.current
    if (!validateAggregatedStockForProduct(product, qty)) return false
    const existing = cart.find((i) => sameAccessoryCartLine(i.cartLineKey, line.cartLineKey))
    if (existing) {
      setCart((prev) =>
        prev.map((i) =>
          i.lineId === existing.lineId ? { ...i, quantity: i.quantity + qty } : i,
        ),
      )
      setSelectedCartLineId(existing.lineId)
      if (isModoRapido) {
        setRapidoFlashLineId(existing.lineId)
        window.setTimeout(() => {
          setRapidoFlashLineId((h) => (h === existing.lineId ? null : h))
        }, 150)
        setSearchTerm("")
        setBipeCode("")
        playPdvRapidoItemBeepIfEnabled()
      }
      setShellHighlightLineId(existing.lineId)
      window.setTimeout(() => {
        setShellHighlightLineId((h) => (h === existing.lineId ? null : h))
      }, 1400)
      queueMicrotask(() => shellBipeRef.current?.focus())
    } else {
      pushCartLine({
        inventoryId: product.id,
        name: line.lineDescription,
        price: product.price,
        quantity: qty,
        accessorySelection: line.selection,
        cartLineKey: line.cartLineKey,
      })
    }
    setSelectedProduct(product)
    setAccessoryProduct(null)
    return true
  }

  /**
   * Adiciona ao carrinho um Item Avulso (Venda Avulsa via tecla INSERT).
   * Cria um `inventoryId` virtual com prefixo `__avulso__` — `isVirtualSaleLine`
   * faz o restante do pipeline (finalize, upsert venda, ledger) pular a baixa de
   * estoque automaticamente. Descrição, valor, qtd e custo opcional vêm do modal.
   */
  const addItemAvulso = (payload: ItemAvulsoPayload) => {
    const lineId = newPdvLineId("avulso")
    const inventoryId = avulsoInventoryId(lineId)
    const quantity = Math.max(1, Math.round(payload.quantity))
    const price = Math.max(0, Math.round(payload.unitPrice * 100) / 100)
    const custoUnitario =
      payload.custoUnitario !== null && payload.custoUnitario >= 0
        ? Math.round(payload.custoUnitario * 100) / 100
        : null
    setCart((prev) => [
      ...prev,
      {
        lineId,
        inventoryId,
        name: payload.description,
        price,
        quantity,
        complementos: [],
        isAvulso: true,
        custoUnitario,
        codigoAvulso: payload.codigo,
      },
    ])
    setSelectedCartLineId(lineId)
    setShowItemAvulsoModal(false)
    appendAuditLog({
      action: "pdv_item_avulso_adicionado",
      userLabel: auditUser(),
      detail: `${payload.description} · ${quantity}x ${formatBrlAudit(price)}${custoUnitario !== null ? ` · custo ${formatBrlAudit(custoUnitario)}` : " · custo n/i"}`,
    })
    if (isModoRapido) {
      setRapidoFlashLineId(lineId)
      window.setTimeout(() => {
        setRapidoFlashLineId((h) => (h === lineId ? null : h))
      }, 150)
      playPdvRapidoItemBeepIfEnabled()
    }
    setShellHighlightLineId(lineId)
    window.setTimeout(() => {
      setShellHighlightLineId((h) => (h === lineId ? null : h))
    }, 1400)
    queueMicrotask(() => shellBipeRef.current?.focus())
    // Branch legado `uiShell=default` (focava productInputRef) removida no Lote 4.
  }

  const handleShellBipeKeyDown = useCallback(
    async (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.key !== "Enter") return
      e.preventDefault()
      const raw = bipeCode.trim()
      if (!raw) return
      const q = Number(shellNextQty.replace(",", ".")) || 1

      const commitScan = (product: PdvCatalogProduct) => {
        if (!addToCart(product, q)) return
        setBipeCode("")
        setShellNextQty("1")
        const _newCount = cart.length + 1
        const _newSub = cart.reduce((s, i) => s + i.price * i.quantity, 0) + product.price * q
        setShellInfo(
          `✓ ${product.name} · ${_newCount} ${_newCount === 1 ? "item" : "itens"} · R$ ${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(_newSub)}`
        )
        queueMicrotask(() => shellBipeRef.current?.focus())
      }

      const found = findPdvProductByScan(raw, products)
      if (found) {
        commitScan(found)
        return
      }

      // Miss local → busca autoritativa no catálogo INTEIRO da loja (snapshot pode estar defasado).
      const remote = await lookupPdvScanRemote({ code: raw, storeId: lojaKey, setInventory })
      if (remote.kind === "single") {
        commitScan(remote.product)
        return
      }
      if (remote.kind === "multiple") {
        setShellInfo(`Vários produtos para o código "${raw}". Use F3 para escolher.`)
        queueMicrotask(() => shellBipeRef.current?.focus())
        return
      }
      toast({ title: "Produto não encontrado", description: `Produto não encontrado nesta loja para o código: ${raw}` })
      setShellInfo(`✕ Produto não encontrado nesta loja para o código: ${raw}`)
      queueMicrotask(() => shellBipeRef.current?.focus())
    },
    [addToCart, bipeCode, cart, products, shellNextQty, toast, lojaKey, setInventory]
  )

  const handleBipeSuggestionSelect = useCallback(
    (product: PdvCatalogProduct) => {
      const q = Number(shellNextQty.replace(",", ".")) || 1
      if (!addToCart(product, q)) return
      setBipeCode("")
      setShellNextQty("1")
      const _newCount = cart.length + 1
      const _newSub = cart.reduce((s, i) => s + i.price * i.quantity, 0) + product.price * q
      setShellInfo(
        `✓ ${product.name} · ${_newCount} ${_newCount === 1 ? "item" : "itens"} · R$ ${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(_newSub)}`
      )
      queueMicrotask(() => shellBipeRef.current?.focus())
    },
    [addToCart, cart, shellNextQty]
  )

  const addComplemento = (productId: string, complementoName: string, complementoPrice: number) => {
    const inv = `comp-${productId}`
    pushCartLine({
      inventoryId: `${inv}-${Date.now()}`,
      name: `  + ${complementoName}`,
      price: complementoPrice,
      quantity: 1,
    })
  }

  const updateQuantity = (lineId: string, delta: number) => {
    const current = cart.find((item) => item.lineId === lineId)
    if (!current) return
    const step = current.vendaPorPeso ? 0.05 : 1
    const newQty = current.quantity + delta * step
    if (newQty > 0) {
      const product = getCartStockProduct(current)
      if (product && !validateAggregatedStockForProduct(product, newQty, lineId)) return
    }
    setCart(
      cart
        .map((item) => {
          if (item.lineId !== lineId) return item
          return newQty > 0 ? { ...item, quantity: newQty } : item
        })
        .filter((item) => item.quantity > 0)
    )
  }

  const removeFromCart = (lineId: string) => {
    setCart(cart.filter((item) => item.lineId !== lineId))
  }

  const confirmAttrDialog = () => {
    if (!attrProduct) return
    const parts = attrProduct.atributos?.map((a) => attrSelections[a.id]).filter(Boolean) ?? []
    const label = parts.length ? `${attrProduct.name} (${parts.join(" · ")})` : attrProduct.name
    if (attrProduct.vendaPorPeso) {
      setAttrDialogOpen(false)
      setWeightProduct(attrProduct)
      setWeightKgInput("")
      setWeightDialogOpen(true)
      return
    }
    if (!validateAggregatedStockForProduct(attrProduct, 1)) return
    setAttrDialogOpen(false)
    pushCartLine({
      inventoryId: attrProduct.id,
      name: label,
      price: attrProduct.price,
      quantity: 1,
      atributosLabel: parts.join(" · "),
    })
    setSelectedProduct(attrProduct)
    setAttrProduct(null)
  }

  const confirmWeightDialog = () => {
    if (!weightProduct) return
    const kg = parseFloat(weightKgInput.replace(",", "."))
    if (!Number.isFinite(kg) || kg <= 0) {
      toast({ title: "Peso inválido", description: "Informe o peso em kg.", variant: "destructive" })
      return
    }
    const inv = inventory.find((i) => i.id === weightProduct.id)
    const productForStock = { ...weightProduct, stock: inv?.stock ?? weightProduct.stock }
    if (!validateAggregatedStockForProduct(productForStock, kg)) return
    const pKg = weightProduct.precoPorKg ?? weightProduct.price
    const parts = weightProduct.atributos?.length ? weightProduct.atributos.map((a) => attrSelections[a.id]).filter(Boolean) : []
    const baseName = parts.length > 0 ? `${weightProduct.name} (${parts.join(" · ")})` : weightProduct.name
    pushCartLine({
      inventoryId: weightProduct.id,
      name: `${baseName} — ${kg.toFixed(3)} kg`,
      price: pKg,
      quantity: kg,
      vendaPorPeso: true,
      atributosLabel: parts.length ? parts.join(" · ") : undefined,
    })
    setSelectedProduct(weightProduct)
    setWeightDialogOpen(false)
    setWeightProduct(null)
    setAttrProduct(null)
  }

  const handleLerBalança = async () => {
    if (!isWebSerialSupported()) {
      toast({
        title: "Web Serial",
        description: "Use Chrome ou Edge em HTTPS ou localhost. Conecte a balança via USB.",
        variant: "destructive",
      })
      return
    }
    setScaleBusy(true)
    try {
      await openScalePort({ baudRate: 9600 })
      const w = await waitForStableWeightKg("auto", 3200)
      await closeScalePort()
      if (w != null && w > 0) {
        setWeightKgInput(w.toFixed(3))
        toast({ title: "Peso lido", description: `${w.toFixed(3)} kg` })
      } else {
        const peek = peekLastWeightKg("auto")
        if (peek != null && peek > 0) setWeightKgInput(peek.toFixed(3))
        else
          toast({
            title: "Peso",
            description: "Não estabilizou a tempo. Digite manualmente ou verifique baud rate (ex.: 9600).",
            variant: "destructive",
          })
      }
    } catch (e) {
      await closeScalePort()
      toast({
        title: "Balança",
        description: e instanceof Error ? e.message : "Falha na leitura serial",
        variant: "destructive",
      })
    } finally {
      setScaleBusy(false)
    }
  }

  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const pctRaw = Math.min(100, Math.max(0, discountPercent || 0))
  const discountTotal = Math.min(+(subtotal * (pctRaw / 100)).toFixed(2) + Math.max(0, discountReais || 0), subtotal)
  const { impostoEstimado, total } = useMemo(
    () => computePdvCartTotals(subtotal, discountTotal, pdvParams),
    [subtotal, discountTotal, pdvParams.incluirImpostoEstimadoNoPdv, pdvParams.aliquotaImpostoEstimadoPdv],
  )

  const formasPagamentoClassic = useMemo(() => {
    const all = getActiveFormasPagamento(pdvParams.formasPagamento ?? [])
    return {
      grid: all.filter((f) => f.id !== "carne" && f.id !== "boleto" && f.id !== "multiplo"),
      parcelado: all.filter((f) => f.id === "carne" || f.id === "boleto"),
      multiplo: getFormaMultiplo(pdvParams.formasPagamento ?? []),
    }
  }, [pdvParams.formasPagamento])

  const buildReceiptPrintPayload = useCallback(() => {
    const nome = (empresaDocumentos.nomeFantasia || "").trim() || configPadrao.empresa.nomeFantasia
    const cnpj = (empresaDocumentos.cnpj || "").trim() || configPadrao.empresa.cnpj
    const footer = resolveCupomRodape(impressaoConfig, pdvReceiptFooter || settings?.receiptFooter)
    return {
      nome,
      cnpj,
      footer,
      itens: cart.map((i) => ({
        name: i.name,
        quantity: i.quantity,
        unitPrice: i.price,
        lineTotal: i.price * i.quantity,
      })),
    }
  }, [
    cart,
    empresaDocumentos.cnpj,
    empresaDocumentos.nomeFantasia,
    impressaoConfig,
    pdvReceiptFooter,
    settings?.receiptFooter,
  ])

  const handlePrintReceipt = async () => {
    if (cart.length === 0) {
      toast({ title: "Carrinho vazio", description: "Adicione itens antes de imprimir.", variant: "destructive" })
      return
    }
    const p = buildReceiptPrintPayload()
    const result = await printPdvSaleReceipt({
      config: impressaoConfig,
      receiptFooter: p.footer,
      logoUrl: storeLogoUrl,
      input: {
        nomeFantasia: p.nome,
        cnpj: p.cnpj,
        enderecoLinha: getEnderecoDocumentos(),
        receiptFooter: p.footer,
        operador: operatorLabel,
        clienteNome: selectedCustomer?.name,
        clienteCpf: selectedCustomer?.cpf,
        itens: p.itens,
        subtotal,
        taxes: impostoEstimado,
        discount: discountTotal,
        total,
        dataHora: new Date().toLocaleString("pt-BR"),
      },
    })
    if (result.ok) {
      toast({
        title: result.via === "proxy" ? "Cupom enviado" : "Cupom preparado",
        description:
          result.via === "proxy"
            ? `Impressora ${impressaoConfig.impressoraHost.trim() || "padrão do servidor"} · ${impressaoConfig.viasCupom} via(s).`
            : "Impressão HTML ou arquivo .bin gerado (fallback web).",
      })
      return
    }
    toast({
      title: "Falha na impressão",
      description: result.error || "Não foi possível enviar o cupom.",
      variant: "destructive",
    })
  }

  const handlePendOnAccount = () => {
    if (!selectedCustomer) {
      toast({ title: "Cliente obrigatorio", description: "Selecione um cliente para pendurar na conta." })
      return
    }
    setPendingOnAccount(true)
    toast({ title: "Venda pendurada na conta", description: `${selectedCustomer.name} - R$ ${total.toFixed(2)}` })
    clearDraft()
    setCart([])
    setDiscountReais(0)
    setDiscountPercent(0)
    setSelectedProduct(null)
    setPendingOnAccount(false)
  }

  // Sangria/Suprimento ficam na barra de caixa compartilhada (CaixaStatusBar).
  // Não há mais dialog `operationType` neste arquivo — fonte única de sangria/suprimento.

  const requestFechamentoCaixa = () => {
    setShowOperationsMenu(false)
    setFechamentoCaixaSignal((n) => n + 1)
  }

  // ─── Lote 4: REMOÇÃO LEGADA ─────────────────────────────────────────────────
  // Removidos nesta sessão:
  //  1. função `saveOperation` (sangria/suprimento via dialog local) — sem ponto
  //     de entrada. Sangria/suprimento vivem agora no CaixaStatusBar compartilhado
  //     (com retry/idempotência via `lib/pdv-caixa-operacao.ts`).
  //  2. helper `labelOperacaoCaixa` — só era usado pelo painel cashHistory.
  //  3. `useEffect` keymap do `uiShell === "default"` — em produção o PDV Clássico
  //     SEMPRE roda como `omni-smart` (ver vendas-pdv.tsx:117). O handler nunca
  //     executava (early-return) e era "feature fantasma" para qualquer atalho
  //     que alguém adicionasse aqui. O keymap operacional vivo é o `down`/
  //     `openShellShortcut` do shell omni-smart, logo abaixo.
  //  4. states `operationType`, `operationValue`, `operationReason`, `cashHistory`.
  //  5. dialog `operationType` + painel "Histórico financeiro do caixa".
  // Para o histórico completo do que foi removido, ver `git log` antes do Lote 4.

  const shellModalBlocking =
    isPaymentModalOpen ||
    shellProductSearchOpen ||
    shellClientSearchOpen ||
    shellQtyEditOpen ||
    shellCancelSaleOpen ||
    shellAdvancedOpen ||
    shellReceivablesOpen ||
    attrDialogOpen ||
    weightDialogOpen ||
    accessoryProduct !== null ||
    showKeyboardHelp ||
    showOperationsMenu ||
    postSalePrintOpen

  useEffect(() => {
    if (!isModoRapido) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (shellModalBlocking) return
      if (e.key === "Escape" && cart.length > 0) {
        e.preventDefault()
        setCart((prev) => {
          const next = prev.slice(0, -1)
          const last = next[next.length - 1]
          queueMicrotask(() => setSelectedCartLineId(last ? last.lineId : null))
          return next
        })
        queueMicrotask(() => shellBipeRef.current?.focus())
        return
      }
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && cart.length > 0) {
        const active = document.activeElement
        if (active !== shellBipeRef.current) return
        e.preventDefault()
        const ids = cart.map((c) => c.lineId)
        const cur = selectedCartLineId
        const idx = cur ? ids.indexOf(cur) : -1
        const nextIdx =
          e.key === "ArrowDown"
            ? idx < 0
              ? 0
              : Math.min(idx + 1, ids.length - 1)
            : idx <= 0
              ? ids.length - 1
              : idx - 1
        setSelectedCartLineId(ids[nextIdx] ?? null)
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [isModoRapido, uiShell, shellModalBlocking, cart, selectedCartLineId])

  const focusShellBipe = useCallback(() => {
    queueMicrotask(() => shellBipeRef.current?.focus())
  }, [])

  const validateBeforeOpenPayment = useCallback(() => {
    const caixaState = caixa as typeof caixa | null | undefined

    if (cart.length === 0) {
      toast({
        title: "Carrinho vazio",
        description: "Adicione produtos ao carrinho antes de finalizar.",
        variant: "destructive",
      })
      return false
    }

    if (!caixaState) {
      toast({
        title: "Status do caixa carregando",
        description: "Aguarde o status do caixa carregar antes de finalizar.",
        variant: "destructive",
      })
      return false
    }

    // Caixa fechado na tela ou sem referência de sessão utilizável: em vez de
    // recusar com uma mensagem morta, reconsulta a sessão ativa da loja. O
    // carrinho é mantido e a venda NÃO é enviada — quem finaliza de novo, depois
    // de revisar, é o operador (evita duplicidade se a 1ª resposta for inconclusiva).
    if (!caixaState.isOpen || !sessaoId?.trim()) {
      void garantirSessao()
      return false
    }

    if (!validateCartAggregatedStock()) return false

    return true
  }, [cart.length, caixa, garantirSessao, sessaoId, toast, validateCartAggregatedStock])

  const openPaymentFlow = useCallback(
    (intent: PaymentMethodType | null, multiple: boolean) => {
      if (!validateBeforeOpenPayment()) {
        focusShellBipe()
        return false
      }
      setInstantPayIntent(intent)
      setMultipayMode(multiple)
      setIsPaymentModalOpen(true)
      return true
    },
    [focusShellBipe, validateBeforeOpenPayment]
  )

  const openShellShortcut = useCallback(
    (key: string) => {
      const goBipe = () => focusShellBipe()
      switch (key) {
        case "F1":
          openPaymentFlow(null, false)
          break
        case "End":
          setShowKeyboardHelp(true)
          break
        case "F2":
          setShellClientSearchOpen(true)
          break
        case "F3":
          setShellProductSearchOpen(true)
          break
        case "F4":
          if (!selectedCartLineId) {
            toast({ title: "Selecione um item", description: "Clique na lista para alterar a quantidade." })
            goBipe()
            return
          }
          setShellQtyEditOpen(true)
          break
        case "F5": {
          if (!caixa.isOpen || !sessaoId?.trim()) {
            // Mesma recuperação da finalização: consulta o servidor antes de recusar.
            void garantirSessao()
            goBipe()
            return
          }
          setShellReceivablesOpen(true)
          break
        }
        case "F6":
          setShellCancelSaleOpen(true)
          break
        case "F7":
          setVendaEsperaOpen(true)
          break
        case "F8":
          goBipe()
          break
        case "F9":
          // Alias legado — mesmo fluxo do F5 (Receber conta).
          if (!caixa.isOpen || !sessaoId?.trim()) {
            toast({
              variant: "destructive",
              title: "Caixa fechado",
              description: "Abra o caixa antes de receber contas.",
            })
            goBipe()
            return
          }
          setShellReceivablesOpen(true)
          break
        case "F10":
          // Desconto: aplicado no modal de pagamento (campos de desconto no topo).
          // Tecla dedicada consistente com o PDV Assistência (F10 = Desconto).
          openPaymentFlow(null, false)
          break
        case "F12":
          // Pagamento Múltiplo (convergência operacional com Assistência). Reusa o
          // modal compartilhado em modo split — sem implementação paralela.
          openPaymentFlow(null, true)
          break
        case "CTRL":
          setShellAdvancedOpen(true)
          break
        default:
          break
      }
    },
    [cart.length, focusShellBipe, selectedCartLineId, toast, caixa.isOpen, sessaoId, openPaymentFlow]
  )

  useEffect(() => {
    const fnKeys = new Set(["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F12", "End"])
    let ctrlDown = false
    const down = (e: globalThis.KeyboardEvent) => {
      if (shellModalBlocking) return
      if (e.key === "Delete" && cart.length > 0) {
        const active = document.activeElement
        const inInput =
          active instanceof HTMLInputElement ||
          active instanceof HTMLTextAreaElement ||
          active instanceof HTMLSelectElement
        if (!inInput) {
          e.preventDefault()
          if (selectedCartLineId) {
            setCart((prev) => prev.filter((i) => i.lineId !== selectedCartLineId))
            setSelectedCartLineId(null)
            setShellInfo("Item cancelado.")
          } else {
            setCart((prev) => {
              const next = prev.slice(0, -1)
              const last = next[next.length - 1]
              queueMicrotask(() => setSelectedCartLineId(last?.lineId ?? null))
              return next
            })
            setShellInfo("Último item removido.")
          }
          focusShellBipe()
          return
        }
      }
      if (e.key === "Control") ctrlDown = true
      else ctrlDown = false
      // INSERT — Item Avulso (venda de balcão sem cadastro). Antes só existia no
      // handler `default` (desativado no shell omni-smart) → era "feature fantasma".
      // Agora vive no keymap operacional do Clássico, igual a Assistência/Supermercado.
      if (e.key === "Insert") {
        e.preventDefault()
        setShowItemAvulsoModal(true)
        return
      }
      if (!fnKeys.has(e.key)) return
      e.preventDefault()
      openShellShortcut(e.key)
    }
    const up = (e: globalThis.KeyboardEvent) => {
      if (shellModalBlocking) return
      if (e.key === "Control" && ctrlDown) {
        e.preventDefault()
        openShellShortcut("CTRL")
      }
      ctrlDown = false
    }
    window.addEventListener("keydown", down)
    window.addEventListener("keyup", up)
    return () => {
      window.removeEventListener("keydown", down)
      window.removeEventListener("keyup", up)
    }
  }, [openShellShortcut, shellModalBlocking, cart, selectedCartLineId, focusShellBipe])

  useEffect(() => {
    const t = window.setTimeout(() => shellBipeRef.current?.focus(), 100)
    return () => window.clearTimeout(t)
  }, [])

  useEffect(() => {
    if (!isModoRapido) return
    if (!storePdvGate.ready || storePdvGate.block) return
    const t = window.setTimeout(() => {
      shellBipeRef.current?.focus()
    }, 200)
    return () => window.clearTimeout(t)
  }, [isModoRapido, storePdvGate.ready, storePdvGate.block])

  useEffect(() => {
    if (!voiceCartSeed?.key) return
    const label = (voiceCartSeed.itemName || "").trim()
    if (!label) {
      onVoiceCartSeedConsumed?.()
      return
    }
    const id = `voice-${voiceCartSeed.key}`
    const unit = voiceCartSeed.price ?? 0
    setCart((prev) => {
      if (prev.some((i) => i.lineId === id)) return prev
      return [
        ...prev,
        {
          lineId: id,
          inventoryId: id,
          name: label,
          price: unit,
          quantity: 1,
          complementos: [],
        },
      ]
    })
    setSearchTerm(label)
    setSelectedProduct(null)
    toast({
      title: "Voz: item no carrinho",
      description:
        `${label}` +
        (voiceCartSeed.price != null
          ? ` — ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(voiceCartSeed.price)}`
          : ""),
    })
    onVoiceCartSeedConsumed?.()
  }, [voiceCartSeed, onVoiceCartSeedConsumed, toast])

  const openPaymentModal = (intent: PaymentMethodType | null) => {
    // À prazo / carnê sem cliente NÃO barram mais: o modal abre e pede o seletor de
    // cliente (com cadastro rápido) via onRequireCustomer, preservando o carrinho.
    openPaymentFlow(intent, false)
  }

  /** Pagamento Múltiplo — convergência operacional com o PDV Assistência (F12). */
  const openMultipayModal = () => {
    openPaymentFlow(null, true)
  }

  const heldSales = getHeldSales(lojaKey, terminalIdForHold)

  function handleHoldSale() {
    const held: HeldSale = {
      id: newHoldId(),
      label: nextHoldLabel(heldSales),
      savedAt: new Date().toISOString(),
      items: cart.map((i) => ({
        lineId: i.lineId,
        inventoryId: i.inventoryId,
        name: i.name,
        price: i.price,
        quantity: i.quantity,
        isAvulso: i.isAvulso,
        atributosLabel: i.atributosLabel,
        vendaPorPeso: i.vendaPorPeso,
        custoUnitario: i.custoUnitario,
        codigoAvulso: i.codigoAvulso,
        accessorySelection: i.accessorySelection,
        cartLineKey: i.cartLineKey,
      })),
      customer: selectedCustomer
        ? { id: selectedCustomer.id, name: selectedCustomer.name, cpf: selectedCustomer.cpf, phone: selectedCustomer.phone }
        : null,
      discountReais,
      discountPercent,
      pdvType: "classic",
    }
    saveHeldSale(lojaKey, terminalIdForHold, held)
    // O carrinho passou a viver na venda em espera — o rascunho sai de cena.
    clearDraft()
    setCart([])
    setSelectedCustomer(null)
    setDiscountReais(0)
    setDiscountPercent(0)
    toast({ title: "Venda em espera", description: `${held.label} guardada.` })
  }

  function handleResumeSale(sale: HeldSale) {
    setCart(
      sale.items.map((i) => ({
        lineId: i.lineId,
        inventoryId: i.inventoryId,
        name: i.name,
        price: i.price,
        quantity: i.quantity,
        isAvulso: i.isAvulso,
        atributosLabel: i.atributosLabel,
        vendaPorPeso: i.vendaPorPeso,
        custoUnitario: i.custoUnitario,
        codigoAvulso: i.codigoAvulso,
        accessorySelection: i.accessorySelection,
        cartLineKey: i.cartLineKey,
      })),
    )
    if (sale.customer) {
      setSelectedCustomer({
        id: sale.customer.id,
        name: sale.customer.name,
        cpf: sale.customer.cpf ?? "",
        phone: sale.customer.phone ?? "",
      })
    }
    setDiscountReais(sale.discountReais ?? 0)
    setDiscountPercent(sale.discountPercent ?? 0)
    removeHeldSale(lojaKey, terminalIdForHold, sale.id)
  }

  function handleDiscardHeldSale(id: string) {
    removeHeldSale(lojaKey, terminalIdForHold, id)
  }

  if (lojaAtivaId && !storePdvGate.ready) {
    return (
      <div className="flex min-h-screen w-full flex-col bg-background p-4 space-y-4 animate-pulse">
        {/* Topbar Skeleton */}
        <div className="flex items-center justify-between border-b border-border pb-3 shrink-0">
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 rounded-lg" />
            <Skeleton className="h-6 w-32" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-24 rounded-lg" />
            <Skeleton className="h-8 w-20 rounded-lg" />
          </div>
        </div>

        {/* Main Area Skeleton */}
        <div className="flex flex-1 gap-4 min-h-0">
          {/* Cart Column Skeleton */}
          <div className="flex-1 flex flex-col border border-border rounded-xl p-4 space-y-4 bg-card">
            <div className="flex justify-between items-center">
              <Skeleton className="h-6 w-24" />
              <Skeleton className="h-4 w-12" />
            </div>
            <div className="flex-1 space-y-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex justify-between items-center">
                  <div className="space-y-1">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                  <Skeleton className="h-5 w-16" />
                </div>
              ))}
            </div>
            <div className="border-t border-border pt-4 space-y-2 shrink-0">
              <div className="flex justify-between">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-16" />
              </div>
              <div className="flex justify-between">
                <Skeleton className="h-6 w-20" />
                <Skeleton className="h-6 w-24" />
              </div>
            </div>
          </div>

          {/* Sidebar / Options Skeleton */}
          <div className="w-80 border border-border rounded-xl p-4 space-y-4 bg-card shrink-0 hidden md:block">
            <Skeleton className="h-5 w-32" />
            <div className="grid grid-cols-2 gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded-lg" />
              ))}
            </div>
            <div className="space-y-2 pt-4 border-t border-border">
              <Skeleton className="h-12 w-full rounded-lg" />
              <Skeleton className="h-10 w-full rounded-lg" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (storePdvGate.block) {
    return (
      <div className="flex min-h-[360px] w-full flex-1 flex-col items-center justify-center gap-4 rounded-2xl border border-border bg-muted/40 px-6 py-10 text-center backdrop-blur-xl">
        <h2 className="text-xl font-black text-foreground">Cadastre o nome da empresa desta unidade</h2>
        <p className="max-w-lg text-base text-muted-foreground">
          O PDV fica bloqueado até <strong>esta unidade</strong> ter um <strong>Nome fantasia</strong> salvo.
          Acesse <strong>Configurações → Dados da Empresa</strong>, preencha e salve.
        </p>
        <Button type="button" className="h-12 px-8 text-base font-bold" onClick={() => router.replace("/dashboard/configuracoes")}>
          Ir para Dados da Empresa
        </Button>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden text-[17px] text-foreground antialiased sm:text-[18px]">
        <div
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-t border-border bg-background transition-colors duration-300"
        >
          <CaixaStatusBar
            variant="pdv"
            openAberturaSignal={voiceOpenCaixaSignal}
            onOpenAberturaSignalConsumed={onVoiceOpenCaixaConsumed}
            openFechamentoSignal={fechamentoCaixaSignal}
          />
          <PdvOmniClassicShell
              isModoRapido={isModoRapido}
              storeName={storeDisplayName}
              storeId={lojaAtivaId ?? undefined}
              cartRows={shellCartRows}
              highlightLineId={shellHighlightLineId}
              flashLineId={isModoRapido ? rapidoFlashLineId : null}
              selectedLineId={selectedCartLineId}
              onSelectLine={setSelectedCartLineId}
              total={total}
              itemCount={cart.length}
              previousSaleTotal={lastSaleTotal}
              bipeCode={bipeCode}
              onBipeChange={setBipeCode}
              bipeRef={shellBipeRef}
              onBipeKeyDown={handleShellBipeKeyDown}
              bipeSuggestions={bipeSuggestions}
              onBipeSuggestionSelect={handleBipeSuggestionSelect}
              customerDisplay={shellCustomerField}
              onCustomerDisplayChange={(v) => {
                // Busca de cliente ao digitar no campo inline (antes só funcionava
                // via F2): alimenta a mesma busca live do picker e abre o resultado.
                setShellCustomerField(v)
                setCustomerSearch(v)
                if (v.trim().length > 0) setShellClientSearchOpen(true)
              }}
              nextQtyStr={shellNextQty}
              onNextQtyStrChange={setShellNextQty}
              seller={shellSeller}
              onSellerChange={setShellSeller}
              info={shellInfo}
              onShortcutAction={openShellShortcut}
              onFinalizeClick={() => openShellShortcut("F1")}
              products={products}
              productSearchOpen={shellProductSearchOpen}
              onProductSearchOpenChange={(open) => {
                setShellProductSearchOpen(open)
                if (!open) focusShellBipe()
              }}
              clientSearchOpen={shellClientSearchOpen}
              onClientSearchOpenChange={(open) => {
                setShellClientSearchOpen(open)
                if (open) setCustomerSearch("")
                if (!open) focusShellBipe()
              }}
              clientOptions={shellClientOptions}
              onPickClient={(label) => {
                const row = shellClientOptions.find((x) => x.label === label)
                if (!row || row.id === "0") {
                  setSelectedCustomer(null)
                  setCustomerSearch("")
                } else {
                  const c = filteredCustomers.find((x) => x.id === row.id)
                  if (c) setSelectedCustomer({ id: c.id, name: c.name, cpf: c.document ?? "", phone: c.phone ?? "" })
                  setCustomerSearch("")
                }
                setShellClientSearchOpen(false)
                focusShellBipe()
              }}
              clientSearchQuery={customerSearch}
              onClientSearchQueryChange={setCustomerSearch}
              clientSearchLoading={buscandoCliente}
              qtyEditOpen={shellQtyEditOpen}
              onQtyEditOpenChange={(open) => {
                setShellQtyEditOpen(open)
                if (!open) focusShellBipe()
              }}
              qtyEditDefault={qtyEditDefault}
              onQtyEditConfirm={(raw) => {
                const v = Number(String(raw).replace(",", "."))
                if (!Number.isFinite(v) || v <= 0) {
                  toast({
                    title: "Quantidade inválida",
                    description: "Informe um número maior que zero.",
                    variant: "destructive",
                  })
                  return false
                }
                const id = selectedCartLineId
                if (!id) return false
                const item = cart.find((i) => i.lineId === id)
                if (!item) return false
                const product = getCartStockProduct(item)
                if (product && !validateAggregatedStockForProduct(product, v, id)) return false
                setCart((prev) => prev.map((i) => (i.lineId === id ? { ...i, quantity: v } : i)))
                setShellQtyEditOpen(false)
                setShellInfo("Quantidade atualizada.")
                focusShellBipe()
                return true
              }}
              cancelSaleOpen={shellCancelSaleOpen}
              onCancelSaleOpenChange={(open) => {
                setShellCancelSaleOpen(open)
                if (!open) focusShellBipe()
              }}
              onConfirmCancelSale={() => {
                // Ação explícita do operador: é o único jeito de descartar o rascunho sem venda.
                clearDraft()
                setCart([])
                setSelectedCartLineId(null)
                setShellHighlightLineId(null)
                setBipeCode("")
                setSearchTerm("") // limpar busca F3 ao cancelar (GOAL limpeza pós-ação)
                setShellNextQty("1")
                setSelectedCustomer(null)
                setShellCustomerField("CONSUMIDOR")
                setShellCancelSaleOpen(false)
                setShellInfo("Venda cancelada. Sistema limpo.")
                focusShellBipe()
              }}
              advancedOpen={shellAdvancedOpen}
              onAdvancedOpenChange={(open) => {
                setShellAdvancedOpen(open)
                if (!open) focusShellBipe()
              }}
              onOpenTrocas={() => {
                setShellAdvancedOpen(false)
                setShowDevolucaoModal(true)
              }}
              receivablesOpen={false}
              onReceivablesOpenChange={() => {
                /* Dialog antigo do shell ("Ir para Contas a Receber") foi
                 * substituído pelo <PdvRecebimentoModal /> abaixo. O estado
                 * `shellReceivablesOpen` controla o novo modal diretamente. */
              }}
              onOpenReceivablesModule={() => {
                router.push("/dashboard/financeiro/contas-a-receber")
                focusShellBipe()
              }}
              onAddProductFromSearch={(p) => {
                setShellProductSearchOpen(false)
                addToCart(p)
                focusShellBipe()
              }}
            />
        </div>

      <ItemAvulsoModal
        open={showItemAvulsoModal}
        onOpenChange={setShowItemAvulsoModal}
        onConfirm={addItemAvulso}
        checkCodigoExistente={(c) => acharProdutoPorCodigoExato(inventory, c)}
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

      <PdvRecebimentoModal
        open={shellReceivablesOpen}
        onOpenChange={(open) => {
          setShellReceivablesOpen(open)
          if (!open) focusShellBipe()
        }}
        preselectedCustomerName={selectedCustomer?.name ?? null}
        formasPagamento={pdvParams.formasPagamento ?? []}
        impressaoConfig={impressaoConfig}
        lojaNome={(empresaDocumentos.nomeFantasia || configPadrao.empresa.nomeFantasia || "").trim() || undefined}
        hotkeyLabel="F5"
      />

      <PdvClientePicker
        open={aPrazoClientePickerOpen}
        storeId={lojaKey}
        onClose={() => setAPrazoClientePickerOpen(false)}
        onSelect={(c: PdvClienteResult) => {
          setSelectedCustomer({
            id: c.id,
            name: c.name,
            cpf: (c.document ?? "").trim(),
            phone: (c.phone ?? "").trim(),
          })
          setAPrazoClientePickerOpen(false)
        }}
      />

      <PaymentModal
        isOpen={isPaymentModalOpen}
        twoColumn
        onClose={() => {
          setIsPaymentModalOpen(false)
          setInstantPayIntent(null)
          setMultipayMode(false)
          focusShellBipe()
        }}
        cartSubtotal={subtotal}
        impostoEstimado={impostoEstimado}
        total={total}
        discountReais={discountReais}
        discountPercent={discountPercent}
        onDiscountReaisChange={setDiscountReais}
        onDiscountPercentChange={setDiscountPercent}
        custoPeca={total * 0.35}
        selectedCustomer={selectedCustomer}
        customerStoreCredit={selectedCustomer ? (customerCreditFetched ?? getSaldoCreditoCliente(selectedCustomer.cpf)) : 0}
        instantPayIntent={instantPayIntent}
        onInstantPayIntentConsumed={() => setInstantPayIntent(null)}
        onCustomerCpfUpdate={updateCustomerCpf}
        multipayHint={multipayMode}
        onRequireCustomer={() => setAPrazoClientePickerOpen(true)}
        cashierId={cashierId}
        onConfirm={(payments, meta) => {
          const saleLines = cart
            .filter(
              (item) =>
                isOsVirtualSaleLine(item.inventoryId) ||
                isAvulsoSaleLine(item.inventoryId) ||
                inventory.some((i) => i.id === item.inventoryId)
            )
            .map((item) => ({
              inventoryId: item.inventoryId,
              quantity: item.quantity,
              unitPrice: item.price,
              name: item.name,
              ...(item.isAvulso ? { isAvulso: true as const } : {}),
              ...(item.custoUnitario !== undefined ? { custoUnitario: item.custoUnitario } : {}),
              ...(item.accessorySelection ? { accessorySelection: item.accessorySelection } : {}),
            }))
          // Capturar dados de impressão ANTES de limpar o cart
          const _rp = buildReceiptPrintPayload()
          const _printInput: PdvReceiptInput = {
            nomeFantasia: _rp.nome,
            cnpj: _rp.cnpj,
            enderecoLinha: getEnderecoDocumentos(),
            receiptFooter: _rp.footer,
            operador: operatorLabel,
            clienteNome: selectedCustomer?.name,
            clienteCpf: selectedCustomer?.cpf,
            itens: _rp.itens,
            subtotal,
            taxes: impostoEstimado,
            discount: discountTotal,
            total,
            dataHora: new Date().toLocaleString("pt-BR"),
          }

          let dinheiro = 0
          let pix = 0
          let cartaoDebito = 0
          let cartaoCredito = 0
          let carne = 0
          let aPrazo = 0
          let creditoVale = 0
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
          _printInput.pagamentos = buildPagamentosResumo({
            dinheiro, pix, cartaoDebito, cartaoCredito, carne, aPrazo, creditoVale,
          })
          const result = finalizeSaleTransaction({
            lines: saleLines,
            total,
            linkedOsId,
            paymentBreakdown: {
              dinheiro,
              pix,
              cartaoDebito,
              cartaoCredito,
              carne,
              aPrazo,
              creditoVale,
            },
            auditMeta: {
              cashierId: meta?.cashierId ?? cashierId,
              discountAuthorizedByAdminId: meta?.discountAuthorizedByAdminId,
              discountReais: meta?.discountReais ?? discountReais,
              discountPercent: meta?.discountPercent ?? discountPercent,
            },
            customerCpf: selectedCustomer?.cpf,
            customerName: selectedCustomer?.name,
            clienteId: selectedCustomer?.id || undefined,
            aPrazoConfig,
          })
          if (!result.ok) {
            toast({ title: "Falha transacional", description: result.reason })
            return false
          }
          _printInput.numeroVenda = result.saleId
          // Fila "Produtos a cadastrar": registra os itens avulsos vendidos para revisão posterior.
          // Não toca estoque/venda/caixa e nunca lança (não pode afetar a venda já concluída).
          try {
            const avulsosVendidos = cart.filter((i) => i.isAvulso)
            if (avulsosVendidos.length > 0) {
              enfileirarProdutosACadastrar(
                lojaKey,
                construirProdutosACadastrar({
                  storeId: lojaKey,
                  vendaId: result.saleId,
                  operador: operatorLabel,
                  itens: avulsosVendidos.map((i) => ({
                    lineId: i.lineId,
                    nome: i.name,
                    codigo: i.codigoAvulso,
                    precoVenda: i.price,
                    custo: i.custoUnitario,
                    quantidade: i.quantity,
                  })),
                })
              )
            }
          } catch {
            /* fila é auxiliar — não interrompe o pós-venda */
          }
          const _hadItems = cart.length > 0
          if (impressaoConfig.imprimirAutomatico && _hadItems) {
            void printPdvSaleReceipt({
              config: impressaoConfig,
              receiptFooter: _rp.footer,
              logoUrl: storeLogoUrl,
              input: _printInput,
            })
          } else if (_hadItems) {
            setPostSalePrintInput(_printInput)
            setPostSalePrintOpen(true)
          }
          if (aPrazo > 0.02 && selectedCustomer) {
            appendContaReceberTituloPdvAprazo({
              lojaId: lojaKey,
              saleId: result.saleId,
              clienteNome: selectedCustomer.name,
              valor: aPrazo,
              aPrazoConfig,
            })
          }
          appendAuditLog({
            action: "sale_finalized",
            userLabel: auditUser(),
            detail: `Venda ${result.saleId} Total ${formatBrlAudit(total)} | Din ${formatBrlAudit(dinheiro)} Pix ${formatBrlAudit(pix)} Déb ${formatBrlAudit(cartaoDebito)} Créd ${formatBrlAudit(cartaoCredito)} Carnê ${formatBrlAudit(carne)} Prazo ${formatBrlAudit(aPrazo)} Vale ${formatBrlAudit(creditoVale)}`,
          })
          if (subtotal > 0 && discountTotal > 0) {
            const pct = (discountTotal / subtotal) * 100
            if (pct >= AUDIT_DISCOUNT_ALERT_PCT) {
              appendAuditLog({
                action: "desconto_elevado",
                userLabel: auditUser(),
                detail: `Desconto ${pct.toFixed(1)}% (${formatBrlAudit(discountTotal)}) sobre base ${formatBrlAudit(subtotal)}`,
              })
            }
          }
          setLastSaleTotal(total)
          // Venda registrada (fica em `syncPending` até o servidor confirmar): o
          // rascunho sai para o próximo mount não repor um carrinho já vendido.
          clearDraft()
          setCart([])
          setDiscountReais(0)
          setDiscountPercent(0)
          setSelectedProduct(null)
          setRapidoFlashLineId(null)
          setShellHighlightLineId(null)
          setSelectedCartLineId(null)
          setSearchTerm("")
          setBipeCode("")
          setShellNextQty("1")
          onSaleCompleted?.()
          toast({
            title: "Venda finalizada",
            description: `${payments.length} forma(s) de pagamento confirmada(s).`,
            duration: 4000,
          })
          queueMicrotask(() => {
            shellBipeRef.current?.focus()
            if (isModoRapido) {
              window.requestAnimationFrame(() => shellBipeRef.current?.focus())
            }
          })
          return true
          // Branch legado `uiShell=default` (focar productInputRef em modo rápido)
          // removida no Lote 4 — omni-smart é o único shell.
        }}
      />

      {showOperationsMenu && (
        <div className="fixed inset-0 z-[70] bg-black/10" onClick={() => setShowOperationsMenu(false)}>
          <Card
            className="fixed left-4 top-1/2 z-[90] max-h-[min(32rem,85vh)] w-[min(20rem,calc(100vw-2rem))] -translate-y-1/2 overflow-y-auto border-border bg-card shadow-xl sm:left-6 lg:left-8"
            onClick={(e) => e.stopPropagation()}
          >
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Settings className="h-4 w-4 text-primary" />
                Operações de Caixa
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button
                variant="outline"
                className="w-full justify-start border-primary/30 hover:bg-primary/10"
                onClick={() => { setShowOperationsMenu(false); setShowItemAvulsoModal(true) }}
              >
                Item Avulso
                <span className="ml-auto text-xs text-muted-foreground">INS</span>
              </Button>
              {/* Sangria/Suprimento removidos daqui: agora ficam na barra de caixa
                  compartilhada (CaixaStatusBar), única em todos os PDVs. */}
              <Button
                variant="outline"
                className="w-full justify-start border-primary/30 hover:bg-primary/10"
                onClick={() => { setShowOperationsMenu(false); setShowDevolucaoModal(true) }}
              >
                Troca / Devolução
              </Button>
              <Button variant="outline" className="w-full justify-start border-primary/30 hover:bg-primary/10" onClick={() => requestFechamentoCaixa()}>
                Fechamento de Caixa
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      <AttrProductDialog
        open={attrDialogOpen}
        onOpenChange={(open) => {
          setAttrDialogOpen(open)
          if (!open) setAttrProduct(null)
        }}
        product={attrProduct}
        attrSelections={attrSelections}
        onAttrSelectionsChange={setAttrSelections}
        onConfirm={confirmAttrDialog}
      />

      <WeightProductDialog
        open={weightDialogOpen}
        onOpenChange={(open) => {
          setWeightDialogOpen(open)
          if (!open) setWeightProduct(null)
        }}
        product={weightProduct}
        weightKgInput={weightKgInput}
        onWeightKgInputChange={setWeightKgInput}
        onConfirm={confirmWeightDialog}
        onReadScale={handleLerBalança}
        scaleBusy={scaleBusy}
      />

      <SelecionarAcessorioDialog
        open={accessoryProduct !== null}
        product={accessoryProduct}
        onCancel={() => setAccessoryProduct(null)}
        onConfirm={confirmAccessorySelection}
      />

      <Dialog open={showDevolucaoModal} onOpenChange={setShowDevolucaoModal}>
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

      <Dialog open={showKeyboardHelp} onOpenChange={setShowKeyboardHelp}>
        <DialogContent className="max-w-xl border-border bg-card p-0">
          <div className="border-b border-border px-6 py-4">
            <DialogTitle className="flex items-center gap-2 text-base font-bold">
              <Keyboard className="h-5 w-5 text-primary" />
              Atalhos de Teclado — PDV Clássico
            </DialogTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">Pressione <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-xs">F1</kbd> ou <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-xs">End</kbd> a qualquer momento para abrir esta ajuda.</p>
          </div>
          <div className="grid grid-cols-1 gap-1 p-4 sm:grid-cols-2">
            {/* Atalhos a partir do keymap-base compartilhado (fonte única). */}
            {PDV_KEYMAP.map(({ key, desc }) => (
              <div key={key} className="flex items-start gap-3 rounded-lg px-3 py-2 hover:bg-muted/50">
                <kbd className="mt-0.5 shrink-0 rounded border border-border bg-muted px-2 py-0.5 font-mono text-xs font-semibold text-foreground">{key}</kbd>
                <span className="text-sm text-muted-foreground">{desc}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-border px-6 py-3">
            <button
              onClick={() => setShowKeyboardHelp(false)}
              className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              Fechar (ESC)
            </button>
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
        logoUrl={storeLogoUrl}
        onAfterClose={focusShellBipe}
      />

      {/* Lote 4: dialog `operationType` + painel `cashHistory` REMOVIDOS.
          Sangria/suprimento e histórico vêm do CaixaStatusBar compartilhado. */}
    </div>
  )
}

