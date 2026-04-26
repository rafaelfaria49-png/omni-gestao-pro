"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Barcode,
  Banknote,
  CreditCard,
  Minus,
  Plus,
  QrCode,
  Search,
  Trash2,
  Zap,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import { CaixaStatusBar } from "../caixa/caixa-status-bar"
import { useLojaAtiva } from "@/lib/loja-ativa"
import { opsLojaIdFromStorageKey } from "@/lib/ops-loja-id"
import { useStoreSettings } from "@/lib/store-settings-provider"
import { useOperationsStore } from "@/lib/operations-store"
import { PaymentModal, type PaymentMethodType } from "./payment-modal"
import {
  PDV_PRODUCTS_BASE,
  mergePdvCatalogWithInventory,
  newPdvLineId,
  type PdvCatalogProduct,
} from "@/lib/pdv-catalog"
import { AttrProductDialog, WeightProductDialog } from "./pdv-product-dialogs"
import { PdvPainelLateralTerminal, PdvVisorTotal } from "./painel-total"
import { PdvTabelaItemLinha, PdvTabelaItens } from "./tabela-itens"
import { getOrCreatePdvOperatorId } from "@/lib/pdv-operator-id"

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

type Product = PdvCatalogProduct

type CartItem = {
  lineId: string
  inventoryId: string
  name: string
  price: number
  quantity: number
  vendaPorPeso?: boolean
  atributosLabel?: string
}

