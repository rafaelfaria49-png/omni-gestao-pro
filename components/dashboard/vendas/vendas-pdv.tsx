"use client"

import { useEffect, useRef, useState } from "react"
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
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { PaymentModal } from "./payment-modal"
import { CaixaStatusBar } from "../caixa/caixa-status-bar"
import { useCaixa } from "../caixa/caixa-provider"
import { configPadrao, useConfigEmpresa } from "@/lib/config-empresa"
import { useLojaAtiva } from "@/lib/loja-ativa"
import { buildPdvReceiptEscPos } from "@/lib/escpos"
import {
  sendEscPosViaProxy,
  downloadEscPosFile,
  openThermalHtmlPrint,
  escapeHtml,
} from "@/lib/thermal-print"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { useOperationsStore } from "@/lib/operations-store"
import {
  PDV_PRODUCTS_BASE,
  mergePdvCatalogWithInventory,
  newPdvLineId,
  type PdvCatalogProduct,
} from "@/lib/pdv-catalog"
import {
  PDV_IMPORT_COMANDA_KEY,
  type PdvImportComandaPayload,
} from "@/lib/pdv-comanda-bridge"
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
}

type Product = PdvCatalogProduct

/** Categorias que não aparecem na grade até o usuário buscar (filtro inteligente do PDV). */
const PDV_CATEGORIAS_OCULTAS_ATE_BUSCA = new Set(["telas", "baterias", "conectores"])

type PdvUiMode = "default" | "touch" | "scanner"

const PDV_UI_STORAGE_KEY = "assistec-pdv-ui-mode"

const mockCustomers: Customer[] = [
  { id: "1", name: "Joao Silva", cpf: "123.456.789-00", phone: "(11) 99999-1234", saldoDevedor: 150.00 },
  { id: "2", name: "Maria Santos", cpf: "987.654.321-00", phone: "(11) 98888-5678", saldoDevedor: 0 },
  { id: "3", name: "Pedro Oliveira", cpf: "456.789.123-00", phone: "(11) 97777-9012", saldoDevedor: 280.00 },
]

interface VendasPDVProps {
  linkedOsId?: string | null
  onSaleCompleted?: () => void
  /** Item sugerido por comando de voz (adicionado ao carrinho ao montar/atualizar). */
  voiceCartSeed?: { key: number; itemName: string; price?: number } | null
  onVoiceCartSeedConsumed?: () => void
  voiceOpenCaixaSignal?: number
  onVoiceOpenCaixaConsumed?: () => void
}

