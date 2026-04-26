"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
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
  Receipt,
  BookUser,
  Keyboard,
  Settings,
  HandCoins,
  ClipboardList,
  ScanLine,
  LayoutGrid,
  CalendarClock,
  Layers,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { PaymentModal, type PaymentMethodType } from "./payment-modal"
import { getOrCreatePdvOperatorId } from "@/lib/pdv-operator-id"
import { CaixaStatusBar } from "../caixa/caixa-status-bar"
import { useCaixa } from "../caixa/caixa-provider"
import { configPadrao, useConfigEmpresa } from "@/lib/config-empresa"
import { useLojaAtiva } from "@/lib/loja-ativa"
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
import { buildPdvReceiptEscPos } from "@/lib/escpos"
import {
  sendEscPosViaProxy,
  downloadEscPosFile,
  openThermalHtmlPrint,
  escapeHtml,
} from "@/lib/thermal-print"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { useOperationsStore } from "@/lib/operations-store"
import { useStoreSettings } from "@/lib/store-settings-provider"
import {
  PDV_PRODUCTS_BASE,
  mergePdvCatalogWithInventory,
  newPdvLineId,
  type PdvCatalogProduct,
} from "@/lib/pdv-catalog"
import { findPdvProductByScan } from "@/lib/pdv-scan-product"
import { PdvOmniClassicShell, type PdvOmniCartRow } from "./pdv-omni-classic-shell"
import { useStudioTheme } from "@/components/theme/ThemeProvider"
import { PDV_IMPORT_COMANDA_KEY, type PdvImportComandaPayload } from "@/lib/pdv-comanda-bridge"
import { AttrProductDialog, WeightProductDialog } from "./pdv-product-dialogs"
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
import { isOsVirtualSaleLine, osPecasInventoryId, osServicoInventoryId } from "@/lib/os-pdv-virtual-lines"

type SaleMode = "balcao" | "completa"

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
}

type Product = PdvCatalogProduct

/** Categorias que não aparecem na grade até o usuário buscar (filtro inteligente do PDV). */
const PDV_CATEGORIAS_OCULTAS_ATE_BUSCA = new Set(["telas", "baterias", "conectores"])

type PdvUiMode = "default" | "touch" | "scanner"

const PDV_UI_STORAGE_KEY = "assistec-pdv-ui-mode"

const MOCK_CUSTOMERS_INITIAL: Customer[] = [
  { id: "1", name: "Joao Silva", cpf: "123.456.789-00", phone: "(11) 99999-1234", saldoDevedor: 150.0 },
  { id: "2", name: "Maria Santos", cpf: "987.654.321-00", phone: "(11) 98888-5678", saldoDevedor: 0 },
  { id: "3", name: "Pedro Oliveira", cpf: "456.789.123-00", phone: "(11) 97777-9012", saldoDevedor: 280.0 },
]

export interface VendasPDVProps {
  linkedOsId?: string | null
  onSaleCompleted?: () => void
  /** Item sugerido por comando de voz (adicionado ao carrinho ao montar/atualizar). */
  voiceCartSeed?: { key: number; itemName: string; price?: number } | null
  onVoiceCartSeedConsumed?: () => void
  voiceOpenCaixaSignal?: number
  onVoiceOpenCaixaConsumed?: () => void
  /** `omni-smart` = caixa Lovable (F1–F9); `default` = tela completa legada (Services). */
  uiShell?: "default" | "omni-smart"
}