export function PdvSupermercado({
  linkedOsId = null,
  onSaleCompleted,
  voiceCartSeed = null,
  onVoiceCartSeedConsumed,
  voiceOpenCaixaSignal = 0,
  onVoiceOpenCaixaConsumed,
}: VendasPDVProps) {
  const router = useRouter()
  const { toast } = useToast()
  const { lojaAtivaId, opsStorageKey } = useLojaAtiva()
  const { pdvParams } = useStoreSettings()
  const { inventory, finalizeSaleTransaction, getSaldoCreditoCliente } = useOperationsStore()

  const lojaKey = lojaAtivaId ?? opsLojaIdFromStorageKey(opsStorageKey)
  const cashierId = useMemo(() => getOrCreatePdvOperatorId(), [])

  const productInputRef = useRef<HTMLInputElement | null>(null)
  const listEndRef = useRef<HTMLDivElement | null>(null)
  const pendingSearchQtyRef = useRef(1)
  const activeSuggestionIndexRef = useRef(-1)

  const [searchTerm, setSearchTerm] = useState("")
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1)
  const [cart, setCart] = useState<CartItem[]>([])
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)

  const [discountReais, setDiscountReais] = useState<number>(0)
  const [discountPercent, setDiscountPercent] = useState<number>(0)
  const [instantPayIntent, setInstantPayIntent] = useState<PaymentMethodType | null>(null)
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false)
  const [adminSessionOk, setAdminSessionOk] = useState(false)
  const [supervisorDialogOpen, setSupervisorDialogOpen] = useState(false)
  const [supervisorPin, setSupervisorPin] = useState("")
  const [supervisorBusy, setSupervisorBusy] = useState(false)
  const [supervisorErr, setSupervisorErr] = useState<string | null>(null)
  const [supervisorAction, setSupervisorAction] = useState<"clear_cart" | "remove_line" | null>(null)
  const [pendingRemoveLineId, setPendingRemoveLineId] = useState<string | null>(null)

  const [weightDialogOpen, setWeightDialogOpen] = useState(false)
  const [weightProduct, setWeightProduct] = useState<Product | null>(null)
  const [weightKgInput, setWeightKgInput] = useState("")
  const [attrDialogOpen, setAttrDialogOpen] = useState(false)
  const [attrProduct, setAttrProduct] = useState<Product | null>(null)
  const [attrSelections, setAttrSelections] = useState<Record<string, string>>({})

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

  const quickItems = useMemo(() => {
    return (pdvParams.atalhosRapidos || []).map((a) => ({
      id: a.id,
      name: a.nome,
      price: a.preco,
      stock: 999,
      category: "Atalho",
    }))
  }, [pdvParams.atalhosRapidos])

  const products = useMemo(() => mergePdvCatalogWithInventory(PDV_PRODUCTS_BASE, inventory), [inventory])

  const searchTrim = searchTerm.trim()

  const filterCatalogByTerm = useCallback(
    (raw: string) => {
      const term = raw.trim().toLowerCase()
      if (!term) return [...quickItems, ...products].slice(0, 60)
      const list = [...quickItems, ...products]
      return list.filter((p) => p.name.toLowerCase().includes(term) || p.category.toLowerCase().includes(term)).slice(0, 80)
    },
    [products, quickItems]
  )

  const filteredProducts = useMemo(() => filterCatalogByTerm(searchTrim), [filterCatalogByTerm, searchTrim])

  useEffect(() => {
    activeSuggestionIndexRef.current = -1
    setActiveSuggestionIndex(-1)
  }, [searchTrim])

  useEffect(() => {
    if (activeSuggestionIndex < 0) return
    const el = document.querySelector(`[data-pdv-suggestion-index="${activeSuggestionIndex}"]`)
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }, [activeSuggestionIndex, filteredProducts])

  const pushCartLine = useCallback((params: { inventoryId: string; name: string; price: number; quantity: number; vendaPorPeso?: boolean; atributosLabel?: string }) => {
    setCart((prev) => [
      ...prev,
      {
        lineId: newPdvLineId(params.inventoryId),
        inventoryId: params.inventoryId,
        name: params.name,
        price: params.price,
        quantity: params.quantity,
        vendaPorPeso: params.vendaPorPeso,
        atributosLabel: params.atributosLabel,
      },
    ])
    queueMicrotask(hardFocusSearch)
  }, [hardFocusSearch])

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

  const removeFromCart = useCallback((lineId: string) => setCart((prev) => prev.filter((i) => i.lineId !== lineId)), [])

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
  const total = useMemo(() => Math.max(0, subtotal - discountTotal), [discountTotal, subtotal])

  const openPaymentModal = useCallback(
    (intent: PaymentMethodType | null) => {
      if (cart.length === 0) {
        toast({ title: "Carrinho vazio", description: "Adicione itens para finalizar." })
        hardFocusSearch()
        return
      }
      setInstantPayIntent(intent)
      setIsPaymentModalOpen(true)
    },
    [cart.length, hardFocusSearch, toast]
  )

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
    (raw: string): Product | null => {
      const digits = raw.replace(/\D/g, "")
      if (digits.length < 8) return null
      const list = [...quickItems, ...products] as any[]
      const hit = list.find((p) => {
        // PRIMEIRO: barcode dedicado.
        const barcodeDigits = String((p as any)?.barcode ?? "").replace(/\D/g, "")
        if (barcodeDigits && barcodeDigits === digits) return true
        // Fallbacks (legado): ean/gtin e, por último, id.
        const maybeBarcode = String((p as any)?.ean ?? (p as any)?.gtin ?? "").replace(/\D/g, "")
        return maybeBarcode && maybeBarcode === digits
      })
      if (hit) return hit as Product
      const fallbackById = list.find((p) => String(p?.id ?? "").replace(/\D/g, "") === digits)
      return (fallbackById as Product) || null
    },
    [products, quickItems]
  )

  const submitSearch = useCallback(
    (keyboardPickIndex?: number) => {
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

      toast({
        title: "Selecione o item",
        description: "Vários resultados. Use as setas ↑↓ e Enter para escolher sem o mouse.",
      })
      hardFocusSearch()
    },
    [addToCart, filterCatalogByTerm, filteredProducts, findProductByEan, hardFocusSearch, searchTerm, toast]
  )

  // Atalhos de teclado (evitar conflitos com o navegador)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
      if (e.key !== "F2" && e.key !== "F3" && e.key !== "F4") return
      // Quando modal aberto, não interceptar (deixa o modal controlar o teclado)
      if (isPaymentModalOpen) return

      e.preventDefault()
      e.stopPropagation()
      if (e.key === "F2") openPaymentModal("dinheiro")
      else if (e.key === "F3") openPaymentModal("pix")
      else openPaymentModal("cartao_debito")
    }
    window.addEventListener("keydown", onKeyDown, { capture: true })
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true } as any)
  }, [isPaymentModalOpen, openPaymentModal])

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-background text-foreground">
      <div className="shrink-0 border-b border-border">
        <CaixaStatusBar
          variant="pdv"
          openAberturaSignal={voiceOpenCaixaSignal}
          onOpenAberturaSignalConsumed={onVoiceOpenCaixaConsumed}
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        {/* ESQUERDA: Catálogo + Busca gigante */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-b border-border lg:border-b-0 lg:border-r">
          <div className="shrink-0 bg-background px-3 py-3">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-card text-blue-400 shadow-sm">
                  <Barcode className="h-6 w-6" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold leading-none">Busca / Código de barras</div>
                  <div className="text-xs leading-tight text-foreground/70 dark:text-white/55">
                    Enter adiciona; quantidade×código com *; ↑↓ destaca sugestão.
                  </div>
                </div>
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-6 w-6 -translate-y-1/2 text-foreground/50 dark:text-white/45" />
                <Input
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
                  className="h-16 rounded-2xl border border-border bg-card/60 pl-14 text-xl font-black tracking-tight shadow-sm backdrop-blur-sm"
                />
              </div>
            </div>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {filteredProducts.map((p, idx) => (
                <button
                  key={`${p.id}-${p.category}-${idx}`}
                  type="button"
                  data-pdv-suggestion-index={idx}
                  className={cn(
                    "group rounded-2xl border border-border bg-card/80 p-3 text-left shadow-sm backdrop-blur-sm transition hover:border-blue-500/35 hover:shadow-md",
                    selectedProduct?.id === p.id ? "ring-2 ring-blue-500/35" : "",
                    activeSuggestionIndex === idx ? "ring-2 ring-emerald-400/70 ring-offset-2 ring-offset-background" : ""
                  )}
                  onClick={() => addToCart(p as Product)}
                >
                  <div className="line-clamp-2 min-h-[2.5rem] text-sm font-extrabold leading-snug">
                    {p.name}
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 border-t border-border/60 pt-2">
                    <div className="text-xs font-semibold text-foreground/60 dark:text-white/50">{p.category}</div>
                    <div className="text-sm font-black tabular-nums text-emerald-400">
                      R$ {Number(p.price || 0).toFixed(2)}
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <div ref={listEndRef} />
          </ScrollArea>
        </div>

        {/* DIREITA: Carrinho mais largo + pagamentos gigantes */}
        <PdvPainelLateralTerminal className="lg:w-[560px] lg:min-w-[560px]">
          <div className="shrink-0 border-b border-white/10 bg-black/20 px-3 py-3 backdrop-blur-md dark:bg-black/30">
            <div className="flex items-center justify-between">
              <div className="text-lg font-black tracking-tight">Carrinho</div>
              <Button
                variant="outline"
                className="h-10 rounded-2xl border-border bg-background/80 font-bold backdrop-blur-sm"
                onClick={() => {
                  if (cart.length === 0) return
                  if (adminSessionOk) {
                    setCart([])
                    setDiscountPercent(0)
                    setDiscountReais(0)
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
                    <PdvTabelaItemLinha key={item.lineId}>
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
                      >
                        <Trash2 className="h-5 w-5" />
                      </Button>
                    </PdvTabelaItemLinha>
                  ))}
                </PdvTabelaItens>
              </ScrollArea>
            )}
          </div>

          <div className="shrink-0 border-t border-white/10 bg-black/25 p-3 backdrop-blur-md dark:bg-black/35">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm font-semibold">
                <span className="text-foreground/70 dark:text-white/55">Subtotal</span>
                <span className="font-black tabular-nums">R$ {subtotal.toFixed(2)}</span>
              </div>
              {discountTotal > 0 ? (
                <div className="flex items-center justify-between text-sm font-semibold">
                  <span className="text-foreground/70 dark:text-white/55">Desconto</span>
                  <span className="font-black tabular-nums">− R$ {discountTotal.toFixed(2)}</span>
                </div>
              ) : null}
              <div className="border-t border-white/5 pt-2">
                <PdvVisorTotal label="Total a pagar" valorFormatado={`R$ ${total.toFixed(2)}`} />
              </div>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2">
              <Button
                type="button"
                className="h-14 rounded-2xl bg-emerald-600 text-base font-black text-zinc-950 shadow-lg shadow-emerald-950/30 hover:bg-emerald-500"
                onClick={() => openPaymentModal("dinheiro")}
              >
                <Banknote className="mr-2 h-5 w-5" /> Dinheiro <span className="ml-2 text-sm font-black opacity-90">[F2]</span>
              </Button>
              <Button
                type="button"
                className="h-14 rounded-2xl bg-emerald-600 text-base font-black text-zinc-950 shadow-lg shadow-emerald-950/30 hover:bg-emerald-500"
                onClick={() => openPaymentModal("pix")}
              >
                <QrCode className="mr-2 h-5 w-5" /> PIX <span className="ml-2 text-sm font-black opacity-90">[F3]</span>
              </Button>
              <Button
                type="button"
                className="h-14 rounded-2xl bg-emerald-600 text-base font-black text-zinc-950 shadow-lg shadow-emerald-950/30 hover:bg-emerald-500"
                onClick={() => openPaymentModal("cartao_debito")}
                title="Cartão (débito)"
              >
                <CreditCard className="mr-2 h-5 w-5" /> Cartão <span className="ml-2 text-sm font-black opacity-90">[F4]</span>
              </Button>
            </div>

            <Button
              type="button"
              variant="outline"
              className="mt-2 h-12 w-full rounded-2xl border-2 border-border bg-background/80 text-base font-black backdrop-blur-sm hover:bg-foreground/5 dark:border-white/10 dark:bg-black/50 dark:hover:bg-black/70"
              onClick={() => openPaymentModal(null)}
              disabled={cart.length === 0}
            >
              <Zap className="mr-2 h-5 w-5" /> Finalizar (outros)
            </Button>
          </div>
        </PdvPainelLateralTerminal>
      </div>

      <PaymentModal
        isOpen={isPaymentModalOpen}
        onClose={() => {
          setIsPaymentModalOpen(false)
          setInstantPayIntent(null)
          queueMicrotask(hardFocusSearch)
        }}
        cartSubtotal={subtotal}
        total={total}
        discountReais={discountReais}
        discountPercent={discountPercent}
        onDiscountReaisChange={setDiscountReais}
        onDiscountPercentChange={setDiscountPercent}
        custoPeca={total * 0.35}
        selectedCustomer={null}
        customerStoreCredit={getSaldoCreditoCliente("")}
        instantPayIntent={instantPayIntent}
        onInstantPayIntentConsumed={() => setInstantPayIntent(null)}
        onCustomerCpfUpdate={() => {}}
        cashierId={cashierId}
        onConfirm={(payments, meta) => {
          const saleLines = cart
            .filter((item) => inventory.some((i) => i.id === item.inventoryId))
            .map((item) => ({
              inventoryId: item.inventoryId,
              quantity: item.quantity,
              unitPrice: item.price,
              name: item.name,
            }))

          let dinheiro = 0
          let pix = 0
          let cartaoDebito = 0
          let cartaoCredito = 0
          let carne = 0
          let aPrazo = 0
          let creditoVale = 0
          for (const p of payments) {
            if (p.type === "dinheiro") dinheiro += p.value
            else if (p.type === "pix") pix += p.value
            else if (p.type === "cartao_debito") cartaoDebito += p.value
            else if (p.type === "cartao_credito") cartaoCredito += p.value
            else if (p.type === "carne") carne += p.value
            else if (p.type === "a_prazo") aPrazo += p.value
            else if (p.type === "credito_vale") creditoVale += p.value
          }

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
          })

          if (!result.ok) {
            toast({ title: "Falha transacional", description: result.reason })
            return
          }

          setCart([])
          setDiscountReais(0)
          setDiscountPercent(0)
          setSelectedProduct(null)
          setIsPaymentModalOpen(false)
          setInstantPayIntent(null)
          onSaleCompleted?.()
          toast({
            title: "Venda finalizada",
            description: `${payments.length} forma(s) de pagamento confirmada(s).`,
          })
          queueMicrotask(hardFocusSearch)
        }}
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
        onReadScale={() => {}}
        scaleBusy={false}
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
                      setCart([])
                      setDiscountPercent(0)
                      setDiscountReais(0)
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