export function VendasPDV({
  linkedOsId = null,
  onSaleCompleted,
  voiceCartSeed = null,
  onVoiceCartSeedConsumed,
  voiceOpenCaixaSignal = 0,
  onVoiceOpenCaixaConsumed,
}: VendasPDVProps) {
  const router = useRouter()
  const { config } = useConfigEmpresa()
  const { empresaDocumentos, getEnderecoDocumentos } = useLojaAtiva()
  const { adicionarEntrada, adicionarSaida } = useCaixa()
  const { inventory, finalizeSaleTransaction, getSaldoCreditoCliente } = useOperationsStore()
  const { toast } = useToast()
  const [saleMode, setSaleMode] = useState<SaleMode>("balcao")
  const [searchTerm, setSearchTerm] = useState("")
  const [customerSearch, setCustomerSearch] = useState("")
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
  const [selectedPayment, setSelectedPayment] = useState<"dinheiro" | "cartao" | "pix" | null>(null)
  const [showOperationsMenu, setShowOperationsMenu] = useState(false)
  const [pdvUiMode, setPdvUiMode] = useState<PdvUiMode>("default")
  const [weightDialogOpen, setWeightDialogOpen] = useState(false)
  const [weightProduct, setWeightProduct] = useState<Product | null>(null)
  const [weightKgInput, setWeightKgInput] = useState("")
  const [scaleBusy, setScaleBusy] = useState(false)
  const [attrDialogOpen, setAttrDialogOpen] = useState(false)
  const [attrProduct, setAttrProduct] = useState<Product | null>(null)
  const [attrSelections, setAttrSelections] = useState<Record<string, string>>({})
  const [operationType, setOperationType] = useState<"sangria" | "suprimento" | "devolucao" | "fechamento" | null>(null)
  const [operationValue, setOperationValue] = useState("")
  const [operationReason, setOperationReason] = useState("")
  const [cashHistory, setCashHistory] = useState<Array<{ id: string; type: string; value: number; reason: string; at: string }>>([])
  const customerInputRef = useRef<HTMLInputElement>(null)
  const productInputRef = useRef<HTMLInputElement>(null)
  const quantityInputRef = useRef<HTMLInputElement>(null)
  const comandaImportDone = useRef(false)

  const auditUser = () =>
    `${(config.empresa.nomeFantasia || "Loja").trim() || "Administrador"} (sessão local)`
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

  const quickItems = (config.pdv.atalhosRapidos || []).map((a) => ({
    id: a.id,
    name: a.nome,
    price: a.preco,
    stock: 999,
    category: "Atalho",
  }))

  const products = mergePdvCatalogWithInventory(PDV_PRODUCTS_BASE, inventory)

  const searchTrim = searchTerm.trim()
  const hideCategoriesPdv = config.pdv.ocultarCategoriasNoPdv === true
  const hiddenCategoriesSet = new Set(
    (config.pdv.categoriasOcultasNoPdv ?? []).map((c) => c.toLowerCase())
  )
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

  const filteredCustomers = mockCustomers.filter(c =>
    c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
    c.cpf.includes(customerSearch) ||
    c.phone.includes(customerSearch)
  )

  const pushCartLine = (params: {
    inventoryId: string
    name: string
    price: number
    quantity: number
    vendaPorPeso?: boolean
    atributosLabel?: string
  }) => {
    setCart((prev) => [
      ...prev,
      {
        lineId: newPdvLineId(params.inventoryId),
        inventoryId: params.inventoryId,
        name: params.name,
        price: params.price,
        quantity: params.quantity,
        complementos: [],
        vendaPorPeso: params.vendaPorPeso,
        atributosLabel: params.atributosLabel,
      },
    ])
  }

  const addToCart = (product: Product) => {
    if (product.stock <= 0) {
      toast({ title: "Sem estoque", description: `${product.name} está sem saldo no estoque.` })
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
      quantity: 1,
    })
    setSelectedProduct(product)
  }

  const addQuickItem = (item: Product) => {
    addToCart(item)
  }

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
    const parts = weightProduct.atributos?.length
      ? weightProduct.atributos.map((a) => attrSelections[a.id]).filter(Boolean)
      : []
    const baseName =
      parts.length > 0 ? `${weightProduct.name} (${parts.join(" · ")})` : weightProduct.name
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
  const discountTotal = Math.min(
    +(subtotal * (pctRaw / 100)).toFixed(2) + Math.max(0, discountReais || 0),
    subtotal
  )
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
      .map(
        (i) =>
          `<p>${escapeHtml(String(i.quantity))}x ${escapeHtml(i.name)} — ${br.format(i.price * i.quantity)}</p>`
      )
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
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")
      if (e.key === "F1") {
        e.preventDefault()
        setShowKeyboardHelp(true)
      } else if (e.key === "F2") {
        e.preventDefault()
        customerInputRef.current?.focus()
      } else if (e.key === "F3") {
        e.preventDefault()
        productInputRef.current?.focus()
      } else if (e.key === "F4") {
        e.preventDefault()
        quantityInputRef.current?.focus()
      } else if (e.altKey && (e.key === "d" || e.key === "D")) {
        e.preventDefault()
        if (cart.length > 0) setIsPaymentModalOpen(true)
      } else if (e.altKey && (e.key === "p" || e.key === "P")) {
        e.preventDefault()
        setSelectedPayment("dinheiro")
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
  }, [cart.length])

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

  return (
    <div className="space-y-4">
      {/* Barra de Status do Caixa */}
      <CaixaStatusBar
        openAberturaSignal={voiceOpenCaixaSignal}
        onOpenAberturaSignalConsumed={onVoiceOpenCaixaConsumed}
      />

      {/* Header do PDV - Toggle de Modo */}
      <Card className="bg-card border-border">
        <CardContent className="py-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            {/* Toggle de Modo */}
            <div className="flex bg-secondary rounded-lg p-1 w-full sm:w-auto">
              <button
                onClick={() => {
                  setSaleMode("balcao")
                  setEmitirNota(false)
                }}
                className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-3 rounded-md font-medium transition-all ${
                  saleMode === "balcao"
                    ? "bg-primary text-primary-foreground shadow-lg"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Zap className="w-4 h-4" />
                <span>Venda Balcao (Rapida)</span>
              </button>
              <button
                onClick={() => setSaleMode("completa")}
                className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-3 rounded-md font-medium transition-all ${
                  saleMode === "completa"
                    ? "bg-primary text-primary-foreground shadow-lg"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <FileText className="w-4 h-4" />
                <span>Venda Completa (Nota)</span>
              </button>
            </div>

            {/* Status do Modo */}
            <Badge 
              variant={saleMode === "balcao" ? "secondary" : "default"}
              className={`text-sm px-4 py-2 ${saleMode === "completa" ? "bg-primary/20 text-primary border border-primary/30" : ""}`}
            >
              {saleMode === "balcao" ? "Modo Rapido" : "Modo Completo - Com NF-e"}
            </Badge>
            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-center sm:justify-end">
              <span className="text-xs text-muted-foreground mr-1">Interface:</span>
              <Button
                type="button"
                size="sm"
                variant={pdvUiMode === "default" ? "default" : "outline"}
                className="h-9"
                onClick={() => setPdvUiMode("default")}
              >
                Padrão
              </Button>
              <Button
                type="button"
                size="sm"
                variant={pdvUiMode === "touch" ? "default" : "outline"}
                className="h-9 gap-1"
                onClick={() => setPdvUiMode("touch")}
              >
                <LayoutGrid className="w-4 h-4" />
                Touch
              </Button>
              <Button
                type="button"
                size="sm"
                variant={pdvUiMode === "scanner" ? "default" : "outline"}
                className="h-9 gap-1"
                onClick={() => setPdvUiMode("scanner")}
              >
                <ScanLine className="w-4 h-4" />
                Scanner
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cliente Opcional no Modo Balcao */}
      {saleMode === "balcao" && (
        <Card className="bg-card border-border border-dashed">
          <CardContent className="py-3 space-y-3">
            <div className="flex flex-col sm:flex-row items-center gap-4">
              <div className="flex-1 relative w-full">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Selecionar cliente (opcional)..."
                      value={customerSearch}
                      onChange={(e) => {
                        setCustomerSearch(e.target.value)
                        setShowCustomerDropdown(true)
                      }}
                      onFocus={() => setShowCustomerDropdown(true)}
                      ref={customerInputRef}
                      className="pl-10 h-10 bg-secondary border-border text-sm"
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
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  )}
                </div>

                {/* Dropdown de Clientes */}
                {showCustomerDropdown && customerSearch && (
                  <div className="absolute z-10 w-full mt-1 bg-card border border-border rounded-lg shadow-xl max-h-48 overflow-y-auto">
                    {filteredCustomers.length > 0 ? (
                      filteredCustomers.map((customer) => (
                        <button
                          key={customer.id}
                          onClick={() => {
                            setSelectedCustomer(customer)
                            setCustomerSearch("")
                            setShowCustomerDropdown(false)
                          }}
                          className="w-full px-4 py-2 text-left hover:bg-secondary transition-colors border-b border-border last:border-0"
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-medium text-foreground text-sm">{customer.name}</p>
                              <p className="text-xs text-muted-foreground">{customer.phone}</p>
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
                      <div className="px-4 py-2 text-muted-foreground text-center text-sm">
                        Nenhum cliente encontrado
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Cliente Selecionado Badge */}
              {selectedCustomer && (
                <div className="flex items-center gap-2 px-3 py-2 bg-primary/10 border border-primary/30 rounded-lg">
                  <User className="w-4 h-4 text-primary" />
                  <span className="font-medium text-sm text-foreground">{selectedCustomer.name}</span>
                  {selectedCustomer.saldoDevedor && selectedCustomer.saldoDevedor > 0 && (
                    <Badge variant="outline" className="text-xs border-amber-500/50 text-amber-500">
                      Deve R$ {selectedCustomer.saldoDevedor.toFixed(2)}
                    </Badge>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Cliente Selecionado - Apenas no Modo Completa */}
      {saleMode === "completa" && (
        <Card className="bg-card border-border">
          <CardContent className="py-4">
            <div className="flex flex-col lg:flex-row gap-4">
              {/* Busca de Cliente */}
              <div className="flex-1 relative">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Buscar cliente por nome, CPF ou telefone..."
                      value={customerSearch}
                      onChange={(e) => {
                        setCustomerSearch(e.target.value)
                        setShowCustomerDropdown(true)
                      }}
                      onFocus={() => setShowCustomerDropdown(true)}
                      ref={customerInputRef}
                      className="pl-10 bg-secondary border-border"
                    />
                  </div>
                  <Button variant="outline" className="border-primary text-primary hover:bg-primary hover:text-primary-foreground">
                    <UserPlus className="w-4 h-4 mr-2" />
                    Cadastrar Novo
                  </Button>
                </div>

                {/* Dropdown de Clientes */}
                {showCustomerDropdown && customerSearch && (
                  <div className="absolute z-10 w-full mt-1 bg-card border border-border rounded-lg shadow-xl max-h-60 overflow-y-auto">
                    {filteredCustomers.length > 0 ? (
                      filteredCustomers.map((customer) => (
                        <button
                          key={customer.id}
                          onClick={() => {
                            setSelectedCustomer(customer)
                            setCustomerSearch("")
                            setShowCustomerDropdown(false)
                          }}
                          className="w-full px-4 py-3 text-left hover:bg-secondary transition-colors border-b border-border last:border-0"
                        >
                          <p className="font-medium text-foreground">{customer.name}</p>
                          <p className="text-sm text-muted-foreground">
                            CPF: {customer.cpf} | Tel: {customer.phone}
                          </p>
                        </button>
                      ))
                    ) : (
                      <div className="px-4 py-3 text-muted-foreground text-center">
                        Nenhum cliente encontrado
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Checkbox Emitir Nota */}
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <div 
                    onClick={() => setEmitirNota(!emitirNota)}
                    className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-all ${
                      emitirNota 
                        ? "bg-primary border-primary" 
                        : "border-muted-foreground group-hover:border-primary"
                    }`}
                  >
                    {emitirNota && <Check className="w-4 h-4 text-primary-foreground" />}
                  </div>
                  <span className="font-medium text-foreground">Emitir Nota Fiscal</span>
                </label>
              </div>
            </div>

            {/* Cliente Selecionado Badge */}
            {selectedCustomer && (
              <div className="mt-4 p-4 bg-primary/10 border border-primary/30 rounded-lg flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center">
                    <User className="w-5 h-5 text-primary-foreground" />
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">{selectedCustomer.name}</p>
                    <p className="text-sm text-muted-foreground">
                      CPF: {selectedCustomer.cpf} | Tel: {selectedCustomer.phone}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setSelectedCustomer(null)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <X className="w-5 h-5" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Grid Principal */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Produtos */}
        <div className="lg:col-span-2 space-y-4">
          {pdvUiMode !== "scanner" && (
            <Card className="bg-card border-border">
              <CardContent className="py-4">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Serviços rápidos — edite em Configurações → Personalização do PDV
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-primary"
                    onClick={() => setShowKeyboardHelp(true)}
                  >
                    <Keyboard className="w-4 h-4 mr-1" /> Atalhos de teclado
                  </Button>
                </div>
                <div
                  className={`grid grid-cols-1 sm:grid-cols-2 mt-3 ${pdvUiMode === "touch" ? "gap-4" : "gap-3"}`}
                >
                  {quickItems.length === 0 ? (
                    <p className="text-sm text-muted-foreground sm:col-span-2">
                      Configure os três cards de serviço em Configurações → Personalização do PDV.
                    </p>
                  ) : (
                    quickItems.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => addQuickItem(item)}
                        className={`flex flex-col rounded-xl border-2 border-border bg-secondary/80 hover:bg-secondary hover:border-primary transition-colors text-left justify-between ${
                          pdvUiMode === "touch"
                            ? "p-8 min-h-[160px] text-lg"
                            : "p-5 min-h-[128px]"
                        }`}
                      >
                        <Sparkles className="w-5 h-5 text-primary shrink-0" />
                        <span
                          className={`font-semibold text-foreground leading-snug ${pdvUiMode === "touch" ? "text-xl" : "text-base"}`}
                        >
                          {item.name}
                        </span>
                        <span
                          className={`font-bold text-primary ${pdvUiMode === "touch" ? "text-3xl" : "text-2xl"}`}
                        >
                          R$ {item.price.toFixed(2).replace(".", ",")}
                        </span>
                      </button>
                    ))
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => router.replace("/?page=os")}
                  className={`mt-3 w-full flex flex-col rounded-xl border-2 border-primary bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg text-left justify-center gap-2 ${
                    pdvUiMode === "touch" ? "p-8 min-h-[120px]" : "p-5 min-h-[100px]"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <ClipboardList className={`shrink-0 opacity-95 ${pdvUiMode === "touch" ? "w-9 h-9" : "w-7 h-7"}`} />
                    <span
                      className={`font-bold tracking-tight leading-tight ${pdvUiMode === "touch" ? "text-2xl" : "text-lg sm:text-xl"}`}
                    >
                      NOVA ORDEM DE SERVIÇO
                    </span>
                  </div>
                  <span className="text-xs font-medium opacity-90 pl-10 sm:pl-0">Abrir cadastro de O.S.</span>
                </button>
              </CardContent>
            </Card>
          )}

          <Card className="bg-card border-border">
            <CardHeader className="pb-4">
              <div className="flex flex-col sm:flex-row gap-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar produto ou codigo de barras..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    ref={productInputRef}
                    className={`pl-10 bg-secondary border-border ${pdvUiMode === "scanner" ? "h-14 text-lg ring-2 ring-primary/40" : ""}`}
                  />
                </div>
                <Button variant="outline" className="border-border">
                  <Barcode className="w-4 h-4 mr-2" />
                  Leitor
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {filteredProducts.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  {!searchTrim
                    ? "Telas, Baterias e Conectores ficam ocultos até você buscar. Digite o nome ou categoria."
                    : "Nenhum produto encontrado."}
                </p>
              ) : null}
              <div
                className={`grid gap-3 ${pdvUiMode === "touch" ? "grid-cols-2 sm:grid-cols-2 gap-4" : "grid-cols-2 sm:grid-cols-3"}`}
              >
                {filteredProducts.map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => addToCart(product)}
                    className={`flex flex-col rounded-lg bg-secondary hover:bg-secondary/80 border border-border hover:border-primary transition-colors text-left ${
                      pdvUiMode === "touch" ? "p-6 min-h-[120px] justify-between" : "p-4"
                    }`}
                  >
                    <span
                      className={`font-medium text-foreground line-clamp-2 ${pdvUiMode === "touch" ? "text-lg" : "text-sm"}`}
                    >
                      {product.name}
                    </span>
                    <span className="text-xs text-muted-foreground mt-1">{product.category}</span>
                    <div className="flex items-center justify-between mt-2 gap-2">
                      <span
                        className={`font-bold text-primary shrink-0 ${pdvUiMode === "touch" ? "text-2xl" : "text-lg"}`}
                      >
                        {product.vendaPorPeso
                          ? `R$ ${product.price.toFixed(2)}/kg`
                          : `R$ ${product.price.toFixed(2)}`}
                      </span>
                      <Badge variant={product.stock <= 5 ? "destructive" : "secondary"} className="text-xs shrink-0">
                        {product.vendaPorPeso ? `${product.stock} kg` : `${product.stock} un`}
                      </Badge>
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Sugestoes de Complementos */}
          {selectedProduct?.complementos && selectedProduct.complementos.length > 0 && (
            <Card className="bg-card border-primary/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-primary" />
                  Sugestoes de Complementos
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Clientes que compraram {selectedProduct.name} tambem levaram:
                </p>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {selectedProduct.complementos.map((comp) => (
                    <Button
                      key={comp.id}
                      variant="outline"
                      size="sm"
                      onClick={() => addComplemento(selectedProduct.id, comp.name, comp.price)}
                      className="border-primary/50 hover:bg-primary hover:text-primary-foreground"
                    >
                      <Plus className="w-3 h-3 mr-1" />
                      {comp.name} - R$ {comp.price.toFixed(2)}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Carrinho */}
        <div className="lg:col-span-1">
          <Card className="bg-card border-border sticky top-4">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                <ShoppingBag className="w-5 h-5" />
                Carrinho
                {selectedCustomer && (
                  <Badge variant="outline" className="ml-auto text-xs">
                    {selectedCustomer.name.split(" ")[0]}
                  </Badge>
                )}
                {linkedOsId && (
                  <Badge variant="outline" className="text-primary border-primary/40">
                    Venda vinculada à O.S.
                  </Badge>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-auto text-primary"
                  onClick={() => setShowOperationsMenu((p) => !p)}
                >
                  <Settings className="w-4 h-4" />
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {cart.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <ShoppingBag className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>Carrinho vazio</p>
                  <p className="text-sm">Adicione produtos para iniciar a venda</p>
                </div>
              ) : (
                <>
                  <div className="space-y-3 max-h-64 overflow-y-auto">
                    {cart.map((item) => (
                      <div key={item.lineId} className="flex items-center gap-2 p-2 rounded-lg bg-secondary">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{item.name}</p>
                          <p className="text-xs text-muted-foreground">
                            R$ {item.price.toFixed(2)}
                            {item.vendaPorPeso ? "/kg" : ""} ×{" "}
                            {item.vendaPorPeso ? `${item.quantity.toFixed(3)} kg` : item.quantity}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => updateQuantity(item.lineId, -1)}
                          >
                            <Minus className="w-3 h-3" />
                          </Button>
                          <span className="w-10 text-center text-sm font-medium">
                            {item.vendaPorPeso ? item.quantity.toFixed(2) : item.quantity}
                          </span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => updateQuantity(item.lineId, 1)}
                          >
                            <Plus className="w-3 h-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive"
                            onClick={() => removeFromCart(item.lineId)}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Quantidade do último item (F4)</Label>
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
                        const next = last.vendaPorPeso
                          ? Math.max(0.001, parseFloat(raw) || 0.001)
                          : Math.max(1, parseInt(raw, 10) || 1)
                        setCart((prev) =>
                          prev.map((i) => (i.lineId === lastId ? { ...i, quantity: next } : i))
                        )
                      }}
                      step={cart.length && cart[cart.length - 1].vendaPorPeso ? "0.001" : "1"}
                      className="h-10 bg-secondary border-border"
                    />
                  </div>

                  {/* Saldo Devedor do Cliente */}
                  {selectedCustomer && selectedCustomer.saldoDevedor && selectedCustomer.saldoDevedor > 0 && (
                    <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-amber-500">Saldo Devedor</span>
                        <span className="font-bold text-amber-500">
                          R$ {selectedCustomer.saldoDevedor.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Subtotal</span>
                      <span>R$ {subtotal.toFixed(2)}</span>
                    </div>
                    {discountTotal > 0 && (
                      <div className="flex justify-between text-sm text-primary">
                        <span>Desconto</span>
                        <span>− R$ {discountTotal.toFixed(2)}</span>
                      </div>
                    )}
                    <p className="text-[11px] text-muted-foreground">
                      Desconto (R$ e %) no passo &quot;Finalizar venda&quot;.
                    </p>
                    {saleMode === "completa" && emitirNota && (
                      <div className="flex justify-between text-sm text-primary">
                        <span>NF-e</span>
                        <span>Sera emitida</span>
                      </div>
                    )}
                    <div className="flex justify-between text-lg font-bold">
                      <span>Total (líquido)</span>
                      <span className="text-primary">R$ {total.toFixed(2)}</span>
                    </div>
                  </div>

                  <Separator />

                  {/* Formas de Pagamento */}
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-muted-foreground">Forma de Pagamento</p>
                    <div className="grid grid-cols-3 gap-2">
                      <Button variant="outline" onClick={() => setSelectedPayment("dinheiro")} className={`flex-col h-auto py-3 border-border hover:border-primary ${selectedPayment === "dinheiro" ? "border-primary text-primary" : ""}`}>
                        <Banknote className="w-5 h-5 mb-1" />
                        <span className="text-xs">Dinheiro</span>
                      </Button>
                      <Button variant="outline" onClick={() => setSelectedPayment("cartao")} className={`flex-col h-auto py-3 border-border hover:border-primary ${selectedPayment === "cartao" ? "border-primary text-primary" : ""}`}>
                        <CreditCard className="w-5 h-5 mb-1" />
                        <span className="text-xs">Cartao</span>
                      </Button>
                      <Button variant="outline" onClick={() => setSelectedPayment("pix")} className={`flex-col h-auto py-3 border-border hover:border-primary ${selectedPayment === "pix" ? "border-primary text-primary" : ""}`}>
                        <QrCode className="w-5 h-5 mb-1" />
                        <span className="text-xs">Pix</span>
                      </Button>
                    </div>
                    
                    {/* Opcao Pendurar na Conta - So aparece com cliente selecionado */}
                    {selectedCustomer && (
                      <Button 
                        variant="outline" 
                        className="w-full h-12 border-amber-500/50 text-amber-500 hover:bg-amber-500 hover:text-white"
                        onClick={handlePendOnAccount}
                      >
                        <BookUser className="w-5 h-5 mr-2" />
                        Pendurar / Conta do Cliente
                      </Button>
                    )}
                  </div>

                  {/* Botoes de Acao */}
                  <div className="space-y-2">
                    <Button 
                      className="w-full h-12 text-base font-semibold bg-primary hover:bg-primary/90"
                      onClick={() => setIsPaymentModalOpen(true)}
                      disabled={saleMode === "completa" && !selectedCustomer}
                    >
                      Finalizar Venda
                    </Button>
                    
                    {/* Botao Recibo Simples */}
                    <Button 
                      variant="outline"
                      className="w-full h-10 border-border hover:bg-secondary"
                      onClick={handlePrintReceipt}
                    >
                      <Receipt className="w-4 h-4 mr-2" />
                      Recibo Simples (Termica 80mm)
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Modal de Pagamento */}
      <PaymentModal
        isOpen={isPaymentModalOpen}
        onClose={() => setIsPaymentModalOpen(false)}
        cartSubtotal={subtotal}
        total={total}
        discountReais={discountReais}
        discountPercent={discountPercent}
        onDiscountReaisChange={setDiscountReais}
        onDiscountPercentChange={setDiscountPercent}
        custoPeca={total * 0.35}
        selectedCustomer={selectedCustomer}
        customerStoreCredit={selectedCustomer ? getSaldoCreditoCliente(selectedCustomer.cpf) : 0}
        onConfirm={(payments) => {
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
          let creditoVale = 0
          for (const p of payments) {
            if (p.type === "dinheiro") dinheiro += p.value
            else if (p.type === "pix") pix += p.value
            else if (p.type === "cartao_debito") cartaoDebito += p.value
            else if (p.type === "cartao_credito") cartaoCredito += p.value
            else if (p.type === "carne") carne += p.value
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
              creditoVale,
            },
            customerCpf: selectedCustomer?.cpf,
            customerName: selectedCustomer?.name,
          })
          if (!result.ok) {
            toast({ title: "Falha transacional", description: result.reason })
            return
          }
          appendAuditLog({
            action: "sale_finalized",
            userLabel: auditUser(),
            detail: `Venda ${result.saleId} Total ${formatBrlAudit(total)} | Din ${formatBrlAudit(dinheiro)} Pix ${formatBrlAudit(pix)} Déb ${formatBrlAudit(cartaoDebito)} Créd ${formatBrlAudit(cartaoCredito)} Carnê ${formatBrlAudit(carne)} Vale ${formatBrlAudit(creditoVale)}`,
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
          setCart([])
          setDiscountReais(0)
          setDiscountPercent(0)
          setSelectedProduct(null)
          onSaleCompleted?.()
          toast({
            title: "Venda finalizada",
            description: `${payments.length} forma(s) de pagamento confirmada(s).`,
          })
        }}
      />

      {showOperationsMenu && (
        <div
          className="fixed inset-0 z-[70] bg-black/10"
          onClick={() => setShowOperationsMenu(false)}
        >
          <Card
            className="fixed right-4 top-1/2 -translate-y-1/2 w-64 bg-card border-border shadow-xl z-[80]"
            onClick={(e) => e.stopPropagation()}
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Settings className="w-4 h-4 text-primary" />
                Operações de Caixa
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button variant="outline" className="w-full justify-start border-primary/30 hover:bg-primary/10" onClick={() => openOperation("sangria")}>Sangria</Button>
              <Button variant="outline" className="w-full justify-start border-primary/30 hover:bg-primary/10" onClick={() => openOperation("suprimento")}>Reforço (Suprimento)</Button>
              <Button variant="outline" className="w-full justify-start border-primary/30 hover:bg-primary/10" onClick={() => openOperation("devolucao")}>Troca / Devolução</Button>
              <Button variant="outline" className="w-full justify-start border-primary/30 hover:bg-primary/10" onClick={() => openOperation("fechamento")}>Fechamento de Caixa</Button>
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
        <DialogContent className="max-w-lg bg-card border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Keyboard className="w-5 h-5 text-primary" /> Atalhos de Teclado (PDV)</DialogTitle>
          </DialogHeader>
          <div className="text-sm space-y-2">
            <p><strong>F1:</strong> Ajuda de atalhos</p>
            <p><strong>F2:</strong> Buscar cliente</p>
            <p><strong>F3:</strong> Buscar produto/serviço</p>
            <p><strong>F4:</strong> Quantidade do último item</p>
            <p><strong>Alt + D:</strong> Abrir pagamento (ajuste de desconto no checkout)</p>
            <p><strong>Alt + P:</strong> Forma de pagamento</p>
            <p><strong>F10 / Espaço:</strong> Finalizar venda</p>
            <p><strong>ESC:</strong> Fechar modais/operações</p>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={operationType !== null} onOpenChange={(open) => !open && setOperationType(null)}>
        <DialogContent className="max-w-md bg-card border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HandCoins className="w-5 h-5 text-primary" />
              Registrar {operationType === "suprimento" ? "Reforço" : operationType === "devolucao" ? "Troca/Devolução" : operationType === "fechamento" ? "Fechamento" : "Sangria"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Valor</Label>
              <Input type="number" step="0.01" value={operationValue} onChange={(e) => setOperationValue(e.target.value)} className="bg-secondary border-border" />
            </div>
            <div className="space-y-1">
              <Label>Motivo</Label>
              <Input value={operationReason} onChange={(e) => setOperationReason(e.target.value)} className="bg-secondary border-border" />
            </div>
            <Button onClick={saveOperation} className="w-full bg-primary hover:bg-primary/90">Salvar no histórico financeiro</Button>
          </div>
        </DialogContent>
      </Dialog>

      {cashHistory.length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Histórico Financeiro do Caixa</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {cashHistory.slice(0, 6).map((h) => (
              <div key={h.id} className="p-2 rounded border border-border bg-secondary/30 text-sm flex justify-between gap-2">
                <span>{h.type} - {h.reason}</span>
                <span className="font-medium">R$ {h.value.toFixed(2)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
