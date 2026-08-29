"use client"

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Barcode,
  Banknote,
  CreditCard,
  Layers,
  Minus,
  Plus,
  QrCode,
  Search,
  ShoppingCart,
  Trash2,
  X,
  Zap,
  ChevronUp,
  ChevronDown,
  Settings2,
  Star,
  AlertTriangle,
  Loader2,
  Check,
  RotateCcw,
  User,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import { CaixaStatusBar } from "../caixa/caixa-status-bar"
import { useCaixa } from "../caixa/caixa-provider"
import { useGarantirSessaoCaixa } from "../caixa/use-atualizar-caixa"
import { useLojaAtiva } from "@/lib/loja-ativa"
import { opsLojaIdFromStorageKey } from "@/lib/ops-loja-id"
import { useStoreSettings } from "@/lib/store-settings-provider"
import { computePdvCartTotals } from "@/lib/pdv-cart-totals"
import {
  getActiveFormasPagamento,
  getFormaMultiplo,
  getFormaPagamentoIcon,
  formaPagamentoSupermercadoQuickClasses,
  toPaymentMethodType,
} from "@/lib/pdv-formas-pagamento"
import { useOperationsStore, type InventoryItem } from "@/lib/operations-store"
import { PaymentModal, type PaymentMethodType } from "./payment-modal"
import { PdvClientePicker, type PdvClienteResult } from "./pdv-cliente-picker"
import { appendContaReceberTituloPdvAprazo } from "@/lib/pdv-append-conta-receber"
import { displaySaleNumber } from "@/lib/vendas/local-sale-identity"
import { newPdvLineId, type PdvCatalogProduct } from "@/lib/pdv-catalog"
import { findPdvProductByScan } from "@/lib/pdv-scan-product"
import { lookupPdvScanRemote } from "@/lib/pdv-scan-lookup"
import { filterPdvCatalogBySearch } from "@/lib/pdv-product-search"
import { AttrProductDialog, WeightProductDialog } from "./pdv-product-dialogs"
import { SelecionarAcessorioDialog } from "./acessorios/selecionar-acessorio-dialog"
import {
  accessoryConfigRequiresSelection,
  sameAccessoryCartLine,
  sumCartQuantityByInventoryId,
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
import { PdvPainelLateralTerminal, PdvVisorTotal } from "./painel-total"
import { PdvTabelaItemLinha, PdvTabelaItens } from "./tabela-itens"
import { getOrCreatePdvOperatorId } from "@/lib/pdv-operator-id"
import { useSession } from "next-auth/react"
import { operatorDisplayName } from "@/lib/pdv-operator-label"
import { usePdvOperadorNome } from "@/lib/pdv-operador-nome"
import { playPdvRapidoItemBeepIfEnabled } from "@/lib/pdv-rapido-feedback"
import { avulsoInventoryId, isAvulsoSaleLine } from "@/lib/os-pdv-virtual-lines"
import { ItemAvulsoModal, type ItemAvulsoPayload } from "./item-avulso-modal"
import {
  construirProdutosACadastrar,
  enfileirarProdutosACadastrar,
  acharProdutoPorCodigoExato,
} from "@/lib/pdv-produtos-a-cadastrar"
import { PdvRecebimentoModal } from "./pdv-recebimento-modal"
import { VendaEsperaModal } from "./venda-espera-modal"
import { TrocasDevolucao } from "./trocas-devolucao"
import { appendAuditLog } from "@/lib/audit-log"
import { AUDIT_DISCOUNT_ALERT_PCT } from "@/lib/audit-constants"
import { resolveCupomRodape } from "@/lib/pdv-impressao-config"
import { buildPagamentosResumo, type PdvReceiptInput } from "@/lib/escpos"
import { PdvPostSaleDialog } from "./pdv-post-sale-dialog"
import { PdvAutoPrintFeedback } from "./pdv-auto-print-feedback"
import {
  getHeldSales,
  saveHeldSale,
  removeHeldSale,
  newHoldId,
  nextHoldLabel,
  type HeldSale,
} from "@/lib/pdv-hold"
import { readSelectedTerminal } from "@/lib/pdv-terminal"

import type { VendasPDVProps } from "./pdv-classic"

/** Atalho de quantidade: `3*78912345` → quantidade 3 e código à direita do asterisco. */
function parseStarQtyAndRest(raw: string): { codePart: string; qty: number } | null {
  const t = raw.trim()
  const i = t.indexOf("*")
  if (i <= 0) return null
  const left = t.slice(0, i).trim().replace(",", ".")
  const right = t.slice(i + 1).trim()
  if (!right) return null
  const q = parseFloat(left)
  if (!Number.isFinite(q) || q <= 0) return null
  return { codePart: right, qty: q }
}

function normalizeQtyForProduct(p: PdvCatalogProduct, q: number | undefined): number {
  const base = q != null && Number.isFinite(q) && q > 0 ? q : 1
  if (p.vendaPorPeso) return base
  return Math.max(1, Math.floor(base))
}

function inventoryItemToPdvProduct(inv: InventoryItem): PdvCatalogProduct {
  const unit = inv.vendaPorPeso ? (inv.precoPorKg ?? inv.price) : inv.price
  const cat = (inv.category && inv.category.trim()) || "Produtos"
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
    category: cat,
    vendaPorPeso: inv.vendaPorPeso,
    precoPorKg: inv.precoPorKg,
    atributos: inv.atributos,
    ...(inv.accessoryConfig ? { accessoryConfig: inv.accessoryConfig } : {}),
  }
}

type Product = PdvCatalogProduct