export function PdvClassic({
  linkedOsId = null,
  onSaleCompleted,
  voiceCartSeed = null,
  onVoiceCartSeedConsumed,
  voiceOpenCaixaSignal = 0,
  onVoiceOpenCaixaConsumed,
  uiShell = "default",
}: VendasPDVProps) {
  const router = useRouter()
  const { config } = useConfigEmpresa()
  const { empresaDocumentos, getEnderecoDocumentos, lojaAtivaId, opsStorageKey, storesRefreshNonce } =
    useLojaAtiva()
  const { pdvParams } = useStoreSettings()
  const { mode: studioThemeMode } = useStudioTheme()
  const classicStudio = studioThemeMode === "classic"
  const lojaKey = lojaAtivaId ?? opsLojaIdFromStorageKey(opsStorageKey)
  const { adicionarEntrada, adicionarSaida } = useCaixa()
  const { inventory, finalizeSaleTransaction, getSaldoCreditoCliente, ordens } = useOperationsStore()
  const cashierId = useMemo(() => getOrCreatePdvOperatorId(), [])
  const { toast } = useToast()
  const [saleMode, setSaleMode] = useState<SaleMode>("balcao")
  const [searchTerm, setSearchTerm] = useState("")
  const [customerSearch, setCustomerSearch] = useState("")
  const [customers, setCustomers] = useState<Customer[]>(() => [...MOCK_CUSTOMERS_INITIAL])
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
  const [showOperationsMenu, setShowOperationsMenu] = useState(false)
  const [pdvUiMode, setPdvUiMode] = useState<PdvUiMode>("default")
  const [weightDialogOpen, setWeightDialogOpen] = useState(false)
  const [weightProduct, setWeightProduct] = useState<Product | null>(null)
  const [weightKgInput, setWeightKgInput] = useState("")
  const [scaleBusy, setScaleBusy] = useState(false)
  const [attrDialogOpen, setAttrDialogOpen] = useState(false)
  const [attrProduct, setAttrProduct] = useState<Product | null>(null)
  const [attrSelections, setAttrSelections] = useState<Record<string, string>>({})
  const [operationType, setOperationType] = useState<
    "sangria" | "suprimento" | "devolucao" | "fechamento" | null
  >(null)
  const [operationValue, setOperationValue] = useState("")
  const [operationReason, setOperationReason] = useState("")
  const [cashHistory, setCashHistory] = useState<
    Array<{ id: string; type: string; value: number; reason: string; at: string }>
  >([])
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
  const [selectedCartLineId, setSelectedCartLineId] = useState<string | null>(null)
  const [shellProductSearchOpen, setShellProductSearchOpen] = useState(false)
  const [shellClientSearchOpen, setShellClientSearchOpen] = useState(false)
  const [shellQtyEditOpen, setShellQtyEditOpen] = useState(false)
  const [shellCancelSaleOpen, setShellCancelSaleOpen] = useState(false)
  const [shellAdvancedOpen, setShellAdvancedOpen] = useState(false)
  const [shellReceivablesOpen, setShellReceivablesOpen] = useState(false)
  const [lastSaleTotal, setLastSaleTotal] = useState<number | null>(null)
  const [shellCustomerField, setShellCustomerField] = useState("CONSUMIDOR")

  /** Bloqueio do PDV até cadastrar Nome Fantasia (Store.name) da unidade no banco. */
  const [storePdvGate, setStorePdvGate] = useState<{ ready: boolean; block: boolean }>({
    ready: false,
    block: false,
  })
  /** Rodapé do cupom por unidade (StoreSettings). */
  const [pdvReceiptFooter, setPdvReceiptFooter] = useState("")

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
          | { store?: { name?: string | null } | null }
          | null
        const jSet = (await rset.json().catch(() => null)) as
          | { settings?: { receiptFooter?: string | null } | null }
          | null
        if (cancelled) return
        const name = String(jStore?.store?.name ?? "").trim()
        setPdvReceiptFooter(String(jSet?.settings?.receiptFooter ?? "").trim())
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

  const products = mergePdvCatalogWithInventory(PDV_PRODUCTS_BASE, inventory)

  const searchTrim = searchTerm.trim()
  const hideCategoriesPdv = pdvParams.ocultarCategoriasNoPdv === true
  const hiddenCategoriesSet = new Set((pdvParams.categoriasOcultasNoPdv ?? []).map((c) => c.toLowerCase()))
  const filteredProducts = products.filter((p) => {
    const catLower = p.category.toLowerCase()
    const matchName = p.name.toLowerCase().includes(searchTerm.toLowerCase())
    const matchCat = catLower.includes(searchTerm.toLowerCase())
    if (!matchName && !matchCat) return false
    if (searchTrim.length === 0 && PDV_CATEGORIAS_OCULTAS_ATE_BUSCA.has(catLower)) return false
    if (searchTrim.length > 0) return true
    if (hideCategoriesPdv && hiddenCategoriesSet.has(catLower)) return false
    return true
  })

  const filteredCustomers = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
      c.cpf.includes(customerSearch) ||
      c.phone.includes(customerSearch)
  )

  const storeDisplayName = useMemo(() => {
    const n = (empresaDocumentos.nomeFantasia || configPadrao.empresa.nomeFantasia || "Loja").trim()
    return n || "Loja"
  }, [empresaDocumentos.nomeFantasia])

  const shellClientOptions = useMemo(
    () => [{ id: "0", label: "CONSUMIDOR" }, ...customers.map((c) => ({ id: c.id, label: `${c.name} — CPF ${c.cpf}` }))],
    [customers]
  )

  const shellCartRows: PdvOmniCartRow[] = useMemo(
    () =>
      cart.map((i) => {
        const inv = inventory.find((x) => x.id === i.inventoryId)
        const code =
          isOsVirtualSaleLine(i.inventoryId) ? "OS" : (inv?.barcode && inv.barcode.trim()) || i.inventoryId
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

  useEffect(() => {
    if (!linkedOsId) {
      linkedOsHydratedRef.current = null
      return
    }
    if (linkedOsHydratedRef.current === linkedOsId) {
      const osEarly = ordens.find((o) => o.id === linkedOsId)
      const telEarly = String(osEarly?.cliente?.telefone || "").replace(/\D/g, "")
      if (telEarly.length >= 8) {
        const hit = customers.find((c) => c.phone.replace(/\D/g, "") === telEarly)
        if (hit) setSelectedCustomer(hit)
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
      if (uiShell !== "default") {
        setShellHighlightLineId(lastId)
        window.setTimeout(() => {
          setShellHighlightLineId((h) => (h === lastId ? null : h))
        }, 1400)
        queueMicrotask(() => shellBipeRef.current?.focus())
      }
    }
    const tel = String(os.cliente?.telefone || "").replace(/\D/g, "")
    if (tel.length >= 8) {
      const hit = customers.find((c) => c.phone.replace(/\D/g, "") === tel)
      if (hit) setSelectedCustomer(hit)
    }
  }, [linkedOsId, ordens, customers, uiShell])

  const qtyEditDefault = useMemo(() => {
    const line = cart.find((i) => i.lineId === selectedCartLineId)
    return line ? String(line.quantity) : "1"
  }, [cart, selectedCartLineId])

  useEffect(() => {
    setShellCustomerField(selectedCustomer?.name ?? "CONSUMIDOR")
  }, [selectedCustomer])

  const updateCustomerCpf = useCallback((customerId: string, cpfDigits: string) => {
    const display = formatBrDocDisplay(cpfDigits)
    setCustomers((prev) => prev.map((c) => (c.id === customerId ? { ...c, cpf: display } : c)))
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
      },
    ])
    setSelectedCartLineId(lineId)
    if (uiShell !== "default") {
      setShellHighlightLineId(lineId)
      window.setTimeout(() => {
        setShellHighlightLineId((h) => (h === lineId ? null : h))
      }, 1400)
      queueMicrotask(() => shellBipeRef.current?.focus())
    }
  }

  const addToCart = (product: Product, presetQty?: number) => {
    const baseQty = presetQty ?? 1
    if (product.stock <= 0) {
      toast({ title: "Sem estoque", description: `${product.name} está sem saldo no estoque.` })
      return
    }
    if (!product.vendaPorPeso && baseQty > product.stock) {
      toast({
        title: "Sem estoque",
        description: `${product.name}: solicitado ${baseQty}, disponível ${product.stock}.`,
        variant: "destructive",
      })
      return
    }
    if (product.atributos && product.atributos.length > 0) {
      setAttrProduct(product)
      const init: Record<string, string> = {}
      for (const a of product.atributos) {
        init[a.id] = a.opcoes[0] ?? ""
      }
      setAttrSelections(init)
      setAttrDialogOpen(true)
      return
    }
    if (product.vendaPorPeso) {
      setAttrSelections({})
      setWeightProduct(product)
      setWeightKgInput("")
      setWeightDialogOpen(true)
      return
    }
    pushCartLine({
      inventoryId: product.id,
      name: product.name,
      price: product.price,
      quantity: baseQty,
    })
    setSelectedProduct(product)
  }

  const addQuickItem = (item: Product) => {
    addToCart(item)
  }

  const handleShellBipeKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.key !== "Enter") return
      e.preventDefault()
      const raw = bipeCode.trim()
      if (!raw) return
      const q = Number(shellNextQty.replace(",", ".")) || 1
      const found = findPdvProductByScan(raw, products)
      if (!found) {
        toast({ title: "Produto não encontrado", description: `Código "${raw}" não localizado no cadastro.` })
        setShellInfo(`✕ Produto "${raw}" não localizado no cadastro.`)
        queueMicrotask(() => shellBipeRef.current?.focus())
        return
      }
      addToCart(found, q)
      setBipeCode("")
      setShellNextQty("1")
      setShellInfo(
        `✓ ${found.name} adicionado · ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(found.price * q)}`
      )
      queueMicrotask(() => shellBipeRef.current?.focus())
    },
    [addToCart, bipeCode, products, shellNextQty, toast]
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
    setCart(
      cart
        .map((item) => {
          if (item.lineId !== lineId) return item
          const step = item.vendaPorPeso ? 0.05 : 1
          const newQty = item.quantity + delta * step
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
    setAttrDialogOpen(false)
    if (attrProduct.vendaPorPeso) {
      setWeightProduct(attrProduct)
      setWeightKgInput("")
      setWeightDialogOpen(true)
      return
    }
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
    if (inv && kg > inv.stock + 0.0001) {
      toast({ title: "Estoque", description: "Peso maior que o disponível em estoque.", variant: "destructive" })
      return
    }
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
  const total = Math.max(0, subtotal - discountTotal)

  const handlePrintReceipt = async () => {
    const nome = (empresaDocumentos.nomeFantasia || "").trim() || configPadrao.empresa.nomeFantasia
    const cnpj = (empresaDocumentos.cnpj || "").trim() || configPadrao.empresa.cnpj
    const itens = cart.map((i) => ({
      name: i.name,
      quantity: i.quantity,
      unitPrice: i.price,
      lineTotal: i.price * i.quantity,
    }))
    const bytes = buildPdvReceiptEscPos({
      nomeFantasia: nome,
      cnpj,
      enderecoLinha: getEnderecoDocumentos(),
      receiptFooter: pdvReceiptFooter,
      itens,
      subtotal,
      taxes: 0,
      discount: discountTotal,
      total,
      dataHora: new Date().toLocaleString("pt-BR"),
    })

    const result = await sendEscPosViaProxy(bytes)
    if (result.ok) {
      toast({
        title: "Cupom ESC/POS enviado",
        description: "Dados enviados por TCP (API /api/print/raw → THERMAL_PRINT_HOST:THERMAL_PRINT_PORT).",
      })
      return
    }

    toast({
      title: "Impressora raw indisponível",
      description: `${result.error} — baixamos o .bin e abrimos impressão HTML 80mm.`,
      variant: "destructive",
    })
    downloadEscPosFile(bytes, "recibo-pdv.bin")

    const br = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
    const linhasItens = cart
      .map((i) => `<p>${escapeHtml(String(i.quantity))}x ${escapeHtml(i.name)} — ${br.format(i.price * i.quantity)}</p>`)
      .join("")
    openThermalHtmlPrint(
      `
      <div style="text-align:center;font-weight:700;margin-bottom:6px">${escapeHtml(nome)}</div>
      <div style="text-align:center;font-size:11px;margin-bottom:4px">CNPJ ${escapeHtml(cnpj)}</div>
      <div style="font-size:10px;margin-bottom:8px">${escapeHtml(getEnderecoDocumentos())}</div>
      <div style="border-top:1px dashed #000;margin:6px 0"></div>
      ${linhasItens}
      <div style="border-top:1px dashed #000;margin:6px 0"></div>
      <p>Subtotal: ${br.format(subtotal)}</p>
      ${discountTotal > 0 ? `<p>Desconto: ${br.format(discountTotal)}</p>` : ""}
      <p style="font-weight:700">Valor final pago: ${br.format(total)}</p>
      ${
        pdvReceiptFooter.trim()
          ? `<div style="font-size:10px;margin-top:8px;white-space:pre-wrap">${escapeHtml(pdvReceiptFooter.trim())}</div>`
          : ""
      }
      <p style="font-size:10px;margin-top:8px">${escapeHtml(new Date().toLocaleString("pt-BR"))}</p>
    `,
      "Recibo PDV"
    )
  }

  const handlePendOnAccount = () => {
    if (!selectedCustomer) {
      toast({ title: "Cliente obrigatorio", description: "Selecione um cliente para pendurar na conta." })
      return
    }
    setPendingOnAccount(true)
    toast({ title: "Venda pendurada na conta", description: `${selectedCustomer.name} - R$ ${total.toFixed(2)}` })
    setCart([])
    setDiscountReais(0)
    setDiscountPercent(0)
    setSelectedProduct(null)
    setPendingOnAccount(false)
  }

  const openOperation = (type: "sangria" | "suprimento" | "devolucao" | "fechamento") => {
    setShowOperationsMenu(false)
    setOperationType(type)
    setOperationValue("")
    setOperationReason("")
  }

  const saveOperation = () => {
    if (!operationType) return
    const value = parseFloat(operationValue) || 0
    if (value <= 0) return
    const op = operationType
    const reason = operationReason || "Sem motivo informado"
    setCashHistory((prev) => [
      {
        id: `${Date.now()}`,
        type: op,
        value,
        reason,
        at: new Date().toLocaleString("pt-BR"),
      },
      ...prev,
    ])
    if (op === "sangria") {
      adicionarSaida(value)
      appendAuditLog({
        action: "sangria_caixa",
        userLabel: auditUser(),
        detail: `R$ ${value.toFixed(2)} — ${reason}`,
      })
    }
    if (op === "suprimento") adicionarEntrada(value)
    setOperationType(null)
    toast({
      title: op === "sangria" ? "Sangria gerada" : "Operacao registrada",
      description: `Valor de R$ ${value.toFixed(2)} registrado com sucesso.`,
    })
  }

  useEffect(() => {
    if (uiShell !== "default") return
    const handler = (e: globalThis.KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")
      if (e.key === "F1") {
        e.preventDefault()
        setShowKeyboardHelp(true)
      } else if (e.key === "F2") {
        e.preventDefault()
        if (cart.length > 0) {
          setInstantPayIntent(null)
          setIsPaymentModalOpen(true)
        }
      } else if (e.key === "F3") {
        e.preventDefault()
        productInputRef.current?.focus()
      } else if (e.key === "F4") {
        e.preventDefault()
        if (cart.length > 0) {
          queueMicrotask(() => {
            const el = quantityInputRef.current
            if (!el) return
            el.focus()
            const len = String(el.value ?? "").length
            try {
              el.setSelectionRange(len, len)
            } catch {
              /* input type number em alguns browsers */
            }
          })
        } else {
          productInputRef.current?.focus()
        }
      } else if (e.altKey && (e.key === "d" || e.key === "D")) {
        e.preventDefault()
        if (cart.length > 0) setIsPaymentModalOpen(true)
      } else if (e.altKey && (e.key === "p" || e.key === "P")) {
        e.preventDefault()
        if (cart.length > 0) {
          setInstantPayIntent(null)
          setIsPaymentModalOpen(true)
        }
      } else if (e.key === "F10") {
        e.preventDefault()
        if (cart.length > 0) setIsPaymentModalOpen(true)
      } else if (e.code === "Space" && !typing) {
        e.preventDefault()
        if (cart.length > 0) setIsPaymentModalOpen(true)
      } else if (e.key === "Escape") {
        e.preventDefault()
        setShowKeyboardHelp(false)
        setShowOperationsMenu(false)
        setOperationType(null)
        setIsPaymentModalOpen(false)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [cart.length, uiShell])

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
    operationType !== null ||
    showKeyboardHelp ||
    showOperationsMenu

  const focusShellBipe = useCallback(() => {
    if (uiShell === "default") return
    queueMicrotask(() => shellBipeRef.current?.focus())
  }, [uiShell])

  const openShellShortcut = useCallback(
    (key: string) => {
      if (uiShell === "default") return
      const goBipe = () => focusShellBipe()
      switch (key) {
        case "F1":
          if (cart.length === 0) {
            toast({ title: "Nenhum item", description: "Adicione produtos antes de finalizar." })
            goBipe()
            return
          }
          setInstantPayIntent(null)
          setIsPaymentModalOpen(true)
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
        case "F5":
          if (!selectedCartLineId) {
            toast({ title: "Selecione um item", description: "Clique em um item da lista para cancelá-lo." })
            goBipe()
            return
          }
          setCart((prev) => prev.filter((i) => i.lineId !== selectedCartLineId))
          setSelectedCartLineId(null)
          setShellInfo("Item cancelado.")
          goBipe()
          break
        case "F6":
          setShellCancelSaleOpen(true)
          break
        case "F7":
        case "F8":
          goBipe()
          break
        case "F9":
          setShellReceivablesOpen(true)
          break
        case "CTRL":
          setShellAdvancedOpen(true)
          break
        default:
          break
      }
    },
    [cart.length, focusShellBipe, selectedCartLineId, toast, uiShell]
  )

  useEffect(() => {
    if (uiShell === "default") return
    const fnKeys = new Set(["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9"])
    let ctrlDown = false
    const down = (e: globalThis.KeyboardEvent) => {
      if (shellModalBlocking) return
      if (e.key === "Control") ctrlDown = true
      else ctrlDown = false
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
  }, [openShellShortcut, shellModalBlocking, uiShell])

  useEffect(() => {
    if (uiShell === "default") return
    const t = window.setTimeout(() => shellBipeRef.current?.focus(), 100)
    return () => window.clearTimeout(t)
  }, [uiShell])

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
    if (intent === "a_prazo" && !selectedCustomer) {
      // @ts-expect-error toast.error existe no runtime atual
      toast.error("⚠️ Selecione um cliente na tela inicial para liberar a venda a prazo.")
      return
    }
    if (intent === "carne" && !selectedCustomer) {
      toast({
        variant: "destructive",
        title: "Cliente obrigatório",
        description: "Selecione o cliente para carnê parcelado ou boleto.",
      })
      return
    }
    setInstantPayIntent(intent)
    setIsPaymentModalOpen(true)
  }

  if (lojaAtivaId && !storePdvGate.ready) {
    return (
      <div className="flex min-h-[280px] w-full flex-1 items-center justify-center text-base font-medium text-white/70">
        Carregando dados da unidade…
      </div>
    )
  }

  if (storePdvGate.block) {
    return (
      <div className="flex min-h-[360px] w-full flex-1 flex-col items-center justify-center gap-4 rounded-2xl border border-white/10 bg-white/5 px-6 py-10 text-center backdrop-blur-xl">
        <h2 className="text-xl font-black text-white">Cadastre o nome da empresa desta unidade</h2>
        <p className="max-w-lg text-base text-white/70">
          O PDV fica bloqueado até a unidade <strong>{lojaAtivaId}</strong> ter um <strong>Nome fantasia</strong> salvo no
          banco. Acesse <strong>Configurações → Dados da Empresa</strong>, preencha e salve.
        </p>
        <Button type="button" className="h-12 px-8 text-base font-bold" onClick={() => router.replace("/?page=config-empresa")}>
          Ir para Dados da Empresa
        </Button>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden text-[17px] text-foreground antialiased sm:text-[18px]">
      {uiShell === "omni-smart" ? (
        <div
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-t transition-colors duration-300",
            classicStudio
              ? "border-slate-200/90 bg-slate-50"
              : "border-white/10 bg-[#000000]"
          )}
        >
          <CaixaStatusBar
            variant="pdv"
            openAberturaSignal={voiceOpenCaixaSignal}
            onOpenAberturaSignalConsumed={onVoiceOpenCaixaConsumed}
          />
          <PdvOmniClassicShell
              storeName={storeDisplayName}
              cartRows={shellCartRows}
              highlightLineId={shellHighlightLineId}
              selectedLineId={selectedCartLineId}
              onSelectLine={setSelectedCartLineId}
              total={total}
              itemCount={cart.length}
              previousSaleTotal={lastSaleTotal}
              bipeCode={bipeCode}
              onBipeChange={setBipeCode}
              bipeRef={shellBipeRef}
              onBipeKeyDown={handleShellBipeKeyDown}
              customerDisplay={shellCustomerField}
              onCustomerDisplayChange={(v) => setShellCustomerField(v)}
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
                if (!open) focusShellBipe()
              }}
              clientOptions={shellClientOptions}
              onPickClient={(label) => {
                const row = shellClientOptions.find((x) => x.label === label)
                if (!row || row.id === "0") {
                  setSelectedCustomer(null)
                  setCustomerSearch("")
                } else {
                  const c = customers.find((x) => x.id === row.id)
                  if (c) setSelectedCustomer(c)
                }
                setShellClientSearchOpen(false)
                focusShellBipe()
              }}
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
                  return
                }
                const id = selectedCartLineId
                if (!id) return
                setCart((prev) => prev.map((i) => (i.lineId === id ? { ...i, quantity: v } : i)))
                setShellQtyEditOpen(false)
                setShellInfo("Quantidade atualizada.")
                focusShellBipe()
              }}
              cancelSaleOpen={shellCancelSaleOpen}
              onCancelSaleOpenChange={(open) => {
                setShellCancelSaleOpen(open)
                if (!open) focusShellBipe()
              }}
              onConfirmCancelSale={() => {
                setCart([])
                setSelectedCartLineId(null)
                setShellHighlightLineId(null)
                setBipeCode("")
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
              receivablesOpen={shellReceivablesOpen}
              onReceivablesOpenChange={(open) => {
                setShellReceivablesOpen(open)
                if (!open) focusShellBipe()
              }}
              onOpenReceivablesModule={() => {
                setShellReceivablesOpen(false)
                router.push("/?page=contas-receber")
                focusShellBipe()
              }}
              onAddProductFromSearch={(p) => {
                setShellProductSearchOpen(false)
                addToCart(p)
                focusShellBipe()
              }}
            />
        </div>
      ) : (
        <div
          className={cn(
            "flex min-h-0 w-full min-w-0 flex-1 flex-col gap-0 overflow-hidden border-t px-0 py-0 lg:flex-row transition-colors duration-300",
            classicStudio
              ? "border-slate-200/90 bg-slate-50"
              : "border-white/10 bg-[#000000]"
          )}
        >
          <div
            className={cn(
              "flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-r-0 lg:border-r",
              classicStudio ? "lg:border-slate-200/90" : "lg:border-white/10"
            )}
          >
            <CaixaStatusBar
              variant="pdv"
              openAberturaSignal={voiceOpenCaixaSignal}
              onOpenAberturaSignalConsumed={onVoiceOpenCaixaConsumed}
            />

            <div
              className={cn(
                "shrink-0 border-b py-2.5",
                classicStudio ? "border-slate-200/90 bg-slate-50" : "border-white/10 bg-[#000000]"
              )}
            >
              <div className="px-1 sm:px-2">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex w-full rounded-lg bg-secondary p-1 sm:w-auto">
                  <button
                    onClick={() => {
                      setSaleMode("balcao")
                      setEmitirNota(false)
                    }}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2.5 text-base font-semibold transition-all sm:flex-none ${
                      saleMode === "balcao"
                        ? "bg-primary text-primary-foreground shadow-lg"
                        : "text-black/70 hover:text-black"
                    }`}
                  >
                    <Zap className="h-5 w-5" />
                    <span>Venda Balcao (Rapida)</span>
                  </button>
                  <button
                    onClick={() => setSaleMode("completa")}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2.5 text-base font-semibold transition-all sm:flex-none ${
                      saleMode === "completa"
                        ? "bg-primary text-primary-foreground shadow-lg"
                        : "text-black/70 hover:text-black"
                    }`}
                  >
                    <FileText className="h-5 w-5" />
                    <span>Venda Completa (Nota)</span>
                  </button>
                </div>

                <Badge
                  variant={saleMode === "balcao" ? "secondary" : "default"}
                  className={`px-4 py-2 text-sm ${saleMode === "completa" ? "border border-primary/30 bg-primary/20 text-primary" : ""}`}
                >
                  {saleMode === "balcao" ? "Modo Rapido" : "Modo Completo - Com NF-e"}
                </Badge>
                <div className="flex w-full flex-wrap items-center justify-center gap-2 sm:w-auto sm:justify-end">
                  <span className="mr-1 text-sm font-medium text-black">Interface:</span>
                  <Button type="button" size="sm" variant={pdvUiMode === "default" ? "default" : "outline"} className="h-10 text-sm" onClick={() => setPdvUiMode("default")}>
                    Padrão
                  </Button>
                  <Button type="button" size="sm" variant={pdvUiMode === "touch" ? "default" : "outline"} className="h-10 gap-1 text-sm" onClick={() => setPdvUiMode("touch")}>
                    <LayoutGrid className="h-4 w-4" />
                    Touch
                  </Button>
                  <Button type="button" size="sm" variant={pdvUiMode === "scanner" ? "default" : "outline"} className="h-10 gap-1 text-sm" onClick={() => setPdvUiMode("scanner")}>
                    <ScanLine className="h-4 w-4" />
                    Scanner
                  </Button>
                </div>
              </div>
            </div>

          {saleMode === "balcao" && (
            <div className="shrink-0 border-b border-dashed border-neutral-200/80 bg-background py-2 dark:border-white/10">
              <div className="space-y-2 px-1 sm:px-2">
                <div className="flex flex-col items-center gap-4 sm:flex-row">
                  <div className="relative w-full flex-1">
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/50 dark:text-white/55" />
                        <Input
                          placeholder="Selecionar cliente (opcional)..."
                          value={customerSearch}
                          onChange={(e) => {
                            setCustomerSearch(e.target.value)
                            setShowCustomerDropdown(true)
                          }}
                          onFocus={() => setShowCustomerDropdown(true)}
                          ref={customerInputRef}
                          className="h-11 border-border bg-secondary pl-10 text-base font-medium text-foreground"
                        />
                      </div>
                      {selectedCustomer && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            setSelectedCustomer(null)
                            setCustomerSearch("")
                          }}
                          className="text-black/70 hover:text-destructive"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>

                    {showCustomerDropdown && customerSearch && (
                      <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-border bg-card shadow-xl">
                        {filteredCustomers.length > 0 ? (
                          filteredCustomers.map((customer) => (
                            <button
                              key={customer.id}
                              onClick={() => {
                                setSelectedCustomer(customer)
                                setCustomerSearch("")
                                setShowCustomerDropdown(false)
                              }}
                              className="w-full border-b border-border px-4 py-2 text-left transition-colors last:border-0 hover:bg-secondary"
                            >
                              <div className="flex items-center justify-between">
                                <div>
                                  <p className="text-sm font-medium text-black">{customer.name}</p>
                                  <p className="text-xs text-black/70">{customer.phone}</p>
                                </div>
                                {customer.saldoDevedor && customer.saldoDevedor > 0 && (
                                  <Badge variant="destructive" className="text-xs">
                                    Deve R$ {customer.saldoDevedor.toFixed(2)}
                                  </Badge>
                                )}
                              </div>
                            </button>
                          ))
                        ) : (
                          <div className="px-4 py-2 text-center text-sm text-black/70">Nenhum cliente encontrado</div>
                        )}
                      </div>
                    )}
                  </div>

                  {selectedCustomer && (
                    <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2">
                      <User className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium text-black">{selectedCustomer.name}</span>
                      {selectedCustomer.saldoDevedor && selectedCustomer.saldoDevedor > 0 && (
                        <Badge variant="outline" className="border-amber-500/50 text-xs text-amber-500">
                          Deve R$ {selectedCustomer.saldoDevedor.toFixed(2)}
                        </Badge>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {saleMode === "completa" && (
            <div className="shrink-0 border-b border-neutral-200/80 bg-background py-2 dark:border-white/10">
              <div className="px-1 sm:px-2">
                <div className="flex flex-col gap-4 lg:flex-row">
                  <div className="relative flex-1">
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/50 dark:text-white/55" />
                        <Input
                          placeholder="Buscar cliente por nome, CPF ou telefone..."
                          value={customerSearch}
                          onChange={(e) => {
                            setCustomerSearch(e.target.value)
                            setShowCustomerDropdown(true)
                          }}
                          onFocus={() => setShowCustomerDropdown(true)}
                          ref={customerInputRef}
                          className="border-border bg-secondary pl-10"
                        />
                      </div>
                      <Button variant="outline" className="border-primary text-primary hover:bg-primary hover:text-primary-foreground">
                        <UserPlus className="mr-2 h-4 w-4" />
                        Cadastrar Novo
                      </Button>
                    </div>

                    {showCustomerDropdown && customerSearch && (
                      <div className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-border bg-card shadow-xl">
                        {filteredCustomers.length > 0 ? (
                          filteredCustomers.map((customer) => (
                            <button
                              key={customer.id}
                              onClick={() => {
                                setSelectedCustomer(customer)
                                setCustomerSearch("")
                                setShowCustomerDropdown(false)
                              }}
                              className="w-full border-b border-border px-4 py-3 text-left transition-colors last:border-0 hover:bg-secondary"
                            >
                              <p className="font-medium text-foreground">{customer.name}</p>
                              <p className="text-sm text-muted-foreground">
                                CPF: {customer.cpf} | Tel: {customer.phone}
                              </p>
                            </button>
                          ))
                        ) : (
                          <div className="px-4 py-3 text-center text-muted-foreground">Nenhum cliente encontrado</div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-4">
                    <label className="group flex cursor-pointer items-center gap-3">
                      <div
                        onClick={() => setEmitirNota(!emitirNota)}
                        className={`flex h-6 w-6 items-center justify-center rounded border-2 transition-all ${
                          emitirNota ? "border-primary bg-primary" : "border-muted-foreground group-hover:border-primary"
                        }`}
                      >
                        {emitirNota && <Check className="h-4 w-4 text-primary-foreground" />}
                      </div>
                      <span className="font-medium text-foreground">Emitir Nota Fiscal</span>
                    </label>
                  </div>
                </div>

                {selectedCustomer && (
                  <div className="mt-4 flex items-center justify-between rounded-lg border border-primary/30 bg-primary/10 p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary">
                        <User className="h-5 w-5 text-primary-foreground" />
                      </div>
                      <div>
                        <p className="font-semibold text-foreground">{selectedCustomer.name}</p>
                        <p className="text-sm text-muted-foreground">
                          CPF: {selectedCustomer.cpf} | Tel: {selectedCustomer.phone}
                        </p>
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => setSelectedCustomer(null)} className="text-muted-foreground hover:text-destructive">
                      <X className="h-5 w-5" />
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="shrink-0 border-b border-neutral-200/70 py-2.5 dark:border-white/10">
            <div className="px-1 sm:px-2">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-foreground/50 dark:text-white/55" />
                  <Input
                    placeholder="Buscar produto ou código..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    ref={productInputRef}
                    className={cn(
                      "h-12 border-border bg-secondary pl-11 text-base text-foreground placeholder:text-muted-foreground",
                      pdvUiMode === "scanner" && "h-14 text-lg ring-2 ring-primary/30"
                    )}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="h-12 shrink-0 border-2 border-black/20 px-4 text-base font-semibold text-foreground hover:bg-neutral-100 dark:border-white/10 dark:hover:bg-black/80"
                >
                  <Barcode className="mr-2 h-5 w-5 text-foreground/55 dark:text-white/55" />
                  Leitor
                </Button>
              </div>
            </div>
          </div>

          {pdvUiMode !== "scanner" && (
            <div className="shrink-0 border-b border-neutral-200/70 py-2 dark:border-white/10">
              <div className="px-1 sm:px-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-base font-extrabold text-black sm:text-lg">Serviços rápidos</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-11 border-2 border-black/20 px-3 text-sm font-bold text-black"
                    onClick={() => setShowKeyboardHelp(true)}
                  >
                    <Keyboard className="mr-1.5 h-4 w-4" /> Atalhos
                  </Button>
                </div>
                <div className="mt-2 flex flex-wrap items-stretch gap-2">
                  {quickItems.length === 0 ? (
                    <p className="w-full text-sm text-black/70">Configure em Configurações → Personalização do PDV.</p>
                  ) : (
                    quickItems.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => addQuickItem(item)}
                        className="inline-flex min-h-[56px] max-w-full min-w-0 flex-1 basis-[calc(50%-4px)] items-center justify-between gap-2 rounded-xl border-2 border-black/20 bg-neutral-100 px-3 py-2.5 text-left text-base font-bold shadow-sm transition-colors hover:bg-neutral-200 dark:border-white/10 dark:bg-black/60 dark:backdrop-blur-md dark:hover:border-primary/50 dark:hover:bg-black/70 sm:basis-auto sm:text-lg"
                      >
                        <span className="truncate text-foreground dark:text-white">{item.name}</span>
                        <span className="shrink-0 font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                          R$ {item.price.toFixed(2).replace(".", ",")}
                        </span>
                      </button>
                    ))
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => router.replace("/?page=os")}
                  className="mt-3 flex h-16 w-full items-center justify-between gap-3 rounded-xl border-2 border-black bg-black px-4 text-left text-white shadow-lg transition-colors hover:bg-black/90"
                >
                  <span className="flex min-w-0 items-center gap-2 text-lg font-extrabold tracking-wide">
                    <ClipboardList className="h-6 w-6 shrink-0" />
                    <span className="truncate uppercase">Nova O.S.</span>
                  </span>
                  <span className="shrink-0 text-xl font-light opacity-90">→</span>
                </button>
              </div>
            </div>
          )}

          <div className="h-full min-h-0 flex-1 overflow-y-auto overscroll-contain py-3 pl-1 pr-0 sm:pl-2 [scrollbar-gutter:stable]">
            {selectedProduct?.complementos && selectedProduct.complementos.length > 0 ? (
              <div className="mb-1.5 rounded border border-primary/35 bg-primary/5 px-1.5 py-1 dark:border-primary/30 dark:bg-black/60 dark:backdrop-blur-md">
                <p className="text-[10px] font-semibold text-muted-foreground dark:text-white/55">
                  <Sparkles className="mr-0.5 inline h-3 w-3 text-primary" />
                  {selectedProduct.name}
                </p>
                <div className="mt-1 flex gap-1 overflow-x-auto pb-0.5">
                  {selectedProduct.complementos.map((comp) => (
                    <button
                      key={comp.id}
                      type="button"
                      onClick={() => addComplemento(selectedProduct.id, comp.name, comp.price)}
                      className="inline-flex shrink-0 items-center gap-1 rounded border border-primary/40 bg-white px-2 py-0.5 text-[10px] text-foreground hover:bg-primary/10 dark:border-white/10 dark:bg-black/60 dark:backdrop-blur-md dark:hover:border-primary/50"
                    >
                      <Plus className="h-3 w-3 text-foreground/55 dark:text-white/55" />
                      <span className="max-w-[120px] truncate dark:text-white">{comp.name}</span>
                      <span className="font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                        R$ {comp.price.toFixed(2)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {filteredProducts.length === 0 ? (
              <p className="py-8 text-center text-base font-medium text-black/75">
                {!searchTrim
                  ? "Telas, baterias e conectores ficam ocultos até você buscar. Digite o nome ou a categoria."
                  : "Nenhum produto encontrado."}
              </p>
            ) : (
              <div className="grid w-full grid-cols-2 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {filteredProducts.map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => addToCart(product)}
                    className="min-h-[118px] w-full rounded-xl border-2 border-black/12 bg-white px-3 py-3 text-left shadow-sm transition-colors hover:border-black/30 hover:bg-neutral-50 dark:border-white/10 dark:bg-black/60 dark:backdrop-blur-md dark:hover:border-primary/50 dark:hover:bg-black/70 sm:px-4 sm:py-3.5"
                  >
                    <div className="flex flex-col gap-1.5">
                      <span className="line-clamp-2 min-h-0 break-words text-left text-base font-bold leading-snug text-foreground dark:text-white sm:text-[1.05rem]">
                        {product.name}
                      </span>
                      <div className="flex items-baseline justify-between gap-2 border-t border-black/5 pt-1.5 dark:border-white/5">
                        <span className="shrink-0 text-base font-bold tabular-nums text-emerald-600 dark:text-emerald-400 sm:text-lg">
                          {product.vendaPorPeso ? `R$ ${product.price.toFixed(2)}/kg` : `R$ ${product.price.toFixed(2)}`}
                        </span>
                        <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
                          <span className="truncate text-xs font-medium text-muted-foreground dark:text-white/55 sm:text-sm">
                            {product.category}
                          </span>
                          <Badge
                            variant={product.stock <= 5 ? "destructive" : "secondary"}
                            className="shrink-0 border-black/10 text-xs font-semibold sm:text-sm dark:border-white/10"
                          >
                            {product.vendaPorPeso ? `${product.stock} kg` : `${product.stock} un`}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

        <div
          className={cn(
            "flex min-h-0 w-full min-w-0 flex-col overflow-hidden border-l-2 lg:h-full lg:w-[450px] lg:min-w-[450px] lg:max-w-[450px] lg:shrink-0 lg:grow-0",
            classicStudio
              ? "border-slate-200/90 bg-slate-50"
              : "border-white/10 bg-[#000000]"
          )}
        >
          {cart.length === 0 ? (
            <div className="flex min-h-0 flex-1 flex-col justify-center px-2 py-8 text-center sm:px-3">
              <div className="shrink-0 border-b-2 border-border px-2 pb-2 pt-2.5 text-left sm:px-3 dark:border-white/10">
                <div className="flex flex-wrap items-center gap-2 text-lg font-extrabold text-foreground">
                  <ShoppingBag className="h-6 w-6 shrink-0 text-foreground" />
                  <span>Carrinho</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="relative z-[100] ml-auto h-9 w-9 shrink-0 text-foreground"
                    onClick={() => setShowOperationsMenu((p) => !p)}
                  >
                    <Settings className="h-5 w-5" />
                  </Button>
                </div>
              </div>
              <div className="flex flex-1 flex-col justify-center">
                <ShoppingBag className="mx-auto mb-3 h-12 w-12 text-muted-foreground" />
                <p className="text-lg font-bold text-foreground">Carrinho vazio</p>
                <p className="mt-1 text-base text-muted-foreground">Adicione produtos para iniciar a venda</p>
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="flex min-h-0 min-w-0 flex-[1_1_0] basis-0 flex-col overflow-hidden border-b-2 border-border dark:border-white/10">
                <div className="shrink-0 border-b border-border px-2 pb-2 pt-2 sm:px-3 dark:border-white/10">
                  <div className="flex flex-wrap items-center gap-1.5 text-lg font-extrabold text-foreground">
                    <ShoppingBag className="h-6 w-6 shrink-0 text-foreground" />
                    <span>Carrinho</span>
                    {selectedCustomer ? (
                      <Badge variant="outline" className="border-border text-xs font-semibold text-foreground">
                        {selectedCustomer.name.split(" ")[0]}
                      </Badge>
                    ) : null}
                    {linkedOsId ? (
                      <Badge variant="outline" className="border-primary/40 text-[10px] text-primary">
                        Venda vinculada à O.S.
                      </Badge>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="relative z-[100] ml-auto h-9 w-9 shrink-0 text-foreground"
                      onClick={() => setShowOperationsMenu((p) => !p)}
                    >
                      <Settings className="h-5 w-5" />
                    </Button>
                  </div>
                </div>
                <div className="relative z-0 min-h-0 flex-1 divide-y divide-border overflow-y-auto overflow-x-hidden px-2 py-1 [scrollbar-gutter:stable] dark:divide-white/10 sm:px-3">
                  {cart.map((item) => (
                    <div key={item.lineId} className="relative z-0 flex items-start gap-2 py-3 first:pt-2">
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 break-words text-base font-bold leading-tight text-foreground">
                          {item.name}
                        </p>
                        {item.lineDetail ? (
                          <p
                            className="mt-1 line-clamp-2 text-[11px] font-medium leading-snug text-muted-foreground dark:text-cyan-200/85"
                            title={item.lineDetail}
                          >
                            {item.lineDetail}
                          </p>
                        ) : null}
                        <p className="mt-0.5 text-base font-bold tabular-nums leading-none text-emerald-600 dark:text-emerald-400">
                          R$ {item.price.toFixed(2)}
                          {item.vendaPorPeso ? "/kg" : ""}
                        </p>
                        <p className="mt-1 text-xs leading-tight text-muted-foreground dark:text-white/55">
                          <span className="tabular-nums">
                            {item.vendaPorPeso ? `${item.quantity.toFixed(3)} kg` : `${item.quantity} un.`}
                          </span>
                          <span className="text-foreground/45 dark:text-white/45"> · </span>
                          <span className="tabular-nums font-medium text-foreground/80 dark:text-white/65">
                            linha R$ {(item.price * item.quantity).toFixed(2)}
                          </span>
                        </p>
                      </div>
                      <div className="relative z-[100] flex shrink-0 items-center gap-0">
                        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-foreground dark:text-white/65" onClick={() => updateQuantity(item.lineId, -1)}>
                          <Minus className="h-3.5 w-3.5" />
                        </Button>
                        <span className="min-w-[1.75rem] text-center text-xs font-bold tabular-nums text-foreground dark:text-white/90">
                          {item.vendaPorPeso ? item.quantity.toFixed(2) : item.quantity}
                        </span>
                        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => updateQuantity(item.lineId, 1)}>
                          <Plus className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          title="Remover item"
                          className="h-8 w-8 shrink-0 rounded-md bg-red-600 text-white shadow-sm hover:bg-red-700 active:bg-red-800"
                          onClick={() => removeFromCart(item.lineId)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="relative z-0 flex min-h-0 min-w-0 flex-[1_1_0] basis-0 flex-col gap-1.5 overflow-y-auto overflow-x-hidden border-t border-border bg-card px-2 pb-2 pt-2 shadow-[inset_0_1px_0_rgba(0,0,0,0.06)] dark:border-white/10 dark:bg-black/50 dark:backdrop-blur-md sm:px-3">
                <div className="shrink-0">
                  <Label className="text-xs font-bold text-foreground dark:text-white/65">Qtd. último item (F4)</Label>
                  <Input
                    ref={quantityInputRef}
                    type="number"
                    min={1}
                    value={
                      cart.length
                        ? cart[cart.length - 1].vendaPorPeso
                          ? cart[cart.length - 1].quantity
                          : cart[cart.length - 1].quantity
                        : ""
                    }
                    onChange={(e) => {
                      if (!cart.length) return
                      const last = cart[cart.length - 1]
                      const lastId = last.lineId
                      const raw = e.target.value.replace(",", ".")
                      const next = last.vendaPorPeso ? Math.max(0.001, parseFloat(raw) || 0.001) : Math.max(1, parseInt(raw, 10) || 1)
                      setCart((prev) => prev.map((i) => (i.lineId === lastId ? { ...i, quantity: next } : i)))
                    }}
                    step={cart.length && cart[cart.length - 1].vendaPorPeso ? "0.001" : "1"}
                    className="mt-1 h-9 border-2 border-black/15 bg-neutral-50 text-sm font-semibold text-foreground dark:border-white/10 dark:bg-black/60 dark:backdrop-blur-md"
                  />
                </div>

                {selectedCustomer && selectedCustomer.saldoDevedor && selectedCustomer.saldoDevedor > 0 ? (
                  <div className="rounded-lg border-2 border-amber-500/40 bg-amber-500/10 px-3 py-2">
                    <div className="flex items-center justify-between text-sm font-semibold">
                      <span className="text-amber-800 dark:text-amber-200">Saldo devedor</span>
                      <span className="font-bold tabular-nums text-amber-800 dark:text-amber-200">
                        R$ {selectedCustomer.saldoDevedor.toFixed(2)}
                      </span>
                    </div>
                  </div>
                ) : null}

                <div className="shrink-0 space-y-1">
                  <p className="text-xs font-bold text-foreground dark:text-white/65">Forma de pagamento</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    <Button type="button" variant="outline" className="flex h-11 flex-col gap-0 border-2 border-emerald-500/40 bg-background py-1 text-[10px] font-extrabold leading-none text-foreground shadow-sm hover:bg-emerald-500/10 dark:border-emerald-400/50 dark:bg-black/60 dark:backdrop-blur-md dark:hover:bg-emerald-500/15 sm:text-xs" onClick={() => openPaymentModal("dinheiro")}>
                      <Banknote className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      <span>Dinheiro</span>
                    </Button>
                    <Button type="button" variant="outline" className="flex h-11 flex-col gap-0 border-2 border-teal-500/40 bg-background py-1 text-[10px] font-extrabold leading-none text-foreground shadow-sm hover:bg-teal-500/10 dark:border-teal-400/50 dark:bg-black/60 dark:backdrop-blur-md dark:hover:bg-teal-500/15 sm:text-xs" onClick={() => openPaymentModal("pix")}>
                      <QrCode className="h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" />
                      <span>PIX</span>
                    </Button>
                    <Button type="button" variant="outline" className="flex h-11 flex-col gap-0 border-2 border-slate-500/40 bg-background py-1 text-[10px] font-extrabold leading-none text-foreground shadow-sm hover:bg-slate-500/10 dark:border-slate-400/50 dark:bg-black/60 dark:backdrop-blur-md dark:hover:bg-slate-500/15 sm:text-xs" onClick={() => openPaymentModal("cartao_debito")}>
                      <CreditCard className="h-4 w-4 shrink-0 text-slate-600 dark:text-slate-300" />
                      <span>Débito</span>
                    </Button>
                    <Button type="button" variant="outline" className="flex h-11 flex-col gap-0 border-2 border-blue-500/40 bg-background py-1 text-[10px] font-extrabold leading-none text-foreground shadow-sm hover:bg-blue-500/10 dark:border-blue-400/50 dark:bg-black/60 dark:backdrop-blur-md dark:hover:bg-blue-500/15 sm:text-xs" onClick={() => openPaymentModal("cartao_credito")}>
                      <CreditCard className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
                      <span>Crédito</span>
                    </Button>
                    <Button type="button" variant="outline" title={!selectedCustomer ? "Clique para ver o aviso: é necessário selecionar o cliente para venda à prazo" : "Faturar à prazo em Contas a Receber"} className="flex h-11 flex-col gap-0 border-2 border-violet-500/40 bg-background py-1 text-[10px] font-extrabold leading-none text-foreground shadow-sm hover:bg-violet-500/10 dark:border-violet-400/50 dark:bg-black/60 dark:backdrop-blur-md dark:hover:bg-violet-500/15 sm:text-xs" onClick={() => openPaymentModal("a_prazo")}>
                      <CalendarClock className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" />
                      <span>À prazo</span>
                    </Button>
                    <Button type="button" variant="outline" className="flex h-11 flex-col gap-0 border-2 border-border bg-background py-1 text-[10px] font-extrabold leading-none text-foreground hover:bg-muted/50 dark:border-white/10 dark:bg-black/60 dark:backdrop-blur-md sm:text-xs" onClick={() => openPaymentModal(null)}>
                      <Layers className="h-4 w-4 shrink-0 text-foreground/55 dark:text-white/55" />
                      <span>Misto</span>
                    </Button>
                  </div>
                  <Button type="button" variant="outline" className="flex h-10 w-full flex-col justify-center gap-0 border-2 border-orange-500/45 bg-background py-0.5 text-xs font-extrabold tracking-tight text-foreground shadow-sm hover:bg-orange-500/10 dark:border-orange-400/50 dark:bg-black/60 dark:backdrop-blur-md dark:hover:bg-orange-500/15" onClick={() => openPaymentModal("carne")}>
                    <FileText className="h-4 w-4 shrink-0 text-orange-600 dark:text-orange-400" />
                    Carnê / Parcelado
                  </Button>
                </div>

                {selectedCustomer ? (
                  <Button type="button" variant="outline" className="h-8 w-full border-amber-500/55 text-[11px] text-amber-900 hover:bg-amber-500 hover:text-white" onClick={handlePendOnAccount}>
                    <BookUser className="mr-2 h-3.5 w-3.5" />
                    Pendurar na conta
                  </Button>
                ) : null}

                <div className="shrink-0 space-y-1.5 rounded-lg border-2 border-border bg-muted/80 px-2 py-2.5 sm:px-2.5 dark:border-white/10 dark:bg-black/60 dark:backdrop-blur-md">
                  {discountTotal > 0 ? (
                    <>
                      <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground dark:text-white/55">
                        Totais
                      </p>
                      <div className="flex justify-between text-sm font-semibold">
                        <span className="text-muted-foreground dark:text-white/55">Subtotal</span>
                        <span className="font-extrabold tabular-nums text-foreground dark:text-white">
                          R$ {subtotal.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm font-semibold">
                        <span className="text-muted-foreground dark:text-white/55">Desconto</span>
                        <span className="font-extrabold tabular-nums text-foreground dark:text-white">
                          − R$ {discountTotal.toFixed(2)}
                        </span>
                      </div>
                    </>
                  ) : null}
                  {saleMode === "completa" && emitirNota ? (
                    <div className="flex justify-between text-xs font-medium">
                      <span className="text-muted-foreground dark:text-white/55">NF-e</span>
                      <span className="font-semibold text-foreground dark:text-white/90">Será emitida</span>
                    </div>
                  ) : null}
                  <div
                    className={cn(
                      "flex items-baseline justify-between",
                      discountTotal > 0 || (saleMode === "completa" && emitirNota)
                        ? "border-t border-border pt-1.5 dark:border-white/10"
                        : "pt-0"
                    )}
                  >
                    <span className="text-lg font-black text-foreground sm:text-xl">Total</span>
                    <span className="text-2xl font-black tabular-nums tracking-tight text-emerald-600 dark:text-emerald-400 sm:text-3xl">
                      R$ {total.toFixed(2)}
                    </span>
                  </div>
                </div>

                <Button
                  type="button"
                  className="min-h-[52px] w-full shrink-0 rounded-xl bg-emerald-600 py-3 text-lg font-bold text-zinc-950 shadow-lg hover:bg-emerald-500 sm:text-xl"
                  onClick={() => openPaymentModal(null)}
                  disabled={saleMode === "completa" && !selectedCustomer}
                >
                  Finalizar venda
                </Button>
                <Button type="button" variant="outline" className="h-8 w-full shrink-0 border-border text-xs text-foreground hover:bg-secondary sm:h-9 sm:text-sm" onClick={handlePrintReceipt}>
                  <Receipt className="mr-2 h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  Recibo térmico (80mm)
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
      )}

      <PaymentModal
        isOpen={isPaymentModalOpen}
        onClose={() => {
          setIsPaymentModalOpen(false)
          setInstantPayIntent(null)
          if (uiShell !== "default") focusShellBipe()
        }}
        cartSubtotal={subtotal}
        total={total}
        discountReais={discountReais}
        discountPercent={discountPercent}
        onDiscountReaisChange={setDiscountReais}
        onDiscountPercentChange={setDiscountPercent}
        custoPeca={total * 0.35}
        selectedCustomer={selectedCustomer}
        customerStoreCredit={selectedCustomer ? getSaldoCreditoCliente(selectedCustomer.cpf) : 0}
        instantPayIntent={instantPayIntent}
        onInstantPayIntentConsumed={() => setInstantPayIntent(null)}
        onCustomerCpfUpdate={updateCustomerCpf}
        cashierId={cashierId}
        onConfirm={(payments, meta) => {
          const saleLines = cart
            .filter(
              (item) =>
                isOsVirtualSaleLine(item.inventoryId) || inventory.some((i) => i.id === item.inventoryId)
            )
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
            customerCpf: selectedCustomer?.cpf,
            customerName: selectedCustomer?.name,
          })
          if (!result.ok) {
            toast({ title: "Falha transacional", description: result.reason })
            return
          }
          if (aPrazo > 0.02 && selectedCustomer) {
            appendContaReceberTituloPdvAprazo({
              lojaId: lojaKey,
              saleId: result.saleId,
              clienteNome: selectedCustomer.name,
              valor: aPrazo,
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
          setCart([])
          setDiscountReais(0)
          setDiscountPercent(0)
          setSelectedProduct(null)
          onSaleCompleted?.()
          toast({
            title: "Venda finalizada",
            description: `${payments.length} forma(s) de pagamento confirmada(s).`,
          })
          if (uiShell !== "default") {
            queueMicrotask(() => shellBipeRef.current?.focus())
          }
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
              <Button variant="outline" className="w-full justify-start border-primary/30 hover:bg-primary/10" onClick={() => openOperation("sangria")}>
                Sangria
              </Button>
              <Button variant="outline" className="w-full justify-start border-primary/30 hover:bg-primary/10" onClick={() => openOperation("suprimento")}>
                Reforço (Suprimento)
              </Button>
              <Button variant="outline" className="w-full justify-start border-primary/30 hover:bg-primary/10" onClick={() => openOperation("devolucao")}>
                Troca / Devolução
              </Button>
              <Button variant="outline" className="w-full justify-start border-primary/30 hover:bg-primary/10" onClick={() => openOperation("fechamento")}>
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

      <Dialog open={showKeyboardHelp} onOpenChange={setShowKeyboardHelp}>
        <DialogContent className="max-w-lg border-border bg-card">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Keyboard className="h-5 w-5 text-primary" /> Atalhos de Teclado (PDV)
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p>
              <strong>F1:</strong> Ajuda de atalhos
            </p>
            <p>
              <strong>F2:</strong> Abrir pagamento (com itens no carrinho)
            </p>
            <p>
              <strong>F3:</strong> Buscar produto/serviço
            </p>
            <p>
              <strong>F4:</strong> Quantidade do último item, ou busca de produto se o carrinho estiver vazio
            </p>
            <p>
              <strong>Alt + D:</strong> Abrir pagamento (ajuste de desconto no checkout)
            </p>
            <p>
              <strong>Alt + P:</strong> Forma de pagamento
            </p>
            <p>
              <strong>F10 / Espaço:</strong> Finalizar venda
            </p>
            <p>
              <strong>ESC:</strong> Fechar modais/operações
            </p>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={operationType !== null} onOpenChange={(open) => !open && setOperationType(null)}>
        <DialogContent className="max-w-md border-border bg-card">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HandCoins className="h-5 w-5 text-primary" />
              Registrar{" "}
              {operationType === "suprimento"
                ? "Reforço"
                : operationType === "devolucao"
                  ? "Troca/Devolução"
                  : operationType === "fechamento"
                    ? "Fechamento"
                    : "Sangria"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Valor</Label>
              <Input
                type="number"
                step="0.01"
                value={operationValue}
                onChange={(e) => setOperationValue(e.target.value)}
                className="border-border bg-secondary"
              />
            </div>
            <div className="space-y-1">
              <Label>Motivo</Label>
              <Input
                value={operationReason}
                onChange={(e) => setOperationReason(e.target.value)}
                className="border-border bg-secondary"
              />
            </div>
            <Button onClick={saveOperation} className="w-full bg-primary hover:bg-primary/90">
              Salvar no histórico financeiro
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {cashHistory.length > 0 && (
        <div className="max-h-36 shrink-0 overflow-y-auto overflow-x-hidden border-t border-neutral-200/80 bg-background px-1 py-2">
          <p className="mb-2 text-sm font-semibold text-black">Histórico financeiro do caixa</p>
          <div className="space-y-1.5">
            {cashHistory.slice(0, 6).map((h) => (
              <div
                key={h.id}
                className="flex justify-between gap-2 rounded-md border border-neutral-200/80 bg-background px-2 py-1.5 text-sm"
              >
                <span>
                  {h.type} — {h.reason}
                </span>
                <span className="font-medium tabular-nums">R$ {h.value.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

