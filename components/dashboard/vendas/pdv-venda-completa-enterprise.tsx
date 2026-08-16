"use client"

/**
 * ⚠️ COMPONENTE LEGADO / ÓRFÃO — NÃO USAR EM CÓDIGO NOVO.
 *
 * Esta é uma DUPLICATA não roteada de `venda-completa-enterprise.tsx`. Exporta
 * `PdvVendaCompletaEnterprise` e o re-exporta como alias `VendaCompletaEnterprise`
 * no fim do arquivo — porém NENHUMA rota/módulo importa este arquivo.
 *
 * Caminho oficial e ATIVO da "Venda Completa":
 *   app/dashboard/vendas/venda-completa/page.tsx
 *     → venda-completa-page-client.tsx
 *       → `VendaCompletaEnterprise` de `./venda-completa-enterprise` (SEM o prefixo `pdv-`).
 *
 * Status: código morto. Verificado em 2026-06-20 — busca por imports deste módulo
 * retorna zero ocorrências. É referenciado apenas por:
 *   - documentação de auditoria (docs/audits/*), e
 *   - o lint estático `lib/multi-loja-client-no-legacy-fallback.test.ts` (que lê o
 *     arquivo via readFileSync como guarda anti-fallback de loja principal — DT-13;
 *     por isso evite citar aqui o literal da constante de loja legada).
 *
 * Mantido por ora apenas para preservar esse teste e o histórico. A remoção definitiva
 * exige também retirar a entrada deste arquivo de `DT13_FILES` no teste acima.
 * Ref.: GOAL_PDV_ORPHAN_CLEANUP · docs/audits/AUDITORIA_OPERACIONAL_PDV_REAL_v01.md (P3-01).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  HelpCircle,
  Loader2,
  Maximize2,
  Minimize2,
  Minus,
  PackageSearch,
  Plus,
  Receipt,
  Search,
  ShieldCheck,
  Smartphone,
  Trash2,
  User,
  UserPlus,
  X,
  FileText,
  MapPin,
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
import {
  newPdvLineId,
  type PdvCatalogProduct,
} from "@/lib/pdv-catalog"
import { useClienteSearch } from "@/lib/hooks/use-cliente-search"
import { filterPdvCatalogBySearch } from "@/lib/pdv-product-search"
import { findPdvProductByScan } from "@/lib/pdv-scan-product"
import { appendContaReceberTituloPdvAprazo } from "@/lib/pdv-append-conta-receber"
import { displaySaleNumber } from "@/lib/vendas/local-sale-identity"
import { appendAuditLog } from "@/lib/audit-log"
import {
  PaymentModal,
  type PaymentMethod,
  type PaymentMethodType,
} from "./payment-modal"
import { CupomNaoFiscal, type CupomData } from "./cupom-nao-fiscal"
import { PdvVisorTotal, PdvPainelLateralTerminal } from "./painel-total"
import { CaixaStatusBar } from "../caixa/caixa-status-bar"
import { enrichVendaEnterprise } from "@/app/actions/vendas-enterprise"

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
  name: string
  price: number
  qty: number
  detail?: LineDetail
}

// ── Constants ──────────────────────────────────────────────────────────────────

const DRAFT_STORAGE_KEY = (storeId: string) => `omnigestao:venda-completa:${storeId}`

// ── Types (extended) ───────────────────────────────────────────────────────────

type DraftData = {
  cliente: ClienteResult | null
  cart: CartLine[]
  discountReais: number
  discountPercent: number
  tipoVenda?: TipoVenda
  observacaoGeral?: string
  enderecoEntrega?: EnderecoEntrega
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const brl = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n)

function paymentLabel(type: PaymentMethodType): string {
  const labels: Record<PaymentMethodType, string> = {
    dinheiro: "Dinheiro",
    pix: "PIX",
    cartao_debito: "Débito",
    cartao_credito: "Crédito",
    carne: "Carnê",
    a_prazo: "A prazo",
    credito_vale: "Crédito/Vale",
  }
  return labels[type] ?? type
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function PdvVendaCompletaEnterprise({
  onBack,
}: {
  onBack: () => void
}) {
  const { inventory, finalizeSaleTransaction, getSaldoCreditoCliente } = useOperationsStore()
  const { empresaDocumentos, lojaAtivaId } = useLojaAtiva()
  const { pdvParams } = useStoreSettings()
  const { toast } = useToast()
  const cashierId = useMemo(() => getOrCreatePdvOperatorId(), [])
  const { data: session } = useSession()
  const storeId = useMemo(
    () => (lojaAtivaId ?? "").trim(),
    [lojaAtivaId]
  )
  const operadorNomeAbertura = usePdvOperadorNome(storeId)
  const operatorLabel = operatorDisplayName({ aberturaNome: operadorNomeAbertura, session })

  // ── Customer ──────────────────────────────────────────────────────────────
  const [clienteQuery, setClienteQuery] = useState("")
  const { clientes: clienteResultados, isLoading: clienteLoading } = useClienteSearch(clienteQuery, storeId)
  const [selectedCliente, setSelectedCliente] = useState<ClienteResult | null>(null)
  const [showClienteDropdown, setShowClienteDropdown] = useState(false)
  const clienteInputRef = useRef<HTMLInputElement>(null)
  const hasDraftRestored = useRef(false)

  // ── Products ──────────────────────────────────────────────────────────────
  const [productQuery, setProductQuery] = useState("")
  const productInputRef = useRef<HTMLInputElement>(null)

  // ── Cart ──────────────────────────────────────────────────────────────────
  const [cart, setCart] = useState<CartLine[]>([])
  const [expandedLineId, setExpandedLineId] = useState<string | null>(null)

  // ── Discount ──────────────────────────────────────────────────────────────
  const [discountReais, setDiscountReais] = useState(0)
  const [discountPercent, setDiscountPercent] = useState(0)

  // ── Payment / Cupom ───────────────────────────────────────────────────────
  const [isPaymentOpen, setIsPaymentOpen] = useState(false)
  const [cupomOpen, setCupomOpen] = useState(false)
  const [cupomData, setCupomData] = useState<CupomData | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [tipoVenda, setTipoVenda] = useState<TipoVenda>("comum")
  const [observacaoGeral, setObservacaoGeral] = useState("")
  const [enderecoEntrega, setEnderecoEntrega] = useState<EnderecoEntrega>(EMPTY_ENDERECO)
  const [showEnderecoForm, setShowEnderecoForm] = useState(false)

  // ── Catalog ───────────────────────────────────────────────────────────────
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
    return filterPdvCatalogBySearch(products, q).slice(0, 12)
  }, [products, productQuery])

  // ── Totals ────────────────────────────────────────────────────────────────
  const subtotal = cart.reduce((s, l) => s + l.price * l.qty, 0)
  const { impostoEstimado, total } = useMemo(
    () => computePdvCartTotals(subtotal, discountReais, pdvParams),
    [subtotal, discountReais, pdvParams.incluirImpostoEstimadoNoPdv, pdvParams.aliquotaImpostoEstimadoPdv],
  )
  const customerStoreCredit = useMemo(
    () => (selectedCliente?.document ? getSaldoCreditoCliente(selectedCliente.document) : 0),
    [selectedCliente, getSaldoCreditoCliente]
  )

  // ── Draft restore (once, after inventory loads) ───────────────────────────
  useEffect(() => {
    if (hasDraftRestored.current) return
    if (!Array.isArray(inventory) || inventory.length === 0) return
    hasDraftRestored.current = true
    try {
      const raw = localStorage.getItem(DRAFT_STORAGE_KEY(storeId))
      if (!raw) return
      const draft = JSON.parse(raw) as DraftData
      const validCart = (draft.cart ?? []).filter((line) =>
        inventory.some((i) => i.id === line.inventoryId)
      )
      if (validCart.length > 0) {
        setCart(validCart)
        if ((draft.discountReais ?? 0) > 0) setDiscountReais(draft.discountReais)
        if ((draft.discountPercent ?? 0) > 0) setDiscountPercent(draft.discountPercent)
        if (draft.cliente) setSelectedCliente(draft.cliente)
        if (draft.tipoVenda) setTipoVenda(draft.tipoVenda)
        if (draft.observacaoGeral) setObservacaoGeral(draft.observacaoGeral)
        if (draft.enderecoEntrega) setEnderecoEntrega(draft.enderecoEntrega)
        toast({
          title: "Rascunho restaurado",
          description: `${validCart.length} ite${validCart.length === 1 ? "m" : "ns"} recuperado${validCart.length === 1 ? "" : "s"} do rascunho anterior.`,
        })
      }
    } catch {
      /* ignore malformed draft */
    }
  }, [inventory, storeId, toast])

  // ── Draft save (whenever cart/cliente/desconto muda) ──────────────────────
  useEffect(() => {
    if (!hasDraftRestored.current) return
    const draft: DraftData = { cliente: selectedCliente, cart, discountReais, discountPercent, tipoVenda, observacaoGeral, enderecoEntrega }
    try {
      if (cart.length > 0 || selectedCliente) {
        localStorage.setItem(DRAFT_STORAGE_KEY(storeId), JSON.stringify(draft))
      } else {
        localStorage.removeItem(DRAFT_STORAGE_KEY(storeId))
      }
    } catch {
      /* ignore quota errors */
    }
  }, [selectedCliente, cart, discountReais, discountPercent, tipoVenda, observacaoGeral, enderecoEntrega, storeId])

  // ── Mount focus ───────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => clienteInputRef.current?.focus(), 80)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Fullscreen sync ───────────────────────────────────────────────────────
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener("fullscreenchange", onFsChange)
    return () => document.removeEventListener("fullscreenchange", onFsChange)
  }, [])

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      switch (e.key) {
        case "F1":
          e.preventDefault()
          if (
            selectedCliente !== null &&
            cart.length > 0 &&
            total > 0 &&
            !isPaymentOpen &&
            !cupomOpen &&
            !helpOpen
          ) {
            setIsPaymentOpen(true)
          }
          break
        case "F2":
          e.preventDefault()
          if (selectedCliente) {
            setSelectedCliente(null)
            setClienteQuery("")
            setTimeout(() => clienteInputRef.current?.focus(), 50)
          } else {
            clienteInputRef.current?.focus()
          }
          break
        case "F3":
          e.preventDefault()
          productInputRef.current?.focus()
          break
        case "F11":
          e.preventDefault()
          if (!document.fullscreenElement) {
            void document.documentElement.requestFullscreen().catch(() => {})
          } else {
            void document.exitFullscreen().catch(() => {})
          }
          break
        case "End":
          e.preventDefault()
          if (!isPaymentOpen && !cupomOpen) setHelpOpen((o) => !o)
          break
        case "Escape":
          if (helpOpen) {
            e.preventDefault()
            setHelpOpen(false)
          }
          break
      }
    },
    [selectedCliente, cart, total, isPaymentOpen, cupomOpen, helpOpen]
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
        toast({
          title: "Sem estoque",
          description: `${product.name} está sem estoque.`,
          variant: "destructive",
        })
        return
      }
      setCart((prev) => {
        const existing = prev.find((l) => l.inventoryId === product.id)
        if (existing) {
          return prev.map((l) =>
            l.inventoryId === product.id ? { ...l, qty: l.qty + 1 } : l
          )
        }
        const garantiaDias = pdvParams.garantiaPadraoDias ?? 0
        return [
          ...prev,
          {
            lineId: newPdvLineId(product.id),
            inventoryId: product.id,
            name: product.name,
            price: product.price,
            qty: 1,
            detail: garantiaDias > 0 ? { garantiaDias } : undefined,
          },
        ]
      })
      setProductQuery("")
    },
    [pdvParams.garantiaPadraoDias, toast]
  )

  function updateQty(lineId: string, delta: number) {
    if (delta > 0) {
      const line = cart.find((l) => l.lineId === lineId)
      if (line) {
        const invItem = inventory.find((i) => i.id === line.inventoryId)
        const isService = invItem?.category === "Servicos"
        if (!isService && invItem && line.qty >= invItem.stock) {
          toast({
            title: "Estoque máximo atingido",
            description: `${line.name}: apenas ${invItem.stock} unidade${invItem.stock === 1 ? "" : "s"} disponíve${invItem.stock === 1 ? "l" : "is"}.`,
            variant: "destructive",
          })
          return
        }
      }
    }
    setCart((prev) =>
      prev
        .map((l) => (l.lineId === lineId ? { ...l, qty: l.qty + delta } : l))
        .filter((l) => l.qty > 0)
    )
  }

  function removeFromCart(lineId: string) {
    setCart((prev) => prev.filter((l) => l.lineId !== lineId))
    if (expandedLineId === lineId) setExpandedLineId(null)
  }

  function updateLineDetail(lineId: string, patch: Partial<LineDetail>) {
    setCart((prev) =>
      prev.map((l) =>
        l.lineId === lineId ? { ...l, detail: { ...l.detail, ...patch } } : l
      )
    )
  }

  // ── Finalization ──────────────────────────────────────────────────────────
  async function handleConfirmPayment(
    payments: PaymentMethod[],
    meta?: {
      cashierId?: string
      discountAuthorizedByAdminId?: string
      discountReais?: number
      discountPercent?: number
    }
  ) {
    const saleLines = cart
      .filter((l) => inventory.some((i) => i.id === l.inventoryId))
      .map((l) => ({
        inventoryId: l.inventoryId,
        quantity: l.qty,
        unitPrice: l.price,
        name: l.name,
      }))

    if (saleLines.length === 0) {
      toast({
        title: "Carrinho vazio",
        description: "Adicione itens ao carrinho antes de finalizar.",
        variant: "destructive",
      })
      return
    }

    let dinheiro = 0,
      pix = 0,
      cartaoDebito = 0,
      cartaoCredito = 0,
      carne = 0,
      aPrazo = 0,
      creditoVale = 0
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

    const result = await finalizeSaleTransaction({
      lines: saleLines,
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
      auditMeta: {
        cashierId: meta?.cashierId ?? cashierId,
        discountAuthorizedByAdminId: meta?.discountAuthorizedByAdminId,
        discountReais: meta?.discountReais ?? discountReais,
        discountPercent: meta?.discountPercent ?? discountPercent,
      },
      customerCpf: selectedCliente?.document ?? undefined,
      customerName: selectedCliente?.name,
      clienteId: selectedCliente?.id || undefined,
      aPrazoConfig,
    })

    if (!result.ok) {
      toast({ title: "Falha transacional", description: result.reason, variant: "destructive" })
      return
    }

    // aPrazo → Contas a Receber (localStorage cache)
    if (aPrazo > 0.02 && selectedCliente && !result.pending) {
      appendContaReceberTituloPdvAprazo({
        lojaId: storeId,
        saleId: result.saleId,
        clienteNome: selectedCliente.name,
        valor: aPrazo,
        aPrazoConfig,
      })
    }

    // Audit
    appendAuditLog({
      action: "sale_finalized",
      userLabel: (empresaDocumentos.nomeFantasia || "Loja").trim(),
      detail: `Venda Enterprise ${displaySaleNumber(result.saleId, result.pending)} | Cliente: ${selectedCliente?.name ?? "—"} | Total ${brl(total)}`,
    })

    // Enriquece payload JSONB com dados enterprise (não bloqueia)
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

    if (!result.pending) {
      void enrichVendaEnterprise({
        pedidoId: result.saleId,
      storeId,
      clienteId: selectedCliente?.id,
      clienteNome: selectedCliente?.name,
      clienteDocument: selectedCliente?.document ?? undefined,
      clienteTelefone: selectedCliente?.phone ?? undefined,
      clienteEmail: selectedCliente?.email ?? undefined,
      observacoesVenda: observacaoGeral || undefined,
      tipoVenda,
      enderecoEntrega: Object.values(enderecoEntrega).some((v) => v.trim() !== "")
        ? enderecoEntrega
        : undefined,
      linhasDetalhe,
    }).catch(() => {})
    }

    // Cupom
    const storeDisplayName =
      (
        empresaDocumentos.nomeFantasia ||
        configPadrao.empresa.nomeFantasia ||
        "Loja"
      ).trim() || "Loja"

    const tipoVendaLabel = TIPOS_VENDA.find((t) => t.value === tipoVenda)?.label
    const cupom: CupomData = {
      numeroPedido: displaySaleNumber(result.saleId, result.pending),
      at: new Date().toISOString(),
      lojaNome: storeDisplayName,
      clienteNome: selectedCliente?.name ?? null,
      clienteCpf: selectedCliente?.document ?? null,
      operador: operatorLabel,
      tipoVenda: tipoVenda !== "comum" ? tipoVendaLabel : undefined,
      observacaoGeral: observacaoGeral || undefined,
      itens: cart.map((l) => ({
        nome: l.name,
        quantidade: l.qty,
        precoUnitario: l.price,
        lineTotal: Math.round(l.price * l.qty * 100) / 100,
      })),
      pagamentos: payments.map((p) => ({
        label: paymentLabel(p.type),
        valor: p.value,
      })),
      total,
      desconto: discountReais > 0 ? discountReais : undefined,
    }

    setCupomData(cupom)
    setIsPaymentOpen(false)
    setCupomOpen(true)

    // Clear draft
    try { localStorage.removeItem(DRAFT_STORAGE_KEY(storeId)) } catch {}

    // Reset
    setCart([])
    setDiscountReais(0)
    setDiscountPercent(0)
    setSelectedCliente(null)
    setClienteQuery("")
    setExpandedLineId(null)
    setTipoVenda("comum")
    setObservacaoGeral("")
    setEnderecoEntrega(EMPTY_ENDERECO)
    setShowEnderecoForm(false)
  }

  // Adapter para PaymentModal (espera { id, name, cpf, phone })
  const paymentModalCustomer = selectedCliente
    ? {
        id: selectedCliente.id,
        name: selectedCliente.name,
        cpf: selectedCliente.document ?? "",
        phone: selectedCliente.phone ?? "",
      }
    : null

  const canFinalize = selectedCliente !== null && cart.length > 0 && total > 0

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
      {/* Caixa status */}
      <CaixaStatusBar variant="pdv" />

      {/* Header */}
      <div className="shrink-0 border-b border-border bg-background">
        <div className="flex items-center gap-2 px-3 py-2.5">
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

          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => {
              if (!document.fullscreenElement) {
                void document.documentElement.requestFullscreen().catch(() => {})
              } else {
                void document.exitFullscreen().catch(() => {})
              }
            }}
            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
            title={isFullscreen ? "Sair da tela cheia [F11]" : "Tela cheia [F11]"}
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>

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

      {/* Body: left scroll + right sidebar */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* ── Left column (scrollable) ───────────────────────────────── */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {/* ── CLIENTE ───────────────────────────────────────────────── */}
          <div className="shrink-0 border-b border-border bg-background px-3 py-3">
            <div className="mb-1.5 flex items-center gap-1.5">
              <User className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Cliente <span className="text-destructive">*</span>
              </span>
            </div>

            {selectedCliente ? (
              <>
                <div className="flex items-center justify-between rounded-xl border border-primary/30 bg-primary/5 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {selectedCliente.name}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[
                        selectedCliente.document?.trim() || null,
                        selectedCliente.phone?.trim() || null,
                      ]
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

                {/* Address collapsible */}
                <div className="mt-2">
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
                    {showEnderecoForm ? (
                      <ChevronUp className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                  </button>

                  {showEnderecoForm && (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground">CEP</Label>
                        <Input
                          placeholder="00000-000"
                          value={enderecoEntrega.cep}
                          onChange={(e) =>
                            setEnderecoEntrega((prev) => ({ ...prev, cep: e.target.value }))
                          }
                          className="h-8 border-border bg-background text-xs"
                          maxLength={9}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground">Número</Label>
                        <Input
                          placeholder="Nº"
                          value={enderecoEntrega.numero}
                          onChange={(e) =>
                            setEnderecoEntrega((prev) => ({ ...prev, numero: e.target.value }))
                          }
                          className="h-8 border-border bg-background text-xs"
                        />
                      </div>
                      <div className="col-span-2 space-y-1">
                        <Label className="text-[11px] text-muted-foreground">Logradouro</Label>
                        <Input
                          placeholder="Rua, Av., etc."
                          value={enderecoEntrega.logradouro}
                          onChange={(e) =>
                            setEnderecoEntrega((prev) => ({ ...prev, logradouro: e.target.value }))
                          }
                          className="h-8 border-border bg-background text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground">Bairro</Label>
                        <Input
                          placeholder="Bairro"
                          value={enderecoEntrega.bairro}
                          onChange={(e) =>
                            setEnderecoEntrega((prev) => ({ ...prev, bairro: e.target.value }))
                          }
                          className="h-8 border-border bg-background text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground">Cidade</Label>
                        <Input
                          placeholder="Cidade"
                          value={enderecoEntrega.cidade}
                          onChange={(e) =>
                            setEnderecoEntrega((prev) => ({ ...prev, cidade: e.target.value }))
                          }
                          className="h-8 border-border bg-background text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground">UF</Label>
                        <Input
                          placeholder="SP"
                          value={enderecoEntrega.uf}
                          onChange={(e) =>
                            setEnderecoEntrega((prev) => ({
                              ...prev,
                              uf: e.target.value.toUpperCase().slice(0, 2),
                            }))
                          }
                          className="h-8 border-border bg-background text-xs"
                          maxLength={2}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </>
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
                    onChange={(e) => {
                      setClienteQuery(e.target.value)
                      setShowClienteDropdown(true)
                    }}
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
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Buscando…
                      </div>
                    ) : (
                      clienteResultados.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className="flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left last:border-0 hover:bg-secondary"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setSelectedCliente(c)
                            setClienteQuery("")
                            setShowClienteDropdown(false)
                            setTimeout(() => productInputRef.current?.focus(), 80)
                          }}
                        >
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                            <User className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-foreground">
                              {c.name}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {c.phone?.trim() ?? ""}
                            </p>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── PRODUTOS ──────────────────────────────────────────────── */}
          <div className="shrink-0 border-b border-border bg-background px-3 py-3">
            <div className="mb-1.5 flex items-center gap-1.5">
              <Smartphone className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Produtos
              </span>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={productInputRef}
                placeholder="Nome, SKU ou código de barras… [F3]"
                value={productQuery}
                onChange={(e) => setProductQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    const exact = findPdvProductByScan(productQuery.trim(), products)
                    if (exact) {
                      addToCart(exact)
                    } else if (filteredProducts.length === 1) {
                      addToCart(filteredProducts[0]!)
                    }
                  }
                }}
                className="h-10 border-border bg-secondary pl-9 text-sm"
              />
            </div>

            {filteredProducts.length > 0 && (
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
                {filteredProducts.map((p) => {
                  const isService = p.category === "Servicos"
                  const outOfStock = !isService && p.stock <= 0
                  const lowStock = !isService && !outOfStock && p.stock > 0 && p.stock <= 5
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={outOfStock}
                      onClick={() => addToCart(p)}
                      className={cn(
                        "flex flex-col items-start gap-1 rounded-xl border bg-card px-3 py-2.5 text-left transition-all active:scale-[0.98]",
                        outOfStock
                          ? "cursor-not-allowed border-border opacity-50"
                          : lowStock
                            ? "border-amber-500/30 hover:border-amber-500/60 hover:bg-amber-500/5"
                            : "border-border hover:border-primary/40 hover:bg-accent"
                      )}
                    >
                      <p className="line-clamp-2 text-xs font-semibold leading-snug text-foreground">
                        {p.name}
                      </p>
                      <div className="flex w-full items-center justify-between gap-1">
                        <span
                          className={cn(
                            "text-[10px]",
                            outOfStock
                              ? "text-destructive/70"
                              : lowStock
                                ? "font-medium text-amber-500"
                                : "text-muted-foreground"
                          )}
                        >
                          {isService
                            ? "Serviço"
                            : outOfStock
                              ? "Sem estoque"
                              : lowStock
                                ? `Baixo: ${p.stock} un`
                                : `${p.stock} un`}
                        </span>
                        <span className="text-xs font-bold tabular-nums text-primary">
                          {brl(p.price)}
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}

            {products.length === 0 && !productQuery && (
              <div className="mt-2 flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-6 text-center">
                <PackageSearch className="mb-1.5 h-6 w-6 text-muted-foreground/40" />
                <p className="text-xs font-medium text-muted-foreground">
                  Nenhum produto cadastrado
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground/60">
                  Cadastre itens no módulo Estoque
                </p>
              </div>
            )}

            {filteredProducts.length === 0 && productQuery.trim() && products.length > 0 && (
              <div className="mt-2 flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-4 text-center">
                <Search className="mb-1 h-5 w-5 text-muted-foreground/40" />
                <p className="text-xs text-muted-foreground">
                  Nenhum resultado para &ldquo;{productQuery}&rdquo;
                </p>
              </div>
            )}
          </div>

          {/* ── CARRINHO ──────────────────────────────────────────────── */}
          <div className="flex-1 px-3 py-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Carrinho
              </span>
              {cart.length > 0 && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground transition-colors hover:text-destructive"
                  onClick={() => {
                    setCart([])
                    setExpandedLineId(null)
                  }}
                >
                  Limpar tudo
                </button>
              )}
            </div>

            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-12 text-center">
                <Receipt className="mb-2 h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm font-medium text-muted-foreground">
                  Nenhum item no carrinho
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground/60">
                  Busque um produto acima para adicionar
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {cart.map((line) => {
                  const isExpanded = expandedLineId === line.lineId
                  const hasDetail =
                    line.detail &&
                    (line.detail.imei ||
                      line.detail.serial ||
                      line.detail.garantiaDias ||
                      line.detail.observacao)

                  return (
                    <div
                      key={line.lineId}
                      className="overflow-hidden rounded-xl border border-border bg-card"
                    >
                      {/* Line header */}
                      <div className="flex items-center gap-2 px-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-foreground">
                            {line.name}
                          </p>
                          <p className="text-xs tabular-nums text-muted-foreground">
                            {brl(line.price)} × {line.qty} ={" "}
                            <span className="font-semibold text-foreground">
                              {brl(line.price * line.qty)}
                            </span>
                          </p>
                        </div>

                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => updateQty(line.lineId, -1)}
                            className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-background text-foreground transition-colors hover:bg-secondary"
                          >
                            <Minus className="h-3 w-3" />
                          </button>
                          <span className="w-6 text-center text-sm font-bold tabular-nums text-foreground">
                            {line.qty}
                          </span>
                          <button
                            type="button"
                            onClick={() => updateQty(line.lineId, 1)}
                            className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-background text-foreground transition-colors hover:bg-secondary"
                          >
                            <Plus className="h-3 w-3" />
                          </button>

                          {/* Detalhar */}
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedLineId(isExpanded ? null : line.lineId)
                            }
                            className={cn(
                              "flex h-7 w-7 items-center justify-center rounded-lg border transition-colors",
                              isExpanded
                                ? "border-primary bg-primary/10 text-primary"
                                : hasDetail
                                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
                                  : "border-border bg-background text-muted-foreground hover:bg-secondary"
                            )}
                            title="Detalhar item (IMEI, serial, garantia)"
                          >
                            {isExpanded ? (
                              <ChevronUp className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronDown className="h-3.5 w-3.5" />
                            )}
                          </button>

                          {/* Remover */}
                          <button
                            type="button"
                            onClick={() => removeFromCart(line.lineId)}
                            className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Expandable detail panel */}
                      {isExpanded && (
                        <div className="space-y-3 border-t border-border bg-muted/30 px-3 py-3">
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Dados do produto
                          </p>

                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <Label className="text-[11px] text-muted-foreground">
                                IMEI
                              </Label>
                              <Input
                                placeholder="000000000000000"
                                value={line.detail?.imei ?? ""}
                                onChange={(e) =>
                                  updateLineDetail(line.lineId, { imei: e.target.value })
                                }
                                className="h-8 border-border bg-background text-xs"
                                maxLength={15}
                              />
                            </div>

                            <div className="space-y-1">
                              <Label className="text-[11px] text-muted-foreground">
                                Nº de Série
                              </Label>
                              <Input
                                placeholder="SN-…"
                                value={line.detail?.serial ?? ""}
                                onChange={(e) =>
                                  updateLineDetail(line.lineId, { serial: e.target.value })
                                }
                                className="h-8 border-border bg-background text-xs"
                              />
                            </div>

                            <div className="space-y-1">
                              <Label className="text-[11px] text-muted-foreground">
                                Garantia (dias)
                              </Label>
                              <Input
                                type="number"
                                min={0}
                                max={3650}
                                placeholder="90"
                                value={
                                  line.detail?.garantiaDias !== undefined
                                    ? String(line.detail.garantiaDias)
                                    : ""
                                }
                                onChange={(e) =>
                                  updateLineDetail(line.lineId, {
                                    garantiaDias: e.target.value
                                      ? Math.max(0, parseInt(e.target.value, 10))
                                      : undefined,
                                  })
                                }
                                className="h-8 border-border bg-background text-xs"
                              />
                            </div>

                            <div className="space-y-1">
                              <Label className="text-[11px] text-muted-foreground">
                                Observação
                              </Label>
                              <Input
                                placeholder="Observação do item…"
                                value={line.detail?.observacao ?? ""}
                                onChange={(e) =>
                                  updateLineDetail(line.lineId, { observacao: e.target.value })
                                }
                                className="h-8 border-border bg-background text-xs"
                              />
                            </div>
                          </div>

                          {hasDetail && (
                            <div className="flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-2 py-1.5">
                              <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                              <p className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                                Dados registrados — serão salvos no cupom e no sistema
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* ── DADOS DA VENDA ──────────────────────────────────────── */}
          <div className="shrink-0 border-t border-border bg-background px-3 py-3">
            <div className="mb-2 flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Dados da Venda
              </span>
            </div>

            <div className="mb-3 space-y-1.5">
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
                        : "border-border bg-card text-muted-foreground hover:bg-secondary"
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-2 space-y-1">
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

        {/* ── Right sidebar ─────────────────────────────────────────── */}
        <PdvPainelLateralTerminal className="w-64 shrink-0 xl:w-72">
          {/* ── Fixed top: totals ─────────────────────────────────── */}
          <div className="shrink-0 space-y-2 p-3 pb-1">
            <PdvVisorTotal
              label="TOTAL"
              valorFormatado={brl(total)}
              glow="soft"
            />

            {(subtotal !== total || impostoEstimado > 0 || discountReais > 0) && subtotal > 0 && (
              <div className="rounded-xl border border-border bg-card px-3 py-2 text-xs">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal</span>
                  <span className="tabular-nums">{brl(subtotal)}</span>
                </div>
                {impostoEstimado > 0 ? (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Imposto estimado</span>
                    <span className="tabular-nums">{brl(impostoEstimado)}</span>
                  </div>
                ) : null}
                {discountReais > 0 ? (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Desconto</span>
                    <span className="tabular-nums text-amber-500">-{brl(discountReais)}</span>
                  </div>
                ) : null}
              </div>
            )}

            {cart.length > 0 && (
              <div className="flex items-center justify-between rounded-lg border border-border bg-card px-2.5 py-1.5">
                <span className="text-[11px] text-muted-foreground">
                  {cart.length} ite{cart.length === 1 ? "m" : "ns"}
                </span>
                <Badge variant="secondary" className="tabular-nums text-[10px]">
                  {cart.reduce((s, l) => s + l.qty, 0)} un
                </Badge>
              </div>
            )}
          </div>

          {/* ── Scrollable middle: cart items ─────────────────────── */}
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <Receipt className="mb-2 h-7 w-7 text-muted-foreground/30" />
                <p className="text-xs font-medium text-muted-foreground">Carrinho vazio</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground/50">
                  Use [F3] para buscar produtos
                </p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-border bg-card">
                <div className="divide-y divide-border">
                  {cart.map((l) => (
                    <div
                      key={l.lineId}
                      className="flex items-start justify-between gap-2 px-2.5 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-[11px] font-medium text-foreground">
                          {l.name}
                        </p>
                        {(l.detail?.imei || l.detail?.garantiaDias) && (
                          <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                            {[
                              l.detail.imei ? `IMEI: ${l.detail.imei}` : null,
                              l.detail.garantiaDias
                                ? `${l.detail.garantiaDias}d`
                                : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-[11px] tabular-nums text-muted-foreground">
                          {l.qty}× {brl(l.price)}
                        </p>
                        <p className="text-[11px] font-semibold tabular-nums text-foreground">
                          {brl(l.price * l.qty)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Fixed bottom: warnings + finalize ─────────────────── */}
          <div className="shrink-0 space-y-2 border-t border-border p-3 pt-2">
            {!selectedCliente && (
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-2.5 py-2">
                <p className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
                  [F2] Selecione o cliente para continuar
                </p>
              </div>
            )}

            <Button
              type="button"
              className="h-12 w-full shrink-0 rounded-xl bg-emerald-600 text-base font-bold text-zinc-950 shadow-lg hover:bg-emerald-500 disabled:opacity-50"
              disabled={!canFinalize}
              onClick={() => setIsPaymentOpen(true)}
            >
              <span>Finalizar Venda</span>
              <kbd className="ml-2 rounded border border-zinc-950/20 bg-zinc-950/10 px-1.5 py-0.5 font-mono text-[10px] font-medium">
                F1
              </kbd>
            </Button>
          </div>
        </PdvPainelLateralTerminal>
      </div>

      {/* Help overlay — premium grid */}
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="max-w-md rounded-2xl border-border bg-card p-0">
          <DialogHeader className="border-b border-border px-5 py-3">
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
              <HelpCircle className="h-4 w-4 text-primary" />
              Atalhos — Venda Completa Enterprise
            </DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-2 divide-x divide-border">
            {/* Coluna 1: Venda */}
            <div className="p-4">
              <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-primary">
                Venda
              </p>
              <div className="space-y-2.5">
                {(
                  [
                    { key: "F1",    label: "Finalizar venda" },
                    { key: "F2",    label: "Buscar / limpar cliente" },
                    { key: "F3",    label: "Foco no produto" },
                    { key: "↵",     label: "Bipe / único resultado" },
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

            {/* Coluna 2: Navegação + Caixa */}
            <div className="p-4">
              <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Navegação
              </p>
              <div className="space-y-2.5">
                {(
                  [
                    { key: "F11", label: "Tela cheia / Sair" },
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

              <p className="mb-3 mt-5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Pagamento
              </p>
              <div className="space-y-2.5">
                {(
                  [
                    { key: "F1", label: "Abrir modal de pagamento" },
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
          </div>

          <div className="border-t border-border px-5 py-2.5">
            <p className="text-[11px] text-muted-foreground">
              Operador:{" "}
              <span className="font-medium text-foreground">{operatorLabel}</span>
              {" · "}
              Pressione{" "}
              <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px]">END</kbd>{" "}
              ou{" "}
              <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px]">ESC</kbd>{" "}
              para fechar.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* PaymentModal */}
      <PaymentModal
        isOpen={isPaymentOpen}
        onClose={() => setIsPaymentOpen(false)}
        cartSubtotal={subtotal}
        impostoEstimado={impostoEstimado}
        total={total}
        discountReais={discountReais}
        discountPercent={discountPercent}
        onDiscountReaisChange={setDiscountReais}
        onDiscountPercentChange={setDiscountPercent}
        selectedCustomer={paymentModalCustomer}
        customerStoreCredit={customerStoreCredit}
        cashierId={cashierId}
        onConfirm={handleConfirmPayment}
      />

      {/* Cupom não fiscal */}
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

/** Alias semântico para uso fora do contexto de PDV. */
export { PdvVendaCompletaEnterprise as VendaCompletaEnterprise }