type CartItem = {
  lineId: string
  inventoryId: string
  name: string
  price: number
  quantity: number
  vendaPorPeso?: boolean
  atributosLabel?: string
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

export function PdvSupermercado({
  linkedOsId = null,
  onSaleCompleted,
  voiceCartSeed = null,
  onVoiceCartSeedConsumed,
  voiceOpenCaixaSignal = 0,
  onVoiceOpenCaixaConsumed,
  isModoRapido = false,
}: VendasPDVProps) {
  const router = useRouter()
  const { toast } = useToast()
  const { lojaAtivaId, opsStorageKey, empresaDocumentos, getEnderecoDocumentos } = useLojaAtiva()
  const { pdvParams, blob, save: saveStoreSettings, impressaoConfig } = useStoreSettings()
  const { inventory, setInventory, finalizeSaleTransaction, getSaldoCreditoCliente } = useOperationsStore()
  const { caixa, sessaoId } = useCaixa()
  const { garantirSessao } = useGarantirSessaoCaixa()

  const [editAtalhosOpen, setEditAtalhosOpen] = useState(false)

  const lojaKey = lojaAtivaId ?? opsLojaIdFromStorageKey(opsStorageKey)
  const cashierId = useMemo(() => getOrCreatePdvOperatorId(), [])
  const { data: session } = useSession()
  const operadorNomeAbertura = usePdvOperadorNome(lojaKey)
  const operatorLabel = operatorDisplayName({ aberturaNome: operadorNomeAbertura, session })

  const productInputRef = useRef<HTMLInputElement | null>(null)
  const listEndRef = useRef<HTMLDivElement | null>(null)
  const pendingSearchQtyRef = useRef(1)
  const activeSuggestionIndexRef = useRef(-1)

  const [searchTerm, setSearchTerm] = useState("")
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1)
  const [rapidoFlashLineId, setRapidoFlashLineId] = useState<string | null>(null)
  const [cart, setCart] = useState<CartItem[]>([])
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)

  const [discountReais, setDiscountReais] = useState<number>(0)
  const [discountPercent, setDiscountPercent] = useState<number>(0)
  const [instantPayIntent, setInstantPayIntent] = useState<PaymentMethodType | null>(null)
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false)
  /** Convergência operacional: abre o modal compartilhado em modo Pagamento Múltiplo (F12 / botão "Múltiplo"). */
  const [multipayMode, setMultipayMode] = useState(false)
  /** Cliente selecionado para venda à prazo (consumidor final por padrão no supermercado). */
  const [selectedCustomer, setSelectedCustomer] = useState<{ id: string; name: string; cpf: string; phone: string } | null>(null)
  const [aPrazoClientePickerOpen, setAPrazoClientePickerOpen] = useState(false)
  const [adminSessionOk, setAdminSessionOk] = useState(false)
  const [supervisorDialogOpen, setSupervisorDialogOpen] = useState(false)
  const [supervisorPin, setSupervisorPin] = useState("")
  const [supervisorBusy, setSupervisorBusy] = useState(false)
  const [supervisorErr, setSupervisorErr] = useState<string | null>(null)
  const [supervisorAction, setSupervisorAction] = useState<"clear_cart" | "remove_line" | null>(null)
  const [pendingRemoveLineId, setPendingRemoveLineId] = useState<string | null>(null)

  const [postSalePrintOpen, setPostSalePrintOpen] = useState(false)
  const [postSalePrintInput, setPostSalePrintInput] = useState<PdvReceiptInput | null>(null)
  const [autoPrintInput, setAutoPrintInput] = useState<PdvReceiptInput | null>(null)

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
  const [showItemAvulsoModal, setShowItemAvulsoModal] = useState(false)
  const [vendaEsperaOpen, setVendaEsperaOpen] = useState(false)
  const [recebimentoOpen, setRecebimentoOpen] = useState(false)
  const [trocasOpen, setTrocasOpen] = useState(false)

  const hardFocusSearch = useCallback(() => {
    // Hard-focus: o caixa não deve precisar tocar no mouse.
    requestAnimationFrame(() => {
      productInputRef.current?.focus()
      try {
        const el = productInputRef.current
        if (!el) return
        const len = el.value.length
        el.setSelectionRange(len, len)
      } catch {
        /* ignore */
      }
    })
  }, [])

  useEffect(() => {
    const t = window.setTimeout(() => hardFocusSearch(), 100)
    return () => window.clearTimeout(t)
  }, [hardFocusSearch])

  useEffect(() => {
    if (!isModoRapido) return
    const t = window.setTimeout(() => hardFocusSearch(), 220)
    return () => window.clearTimeout(t)
  }, [isModoRapido, hardFocusSearch])

  useEffect(() => {
    if (!isModoRapido) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return
      if (isPaymentModalOpen || supervisorDialogOpen || weightDialogOpen || attrDialogOpen || accessoryProduct !== null || postSalePrintOpen) return
      if (cart.length === 0) return
      e.preventDefault()
      setCart((prev) => prev.slice(0, -1))
      queueMicrotask(hardFocusSearch)
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [isModoRapido, isPaymentModalOpen, supervisorDialogOpen, weightDialogOpen, attrDialogOpen, accessoryProduct, cart.length, hardFocusSearch])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const r = await fetch("/api/auth/admin", { method: "GET", credentials: "include", cache: "no-store" })
        const j = (await r.json().catch(() => null)) as { authenticated?: boolean }
        if (!r.ok || !j) return
        if (!cancelled) setAdminSessionOk(j?.authenticated === true)
      } catch {
        // falha transiente: manter estado anterior para evitar “fim de sessão” falso
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ block: "end" })
  }, [cart.length])

  const products = useMemo(
    () => (Array.isArray(inventory) ? inventory.map(inventoryItemToPdvProduct) : []),
    [inventory]
  )

  const quickItems = useMemo(() => {
    const byId = new Map(inventory.map((i) => [i.id, i]))
    const out: PdvCatalogProduct[] = []
    
    // Filtrar apenas os atalhos ativos
    const ativos = (pdvParams.atalhosRapidos || []).filter((a) => a.ativo !== false)
    
    for (const a of ativos) {
      const inv = byId.get(a.id)
      if (!inv) continue
      out.push(inventoryItemToPdvProduct(inv))
    }
    
    // Fallback: se não houver atalhos, retorna os 15 primeiros produtos
    if (out.length === 0) return products.slice(0, 15)
    return out
  }, [inventory, pdvParams.atalhosRapidos, products])

  const searchTrim = searchTerm.trim()

  // Busca unificada: mesma fonte que os demais PDVs (acento-insensível, multi-palavra, ranqueada).
  const filterCatalogByTerm = useCallback(
    (raw: string) => (raw.trim() ? filterPdvCatalogBySearch(products, raw).slice(0, 50) : []),
    [products]
  )

  const filteredProducts = useMemo(() => {
    // Sem busca: mostrar somente atalhos (2 fileiras).
    if (!searchTrim) return quickItems
    // Com busca: resultados reais do estoque, limitados.
    return filterCatalogByTerm(searchTrim)
  }, [filterCatalogByTerm, quickItems, searchTrim])

  /** Lista única para bipe / `findPdvProductByScan` (atalhos primeiro, depois demais itens do estoque). */
  const catalogForScan = useMemo(() => {
    const seen = new Set<string>()
    const out: PdvCatalogProduct[] = []
    for (const p of quickItems) {
      if (seen.has(p.id)) continue
      seen.add(p.id)
      out.push(p)
    }
    for (const p of products) {
      if (seen.has(p.id)) continue
      seen.add(p.id)
      out.push(p)
    }
    return out
  }, [quickItems, products])

  useEffect(() => {
    activeSuggestionIndexRef.current = -1
    setActiveSuggestionIndex(-1)
  }, [searchTrim])

  useEffect(() => {
    if (activeSuggestionIndex < 0) return
    const el = document.querySelector(`[data-pdv-suggestion-index="${activeSuggestionIndex}"]`)
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }, [activeSuggestionIndex, filteredProducts])

  const pushCartLine = useCallback(
    (params: { inventoryId: string; name: string; price: number; quantity: number; vendaPorPeso?: boolean; atributosLabel?: string; accessorySelection?: AccessorySelectionV1; cartLineKey?: string }) => {
      const lineId = newPdvLineId(params.inventoryId)
      setCart((prev) => [
        ...prev,
        {
          lineId,
          inventoryId: params.inventoryId,
          name: params.name,
          price: params.price,
          quantity: params.quantity,
          vendaPorPeso: params.vendaPorPeso,
          atributosLabel: params.atributosLabel,
          accessorySelection: params.accessorySelection,
          cartLineKey: params.cartLineKey,
        },
      ])
      if (isModoRapido) {
        setRapidoFlashLineId(lineId)
        window.setTimeout(() => setRapidoFlashLineId((h) => (h === lineId ? null : h)), 150)
        playPdvRapidoItemBeepIfEnabled()
      }
      // Limpa a busca após adicionar em QUALQUER modo (clique no card, Enter ou scan):
      // o operador fica pronto para o próximo item sem apagar o termo. (GOAL limpeza pós-ação)
      setSearchTerm("")
      queueMicrotask(() => {
        hardFocusSearch()
        if (isModoRapido) {
          window.requestAnimationFrame(() => hardFocusSearch())
        }
      })
    },
    [hardFocusSearch, isModoRapido]
  )

  const addToCart = useCallback(
    (product: Product, qtyOverride?: number) => {
      const nq = normalizeQtyForProduct(product, qtyOverride)
      if (product.stock <= 0) {
        toast({ title: "Sem estoque", description: `${product.name} está sem saldo no estoque.` })
        return
      }
      if (!product.vendaPorPeso && product.stock < nq) {
        toast({ title: "Estoque insuficiente", description: `Disponível: ${product.stock} · solicitado: ${nq}.` })
        return
      }
      // Acessório configurado (modelo/cor): intercepta ANTES da mutação do carrinho.
      if (!product.vendaPorPeso && accessoryConfigRequiresSelection(product.accessoryConfig)) {
        accessoryQtyRef.current = nq
        setAccessoryProduct(product)
        return
      }
      if (product.atributos && product.atributos.length > 0) {
        pendingSearchQtyRef.current = nq
        setAttrProduct(product)
        const init: Record<string, string> = {}
        for (const a of product.atributos) init[a.id] = a.opcoes[0] ?? ""
        setAttrSelections(init)
        setAttrDialogOpen(true)
        return
      }
      if (product.vendaPorPeso) {
        pendingSearchQtyRef.current = nq
        setAttrSelections({})
        setWeightProduct(product)
        setWeightKgInput(String(nq))
        setWeightDialogOpen(true)
        return
      }
      pushCartLine({ inventoryId: product.id, name: product.name, price: product.price, quantity: nq })
      setSelectedProduct(product)
    },
    [pushCartLine, toast]
  )

  /**
   * Confirmação do modal "Configurar acessório": mesma combinação
   * produto+modelo+cor incrementa a linha; combinação nova vira linha separada.
   * Anti-oversell agregado: soma TODAS as linhas do mesmo produto real antes de
   * comparar com o estoque. Retorna `false` para manter o modal aberto.
   */
  const confirmAccessorySelection = (line: AccessoryCartLineSnapshot): boolean => {
    const product = accessoryProduct
    if (!product) return false
    const qty = accessoryQtyRef.current
    const reserved = sumCartQuantityByInventoryId(cart, product.id)
    if (product.stock < reserved + qty) {
      toast({
        title: "Estoque insuficiente",
        description: `${product.name}: ${reserved + qty} no carrinho e disponível ${product.stock}.`,
        variant: "destructive",
      })
      return false
    }
    const existing = cart.find((i) => sameAccessoryCartLine(i.cartLineKey, line.cartLineKey))
    if (existing) {
      setCart((prev) =>
        prev.map((i) =>
          i.lineId === existing.lineId ? { ...i, quantity: i.quantity + qty } : i,
        ),
      )
      if (isModoRapido) {
        setRapidoFlashLineId(existing.lineId)
        window.setTimeout(() => setRapidoFlashLineId((h) => (h === existing.lineId ? null : h)), 150)
        playPdvRapidoItemBeepIfEnabled()
      }
      setSearchTerm("")
      queueMicrotask(hardFocusSearch)
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

  const removeFromCart = useCallback(
    (lineId: string) => {
      const removed = cart.find((i) => i.lineId === lineId)
      setCart((prev) => prev.filter((i) => i.lineId !== lineId))
      if (removed) {
        appendAuditLog({
          action: "pdv_item_removido",
          userLabel: cashierId.slice(0, 8),
          detail: `${removed.name} (qty: ${removed.vendaPorPeso ? removed.quantity.toFixed(3) : removed.quantity}) — ${brl(removed.price * removed.quantity)}`,
        })
      }
    },
    [cart, cashierId]
  )

  /** Item Avulso (INSERT) — não passa por `addToCart` porque não há produto/estoque. */
  const addItemAvulso = useCallback(
    (payload: ItemAvulsoPayload) => {
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
        { lineId, inventoryId, name: payload.description, price, quantity, isAvulso: true, custoUnitario, codigoAvulso: payload.codigo },
      ])
      setShowItemAvulsoModal(false)
      if (isModoRapido) {
        setRapidoFlashLineId(lineId)
        window.setTimeout(() => setRapidoFlashLineId((h) => (h === lineId ? null : h)), 150)
        playPdvRapidoItemBeepIfEnabled()
      }
      queueMicrotask(hardFocusSearch)
    },
    [hardFocusSearch, isModoRapido],
  )

  const updateQuantity = useCallback((lineId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.lineId !== lineId) return item
          const step = item.vendaPorPeso ? 0.05 : 1
          const next = item.quantity + delta * step
          return next > 0 ? { ...item, quantity: next } : item
        })
        .filter((x) => x.quantity > 0)
    )
  }, [])

  const subtotal = useMemo(() => cart.reduce((sum, item) => sum + item.price * item.quantity, 0), [cart])
  const pctRaw = Number(discountPercent) || 0
  const discountTotal = useMemo(() => {
    const pctPart = +(subtotal * (pctRaw / 100)).toFixed(2)
    const reaisPart = Math.max(0, Number(discountReais) || 0)
    return Math.min(pctPart + reaisPart, subtotal)
  }, [discountReais, pctRaw, subtotal])
  const { impostoEstimado, total } = useMemo(
    () => computePdvCartTotals(subtotal, discountTotal, pdvParams),
    [subtotal, discountTotal, pdvParams.incluirImpostoEstimadoNoPdv, pdvParams.aliquotaImpostoEstimadoPdv],
  )

  const formasSupermercado = useMemo(() => {
    const all = getActiveFormasPagamento(pdvParams.formasPagamento ?? [])
    const quick = all.filter((f) => {
      const runtime = toPaymentMethodType(f.id)
      return runtime && f.id !== "multiplo" && runtime !== "a_prazo" && runtime !== "carne"
    })
    return {
      quick: quick.slice(0, 3),
      multiplo: getFormaMultiplo(pdvParams.formasPagamento ?? []),
    }
  }, [pdvParams.formasPagamento])

  /**
   * Caixa fechado na tela ou sem referência de sessão utilizável: reconsulta a
   * sessão ativa da loja antes de abrir o pagamento. Mesma regra dos demais PDVs
   * — o carrinho é mantido e a venda não é enviada; o operador finaliza de novo.
   *
   * Sem esta porta, a venda seguia até `venda-persist` e voltava recusada por
   * `CAIXA_FECHADO`, ficando como pendência local (o cenário das pendências
   * fantasmas).
   */
  const caixaProntoParaFinalizar = useCallback(() => {
    if (caixa.isOpen && sessaoId?.trim()) return true
    void garantirSessao()
    hardFocusSearch()
    return false
  }, [caixa.isOpen, garantirSessao, hardFocusSearch, sessaoId])

  const openPaymentModal = useCallback(
    (intent: PaymentMethodType | null) => {
      if (cart.length === 0) {
        toast({ title: "Carrinho vazio", description: "Adicione itens para finalizar." })
        hardFocusSearch()
        return
      }
      if (!caixaProntoParaFinalizar()) return
      setInstantPayIntent(intent)
      setMultipayMode(false)
      setIsPaymentModalOpen(true)
    },
    [caixaProntoParaFinalizar, cart.length, hardFocusSearch, toast]
  )

  /** Pagamento Múltiplo — convergência operacional com PDV Assistência (F12). */
  const openMultipayModal = useCallback(() => {
    if (cart.length === 0) {
      toast({ title: "Carrinho vazio", description: "Adicione itens para finalizar." })
      hardFocusSearch()
      return
    }
    if (!caixaProntoParaFinalizar()) return
    setInstantPayIntent(null)
    setMultipayMode(true)
    setIsPaymentModalOpen(true)
  }, [caixaProntoParaFinalizar, cart.length, hardFocusSearch, toast])

  const confirmAttrDialog = useCallback(() => {
    if (!attrProduct) return
    const parts = attrProduct.atributos?.map((a) => attrSelections[a.id]).filter(Boolean) ?? []
    const label = parts.length ? `${attrProduct.name} (${parts.join(" · ")})` : attrProduct.name
    const lineQty = pendingSearchQtyRef.current
    setAttrDialogOpen(false)
    if (attrProduct.vendaPorPeso) {
      setWeightProduct(attrProduct)
      setWeightKgInput(String(lineQty))
      setWeightDialogOpen(true)
      return
    }
    pushCartLine({
      inventoryId: attrProduct.id,
      name: label,
      price: attrProduct.price,
      quantity: lineQty,
      atributosLabel: parts.join(" · "),
    })
    setSelectedProduct(attrProduct)
    setAttrProduct(null)
    queueMicrotask(hardFocusSearch)
  }, [attrProduct, attrSelections, hardFocusSearch, pushCartLine])

  const confirmWeightDialog = useCallback(() => {
    if (!weightProduct) return
    const kg = parseFloat(weightKgInput.replace(",", "."))
    if (!Number.isFinite(kg) || kg <= 0) {
      toast({ title: "Peso inválido", description: "Informe o peso em kg.", variant: "destructive" })
      return
    }
    const inv = inventory.find((i) => i.id === weightProduct.id)
    if (inv && kg > inv.stock + 0.0001) {
      toast({ title: "Estoque", description: "Peso maior que o disponível.", variant: "destructive" })
      return
    }
    const pKg = weightProduct.precoPorKg ?? weightProduct.price
    const parts = weightProduct.atributos?.length ? weightProduct.atributos.map((a) => attrSelections[a.id]).filter(Boolean) : []
    const baseName = parts.length ? `${weightProduct.name} (${parts.join(" · ")})` : weightProduct.name
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
    queueMicrotask(hardFocusSearch)
  }, [attrSelections, hardFocusSearch, inventory, pushCartLine, toast, weightKgInput, weightProduct])

  /** Leitura real de balança USB (Web Serial) — mesmo mecanismo do PDV Clássico (`services/hardware-bridge.ts`). */
  const handleLerBalança = useCallback(async () => {
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
  }, [toast])

  // Voz: item no carrinho
  useEffect(() => {
    if (!voiceCartSeed?.key) return
    const label = (voiceCartSeed.itemName || "").trim()
    if (!label) {
      onVoiceCartSeedConsumed?.()
      return
    }
    const id = `voice-${voiceCartSeed.key}`
    const unit = voiceCartSeed.price ?? 0
    setCart((prev) => [
      ...prev,
      { lineId: newPdvLineId(id), inventoryId: id, name: label, price: Math.max(0, unit), quantity: 1 },
    ])
    toast({ title: "Voz: item no carrinho", description: label })
    onVoiceCartSeedConsumed?.()
    queueMicrotask(hardFocusSearch)
  }, [hardFocusSearch, onVoiceCartSeedConsumed, toast, voiceCartSeed])

  const findProductByEan = useCallback(
    (raw: string): Product | null => findPdvProductByScan(raw, catalogForScan),
    [catalogForScan]
  )

  const submitSearch = useCallback(
    async (keyboardPickIndex?: number) => {
      if (
        keyboardPickIndex != null &&
        keyboardPickIndex >= 0 &&
        keyboardPickIndex < filteredProducts.length
      ) {
        addToCart(filteredProducts[keyboardPickIndex] as Product)
        setSearchTerm("")
        activeSuggestionIndexRef.current = -1
        setActiveSuggestionIndex(-1)
        queueMicrotask(hardFocusSearch)
        return
      }

      const rawFull = searchTerm.trim()
      if (!rawFull) return

      const star = parseStarQtyAndRest(rawFull)
      const lookupTerm = star?.codePart ?? rawFull
      const multQty = star?.qty

      const eanHit = findProductByEan(lookupTerm)
      if (eanHit) {
        addToCart(eanHit, multQty)
        setSearchTerm("")
        activeSuggestionIndexRef.current = -1
        setActiveSuggestionIndex(-1)
        queueMicrotask(hardFocusSearch)
        return
      }

      const candidates = filterCatalogByTerm(lookupTerm)
      if (candidates.length === 1) {
        addToCart(candidates[0] as Product, multQty)
        setSearchTerm("")
        activeSuggestionIndexRef.current = -1
        setActiveSuggestionIndex(-1)
        queueMicrotask(hardFocusSearch)
        return
      }
      const exact = candidates.find((p) => p.name.toLowerCase() === lookupTerm.toLowerCase())
      if (exact) {
        addToCart(exact as Product, multQty)
        setSearchTerm("")
        activeSuggestionIndexRef.current = -1
        setActiveSuggestionIndex(-1)
        queueMicrotask(hardFocusSearch)
        return
      }

      // Sem candidatos locais → busca autoritativa no catálogo INTEIRO da loja (snapshot defasado).
      if (candidates.length === 0) {
        const remote = await lookupPdvScanRemote({ code: lookupTerm, storeId: lojaKey, setInventory })
        if (remote.kind === "single") {
          addToCart(remote.product as Product, multQty)
          setSearchTerm("")
          activeSuggestionIndexRef.current = -1
          setActiveSuggestionIndex(-1)
          queueMicrotask(hardFocusSearch)
          return
        }
        if (remote.kind === "none" || remote.kind === "error") {
          toast({
            title: "Produto não encontrado",
            description: `Produto não encontrado nesta loja para o código: ${lookupTerm}`,
          })
          hardFocusSearch()
          return
        }
        // remote.kind === "multiple": itens injetados no estoque — operador escolhe na lista.
      }

      toast({
        title: "Selecione o item",
        description: "Vários resultados. Use as setas ↑↓ e Enter para escolher sem o mouse.",
      })
      hardFocusSearch()
    },
    [addToCart, filterCatalogByTerm, filteredProducts, findProductByEan, hardFocusSearch, searchTerm, toast, lojaKey, setInventory]
  )

  // Atalhos de teclado (evitar conflitos com o navegador)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
      if (
        e.key !== "F2" &&
        e.key !== "F3" &&
        e.key !== "F4" &&
        e.key !== "F7" &&
        e.key !== "F8" &&
        e.key !== "F9" &&
        e.key !== "F10" &&
        e.key !== "F12" &&
        e.key !== "Insert"
      )
        return
      // Quando modal aberto, não interceptar (deixa o modal controlar o teclado)
      if (isPaymentModalOpen || attrDialogOpen || weightDialogOpen || accessoryProduct !== null || showItemAvulsoModal || vendaEsperaOpen || recebimentoOpen || trocasOpen) return

      e.preventDefault()
      e.stopPropagation()
      if (e.key === "Insert") setShowItemAvulsoModal(true)
      else if (e.key === "F7") setVendaEsperaOpen(true)
      else if (e.key === "F8") {
        appendAuditLog({
          action: "pdv_troca_aberta",
          userLabel: cashierId.slice(0, 8),
          detail: "Painel de trocas/devoluções aberto via F8",
        })
        setTrocasOpen(true)
      } else if (e.key === "F9") setRecebimentoOpen(true)
      else if (e.key === "F10") setAPrazoClientePickerOpen(true)
      else if (e.key === "F2") {
        const r = toPaymentMethodType(formasSupermercado.quick[0]?.id ?? "dinheiro")
        if (r) openPaymentModal(r)
      } else if (e.key === "F3") {
        const r = toPaymentMethodType(formasSupermercado.quick[1]?.id ?? "pix")
        if (r) openPaymentModal(r)
      } else if (e.key === "F4") {
        const r = toPaymentMethodType(formasSupermercado.quick[2]?.id ?? "cartao_debito")
        if (r) openPaymentModal(r)
      } else if (e.key === "F12" && formasSupermercado.multiplo) openMultipayModal()
    }
    window.addEventListener("keydown", onKeyDown, { capture: true })
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true } as any)
  }, [isPaymentModalOpen, attrDialogOpen, weightDialogOpen, accessoryProduct, showItemAvulsoModal, vendaEsperaOpen, recebimentoOpen, trocasOpen, cashierId, openPaymentModal, openMultipayModal, formasSupermercado])

  const terminalIdForHold = readSelectedTerminal(lojaKey)?.id ?? "default"
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
        custoUnitario: i.custoUnitario,
        codigoAvulso: i.codigoAvulso,
        accessorySelection: i.accessorySelection,
        cartLineKey: i.cartLineKey,
      })),
      customer: null,
      discountReais,
      discountPercent,
      pdvType: "supermercado",
    }
    saveHeldSale(lojaKey, terminalIdForHold, held)
    setCart([])
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
        custoUnitario: i.custoUnitario,
        codigoAvulso: i.codigoAvulso,
        accessorySelection: i.accessorySelection,
        cartLineKey: i.cartLineKey,
      })),
    )
    setDiscountReais(sale.discountReais ?? 0)
    setDiscountPercent(sale.discountPercent ?? 0)
    removeHeldSale(lojaKey, terminalIdForHold, sale.id)
  }

  function handleDiscardHeldSale(id: string) {
    removeHeldSale(lojaKey, terminalIdForHold, id)
  }

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-background text-foreground">
      <div className="shrink-0 border-b border-border">
        <CaixaStatusBar
          variant="pdv"
          openAberturaSignal={voiceOpenCaixaSignal}
          onOpenAberturaSignalConsumed={onVoiceOpenCaixaConsumed}
        />
      </div>

      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row",
          isModoRapido && "min-h-0"
        )}
      >
        {/* ESQUERDA: Catálogo + Busca gigante */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-b border-border lg:border-b-0 lg:border-r">
          <div className={cn("shrink-0 bg-background/50 backdrop-blur-xl border-b border-border/50 px-4", isModoRapido ? "py-4" : "py-5")}>
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                {!isModoRapido ? (
                  <div className="flex items-center gap-2">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-card text-primary shadow-sm">
                      <Barcode className="h-6 w-6" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold leading-none">Busca / Código de barras</div>
                      <div className="text-xs leading-tight text-foreground/70 dark:text-white/55 mt-1">
                        Enter adiciona; quantidade×código com *; ↑↓ destaca sugestão.
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm font-bold text-muted-foreground flex items-center gap-1.5">
                    <Zap className="h-4 w-4 text-amber-500 fill-current" />
                    Modo Rápido Ativo
                  </div>
                )}
                <div className="flex items-center gap-2">
                  {!isModoRapido ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 rounded-xl border-border/50 bg-card/50 px-3 text-xs font-bold transition-all hover:bg-primary/10 hover:text-primary hover:border-primary/30"
                      onClick={() => {
                        appendAuditLog({
                          action: "pdv_troca_aberta",
                          userLabel: cashierId.slice(0, 8),
                          detail: "Painel de trocas/devoluções aberto",
                        })
                        setTrocasOpen(true)
                      }}
                      title="Troca / Devolução (F8)"
                    >
                      <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                      Trocas <span className="ml-1 text-[9px] font-normal opacity-50">[F8]</span>
                    </Button>
                  ) : null}
                  {!isModoRapido ? (
                    selectedCustomer ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 max-w-[180px] rounded-xl border-primary/30 bg-primary/10 px-3 text-xs font-bold text-primary transition-all hover:bg-primary/20"
                        onClick={() => setSelectedCustomer(null)}
                        title="Cliente identificado — clique para remover"
                      >
                        <User className="mr-1.5 h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{selectedCustomer.name}</span>
                        <X className="ml-1.5 h-3 w-3 shrink-0 opacity-60" />
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 rounded-xl border-border/50 bg-card/50 px-3 text-xs font-bold transition-all hover:bg-primary/10 hover:text-primary hover:border-primary/30"
                        onClick={() => setAPrazoClientePickerOpen(true)}
                        title="Identificar cliente / CPF (F10)"
                      >
                        <User className="mr-1.5 h-3.5 w-3.5" />
                        Cliente / CPF <span className="ml-1 text-[9px] font-normal opacity-50">[F10]</span>
                      </Button>
                    )
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 rounded-xl border-border/50 bg-card/50 px-3 text-xs font-bold transition-all hover:bg-primary/10 hover:text-primary hover:border-primary/30"
                    onClick={() => setEditAtalhosOpen(true)}
                  >
                    <Settings2 className="mr-1.5 h-3.5 w-3.5" />
                    Gerenciar Grade
                  </Button>
                </div>
              </div>

              <div className="relative group">
                <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-primary/20 to-transparent opacity-0 blur-xl transition-opacity duration-500 group-focus-within:opacity-100" />
                <Search className="pointer-events-none absolute left-5 top-1/2 h-6 w-6 -translate-y-1/2 text-foreground/40 transition-colors duration-300 group-focus-within:text-primary" />
                <input
                  ref={productInputRef}
                  autoFocus
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onKeyDown={(e) => {
                    const len = filteredProducts.length
                    if (e.key === "ArrowDown" && len > 0) {
                      e.preventDefault()
                      setActiveSuggestionIndex((prev) => {
                        const next = prev < 0 ? 0 : Math.min(len - 1, prev + 1)
                        activeSuggestionIndexRef.current = next
                        return next
                      })
                      return
                    }
                    if (e.key === "ArrowUp" && len > 0) {
                      e.preventDefault()
                      setActiveSuggestionIndex((prev) => {
                        const next = prev <= 0 ? -1 : prev - 1
                        activeSuggestionIndexRef.current = next
                        return next
                      })
                      return
                    }
                    if (e.key === "Enter") {
                      e.preventDefault()
                      const idx = activeSuggestionIndexRef.current
                      if (idx >= 0 && idx < len) {
                        submitSearch(idx)
                      } else {
                        submitSearch()
                      }
                    }
                  }}
                  placeholder="Digite produto, categoria ou escaneie o código…"
                  className="relative h-16 w-full rounded-2xl border border-border/60 bg-card/80 pl-14 pr-6 text-xl font-bold tracking-tight shadow-sm backdrop-blur-md outline-none transition-all duration-300 focus:border-primary focus:ring-2 focus:ring-primary/20 focus:shadow-lg placeholder:text-foreground/30"
                />
              </div>
            </div>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {filteredProducts.length === 0 ? (
                <div className="col-span-full flex min-h-[12rem] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-card/40 px-6 py-10 text-center">
                  <p className="text-base font-semibold text-foreground">
                    {products.length === 0
                      ? "Nenhum produto cadastrado no estoque desta unidade."
                      : searchTrim
                        ? "Nenhum produto encontrado para esta busca."
                        : "Configure os atalhos do PDV para exibir produtos rápidos aqui."}
                  </p>
                </div>
              ) : (
                filteredProducts.map((p, idx) => (
                  <button
                    key={`${p.id}-${p.category}-${idx}`}
                    type="button"
                    data-pdv-suggestion-index={idx}
                    className={cn(
                      "group relative flex flex-col rounded-2xl border p-5 text-left transition-all duration-300 hover:-translate-y-0.5 active:scale-[0.98]",
                      "bg-card text-card-foreground border-border/85 shadow-sm hover:shadow-md hover:border-primary/45",
                      "dark:bg-card/45 dark:border-border/45 dark:hover:border-primary/35 dark:shadow-none",
                      selectedProduct?.id === p.id ? "ring-2 ring-primary/50" : "",
                      activeSuggestionIndex === idx ? "ring-2 ring-primary/60 ring-offset-2 ring-offset-background" : ""
                    )}
                    onClick={() => addToCart(p as Product)}
                  >
                    {/* Fundo sutil com a cor do tema */}
                    <div className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-10 z-0" style={{ background: "linear-gradient(135deg, hsl(var(--primary)/0.15) 0%, transparent 100%)" }} />
                    
                    {/* Glow externo no hover */}
                    <div className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-100 z-0" style={{ boxShadow: "0 0 20px 1px hsl(var(--primary) / 0.12)" }} />

                    <div className="relative z-10 flex flex-1 flex-col justify-between w-full h-full">
                      <div className="line-clamp-2 min-h-[3rem] text-[15px] font-extrabold leading-tight text-foreground">
                        {p.name}
                      </div>
                      <div className="mt-3 flex items-end justify-between gap-2 border-t border-border/45 pt-3">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/80 dark:text-white/60 line-clamp-1 flex-1">
                          {p.category}
                        </div>
                        <div className="text-lg font-black tabular-nums tracking-tight text-primary">
                          R$ {Number(p.price || 0).toFixed(2)}
                        </div>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
            <div ref={listEndRef} />
          </ScrollArea>
        </div>

        {/* DIREITA: Carrinho mais largo + pagamentos gigantes */}
        <PdvPainelLateralTerminal
          className={cn(
            "lg:w-[560px] lg:min-w-[560px] border-l border-border/50 bg-card/30 backdrop-blur-2xl shadow-2xl",
            isModoRapido && "lg:w-[min(100%,440px)] lg:min-w-[320px] lg:max-w-[440px]"
          )}
        >
          <div className="shrink-0 border-b border-border/50 bg-background/40 px-5 py-4 backdrop-blur-md">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <ShoppingCart className="h-4 w-4" />
                </div>
                <div className="text-xl font-black tracking-tight">Carrinho</div>
              </div>
              <Button
                variant="outline"
                className="h-9 rounded-xl border-border/50 bg-card/50 font-bold backdrop-blur-sm hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-colors"
                onClick={() => {
                  if (cart.length === 0) return
                  if (isModoRapido) {
                    appendAuditLog({
                      action: "pdv_carrinho_limpo",
                      userLabel: cashierId.slice(0, 8),
                      detail: `${cart.length} ${cart.length === 1 ? "item" : "itens"} removidos do carrinho`,
                    })
                    setCart([])
                    setDiscountPercent(0)
                    setDiscountReais(0)
                    setSearchTerm("") // limpar busca ao limpar carrinho (GOAL limpeza pós-ação)
                    toast({ title: "Carrinho limpo" })
                    queueMicrotask(hardFocusSearch)
                    return
                  }
                  if (adminSessionOk) {
                    appendAuditLog({
                      action: "pdv_carrinho_limpo",
                      userLabel: cashierId.slice(0, 8),
                      detail: `${cart.length} ${cart.length === 1 ? "item" : "itens"} removidos do carrinho`,
                    })
                    setCart([])
                    setDiscountPercent(0)
                    setDiscountReais(0)
                    setSearchTerm("") // limpar busca ao limpar carrinho (GOAL limpeza pós-ação)
                    toast({ title: "Carrinho limpo" })
                    productInputRef.current?.focus()
                    return
                  }
                  setSupervisorAction("clear_cart")
                  setPendingRemoveLineId(null)
                  setSupervisorErr(null)
                  setSupervisorPin("")
                  setSupervisorDialogOpen(true)
                }}
                disabled={cart.length === 0}
              >
                Limpar
              </Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden">
            {cart.length === 0 ? (
              <div className="flex h-full items-center justify-center p-6 text-center">
                <div className="max-w-sm space-y-2">
                  <div className="text-lg font-bold">Carrinho vazio</div>
                  <div className="text-sm text-foreground/70 dark:text-white/55">
                    Use a busca acima (ou o leitor) para adicionar itens rapidamente.
                  </div>
                </div>
              </div>
            ) : (
              <ScrollArea className="h-full">
                <PdvTabelaItens className="p-2">
                  {cart.map((item) => (
                    <PdvTabelaItemLinha
                      key={item.lineId}
                      className={cn(
                        "rounded-lg transition-colors hover:bg-foreground/5 dark:hover:bg-white/5",
                        isModoRapido && rapidoFlashLineId === item.lineId && "pdv-rapido-row-flash"
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-extrabold">{item.name}</div>
                        <div className="mt-0.5 flex items-center gap-2 text-xs text-foreground/65 dark:text-white/50">
                          <span className="tabular-nums">R$ {item.price.toFixed(2)}</span>
                          {item.vendaPorPeso ? <span>por kg</span> : null}
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-10 w-10"
                          onClick={() => updateQuantity(item.lineId, -1)}
                        >
                          <Minus className="h-4 w-4" />
                        </Button>
                        <div className="w-16 text-center text-base font-black tabular-nums">
                          {item.vendaPorPeso ? item.quantity.toFixed(3) : item.quantity.toFixed(0)}
                        </div>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-10 w-10"
                          onClick={() => updateQuantity(item.lineId, +1)}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>

                      <div className="w-28 text-right text-base font-black tabular-nums">
                        R$ {(item.price * item.quantity).toFixed(2)}
                      </div>

                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10 text-foreground/55 hover:text-destructive dark:text-white/50"
                        onClick={() => {
                          // PDV Rápido: remoção direta (sem PIN) para alta rotatividade.
                          if (isModoRapido) {
                            removeFromCart(item.lineId)
                            queueMicrotask(hardFocusSearch)
                            return
                          }
                          if (adminSessionOk) {
                            removeFromCart(item.lineId)
                            return
                          }
                          setSupervisorAction("remove_line")
                          setPendingRemoveLineId(item.lineId)
                          setSupervisorErr(null)
                          setSupervisorPin("")
                          setSupervisorDialogOpen(true)
                        }}
                        title="Remover item"
                      >
                        {isModoRapido ? <X className="h-5 w-5" /> : <Trash2 className="h-5 w-5" />}
                      </Button>
                    </PdvTabelaItemLinha>
                  ))}
                </PdvTabelaItens>
              </ScrollArea>
            )}
          </div>

          <div className="shrink-0 border-t border-border/50 bg-background/60 p-5 backdrop-blur-xl">
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm font-bold text-muted-foreground">
                <span>Subtotal</span>
                <span className="tabular-nums">R$ {subtotal.toFixed(2)}</span>
              </div>
              {impostoEstimado > 0 ? (
                <div className="flex items-center justify-between text-sm font-bold text-muted-foreground">
                  <span>Imposto estimado</span>
                  <span className="tabular-nums">R$ {impostoEstimado.toFixed(2)}</span>
                </div>
              ) : null}
              {discountTotal > 0 ? (
                <div className="flex items-center justify-between text-sm font-bold text-destructive">
                  <span>Desconto</span>
                  <span className="tabular-nums">− R$ {discountTotal.toFixed(2)}</span>
                </div>
              ) : null}
              
              {/* Premium Visor */}
              <div className="relative overflow-hidden rounded-2xl border border-border/80 bg-gradient-to-b from-muted/50 to-muted/80 p-5 shadow-inner dark:border-border/30 dark:from-black/80 dark:to-black/95">
                <div className="absolute -right-20 -top-20 h-40 w-40 rounded-full bg-primary/10 blur-[40px] pointer-events-none dark:bg-primary/20" />
                <div className="relative z-10 flex flex-col">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground dark:text-white/50 mb-0.5">Total a pagar</span>
                  <span className="text-3xl sm:text-4xl font-black tabular-nums tracking-tight text-foreground dark:text-white dark:drop-shadow-[0_0_12px_rgba(255,255,255,0.25)]">
                    R$ {total.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>

            {/* Botoes SaaS Premium */}
            <div className="mt-5 grid grid-cols-3 gap-3">
              {formasSupermercado.quick.map((forma, idx) => {
                const runtime = toPaymentMethodType(forma.id)
                if (!runtime) return null
                const Icon = getFormaPagamentoIcon(forma.icon)
                const hotkey = forma.hotkey ?? (idx === 0 ? "F2" : idx === 1 ? "F3" : idx === 2 ? "F4" : undefined)
                return (
                  <Button
                    key={forma.id}
                    type="button"
                    className={cn(
                      "group relative h-16 rounded-2xl border shadow-sm backdrop-blur-md transition-all hover:-translate-y-0.5",
                      formaPagamentoSupermercadoQuickClasses(forma.cor),
                    )}
                    onClick={() => openPaymentModal(runtime)}
                    title={forma.label}
                  >
                    <div className="flex flex-col items-center gap-1">
                      <Icon className="h-5 w-5 transition-transform group-hover:scale-110" />
                      <span className="text-[11px] font-bold uppercase tracking-wider">
                        {forma.shortLabel}
                        {hotkey ? (
                          <span className="ml-0.5 text-[9px] font-normal opacity-50">[{hotkey}]</span>
                        ) : null}
                      </span>
                    </div>
                  </Button>
                )
              })}
            </div>

            {formasSupermercado.multiplo ? (
              <Button
                type="button"
                variant="outline"
                title="Pagamento Múltiplo (F12) — informe o valor parcial e escolha a forma; repita até zerar"
                className="mt-3 h-12 w-full rounded-2xl border border-violet-500/40 bg-violet-500/5 text-xs font-extrabold uppercase tracking-wider text-violet-700 backdrop-blur-sm transition-all hover:bg-violet-500/10 hover:text-violet-700 dark:border-violet-400/40 dark:bg-violet-500/10 dark:text-violet-300 dark:hover:bg-violet-500/15"
                onClick={openMultipayModal}
                disabled={cart.length === 0}
              >
                {(() => {
                  const Icon = getFormaPagamentoIcon(formasSupermercado.multiplo.icon)
                  return <Icon className="mr-2 h-4 w-4" />
                })()}
                {formasSupermercado.multiplo.shortLabel}{" "}
                <span className="ml-1 text-[9px] font-normal opacity-50">[F12]</span>
              </Button>
            ) : null}
          </div>
        </PdvPainelLateralTerminal>
      </div>

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
        onClose={() => {
          setIsPaymentModalOpen(false)
          setInstantPayIntent(null)
          setMultipayMode(false)
          queueMicrotask(hardFocusSearch)
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
        customerStoreCredit={getSaldoCreditoCliente(selectedCustomer?.cpf ?? "")}
        instantPayIntent={instantPayIntent}
        onInstantPayIntentConsumed={() => setInstantPayIntent(null)}
        onCustomerCpfUpdate={(id, cpf) =>
          setSelectedCustomer((prev) => (prev && prev.id === id ? { ...prev, cpf } : prev))
        }
        multipayHint={multipayMode}
        onRequireCustomer={() => setAPrazoClientePickerOpen(true)}
        cashierId={cashierId}
        onConfirm={async (payments, meta) => {
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
            itens: cart.map((i) => ({ name: i.name, quantity: i.quantity, unitPrice: i.price, lineTotal: i.price * i.quantity })),
            subtotal,
            taxes: impostoEstimado,
            discount: discountTotal,
            total,
            dataHora: new Date().toLocaleString("pt-BR"),
          }
          const _hadItems = cart.length > 0

          const saleLines = cart
            .filter(
              (item) =>
                isAvulsoSaleLine(item.inventoryId) || inventory.some((i) => i.id === item.inventoryId),
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
          if (meta?.cashTendered != null && dinheiro > 0.005) {
            const cashTendered = Number(meta.cashTendered)
            if (Number.isFinite(cashTendered) && cashTendered >= dinheiro) {
              _printInput.cashTendered = Math.round(cashTendered * 100) / 100
              _printInput.troco = Math.max(0, Math.round((cashTendered - dinheiro) * 100) / 100)
            }
          }

          const result = await finalizeSaleTransaction({
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
            customerCpf: selectedCustomer?.cpf,
            customerName: selectedCustomer?.name,
            clienteId: selectedCustomer?.id || undefined,
            auditMeta: {
              cashierId: meta?.cashierId ?? cashierId,
              discountAuthorizedByAdminId: meta?.discountAuthorizedByAdminId,
              discountReais: meta?.discountReais ?? discountReais,
              discountPercent: meta?.discountPercent ?? discountPercent,
            },
            aPrazoConfig,
            pixQrKind: meta?.pixQrKind,
            cashTendered: meta?.cashTendered,
          })

          if (!result.ok) {
            toast({ title: "Falha transacional", description: result.reason })
            return
          }
          _printInput.numeroVenda = displaySaleNumber(result.saleId, result.pending)
          if (aPrazo > 0.02 && selectedCustomer && !result.pending) {
            appendContaReceberTituloPdvAprazo({
              lojaId: lojaKey,
              saleId: result.saleId,
              clienteNome: selectedCustomer.name,
              valor: aPrazo,
              aPrazoConfig,
            })
          }
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

          appendAuditLog({
            action: "sale_finalized",
            userLabel: cashierId.slice(0, 8),
            detail: `Venda ${result.saleId} Total ${brl(total)} | Din ${brl(dinheiro)} Pix ${brl(pix)} Déb ${brl(cartaoDebito)} Créd ${brl(cartaoCredito)} Carnê ${brl(carne)} Prazo ${brl(aPrazo)} Vale ${brl(creditoVale)}`,
          })
          if (subtotal > 0 && discountTotal > 0) {
            const pct = (discountTotal / subtotal) * 100
            if (pct >= AUDIT_DISCOUNT_ALERT_PCT) {
              appendAuditLog({
                action: "desconto_elevado",
                userLabel: cashierId.slice(0, 8),
                detail: `Desconto ${pct.toFixed(1)}% (${brl(discountTotal)}) sobre base ${brl(subtotal)}`,
              })
            }
          }

          setCart([])
          setSelectedCustomer(null)
          setDiscountReais(0)
          setDiscountPercent(0)
          setSelectedProduct(null)
          setRapidoFlashLineId(null)
          setSearchTerm("")
          setIsPaymentModalOpen(false)
          setInstantPayIntent(null)
          onSaleCompleted?.()
          toast({
            title: "Venda finalizada",
            description: `${payments.length} forma(s) de pagamento confirmada(s).`,
          })

          // Pós-venda: impressão automática ou popup de oferta
          if (impressaoConfig.imprimirAutomatico && _hadItems) {
            setAutoPrintInput(_printInput)
          } else if (_hadItems) {
            setPostSalePrintInput(_printInput)
            setPostSalePrintOpen(true)
          }

          queueMicrotask(() => {
            hardFocusSearch()
            if (isModoRapido) {
              window.requestAnimationFrame(() => hardFocusSearch())
            }
          })
        }}
      />

      <ItemAvulsoModal
        open={showItemAvulsoModal}
        onOpenChange={setShowItemAvulsoModal}
        onConfirm={addItemAvulso}
        checkCodigoExistente={(c) => acharProdutoPorCodigoExato(inventory, c)}
      />

      <PdvRecebimentoModal
        open={recebimentoOpen}
        onOpenChange={(open) => {
          setRecebimentoOpen(open)
          if (!open) queueMicrotask(hardFocusSearch)
        }}
        preselectedCustomerName={null}
        formasPagamento={pdvParams.formasPagamento ?? []}
        impressaoConfig={impressaoConfig}
        hotkeyLabel="F9"
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

      {/* F8 — Troca / Devolução real (reaproveita o fluxo compartilhado TrocasDevolucao) */}
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
        onAfterClose={() => queueMicrotask(hardFocusSearch)}
      />

      <PdvAutoPrintFeedback
        printInput={autoPrintInput}
        impressaoConfig={impressaoConfig}
        onDismiss={() => setAutoPrintInput(null)}
      />

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

      <EditarAtalhosModal
        open={editAtalhosOpen}
        catalog={products}
        catalogForAdd={products}
        savedAtalhos={pdvParams.atalhosRapidos || []}
        onSave={(atalhos) => {
          void saveStoreSettings({
            printerConfig: {
              ...blob,
              pdvParams: { ...blob?.pdvParams, atalhosRapidos: atalhos },
            },
          }).then(() => {
            toast({
              title: "Grade atualizada",
              description: "Os atalhos rápidos foram salvos com sucesso.",
            })
          }).catch(() => {
            toast({
              title: "Erro ao salvar",
              description: "Não foi possível sincronizar com o servidor.",
              variant: "destructive",
            })
          })
        }}
        onClose={() => setEditAtalhosOpen(false)}
      />

      <Dialog
        open={supervisorDialogOpen}
        onOpenChange={(open) => {
          setSupervisorDialogOpen(open)
          if (!open) {
            setSupervisorPin("")
            setSupervisorErr(null)
            setSupervisorBusy(false)
            setSupervisorAction(null)
            setPendingRemoveLineId(null)
          }
        }}
      >
        <DialogContent className="max-w-sm border-border bg-card">
          <DialogHeader>
            <DialogTitle>Senha do Supervisor</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {supervisorAction === "remove_line"
                ? "Excluir item exige autorização de administrador."
                : "Cancelar/limpar venda exige autorização de administrador."}
            </p>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Senha</Label>
              <Input
                type="password"
                value={supervisorPin}
                onChange={(e) => setSupervisorPin(e.target.value)}
                placeholder="PIN"
                autoComplete="off"
                className="h-11"
              />
            </div>
            {supervisorErr ? <p className="text-xs text-destructive">{supervisorErr}</p> : null}
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setSupervisorDialogOpen(false)}>
                Cancelar
              </Button>
              <Button
                type="button"
                className="flex-1 bg-emerald-600 font-bold text-zinc-950 hover:bg-emerald-500 disabled:opacity-50"
                disabled={supervisorBusy || supervisorPin.trim().length === 0}
                onClick={async () => {
                  setSupervisorErr(null)
                  setSupervisorBusy(true)
                  try {
                    const r = await fetch("/api/auth/admin", {
                      method: "POST",
                      credentials: "include",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ pin: supervisorPin.trim() }),
                    })
                    if (!r.ok) {
                      setSupervisorErr("Senha inválida.")
                      setAdminSessionOk(false)
                      return
                    }
                    setAdminSessionOk(true)
                    if (supervisorAction === "remove_line" && pendingRemoveLineId) {
                      removeFromCart(pendingRemoveLineId)
                      toast({ title: "Item removido", description: "Autorizado pelo supervisor." })
                    } else {
                      appendAuditLog({
                        action: "pdv_carrinho_limpo",
                        userLabel: cashierId.slice(0, 8),
                        detail: `${cart.length} ${cart.length === 1 ? "item" : "itens"} removidos do carrinho — autorizado pelo supervisor`,
                      })
                      setCart([])
                      setDiscountPercent(0)
                      setDiscountReais(0)
                      setSearchTerm("") // limpar busca ao limpar carrinho (GOAL limpeza pós-ação)
                      toast({ title: "Carrinho limpo", description: "Autorizado pelo supervisor." })
                    }
                    setSupervisorDialogOpen(false)
                    queueMicrotask(hardFocusSearch)
                  } catch {
                    setSupervisorErr("Falha ao validar senha.")
                    setAdminSessionOk(false)
                  } finally {
                    setSupervisorBusy(false)
                  }
                }}
              >
                Autorizar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Atalhos types + helpers ──────────────────────────────────────────────────

type AtalhoSaved = {
  id: string
  nome: string
  preco: number
  inventoryId?: string
  categoria?: string
  ativo?: boolean
  favorito?: boolean
  cor?: string
  posicao?: number
}

type AtalhoEntry = {
  id: string
  nome: string
  preco: number
  categoria: string
  ativo: boolean
  favorito: boolean
  stockAtual: number
  barcode?: string
  sku?: string
}

const MAX_SVC = 12
const MAX_PRD = 24

const brl = (v: number) => `R$ ${Number(v || 0).toFixed(2)}`

function toAtalhoEntry(a: AtalhoSaved, catalog: Product[]): AtalhoEntry {
  const live = catalog.find((p) => p.id === a.id)
  const isService = (a.categoria ?? live?.category ?? "") === "Servicos"
  return {
    id: a.id,
    nome: live?.name ?? a.nome,
    preco: live?.price ?? a.preco,
    categoria: a.categoria ?? live?.category ?? "Outros",
    ativo: a.ativo !== false,
    favorito: a.favorito ?? false,
    stockAtual: live?.stock ?? (isService ? 999 : 0),
    barcode: live?.barcode ?? live?.codigoBarras,
    sku: live?.sku ?? live?.codigo,
  }
}

function fromAtalhoEntry(e: AtalhoEntry): AtalhoSaved {
  return { id: e.id, nome: e.nome, preco: e.preco, categoria: e.categoria, inventoryId: e.id, ativo: e.ativo, favorito: e.favorito }
}

// ─── EditarAtalhosModal ───────────────────────────────────────────────────────

function EditarAtalhosModal({
  open,
  catalog = [],
  catalogForAdd = [],
  savedAtalhos,
  onSave,
  onClose,
}: {
  open: boolean
  catalog?: Product[]
  catalogForAdd?: Product[]
  savedAtalhos: AtalhoSaved[]
  onSave: (atalhos: AtalhoSaved[]) => void
  onClose: () => void
}) {
  const [entries, setEntries] = useState<AtalhoEntry[]>([])
  const [modalTab, setModalTab] = useState<"atalhos" | "adicionar">("atalhos")
  const [catSearch, setCatSearch] = useState("")
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setEntries(savedAtalhos.map((a) => toAtalhoEntry(a, catalog)))
    setModalTab("atalhos")
    setCatSearch("")
    setIsSaving(false)
  }, [open, savedAtalhos, catalog])

  const svcEntries = useMemo(
    () => entries.map((e, i) => ({ ...e, _idx: i })).filter((e) => e.categoria === "Servicos"),
    [entries],
  )
  const prdEntries = useMemo(
    () => entries.map((e, i) => ({ ...e, _idx: i })).filter((e) => e.categoria !== "Servicos"),
    [entries],
  )
  const svcActive = svcEntries.filter((e) => e.ativo).length
  const prdActive = prdEntries.filter((e) => e.ativo).length
  const addedIds = useMemo(() => new Set(entries.map((e) => e.id)), [entries])

  const catSearchLow = catSearch.toLowerCase().trim()
  const catalogFiltered = useMemo(
    () =>
      catSearchLow
        ? catalogForAdd.filter(
            (p) =>
              p.name.toLowerCase().includes(catSearchLow) ||
              p.category.toLowerCase().includes(catSearchLow) ||
              (p.sku ?? "").toLowerCase().includes(catSearchLow) ||
              (p.barcode ?? "").includes(catSearchLow),
          )
        : catalogForAdd,
    [catalogForAdd, catSearchLow],
  )

  const moveWithinGroup = (idx: number, dir: -1 | 1) => {
    const isService = entries[idx].categoria === "Servicos"
    const step = dir < 0 ? -1 : 1
    let target = -1
    for (let i = idx + step; i >= 0 && i < entries.length; i += step) {
      if ((entries[i].categoria === "Servicos") === isService) { target = i; break }
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

  const addFromCatalog = (p: Product) => {
    if (addedIds.has(p.id)) return
    const isService = p.category === "Servicos"
    if (isService && svcEntries.length >= MAX_SVC) return
    if (!isService && prdEntries.length >= MAX_PRD) return
    setEntries((prev) => [
      ...prev,
      { id: p.id, nome: p.name, preco: p.price, categoria: p.category, ativo: true, favorito: false, stockAtual: p.stock, barcode: p.barcode, sku: p.sku ?? p.codigo },
    ])
  }

  const handleSave = () => {
    setIsSaving(true)
    onSave(entries.map(fromAtalhoEntry))
    onClose()
  }

  const renderRow = (e: AtalhoEntry & { _idx: number }, isFirstInGroup: boolean, isLastInGroup: boolean) => {
    const isService = e.categoria === "Servicos"
    const outOfStock = !isService && e.stockAtual <= 0

    return (
      <div
        key={e.id}
        className={cn(
          "flex items-center gap-1.5 rounded-xl border px-2.5 py-2 transition-all",
          e.ativo ? "border-border bg-background" : "border-border/50 bg-muted/30 opacity-60",
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
              <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-px text-[9px] font-semibold text-amber-600 dark:text-amber-400">
                sem estoque
              </span>
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
          <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
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
                  <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", svcActive >= MAX_SVC ? "bg-destructive/10 text-destructive border border-destructive/20" : "bg-secondary text-secondary-foreground")}>
                    {svcActive}/{MAX_SVC} ativos
                  </span>
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

              <div className="h-px bg-border my-4" />

              {/* Produtos */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Produtos</p>
                  <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", prdActive >= MAX_PRD ? "bg-destructive/10 text-destructive border border-destructive/20" : "bg-secondary text-secondary-foreground")}>
                    {prdActive}/{MAX_PRD} ativos
                  </span>
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
              <div className="sticky top-0 z-10 border-b border-border bg-card px-6 py-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    autoFocus
                    value={catSearch}
                    onChange={(e) => setCatSearch(e.target.value)}
                    placeholder="Buscar por nome, categoria, SKU ou código de barras…"
                    className="h-9 w-full rounded-xl border border-border bg-background pl-9 text-sm outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                  />
                </div>
              </div>

              {/* Lista de itens reais */}
              <div className="space-y-1 px-6 py-3">
                {catalogForAdd.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-10 text-center">
                    <AlertTriangle className="h-6 w-6 text-muted-foreground/40" />
                    <p className="text-sm font-medium text-muted-foreground">
                      Nenhum produto real encontrado nesta loja.
                    </p>
                    <p className="text-xs text-muted-foreground/60">
                      Cadastre itens em Estoque para adicioná-los como atalhos.
                    </p>
                  </div>
                ) : catalogFiltered.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    Nenhum resultado para &ldquo;{catSearch}&rdquo;.
                  </p>
                ) : (
                  catalogFiltered.map((p) => {
                    const isAdded = addedIds.has(p.id)
                    const isService = p.category === "Servicos"
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
                            <span className="text-[10px] text-muted-foreground">{p.category}</span>
                            {p.sku && <span className="rounded bg-muted px-1 text-[9px] text-muted-foreground">{p.sku}</span>}
                            {outOfStock && (
                              <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-px text-[9px] font-semibold text-amber-600">
                                sem estoque
                              </span>
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

