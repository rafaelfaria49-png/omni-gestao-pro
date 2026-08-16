"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  CreditCard,
  FileText,
  HelpCircle,
  Loader2,
  MapPin,
  PackageSearch,
  PauseCircle,
  PlusCircle,
  Receipt,
  Search,
  ShieldCheck,
  Trash2,
  User,
  X,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import { useLojaAtiva } from "@/lib/loja-ativa"
import { configPadrao } from "@/lib/config-empresa"
import { computePdvCartTotals } from "@/lib/pdv-cart-totals"
import { useStoreSettings } from "@/lib/store-settings-provider"
import { useOperationsStore } from "@/lib/operations-store"
import { getOrCreatePdvOperatorId } from "@/lib/pdv-operator-id"
import { useSession } from "next-auth/react"
import { operatorDisplayName } from "@/lib/pdv-operator-label"
import { usePdvOperadorNome } from "@/lib/pdv-operador-nome"
import { newPdvLineId, type PdvCatalogProduct } from "@/lib/pdv-catalog"
import { filterPdvCatalogBySearch } from "@/lib/pdv-product-search"
import { findPdvProductByScan } from "@/lib/pdv-scan-product"
import { lookupPdvScanRemote } from "@/lib/pdv-scan-lookup"
import { appendContaReceberTituloPdvAprazo } from "@/lib/pdv-append-conta-receber"
import { displaySaleNumber } from "@/lib/vendas/local-sale-identity"
import { PaymentModal, type PaymentMethod } from "./payment-modal"
import type { APrazoConfig } from "@/lib/operations-sale-types"
import { appendAuditLog } from "@/lib/audit-log"
import { useClienteSearch } from "@/lib/hooks/use-cliente-search"
import { enrichVendaEnterprise } from "@/app/actions/vendas-enterprise"
import { CupomNaoFiscal, type CupomData } from "./cupom-nao-fiscal"
import { ItemAvulsoModal, type ItemAvulsoPayload } from "./item-avulso-modal"
import { VendaEsperaModal } from "./venda-espera-modal"
import { avulsoInventoryId, isAvulsoSaleLine } from "@/lib/os-pdv-virtual-lines"
import { readSelectedTerminal } from "@/lib/pdv-terminal"
import { CaixaStatusBar } from "../caixa/caixa-status-bar"
import { useCaixa } from "../caixa/caixa-provider"
import { useGarantirSessaoCaixa } from "../caixa/use-atualizar-caixa"
import { isCaixaProntoParaFinalizar } from "@/lib/pdv-caixa-session"
import {
  getHeldSales,
  saveHeldSale,
  removeHeldSale,
  newHoldId,
  nextHoldLabel,
  type HeldSale,
} from "@/lib/pdv-hold"
import {
  construirProdutosACadastrar,
  enfileirarProdutosACadastrar,
  acharProdutoPorCodigoExato,
} from "@/lib/pdv-produtos-a-cadastrar"

// ── Types ──────────────────────────────────────────────────────────────────────

type ClienteResult = {
  id: string
  name: string
  phone?: string | null
  email?: string | null
  document?: string | null
}

type TipoVenda = "comum" | "garantia" | "a_prazo" | "orcamento"

const TIPOS_VENDA: { value: TipoVenda; label: string }[] = [
  { value: "comum",     label: "Venda Comum" },
  { value: "garantia",  label: "Com Garantia" },
  { value: "a_prazo",   label: "A Prazo" },
  { value: "orcamento", label: "Orçamento Conv." },
]

type EnderecoEntrega = {
  logradouro: string
  numero: string
  bairro: string
  cidade: string
  uf: string
  cep: string
}

const EMPTY_ENDERECO: EnderecoEntrega = {
  logradouro: "", numero: "", bairro: "", cidade: "", uf: "", cep: "",
}

type LineDetail = {
  imei?: string
  serial?: string
  garantiaDias?: number
  observacao?: string
}

type CartLine = {
  lineId: string
  inventoryId: string
  codigo: string
  name: string
  unid: string
  price: number
  qty: number
  discountPct: number
  detail?: LineDetail
  /** Item avulso (INSERT): não baixa estoque; alimenta a fila "Produtos a cadastrar". */
  isAvulso?: boolean
  custoUnitario?: number | null
  codigoAvulso?: string | null
}

type DraftData = {
  cliente: ClienteResult | null
  cart: CartLine[]
  discountReais: number
  tipoVenda?: TipoVenda
  observacaoGeral?: string
  enderecoEntrega?: EnderecoEntrega
}

// ── Constants ──────────────────────────────────────────────────────────────────

const DRAFT_KEY = (storeId: string) => `omnigestao:venda-completa-ent-v2:${storeId}`

// ── Helpers ────────────────────────────────────────────────────────────────────

const brl = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n)

/** Rótulo legível de uma forma de pagamento do modal compartilhado (cupom/auditoria). */
function pagamentoLabelMethod(p: PaymentMethod): string {
  switch (p.type) {
    case "dinheiro": return "Dinheiro"
    case "pix": return "PIX"
    case "cartao_debito": return "Cartão débito"
    case "cartao_credito": return p.installments && p.installments > 1 ? `Cartão crédito ${p.installments}x` : "Cartão crédito"
    case "carne": return "Carnê"
    case "a_prazo": return p.aPrazoConfig && p.aPrazoConfig.parcelas > 1 ? `À prazo ${p.aPrazoConfig.parcelas}x` : "À prazo"
    case "credito_vale": return "Crédito/Vale"
    default: return p.type
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

export function VendaCompletaEnterprise({ onBack }: { onBack: () => void }) {
  const { inventory, setInventory, caixa, finalizeSaleTransaction, getSaldoCreditoCliente } = useOperationsStore()
  // Mesma porta de pré-pagamento dos demais PDVs: caixa aberto E sessão do
  // terminal atual. Sem isso a venda saía daqui e voltava recusada por
  // `CAIXA_FECHADO`, virando pendência local (F-02 da readiness 002A).
  const { sessaoId } = useCaixa()
  const { garantirSessao } = useGarantirSessaoCaixa()
  const { empresaDocumentos, lojaAtivaId } = useLojaAtiva()
  const { pdvParams } = useStoreSettings()
  const { toast } = useToast()
  const cashierId = useMemo(() => getOrCreatePdvOperatorId(), [])
  const { data: session } = useSession()
  const operadorNomeAbertura = usePdvOperadorNome((lojaAtivaId ?? "").trim())
  const operatorLabel = operatorDisplayName({ aberturaNome: operadorNomeAbertura, session })

  const storeId = useMemo(
    () => (lojaAtivaId ?? "").trim(),
    [lojaAtivaId],
  )

  // ── Cliente ───────────────────────────────────────────────────────────────
  const [clienteQuery, setClienteQuery] = useState("")
  const { clientes: clienteResultados, isLoading: clienteLoading } = useClienteSearch(clienteQuery, storeId)
  const [selectedCliente, setSelectedCliente] = useState<ClienteResult | null>(null)
  const [showClienteDropdown, setShowClienteDropdown] = useState(false)
  const [showEnderecoForm, setShowEnderecoForm] = useState(false)
  const [enderecoEntrega, setEnderecoEntrega] = useState<EnderecoEntrega>(EMPTY_ENDERECO)
  const clienteInputRef = useRef<HTMLInputElement>(null)

  // ── Produtos ──────────────────────────────────────────────────────────────
  const [productQuery, setProductQuery] = useState("")
  const [showProductDropdown, setShowProductDropdown] = useState(false)
  const productInputRef = useRef<HTMLInputElement>(null)

  // ── Carrinho ──────────────────────────────────────────────────────────────
  const [cart, setCart] = useState<CartLine[]>([])
  const [expandedLineId, setExpandedLineId] = useState<string | null>(null)

  // ── Desconto global ───────────────────────────────────────────────────────
  const [discountReais, setDiscountReais] = useState(0)

  // ── Pagamento (modal compartilhado: à vista / múltiplo / à prazo + entrada) ──
  const [isPaymentOpen, setIsPaymentOpen] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)

  // ── Cupom ─────────────────────────────────────────────────────────────────
  const [cupomOpen, setCupomOpen] = useState(false)
  const [cupomData, setCupomData] = useState<CupomData | null>(null)

  // ── Dados da venda ────────────────────────────────────────────────────────
  const [tipoVenda, setTipoVenda] = useState<TipoVenda>("comum")
  const [observacaoGeral, setObservacaoGeral] = useState("")
  const [helpOpen, setHelpOpen] = useState(false)

  // ── Item avulso + venda em espera (paridade com Clássico/Assistência) ──────
  const [showItemAvulsoModal, setShowItemAvulsoModal] = useState(false)
  const [showVendaEsperaModal, setShowVendaEsperaModal] = useState(false)
  const [heldRefresh, setHeldRefresh] = useState(0)
  const terminalIdForHold = useMemo(
    () => readSelectedTerminal(storeId)?.id ?? "default",
    [storeId],
  )
  const heldSales = useMemo(
    () => getHeldSales(storeId, terminalIdForHold),
    // heldRefresh força releitura do localStorage após guardar/retomar/descartar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storeId, terminalIdForHold, heldRefresh],
  )

  // ── Catálogo ──────────────────────────────────────────────────────────────
  const products = useMemo((): PdvCatalogProduct[] => {
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
      }
    })
  }, [inventory])

  const filteredProducts = useMemo(() => {
    const q = productQuery.trim()
    if (!q) return []
    return filterPdvCatalogBySearch(products, q).slice(0, 10)
  }, [products, productQuery])

  // ── Totais ────────────────────────────────────────────────────────────────
  const subtotal = cart.reduce((s, l) => s + l.price * l.qty * (1 - l.discountPct / 100), 0)
  const totalPerLineDiscount = cart.reduce((s, l) => s + l.price * l.qty * (l.discountPct / 100), 0)
  const { impostoEstimado, total } = useMemo(
    () => computePdvCartTotals(subtotal, discountReais, pdvParams),
    [subtotal, discountReais, pdvParams.incluirImpostoEstimadoNoPdv, pdvParams.aliquotaImpostoEstimadoPdv],
  )
  const customerStoreCredit = useMemo(
    () => (selectedCliente?.document ? getSaldoCreditoCliente(selectedCliente.document) : 0),
    [selectedCliente, getSaldoCreditoCliente],
  )

  // ── Draft restore ─────────────────────────────────────────────────────────
  const hasDraftRestored = useRef(false)
  useEffect(() => {
    if (hasDraftRestored.current) return
    if (!Array.isArray(inventory) || inventory.length === 0) return
    hasDraftRestored.current = true
    try {
      const raw = localStorage.getItem(DRAFT_KEY(storeId))
      if (!raw) return
      const draft = JSON.parse(raw) as DraftData
      const validCart = (draft.cart ?? []).filter((l) =>
        isAvulsoSaleLine(l.inventoryId) || inventory.some((i) => i.id === l.inventoryId),
      )
      if (validCart.length > 0) {
        setCart(validCart)
        if ((draft.discountReais ?? 0) > 0) setDiscountReais(draft.discountReais)
        if (draft.cliente) setSelectedCliente(draft.cliente)
        if (draft.tipoVenda) setTipoVenda(draft.tipoVenda)
        if (draft.observacaoGeral) setObservacaoGeral(draft.observacaoGeral)
        if (draft.enderecoEntrega) setEnderecoEntrega(draft.enderecoEntrega)
        toast({
          title: "Rascunho restaurado",
          description: `${validCart.length} ite${validCart.length === 1 ? "m" : "ns"} recuperado${validCart.length === 1 ? "" : "s"}.`,
        })
      }
    } catch { /* ignore */ }
  }, [inventory, storeId, toast])

  // ── Draft save ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!hasDraftRestored.current) return
    try {
      if (cart.length > 0 || selectedCliente) {
        const draft: DraftData = {
          cliente: selectedCliente,
          cart,
          discountReais,
          tipoVenda,
          observacaoGeral,
          enderecoEntrega,
        }
        localStorage.setItem(DRAFT_KEY(storeId), JSON.stringify(draft))
      } else {
        localStorage.removeItem(DRAFT_KEY(storeId))
      }
    } catch { /* ignore */ }
  }, [selectedCliente, cart, discountReais, tipoVenda, observacaoGeral, enderecoEntrega, storeId])

  // ── Mount focus ───────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => clienteInputRef.current?.focus(), 80)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Deixa qualquer combo Alt+_ passar (ex.: Alt+L → Alta Legibilidade global),
      // mesmo padrão do Supermercado/Assistência — atalho global nunca é engolido.
      if (e.altKey) return
      // Toda flag de modal entra no guard — evita atalho disparar com diálogo aberto.
      const anyModalOpen =
        isPaymentOpen || cupomOpen || helpOpen || showItemAvulsoModal || showVendaEsperaModal
      switch (e.key) {
        case "F1":
          e.preventDefault()
          if (!anyModalOpen) handleClickFinalize()
          break
        case "F2":
          e.preventDefault()
          if (anyModalOpen) break
          if (selectedCliente) {
            setSelectedCliente(null)
            setClienteQuery("")
            setEnderecoEntrega(EMPTY_ENDERECO)
            setShowEnderecoForm(false)
            setTimeout(() => clienteInputRef.current?.focus(), 50)
          } else {
            clienteInputRef.current?.focus()
          }
          break
        case "F3":
          e.preventDefault()
          if (!anyModalOpen) productInputRef.current?.focus()
          break
        case "Insert":
          // Item Avulso — venda de balcão sem cadastro (igual Clássico/Assistência).
          e.preventDefault()
          if (!anyModalOpen) setShowItemAvulsoModal(true)
          break
        case "F7":
          // Venda em espera (suspender/retomar) — mesmo atalho dos PDVs ativos.
          e.preventDefault()
          if (!isPaymentOpen && !cupomOpen && !helpOpen) setShowVendaEsperaModal(true)
          break
        case "End":
          e.preventDefault()
          if (!isPaymentOpen && !cupomOpen) setHelpOpen((o) => !o)
          break
        case "Escape":
          if (helpOpen) { e.preventDefault(); setHelpOpen(false) }
          break
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedCliente, isPaymentOpen, cupomOpen, helpOpen, showItemAvulsoModal, showVendaEsperaModal],
  )

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [handleKeyDown])

  // ── Cart helpers ──────────────────────────────────────────────────────────
  const addToCart = useCallback(
    (product: PdvCatalogProduct) => {
      const isService = product.category === "Servicos"
      if (!isService && product.stock <= 0) {
        toast({ title: "Sem estoque", description: `${product.name} está sem estoque.`, variant: "destructive" })
        return
      }
      setCart((prev) => {
        const existing = prev.find((l) => l.inventoryId === product.id)
        if (existing) {
          return prev.map((l) => l.inventoryId === product.id ? { ...l, qty: l.qty + 1 } : l)
        }
        const garantiaDias = pdvParams.garantiaPadraoDias ?? 0
        return [
          ...prev,
          {
            lineId: newPdvLineId(product.id),
            inventoryId: product.id,
            codigo: product.codigo ?? product.sku ?? "",
            name: product.name,
            unid: product.vendaPorPeso ? "KG" : "UN",
            price: product.price,
            qty: 1,
            discountPct: 0,
            detail: garantiaDias > 0 ? { garantiaDias } : undefined,
          },
        ]
      })
      setProductQuery("")
      setShowProductDropdown(false)
    },
    [pdvParams.garantiaPadraoDias, toast],
  )

  function updateQtyDirect(lineId: string, rawQty: number) {
    let qty = rawQty
    if (qty <= 0) { removeFromCart(lineId); return }
    const line = cart.find((l) => l.lineId === lineId)
    if (line) {
      const invItem = inventory.find((i) => i.id === line.inventoryId)
      const isService = invItem?.category === "Servicos"
      if (!isService && invItem && qty > invItem.stock) {
        toast({
          title: "Estoque insuficiente",
          description: `${line.name}: apenas ${invItem.stock} un disponíve${invItem.stock === 1 ? "l" : "is"}.`,
          variant: "destructive",
        })
        qty = invItem.stock
      }
    }
    setCart((prev) => prev.map((l) => l.lineId === lineId ? { ...l, qty } : l))
  }

  function removeFromCart(lineId: string) {
    setCart((prev) => prev.filter((l) => l.lineId !== lineId))
    if (expandedLineId === lineId) setExpandedLineId(null)
  }

  function updateLineDetail(lineId: string, patch: Partial<LineDetail>) {
    setCart((prev) =>
      prev.map((l) => l.lineId === lineId ? { ...l, detail: { ...l.detail, ...patch } } : l),
    )
  }

  function updateLineDiscountPct(lineId: string, pct: number) {
    const clamped = Math.min(100, Math.max(0, isNaN(pct) ? 0 : pct))
    setCart((prev) => prev.map((l) => l.lineId === lineId ? { ...l, discountPct: clamped } : l))
  }

  // ── Item avulso (INSERT) ──────────────────────────────────────────────────
  // Cria uma linha com `inventoryId` virtual (`__avulso__…`) — `isVirtualSaleLine`
  // faz o motor da venda pular a baixa de estoque. Descrição/valor/qtd/custo/código
  // vêm do modal compartilhado (mesma implementação do Clássico/Assistência).
  const addItemAvulso = useCallback((payload: ItemAvulsoPayload) => {
    const lineId = newPdvLineId("avulso")
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
        inventoryId: avulsoInventoryId(lineId),
        codigo: payload.codigo ?? "",
        name: payload.description,
        unid: "UN",
        price,
        qty: quantity,
        discountPct: 0,
        isAvulso: true,
        custoUnitario,
        codigoAvulso: payload.codigo,
      },
    ])
    setShowItemAvulsoModal(false)
    appendAuditLog({
      action: "pdv_item_avulso_adicionado",
      userLabel: (empresaDocumentos.nomeFantasia || "Loja").trim(),
      detail: `${payload.description} · ${quantity}x ${brl(price)}${custoUnitario !== null ? ` · custo ${brl(custoUnitario)}` : " · custo n/i"}`,
    })
    setTimeout(() => productInputRef.current?.focus(), 50)
  }, [empresaDocumentos.nomeFantasia])

  // ── Venda em espera (F7) ──────────────────────────────────────────────────
  function handleHoldSale() {
    if (cart.length === 0) return
    const held: HeldSale = {
      id: newHoldId(),
      label: nextHoldLabel(heldSales),
      savedAt: new Date().toISOString(),
      items: cart.map((l) => ({
        lineId: l.lineId,
        inventoryId: l.inventoryId,
        name: l.name,
        price: l.price,
        quantity: l.qty,
        isAvulso: l.isAvulso,
        custoUnitario: l.custoUnitario,
        codigoAvulso: l.codigoAvulso,
        discountPct: l.discountPct,
        detail: l.detail,
      })),
      customer: selectedCliente
        ? {
            id: selectedCliente.id,
            name: selectedCliente.name,
            cpf: selectedCliente.document ?? undefined,
            phone: selectedCliente.phone ?? undefined,
          }
        : null,
      discountReais,
      pdvType: "venda-completa",
    }
    saveHeldSale(storeId, terminalIdForHold, held)
    setCart([])
    setSelectedCliente(null)
    setClienteQuery("")
    setDiscountReais(0)
    setEnderecoEntrega(EMPTY_ENDERECO)
    setShowEnderecoForm(false)
    setTipoVenda("comum")
    setObservacaoGeral("")
    setExpandedLineId(null)
    setHeldRefresh((n) => n + 1)
    toast({ title: "Venda em espera", description: `${held.label} guardada.` })
  }

  function handleResumeSale(sale: HeldSale) {
    setCart(
      sale.items.map((i) => {
        const inv = inventory.find((x) => x.id === i.inventoryId)
        return {
          lineId: i.lineId,
          inventoryId: i.inventoryId,
          codigo: i.codigoAvulso ?? inv?.codigo ?? inv?.sku ?? "",
          name: i.name,
          unid: i.vendaPorPeso ? "KG" : "UN",
          price: i.price,
          qty: i.quantity,
          discountPct: i.discountPct ?? 0,
          detail: i.detail,
          isAvulso: i.isAvulso,
          custoUnitario: i.custoUnitario,
          codigoAvulso: i.codigoAvulso,
        }
      }),
    )
    if (sale.customer) {
      setSelectedCliente({
        id: sale.customer.id,
        name: sale.customer.name,
        phone: sale.customer.phone ?? null,
        document: sale.customer.cpf ?? null,
      })
    }
    setDiscountReais(sale.discountReais ?? 0)
    removeHeldSale(storeId, terminalIdForHold, sale.id)
    setHeldRefresh((n) => n + 1)
    toast({ title: "Venda retomada", description: `${sale.label} carregada no carrinho.` })
  }

  function handleDiscardHold(id: string) {
    removeHeldSale(storeId, terminalIdForHold, id)
    setHeldRefresh((n) => n + 1)
  }

  // ── Validações e abertura do modal ────────────────────────────────────────
  function handleClickFinalize() {
    if (!selectedCliente) {
      toast({ title: "Cliente obrigatório", description: "Selecione o cliente antes de finalizar [F2].", variant: "destructive" })
      clienteInputRef.current?.focus()
      return
    }
    if (cart.length === 0) {
      toast({ title: "Carrinho vazio", description: "Adicione produtos ao pedido antes de finalizar.", variant: "destructive" })
      productInputRef.current?.focus()
      return
    }
    if (total <= 0) {
      toast({ title: "Total inválido", description: "O valor total precisa ser maior que zero.", variant: "destructive" })
      return
    }
    // Caixa fechado na tela ou sem referência de sessão utilizável: reconsulta a
    // sessão do terminal atual antes de recusar. O carrinho é mantido e a venda
    // NÃO é enviada — recuperada a sessão, quem finaliza de novo é o operador
    // (uma resposta inconclusiva nunca vira venda duplicada).
    if (!isCaixaProntoParaFinalizar({ isOpen: caixa.isOpen, sessaoId })) {
      void garantirSessao()
      return
    }
    setIsPaymentOpen(true)
  }

  // ── Confirmação e finalização ─────────────────────────────────────────────
  async function handleConfirmPayment(payments: PaymentMethod[]) {
    if (!selectedCliente || cart.length === 0 || total <= 0) return
    if (payments.length === 0) {
      toast({ title: "Selecione a forma de pagamento", variant: "destructive" })
      return
    }
    // Segunda porta: a sessão pode ter fechado (ou sido reconciliada para
    // "sem caixa") com o modal de pagamento já aberto. Bloqueia ANTES de
    // `finalizeSaleTransaction` — nenhuma venda é criada, nenhuma pendência
    // nasce, e o carrinho e as formas digitadas continuam montados.
    if (!isCaixaProntoParaFinalizar({ isOpen: caixa.isOpen, sessaoId })) {
      void garantirSessao()
      return
    }

    setIsProcessing(true)
    try {
      const saleLines = cart
        .filter((l) => isAvulsoSaleLine(l.inventoryId) || inventory.some((i) => i.id === l.inventoryId))
        .map((l) => ({
          inventoryId: l.inventoryId,
          quantity: l.qty,
          unitPrice: l.price * (1 - l.discountPct / 100),
          name: l.name,
          ...(l.isAvulso ? { isAvulso: true as const } : {}),
          ...(l.custoUnitario !== undefined ? { custoUnitario: l.custoUnitario } : {}),
        }))

      let dinheiro = 0, pix = 0, cartaoDebito = 0, cartaoCredito = 0, carne = 0, aPrazo = 0, creditoVale = 0
      let aPrazoConfig: APrazoConfig | undefined
      for (const p of payments) {
        if (p.type === "dinheiro") dinheiro += p.value
        else if (p.type === "pix") pix += p.value
        else if (p.type === "cartao_debito") cartaoDebito += p.value
        else if (p.type === "cartao_credito") cartaoCredito += p.value
        else if (p.type === "carne") carne += p.value
        else if (p.type === "a_prazo") { aPrazo += p.value; if (p.aPrazoConfig) aPrazoConfig = p.aPrazoConfig }
        else if (p.type === "credito_vale") creditoVale += p.value
      }
      const paymentBreakdown = { dinheiro, pix, cartaoDebito, cartaoCredito, aPrazo, carne, creditoVale }

      const result = await finalizeSaleTransaction({
        lines: saleLines,
        total,
        paymentBreakdown,
        auditMeta: {
          cashierId,
          discountReais,
          discountPercent: subtotal > 0 ? (discountReais / (subtotal + totalPerLineDiscount)) * 100 : 0,
        },
        customerCpf: selectedCliente.document ?? undefined,
        customerName: selectedCliente.name,
        clienteId: selectedCliente.id || undefined,
        aPrazoConfig,
      })

      if (!result.ok) {
        toast({ title: "Falha ao registrar venda", description: result.reason, variant: "destructive" })
        return
      }

      // Fila "Produtos a cadastrar": itens avulsos vendidos → revisão posterior.
      // Não toca estoque/venda/caixa e nunca lança (venda já concluída).
      try {
        const avulsosVendidos = cart.filter((l) => l.isAvulso)
        if (avulsosVendidos.length > 0) {
          enfileirarProdutosACadastrar(
            storeId,
            construirProdutosACadastrar({
              storeId,
              vendaId: result.saleId,
              operador: operatorLabel,
              itens: avulsosVendidos.map((l) => ({
                lineId: l.lineId,
                nome: l.name,
                codigo: l.codigoAvulso,
                precoVenda: l.price,
                custo: l.custoUnitario,
                quantidade: l.qty,
              })),
            }),
          )
        }
      } catch {
        /* fila é auxiliar — não interrompe o pós-venda */
      }

      if (aPrazo > 0.02 && !result.pending) {
        appendContaReceberTituloPdvAprazo({
          lojaId: storeId,
          saleId: result.saleId,
          clienteNome: selectedCliente.name,
          valor: aPrazo,
          aPrazoConfig,
        })
      }

      const pagamentosResumo = payments.map((p) => `${pagamentoLabelMethod(p)} ${brl(p.value)}`).join(" + ")
      appendAuditLog({
        action: "sale_finalized",
        userLabel: (empresaDocumentos.nomeFantasia || "Loja").trim(),
        detail: `Venda Completa Enterprise ${displaySaleNumber(result.saleId, result.pending)} | ${selectedCliente.name} | ${pagamentosResumo} | ${brl(total)}`,
      })

      const linhasDetalhe = cart
        .filter((l) => l.detail && Object.values(l.detail).some(Boolean))
        .map((l) => ({
          inventoryId: l.inventoryId,
          nome: l.name,
          imei: l.detail?.imei,
          serial: l.detail?.serial,
          garantiaDias: l.detail?.garantiaDias,
          observacao: l.detail?.observacao,
        }))

      // enrichVendaEnterprise awaited — persiste dados completos no DB
      const enrichResult = result.pending
        ? { ok: false as const }
        : await enrichVendaEnterprise({
        pedidoId: result.saleId,
        storeId,
        clienteId: selectedCliente.id,
        clienteNome: selectedCliente.name,
        clienteDocument: selectedCliente.document ?? undefined,
        clienteTelefone: selectedCliente.phone ?? undefined,
        clienteEmail: selectedCliente.email ?? undefined,
        observacoesVenda: observacaoGeral || undefined,
        tipoVenda,
        enderecoEntrega: Object.values(enderecoEntrega).some((v) => v.trim() !== "")
          ? enderecoEntrega
          : undefined,
        linhasDetalhe,
      })

      if (!enrichResult.ok) {
        // Venda local já registrada — avisa sem bloquear o fluxo
        toast({
          title: "Aviso de sincronização",
          description: "Venda registrada localmente. Os dados detalhados serão sincronizados em breve.",
        })
      }

      const storeDisplayName =
        (empresaDocumentos.nomeFantasia || configPadrao.empresa.nomeFantasia || "Loja").trim() || "Loja"

      const tipoVendaLabel = TIPOS_VENDA.find((t) => t.value === tipoVenda)?.label
      const cupom: CupomData = {
        numeroPedido: displaySaleNumber(result.saleId, result.pending),
        at: new Date().toISOString(),
        lojaNome: storeDisplayName,
        clienteNome: selectedCliente.name,
        clienteCpf: selectedCliente.document ?? null,
        operador: operatorLabel,
        tipoVenda: tipoVenda !== "comum" ? tipoVendaLabel : undefined,
        observacaoGeral: observacaoGeral || undefined,
        itens: cart.map((l) => ({
          nome: l.name,
          quantidade: l.qty,
          precoUnitario: l.price,
          lineTotal: Math.round(l.price * l.qty * (1 - l.discountPct / 100) * 100) / 100,
        })),
        pagamentos: payments.map((p) => ({ label: pagamentoLabelMethod(p), valor: p.value })),
        total,
        desconto: discountReais > 0 ? discountReais : undefined,
      }

      setCupomData(cupom)
      setIsPaymentOpen(false)
      setCupomOpen(true)

      try { localStorage.removeItem(DRAFT_KEY(storeId)) } catch {}

      setCart([])
      setProductQuery("") // limpa termo + resultados de busca após finalizar (GOAL limpeza pós-ação)
      setShowProductDropdown(false)
      setDiscountReais(0)
      setSelectedCliente(null)
      setClienteQuery("")
      setExpandedLineId(null)
      setTipoVenda("comum")
      setObservacaoGeral("")
      setEnderecoEntrega(EMPTY_ENDERECO)
      setShowEnderecoForm(false)
    } finally {
      setIsProcessing(false)
    }
  }

  const canFinalize = selectedCliente !== null && cart.length > 0 && total > 0 && caixa.isOpen

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">

      {/* ── Header ── */}
      <div className="shrink-0 border-b border-border bg-background">
        <div className="flex items-center gap-2 px-4 py-2.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onBack}
            className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>

          <div className="flex min-w-0 flex-1 items-center gap-2">
            <ShieldCheck className="h-5 w-5 shrink-0 text-primary" />
            <div className="min-w-0">
              <p className="text-sm font-bold leading-tight text-foreground">
                Venda Completa Enterprise
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                {selectedCliente
                  ? `${selectedCliente.name} · Op: ${operatorLabel}`
                  : `Op: ${operatorLabel} — Identifique o cliente`}
              </p>
            </div>
          </div>

          {cart.length > 0 && (
            <Badge variant="secondary" className="shrink-0 tabular-nums">
              {cart.reduce((s, l) => s + l.qty, 0)}{" "}
              {cart.reduce((s, l) => s + l.qty, 0) === 1 ? "item" : "itens"}
            </Badge>
          )}

          {!caixa.isOpen && (
            <Badge variant="destructive" className="shrink-0 text-[10px]">
              Caixa fechado
            </Badge>
          )}

          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setHelpOpen(true)}
            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
            title="Atalhos de teclado [END]"
          >
            <HelpCircle className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Barra de caixa compartilhada: abertura/fechamento/sangria/suprimento +
          status visual + badge de pendências (paridade com Clássico/Assistência). */}
      <CaixaStatusBar variant="pdv" />

      {/* ── Body: esquerda scrollável + sidebar direita fixa ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">

        {/* ── Coluna esquerda ── */}
        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="divide-y divide-border">

            {/* ── CLIENTE ── */}
            <section className="bg-background px-4 py-4">
              <div className="mb-2 flex items-center gap-1.5">
                <User className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Cliente <span className="text-destructive">*</span>
                </span>
              </div>

              {selectedCliente ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between rounded-xl border border-primary/30 bg-primary/5 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {selectedCliente.name}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[selectedCliente.phone?.trim() || null, selectedCliente.email?.trim() || null]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setSelectedCliente(null)
                        setClienteQuery("")
                        setEnderecoEntrega(EMPTY_ENDERECO)
                        setShowEnderecoForm(false)
                        setTimeout(() => clienteInputRef.current?.focus(), 50)
                      }}
                      className="ml-2 h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowEnderecoForm((o) => !o)}
                    className="flex w-full items-center justify-between rounded-lg border border-border bg-secondary px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/70"
                  >
                    <span className="flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5" />
                      Endereço de entrega
                      {Object.values(enderecoEntrega).some((v) => v.trim() !== "") && (
                        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                      )}
                    </span>
                    {showEnderecoForm ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>

                  {showEnderecoForm && (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {(
                        [
                          { key: "cep",        label: "CEP",        placeholder: "00000-000", maxLength: 9,         colSpan: "" },
                          { key: "numero",     label: "Número",     placeholder: "Nº",        maxLength: undefined, colSpan: "" },
                          { key: "logradouro", label: "Logradouro", placeholder: "Rua, Av…",  maxLength: undefined, colSpan: "col-span-2 sm:col-span-3" },
                          { key: "bairro",     label: "Bairro",     placeholder: "Bairro",    maxLength: undefined, colSpan: "" },
                          { key: "cidade",     label: "Cidade",     placeholder: "Cidade",    maxLength: undefined, colSpan: "" },
                          { key: "uf",         label: "UF",         placeholder: "SP",        maxLength: 2,         colSpan: "" },
                        ] as { key: keyof EnderecoEntrega; label: string; placeholder: string; maxLength?: number; colSpan: string }[]
                      ).map(({ key, label, placeholder, maxLength, colSpan }) => (
                        <div key={key} className={cn("space-y-1", colSpan)}>
                          <Label className="text-[11px] text-muted-foreground">{label}</Label>
                          <Input
                            placeholder={placeholder}
                            value={enderecoEntrega[key]}
                            maxLength={maxLength}
                            onChange={(e) =>
                              setEnderecoEntrega((prev) => ({
                                ...prev,
                                [key]: key === "uf" ? e.target.value.toUpperCase().slice(0, 2) : e.target.value,
                              }))
                            }
                            className="h-8 border-border bg-background text-xs"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="relative">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    {clienteLoading && (
                      <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                    )}
                    <Input
                      ref={clienteInputRef}
                      placeholder="Nome, CPF ou telefone… [F2]"
                      value={clienteQuery}
                      onChange={(e) => { setClienteQuery(e.target.value); setShowClienteDropdown(true) }}
                      onFocus={() => { if (clienteQuery.trim()) setShowClienteDropdown(true) }}
                      onBlur={() => setTimeout(() => setShowClienteDropdown(false), 200)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") { setShowClienteDropdown(false); setClienteQuery("") }
                        if (e.key === "Enter" && clienteResultados.length > 0) {
                          e.preventDefault()
                          const c = clienteResultados[0]!
                          setSelectedCliente(c)
                          setClienteQuery("")
                          setShowClienteDropdown(false)
                          setTimeout(() => productInputRef.current?.focus(), 80)
                        }
                      }}
                      className="h-10 border-border bg-secondary pl-9 pr-9 text-sm"
                    />
                  </div>
                  {showClienteDropdown && (clienteResultados.length > 0 || clienteLoading) && (
                    <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border border-border bg-card shadow-lg">
                      {clienteLoading && clienteResultados.length === 0 ? (
                        <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" /> Buscando…
                        </div>
                      ) : (
                        clienteResultados.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            className="flex w-full items-center gap-3 border-b border-border px-4 py-2.5 text-left last:border-0 hover:bg-secondary"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setSelectedCliente(c)
                              setClienteQuery("")
                              setShowClienteDropdown(false)
                              setTimeout(() => productInputRef.current?.focus(), 80)
                            }}
                          >
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                              <User className="h-3.5 w-3.5" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-foreground">{c.name}</p>
                              <p className="truncate text-xs text-muted-foreground">{c.phone ?? ""}</p>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* ── ITENS: busca + tabela ERP ── */}
            <section className="bg-background px-4 py-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Receipt className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Itens
                  </span>
                  {cart.length > 0 && (
                    <Badge variant="secondary" className="text-[10px] tabular-nums">
                      {cart.length} linha{cart.length !== 1 ? "s" : ""}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 px-2 text-xs"
                    onClick={() => setShowItemAvulsoModal(true)}
                    title="Item avulso — venda de balcão sem cadastro [INS]"
                  >
                    <PlusCircle className="h-3.5 w-3.5" />
                    Item avulso
                    <kbd className="ml-0.5 rounded border border-border bg-muted px-1 py-0.5 font-mono text-[9px] text-muted-foreground">INS</kbd>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 px-2 text-xs"
                    onClick={() => setShowVendaEsperaModal(true)}
                    title="Vendas em espera — suspender/retomar [F7]"
                  >
                    <PauseCircle className="h-3.5 w-3.5" />
                    Em espera
                    {heldSales.length > 0 && (
                      <Badge variant="secondary" className="ml-0.5 h-4 px-1 text-[9px] tabular-nums">
                        {heldSales.length}
                      </Badge>
                    )}
                  </Button>
                  {cart.length > 0 && (
                    <button
                      type="button"
                      className="ml-1 text-xs text-muted-foreground transition-colors hover:text-destructive"
                      onClick={() => { setCart([]); setExpandedLineId(null); setProductQuery(""); setShowProductDropdown(false) }}
                    >
                      Limpar tudo
                    </button>
                  )}
                </div>
              </div>

              {/* Busca de produto */}
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={productInputRef}
                  placeholder="Adicionar: nome, SKU ou código de barras… [F3]"
                  value={productQuery}
                  onChange={(e) => { setProductQuery(e.target.value); setShowProductDropdown(true) }}
                  onFocus={() => { if (productQuery.trim()) setShowProductDropdown(true) }}
                  onBlur={() => setTimeout(() => setShowProductDropdown(false), 200)}
                  onKeyDown={async (e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      const raw = productQuery.trim()
                      if (!raw) return
                      const exact = findPdvProductByScan(raw, products)
                      if (exact) { addToCart(exact); return }
                      if (filteredProducts.length > 0) { addToCart(filteredProducts[0]!); return }
                      // Miss local → catálogo INTEIRO da loja (snapshot pode estar defasado),
                      // igual ao PDV Assistência/Clássico. Isolamento multi-loja no servidor.
                      const remote = await lookupPdvScanRemote({ code: raw, storeId, setInventory })
                      if (remote.kind === "single") { addToCart(remote.product); return }
                      if (remote.kind === "multiple") {
                        toast({ title: "Vários produtos", description: `Mais de um item para "${raw}". Refine a busca.` })
                        return
                      }
                      toast({
                        title: "Produto não encontrado",
                        description: `Nada encontrado nesta loja para o código: ${raw}`,
                        variant: "destructive",
                      })
                    }
                    if (e.key === "Escape") { setShowProductDropdown(false); setProductQuery("") }
                  }}
                  className="h-10 border-border bg-secondary pl-9 text-sm"
                />

                {showProductDropdown && filteredProducts.length > 0 && (
                  <div className="absolute z-40 mt-1 w-full overflow-hidden rounded-md border border-border bg-card shadow-lg">
                    <div className="max-h-60 overflow-y-auto">
                      {filteredProducts.map((p) => {
                        const isService = p.category === "Servicos"
                        const outOfStock = !isService && p.stock <= 0
                        const lowStock = !isService && !outOfStock && p.stock <= 5
                        return (
                          <button
                            key={p.id}
                            type="button"
                            disabled={outOfStock}
                            className="flex w-full items-center justify-between border-b border-border px-3 py-2 text-left last:border-0 hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => addToCart(p)}
                          >
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-medium text-foreground">{p.name}</p>
                              <p className="text-[10px] text-muted-foreground">
                                {p.codigo ?? p.sku ?? ""}
                                {outOfStock ? " · Sem estoque" : lowStock ? ` · Baixo: ${p.stock} un` : ""}
                              </p>
                            </div>
                            <div className="ml-3 shrink-0 text-right">
                              <p className="text-xs font-bold tabular-nums text-primary">{brl(p.price)}</p>
                              <p className={cn("text-[10px]", outOfStock ? "text-destructive/70" : lowStock ? "text-amber-500" : "text-muted-foreground")}>
                                {isService ? "Serviço" : `${p.stock} un`}
                              </p>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {showProductDropdown && productQuery.trim() && products.length > 0 && filteredProducts.length === 0 && (
                  <div className="absolute z-40 mt-1 w-full rounded-md border border-border bg-card px-3 py-3 shadow-lg">
                    <p className="text-xs text-muted-foreground">
                      Nenhum resultado para &ldquo;{productQuery}&rdquo;
                    </p>
                  </div>
                )}
              </div>

              {products.length === 0 && !productQuery && cart.length === 0 && (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-8 text-center">
                  <PackageSearch className="mb-1.5 h-6 w-6 text-muted-foreground/40" />
                  <p className="text-xs font-medium text-muted-foreground">Nenhum produto cadastrado</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground/60">Cadastre itens no módulo Estoque</p>
                </div>
              )}

              {cart.length === 0 && products.length > 0 ? (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-10 text-center">
                  <PackageSearch className="mb-2 h-8 w-8 text-muted-foreground/40" />
                  <p className="text-sm font-medium text-muted-foreground">Nenhum item adicionado</p>
                  <p className="mt-0.5 text-xs text-muted-foreground/60">Busque um produto acima</p>
                </div>
              ) : cart.length > 0 ? (
                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full min-w-[680px] text-xs">
                    <thead>
                      <tr className="border-b border-border bg-muted/40">
                        <th className="w-8 px-2 py-2 text-right text-[10px] font-semibold text-muted-foreground">#</th>
                        <th className="w-24 px-2 py-2 text-left text-[10px] font-semibold text-muted-foreground">CÓDIGO</th>
                        <th className="px-2 py-2 text-left text-[10px] font-semibold text-muted-foreground">DESCRIÇÃO</th>
                        <th className="w-12 px-2 py-2 text-center text-[10px] font-semibold text-muted-foreground">UNID</th>
                        <th className="w-20 px-2 py-2 text-center text-[10px] font-semibold text-muted-foreground">QTD</th>
                        <th className="w-24 px-2 py-2 text-right text-[10px] font-semibold text-muted-foreground">UNIT</th>
                        <th className="w-[72px] px-2 py-2 text-center text-[10px] font-semibold text-muted-foreground">DESC%</th>
                        <th className="w-24 px-2 py-2 text-right text-[10px] font-semibold text-muted-foreground">TOTAL</th>
                        <th className="w-14 px-2 py-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {cart.map((line, idx) => {
                        const isExpanded = expandedLineId === line.lineId
                        const hasDetail = line.detail && Object.values(line.detail).some(Boolean)
                        const lineTotal = line.price * line.qty * (1 - line.discountPct / 100)
                        return (
                          <>
                            <tr key={line.lineId} className="bg-card">
                              <td className="px-2 py-2.5 text-right tabular-nums text-muted-foreground">{idx + 1}</td>
                              <td className="px-2 py-2.5">
                                <span className="font-mono text-[10px] text-muted-foreground">{line.codigo || "—"}</span>
                              </td>
                              <td className="px-2 py-2.5">
                                <p className="font-medium leading-tight text-foreground">{line.name}</p>
                                {hasDetail && (
                                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                                    {[
                                      line.detail?.imei ? `IMEI: ${line.detail.imei}` : null,
                                      line.detail?.garantiaDias ? `${line.detail.garantiaDias}d gar.` : null,
                                    ].filter(Boolean).join(" · ")}
                                  </p>
                                )}
                              </td>
                              <td className="px-2 py-2.5 text-center text-muted-foreground">{line.unid}</td>
                              <td className="px-2 py-2.5 text-center">
                                <input
                                  type="number"
                                  min={1}
                                  value={line.qty}
                                  onChange={(e) => {
                                    const v = parseInt(e.target.value, 10)
                                    if (!isNaN(v)) updateQtyDirect(line.lineId, v)
                                  }}
                                  className="w-14 rounded border border-border bg-background px-1.5 py-0.5 text-center text-xs font-bold tabular-nums text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                                />
                              </td>
                              <td className="px-2 py-2.5 text-right tabular-nums text-muted-foreground">{brl(line.price)}</td>
                              <td className="px-2 py-2.5 text-center">
                                <div className="flex items-center justify-center gap-0.5">
                                  <input
                                    type="number"
                                    min={0}
                                    max={100}
                                    step={0.5}
                                    placeholder="0"
                                    value={line.discountPct === 0 ? "" : line.discountPct}
                                    onChange={(e) => updateLineDiscountPct(line.lineId, parseFloat(e.target.value))}
                                    className="w-12 rounded border border-border bg-background px-1 py-0.5 text-center text-xs tabular-nums text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                                  />
                                  <span className="text-[10px] text-muted-foreground">%</span>
                                </div>
                              </td>
                              <td className={cn(
                                "px-2 py-2.5 text-right tabular-nums font-semibold",
                                line.discountPct > 0 ? "text-amber-600 dark:text-amber-400" : "text-foreground",
                              )}>
                                {brl(lineTotal)}
                              </td>
                              <td className="px-2 py-2.5">
                                <div className="flex items-center justify-end gap-1">
                                  <button
                                    type="button"
                                    onClick={() => setExpandedLineId(isExpanded ? null : line.lineId)}
                                    className={cn(
                                      "flex h-6 w-6 items-center justify-center rounded border transition-colors",
                                      isExpanded
                                        ? "border-primary bg-primary/10 text-primary"
                                        : hasDetail
                                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
                                          : "border-border bg-background text-muted-foreground hover:bg-secondary",
                                    )}
                                  >
                                    {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => removeFromCart(line.lineId)}
                                    className="flex h-6 w-6 items-center justify-center rounded border border-border bg-background text-muted-foreground transition-colors hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr key={`${line.lineId}-detail`} className="bg-muted/30">
                                <td colSpan={9} className="px-3 py-3">
                                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                    Dados do produto
                                  </p>
                                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                                    <div className="space-y-1">
                                      <Label className="text-[11px] text-muted-foreground">IMEI</Label>
                                      <Input
                                        placeholder="000000000000000"
                                        value={line.detail?.imei ?? ""}
                                        onChange={(e) => updateLineDetail(line.lineId, { imei: e.target.value })}
                                        className="h-8 border-border bg-background text-xs"
                                        maxLength={15}
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <Label className="text-[11px] text-muted-foreground">Nº de Série</Label>
                                      <Input
                                        placeholder="SN-…"
                                        value={line.detail?.serial ?? ""}
                                        onChange={(e) => updateLineDetail(line.lineId, { serial: e.target.value })}
                                        className="h-8 border-border bg-background text-xs"
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <Label className="text-[11px] text-muted-foreground">Garantia (dias)</Label>
                                      <Input
                                        type="number"
                                        min={0}
                                        max={3650}
                                        placeholder="90"
                                        value={line.detail?.garantiaDias !== undefined ? String(line.detail.garantiaDias) : ""}
                                        onChange={(e) =>
                                          updateLineDetail(line.lineId, {
                                            garantiaDias: e.target.value ? Math.max(0, parseInt(e.target.value, 10)) : undefined,
                                          })
                                        }
                                        className="h-8 border-border bg-background text-xs"
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <Label className="text-[11px] text-muted-foreground">Observação</Label>
                                      <Input
                                        placeholder="Obs. do item…"
                                        value={line.detail?.observacao ?? ""}
                                        onChange={(e) => updateLineDetail(line.lineId, { observacao: e.target.value })}
                                        className="h-8 border-border bg-background text-xs"
                                      />
                                    </div>
                                  </div>
                                  {hasDetail && (
                                    <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-2 py-1.5">
                                      <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                                      <p className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                                        Dados registrados — serão salvos no cupom e no sistema
                                      </p>
                                    </div>
                                  )}
                                </td>
                              </tr>
                            )}
                          </>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </section>

            {/* ── DADOS DA VENDA ── */}
            <section className="bg-background px-4 py-4">
              <div className="mb-2 flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Dados da Venda
                </span>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <p className="text-[11px] font-medium text-muted-foreground">Tipo</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {TIPOS_VENDA.map((t) => (
                      <button
                        key={t.value}
                        type="button"
                        onClick={() => setTipoVenda(t.value)}
                        className={cn(
                          "rounded-lg border px-2 py-2 text-left text-xs transition-all",
                          tipoVenda === t.value
                            ? "border-primary bg-primary/10 font-semibold text-primary"
                            : "border-border bg-card text-muted-foreground hover:bg-secondary",
                        )}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">Observação geral</Label>
                    <Input
                      placeholder="Observação para esta venda…"
                      value={observacaoGeral}
                      onChange={(e) => setObservacaoGeral(e.target.value)}
                      className="h-8 border-border bg-secondary text-xs"
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-border bg-card px-2.5 py-1.5 text-[11px] text-muted-foreground">
                    <span>Operador</span>
                    <span className="font-medium text-foreground">{operatorLabel}</span>
                  </div>
                </div>
              </div>
            </section>

          </div>
        </div>

        {/* ── Sidebar direita: totais + finalizar ── */}
        <div className="flex w-72 shrink-0 flex-col overflow-hidden border-l border-border bg-background">

          <div className="flex-1 space-y-3 overflow-y-auto p-4">

            {/* Resumo de valores */}
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Resumo
              </p>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="tabular-nums font-medium text-foreground">{brl(subtotal + totalPerLineDiscount)}</span>
                </div>
                {totalPerLineDiscount > 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Desc. por item</span>
                    <span className="tabular-nums text-amber-500">−{brl(totalPerLineDiscount)}</span>
                  </div>
                )}
                {totalPerLineDiscount > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Subtotal c/ desc.</span>
                    <span className="tabular-nums font-medium text-foreground">{brl(subtotal)}</span>
                  </div>
                )}
                <div className="space-y-1 pt-1">
                  <Label className="text-[11px] text-muted-foreground">Desconto global (R$)</Label>
                  <Input
                    type="number"
                    min={0}
                    placeholder="0,00"
                    value={discountReais || ""}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value)
                      setDiscountReais(isNaN(v) ? 0 : Math.max(0, v))
                    }}
                    className="h-8 border-border bg-background text-xs tabular-nums"
                  />
                </div>
                {discountReais > 0 && (
                  <div className="flex items-center justify-between text-xs text-amber-500">
                    <span>Desc. global</span>
                    <span className="tabular-nums">−{brl(discountReais)}</span>
                  </div>
                )}
                {impostoEstimado > 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Imposto estimado</span>
                    <span className="tabular-nums font-medium text-foreground">{brl(impostoEstimado)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between border-t border-border pt-3">
                  <span className="text-base font-bold text-foreground">Total</span>
                  <span className="text-xl font-bold tabular-nums text-foreground">{brl(total)}</span>
                </div>
              </div>
            </div>

            {/* Resumo da venda */}
            <div className="rounded-xl border border-border bg-card p-3 text-xs text-muted-foreground">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span>Tipo</span>
                  <span className="font-medium text-foreground">
                    {TIPOS_VENDA.find((t) => t.value === tipoVenda)?.label}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Operador</span>
                  <span className="font-medium text-foreground">{operatorLabel}</span>
                </div>
                {cart.length > 0 && (
                  <div className="flex items-center justify-between">
                    <span>Linhas</span>
                    <span className="font-medium text-foreground">{cart.length}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span>Caixa</span>
                  <span className={cn("font-medium", caixa.isOpen ? "text-emerald-600 dark:text-emerald-400" : "text-destructive")}>
                    {caixa.isOpen ? "Aberto" : "Fechado"}
                  </span>
                </div>
                {customerStoreCredit > 0 && (
                  <div className="flex items-center justify-between">
                    <span>Crédito cliente</span>
                    <span className="font-medium text-emerald-600 dark:text-emerald-400">{brl(customerStoreCredit)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Avisos */}
            {!selectedCliente && (
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-2.5 py-2">
                <p className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
                  [F2] Selecione o cliente para continuar
                </p>
              </div>
            )}
            {cart.length === 0 && (
              <div className="rounded-lg border border-border bg-muted/30 px-2.5 py-2">
                <p className="text-[11px] text-muted-foreground">
                  Adicione produtos para finalizar.
                </p>
              </div>
            )}
            {!caixa.isOpen && (
              <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-2.5 py-2">
                <p className="text-[11px] font-medium text-destructive">
                  Abra o caixa antes de registrar uma venda.
                </p>
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-border p-4">
            <Button
              type="button"
              className="h-12 w-full rounded-xl bg-emerald-600 text-sm font-bold text-zinc-950 shadow-lg hover:bg-emerald-500 disabled:opacity-50"
              disabled={!canFinalize}
              onClick={handleClickFinalize}
            >
              <span>Finalizar Venda</span>
              <kbd className="ml-2 rounded border border-zinc-950/20 bg-zinc-950/10 px-1.5 py-0.5 font-mono text-[10px] font-medium">
                F1
              </kbd>
            </Button>
          </div>
        </div>
      </div>

      {/* ── Modal de pagamento (compartilhado: à vista / múltiplo / à prazo + entrada) ── */}
      <PaymentModal
        isOpen={isPaymentOpen}
        onClose={() => {
          if (!isProcessing) setIsPaymentOpen(false)
        }}
        cartSubtotal={subtotal}
        impostoEstimado={impostoEstimado}
        total={total}
        discountReais={discountReais}
        discountPercent={0}
        onDiscountReaisChange={setDiscountReais}
        onDiscountPercentChange={(pct) =>
          setDiscountReais(Math.max(0, Math.round(subtotal * (pct / 100) * 100) / 100))
        }
        selectedCustomer={
          selectedCliente
            ? {
                id: selectedCliente.id,
                name: selectedCliente.name,
                cpf: (selectedCliente.document ?? "").trim(),
                phone: (selectedCliente.phone ?? "").trim(),
              }
            : null
        }
        customerStoreCredit={customerStoreCredit}
        cashierId={cashierId}
        onCustomerCpfUpdate={(id, cpf) =>
          setSelectedCliente((prev) => (prev && prev.id === id ? { ...prev, document: cpf } : prev))
        }
        onRequireCustomer={() => clienteInputRef.current?.focus()}
        onConfirm={(payments) => {
          void handleConfirmPayment(payments)
        }}
      />

      {/* ── Modal de ajuda ── */}
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="max-w-md rounded-2xl border-border bg-card p-0">
          <DialogHeader className="border-b border-border px-5 py-3">
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
              <HelpCircle className="h-4 w-4 text-primary" />
              Atalhos — Venda Completa Enterprise
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 divide-x divide-border">
            <div className="p-4">
              <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-primary">Venda</p>
              <div className="space-y-2.5">
                {(
                  [
                    { key: "F1", label: "Finalizar venda" },
                    { key: "F2", label: "Buscar / limpar cliente" },
                    { key: "F3", label: "Foco no produto" },
                    { key: "INS", label: "Item avulso" },
                    { key: "F7", label: "Vendas em espera" },
                    { key: "↵",  label: "Bipe / 1º resultado" },
                  ] as const
                ).map(({ key, label }) => (
                  <div key={key} className="flex items-center justify-between gap-3">
                    <span className="text-xs text-muted-foreground">{label}</span>
                    <kbd className="shrink-0 rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-primary">
                      {key}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
            <div className="p-4">
              <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Navegação</p>
              <div className="space-y-2.5">
                {(
                  [
                    { key: "END", label: "Esta ajuda" },
                    { key: "ESC", label: "Fechar modal" },
                  ] as const
                ).map(({ key, label }) => (
                  <div key={key} className="flex items-center justify-between gap-3">
                    <span className="text-xs text-muted-foreground">{label}</span>
                    <kbd className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-bold text-muted-foreground">
                      {key}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="border-t border-border px-5 py-2.5">
            <p className="text-[11px] text-muted-foreground">
              Operador: <span className="font-medium text-foreground">{operatorLabel}</span>
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Item avulso (INSERT) ── */}
      <ItemAvulsoModal
        open={showItemAvulsoModal}
        onOpenChange={setShowItemAvulsoModal}
        onConfirm={addItemAvulso}
        checkCodigoExistente={(codigo) => acharProdutoPorCodigoExato(products, codigo)}
      />

      {/* ── Vendas em espera (F7) ── */}
      <VendaEsperaModal
        open={showVendaEsperaModal}
        onOpenChange={setShowVendaEsperaModal}
        heldSales={heldSales}
        cartEmpty={cart.length === 0}
        onHold={handleHoldSale}
        onResume={handleResumeSale}
        onDiscard={handleDiscardHold}
      />

      {/* ── Cupom não fiscal ── */}
      {cupomData && (
        <CupomNaoFiscal
          isOpen={cupomOpen}
          onClose={() => setCupomOpen(false)}
          data={cupomData}
        />
      )}
    </div>
  )
}
