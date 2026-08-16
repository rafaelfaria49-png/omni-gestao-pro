"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { useLojaAtiva } from "@/lib/loja-ativa"
import { operatorDisplayName } from "@/lib/pdv-operator-label"
import { usePdvOperadorNome } from "@/lib/pdv-operador-nome"
import { useConfigEmpresa } from "@/lib/config-empresa"
import { useOperationsStore } from "@/lib/operations-store"
import { useCaixa } from "@/components/dashboard/caixa/caixa-provider"
import { AberturaCaixaModal } from "@/components/dashboard/caixa/abertura-caixa-modal"
import { FechamentoCaixaModal } from "@/components/dashboard/caixa/fechamento-caixa-modal"
import { CaixaStatusBar } from "@/components/dashboard/caixa/caixa-status-bar"
import { SupervisorGateDialog } from "@/components/dashboard/caixa/supervisor-gate-dialog"
import {
  mergePdvCatalogWithInventory,
  newPdvLineId,
  type PdvCatalogProduct,
} from "@/lib/pdv-catalog"
import { findPdvProductByScan } from "@/lib/pdv-scan-product"
import { lookupPdvScanRemote } from "@/lib/pdv-scan-lookup"
import { filterPdvCatalogBySearch } from "@/lib/pdv-product-search"
import { useClienteSearch } from "@/lib/hooks/use-cliente-search"
import { PaymentModal, type PaymentMethod } from "@/components/dashboard/vendas/payment-modal"
import { PdvClientePicker, type PdvClienteResult } from "@/components/dashboard/vendas/pdv-cliente-picker"
import { useToast } from "@/hooks/use-toast"
import { reducePaymentsToBreakdown } from "@/lib/pdv-payments"
import { PdvBlackShell, type PdvBlackCartRow } from "./PdvBlackShell"

const brlBlack = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v)

const TURNO_STORAGE_KEY = "@omnigestao:pdv-black-turno"
const CUPOM_STORAGE_KEY = "@omnigestao:pdv-black-cupom"

function readTurno(): number {
  try { return parseInt(localStorage.getItem(TURNO_STORAGE_KEY) ?? "1", 10) || 1 } catch { return 1 }
}
function writeTurno(n: number) {
  try { localStorage.setItem(TURNO_STORAGE_KEY, String(n)) } catch { /* ignore */ }
}
function readCupom(): number {
  try { return parseInt(localStorage.getItem(CUPOM_STORAGE_KEY) ?? "1000", 10) || 1000 } catch { return 1000 }
}
function writeCupom(n: number) {
  try { localStorage.setItem(CUPOM_STORAGE_KEY, String(n)) } catch { /* ignore */ }
}

export function PdvBlackEdition() {
  const router = useRouter()
  const { lojaAtivaId, lojaAtivaRaw } = useLojaAtiva()
  const { config } = useConfigEmpresa()
  const { inventory, setInventory, finalizeSaleTransaction } = useOperationsStore()
  const { caixa, abrirCaixa, fecharCaixa } = useCaixa()
  const { toast } = useToast()

  // ── Caixa ──────────────────────────────────────────────────────────────────
  const [turno, setTurno] = useState<number>(1)
  const [cupomNum, setCupomNum] = useState<number>(1000)
  const [showAbertura, setShowAbertura] = useState(false)
  const [showFechamento, setShowFechamento] = useState(false)
  // Fechar caixa pelo shell preto é ação sensível: exige PIN de supervisor
  // (mesmo gate compartilhado da CaixaStatusBar). Abrir caixa segue livre.
  const [fecharGateOpen, setFecharGateOpen] = useState(false)

  useEffect(() => {
    setTurno(readTurno())
    setCupomNum(readCupom())
  }, [])

  const handleAbrirCaixa = useCallback(() => {
    setShowAbertura(true)
  }, [])

  const handleFecharCaixa = useCallback(() => {
    setFecharGateOpen(true)
  }, [])

  // Incrementa turno quando o caixa é aberto
  const prevCaixaOpen = useRef(caixa.isOpen)
  useEffect(() => {
    if (!prevCaixaOpen.current && caixa.isOpen) {
      const next = turno + 1
      setTurno(next)
      writeTurno(next)
    }
    prevCaixaOpen.current = caixa.isOpen
  }, [caixa.isOpen, turno])

  // ── Nome da loja e operador ────────────────────────────────────────────────
  const storeName = useMemo(() => {
    const nome = (lojaAtivaRaw?.nomeFantasia || "").trim()
    if (nome) return nome
    return config?.empresa.nomeFantasia || config?.empresa.razaoSocial || "OmniGestão PDV"
  }, [lojaAtivaRaw, config])

  // Operador para exibição e auditoria (cashierId): fonte única — abertura do
  // caixa → sessão autenticada → e-mail → "Operador não identificado". Nunca id.
  const { data: session } = useSession()
  const operadorNomeAbertura = usePdvOperadorNome((lojaAtivaId ?? "").trim())
  const operadorNome = operatorDisplayName({ aberturaNome: operadorNomeAbertura, session })

  // ── Carrinho ───────────────────────────────────────────────────────────────
  const [cartRows, setCartRows] = useState<PdvBlackCartRow[]>([])
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null)
  const [highlightLineId, setHighlightLineId] = useState<string | null>(null)
  const [lastAddedItem, setLastAddedItem] = useState<string | null>(null)

  // ── Barcode ────────────────────────────────────────────────────────────────
  const [bipeCode, setBipeCode] = useState("")
  const bipeRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => { bipeRef.current?.focus() }, [])

  // ── Cliente ────────────────────────────────────────────────────────────────
  const [customerDisplay, setCustomerDisplay] = useState("Consumidor final")
  const [selectedClienteId, setSelectedClienteId] = useState<string | null>(null)
  /** Cliente completo (com CPF) — necessário para venda à prazo (motor exige documento). */
  const [selectedCustomer, setSelectedCustomer] = useState<{ id: string; name: string; cpf: string; phone: string } | null>(null)
  const [aPrazoClientePickerOpen, setAPrazoClientePickerOpen] = useState(false)
  const [clientSearchOpen, setClientSearchOpen] = useState(false)
  const { clientes: clientResults } = useClienteSearch(
    clientSearchOpen ? customerDisplay.replace("Consumidor final", "") : "",
    lojaAtivaId
  )
  const clientOptions = useMemo(
    () =>
      clientResults.map((c) => ({
        id: c.id,
        label: [c.name, c.phone].filter(Boolean).join(" — "),
      })),
    [clientResults]
  )

  // ── Documento fiscal ───────────────────────────────────────────────────────
  const [emitirNota, setEmitirNota] = useState(true)

  // ── Valor recebido ────────────────────────────────────────────────────────
  const [valorRecebido, setValorRecebido] = useState("")

  // ── Catálogo ───────────────────────────────────────────────────────────────
  const products = useMemo(
    // Server = fonte da verdade: somente estoque real da loja, sem catálogo mock.
    () => mergePdvCatalogWithInventory([], inventory),
    [inventory]
  )

  // ── Total ──────────────────────────────────────────────────────────────────
  const total = useMemo(
    () => cartRows.reduce((acc, r) => acc + r.qty * r.unitPrice, 0),
    [cartRows]
  )
  const itemCount = cartRows.length

  // ── Diálogos ──────────────────────────────────────────────────────────────
  const [productSearchOpen, setProductSearchOpen] = useState(false)
  const [productSearchInitial, setProductSearchInitial] = useState("")
  const [qtyEditOpen, setQtyEditOpen] = useState(false)
  const [cancelSaleOpen, setCancelSaleOpen] = useState(false)
  const [paymentOpen, setPaymentOpen] = useState(false)

  const selectedLineQty = useMemo(
    () => cartRows.find((r) => r.lineId === selectedLineId)?.qty ?? 1,
    [cartRows, selectedLineId]
  )

  const focusBipe = useCallback(() => {
    queueMicrotask(() => bipeRef.current?.focus())
  }, [])

  // ── Adicionar produto ──────────────────────────────────────────────────────
  const addProduct = useCallback(
    (product: PdvCatalogProduct, qty?: number) => {
      const effectiveQty = qty ?? 1
      const code = String(product.barcode || product.codigo || product.sku || product.id)
      const unit = product.vendaPorPeso ? "KG" : "UN"
      const price = product.vendaPorPeso
        ? (product.precoPorKg ?? product.price)
        : product.price

      const newRow: PdvBlackCartRow = {
        lineId: newPdvLineId(product.id),
        inventoryId: product.id,
        code,
        description: product.name,
        unit,
        unitPrice: price,
        qty: effectiveQty,
      }

      setCartRows((prev) => [...prev, newRow])
      setHighlightLineId(newRow.lineId)
      setSelectedLineId(newRow.lineId)
      setLastAddedItem(product.name)
      setTimeout(() => setHighlightLineId(null), 1200)
      setBipeCode("")
      bipeRef.current?.focus()
    },
    []
  )

  // ── Bipe: Enter ────────────────────────────────────────────────────────────
  const handleBipeKeyDown = useCallback(
    async (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== "Enter") return
      e.preventDefault()
      const raw = bipeCode.trim()
      if (!raw) return

      // Suporte ao prefixo "3x" ou "3*" para múltiplas unidades
      const prefixMatch = raw.match(/^(\d+)[x*×](.+)/i)
      let qty = 1
      let query = raw
      if (prefixMatch) {
        qty = Math.max(1, parseInt(prefixMatch[1], 10))
        query = prefixMatch[2].trim()
      }

      const found = findPdvProductByScan(query, products)
      if (found) {
        addProduct(found, qty)
        return
      }

      // Fallback fuzzy: nome/categoria/SKU/EAN. Se houver match único, adiciona;
      // se múltiplos, abre busca avançada pré-filtrada para o operador escolher.
      const matches = filterPdvCatalogBySearch(products, query)
      if (matches.length === 1) {
        addProduct(matches[0]!, qty)
        return
      }
      if (matches.length > 1) {
        setProductSearchInitial(query)
        setProductSearchOpen(true)
        setBipeCode("")
        return
      }

      // Miss local → busca autoritativa no catálogo INTEIRO da loja (snapshot pode estar defasado).
      const remote = await lookupPdvScanRemote({ code: query, storeId: (lojaAtivaId ?? "").trim(), setInventory })
      if (remote.kind === "single") {
        addProduct(remote.product, qty)
        setBipeCode("")
        return
      }
      if (remote.kind === "multiple") {
        setProductSearchInitial(query)
        setProductSearchOpen(true)
        setBipeCode("")
        return
      }
      toast({ title: "Produto não encontrado", description: `Produto não encontrado nesta loja para o código: ${query}` })
      bipeRef.current?.select()
    },
    [bipeCode, products, addProduct, lojaAtivaId, setInventory, toast]
  )

  // ── Remover linha (X / Delete) ─────────────────────────────────────────────
  const removeLine = useCallback((lineId: string) => {
    setCartRows((prev) => {
      const idx = prev.findIndex((r) => r.lineId === lineId)
      const next = prev.filter((r) => r.lineId !== lineId)
      setSelectedLineId((cur) => (cur === lineId ? next[Math.max(0, idx - 1)]?.lineId ?? null : cur))
      if (next.length === 0) setLastAddedItem(null)
      return next
    })
  }, [])

  const removeSelectedLine = useCallback(() => {
    if (!selectedLineId) return
    removeLine(selectedLineId)
  }, [selectedLineId, removeLine])

  // ── Atalhos de teclado (F2–F12) ───────────────────────────────────────────
  const handleShortcutAction = useCallback(
    (key: string) => {
      switch (key) {
        case "F2":
          focusBipe()
          break
        case "F3":
          setProductSearchOpen(true)
          break
        case "F4":
          if (selectedLineId) setQtyEditOpen(true)
          break
        case "F5":
          setClientSearchOpen(true)
          break
        case "F6":
          // Troca/Devolução — placeholder
          break
        case "F7":
          setEmitirNota((v) => !v)
          break
        case "F8":
          // Desconto/Acréscimo — placeholder
          break
        case "F9":
          // CPF/CNPJ — abre busca de cliente
          setClientSearchOpen(true)
          break
        case "F10":
          if (cartRows.length > 0) setCancelSaleOpen(true)
          break
        case "F11":
          // Suspender — placeholder
          break
        case "F12":
          if (cartRows.length > 0) setPaymentOpen(true)
          break
      }
    },
    [cartRows, selectedLineId, focusBipe]
  )

  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      const isTyping = tag === "INPUT" || tag === "TEXTAREA"

      // F2–F12 sempre interceptados
      const fKeys = new Set(["F2","F3","F4","F5","F6","F7","F8","F9","F10","F11","F12"])
      if (fKeys.has(e.key)) {
        e.preventDefault()
        handleShortcutAction(e.key)
        return
      }
      if (isTyping) return

      // Delete/Backspace fora de input: remove item selecionado
      if ((e.key === "Delete" || e.key === "Backspace") && selectedLineId) {
        e.preventDefault()
        removeSelectedLine()
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [handleShortcutAction, selectedLineId, removeSelectedLine])

  // ── Confirmar pagamento ────────────────────────────────────────────────────
  const handlePaymentConfirm = useCallback(async (payments: PaymentMethod[]) => {
    // Persistência REAL alinhada ao core (Black continua GATED por env).
    // Elimina o "ghost sale": grava Venda + estoque + financeiro via
    // finalizeSaleTransaction (mesmo motor dos demais PDVs, idempotente + retry).
    if (!caixa.isOpen) {
      toast({ variant: "destructive", title: "Caixa fechado", description: "Abra o caixa antes de finalizar a venda." })
      return
    }
    // Guard anti-descarte-silencioso: detecta linhas cujo produto não resolve no
    // inventory real desta loja. Antes elas eram filtradas EM SILÊNCIO — o cliente
    // seria cobrado pelo `total` cheio (calculado sobre TODO o carrinho), mas o item
    // sumiria da venda persistida e do estoque. Agora bloqueamos com aviso claro,
    // sem perder a venda nem o item (carrinho intacto para o operador corrigir).
    const isLinhaResolvivel = (r: PdvBlackCartRow) =>
      !!r.inventoryId && inventory.some((i) => i.id === r.inventoryId)
    const linhasNaoResolvidas = cartRows.filter((r) => !isLinhaResolvivel(r))
    if (linhasNaoResolvidas.length > 0) {
      const nomes = linhasNaoResolvidas.map((r) => r.description).join(", ")
      toast({
        variant: "destructive",
        title: "Item não pode ser vendido",
        description: `Sem cadastro no estoque desta loja: ${nomes}. Remova o item da lista e tente novamente.`,
      })
      return
    }
    // Todas as linhas resolvem (garantido pelo guard acima) — nada é descartado.
    const saleLines = cartRows.map((r) => ({
      inventoryId: r.inventoryId as string,
      quantity: r.qty,
      unitPrice: r.unitPrice,
      name: r.description,
    }))
    const aPrazoPayment = payments.find((p) => p.type === "a_prazo")
    const result = await finalizeSaleTransaction({
      lines: saleLines,
      total,
      paymentBreakdown: reducePaymentsToBreakdown(payments),
      customerCpf: selectedCustomer?.cpf,
      customerName: selectedCustomer?.name ?? (customerDisplay !== "Consumidor final" ? customerDisplay : undefined),
      clienteId: selectedCustomer?.id ?? selectedClienteId ?? undefined,
      auditMeta: { cashierId: operadorNome },
      aPrazoConfig: aPrazoPayment?.aPrazoConfig,
    })
    if (!result.ok) {
      toast({ variant: "destructive", title: "Falha ao registrar venda", description: result.reason })
      return
    }
    const nextCupom = cupomNum + 1
    setCupomNum(nextCupom)
    writeCupom(nextCupom)
    setCartRows([])
    setSelectedLineId(null)
    setHighlightLineId(null)
    setCustomerDisplay("Consumidor final")
    setSelectedClienteId(null)
    setSelectedCustomer(null)
    setBipeCode("")
    setValorRecebido("")
    setLastAddedItem(null)
    setPaymentOpen(false)
    focusBipe()
    toast({ title: "Venda registrada", description: `Cupom ${nextCupom} — ${brlBlack(total)}` })
  }, [
    caixa.isOpen,
    cartRows,
    inventory,
    total,
    customerDisplay,
    selectedClienteId,
    selectedCustomer,
    finalizeSaleTransaction,
    operadorNome,
    cupomNum,
    focusBipe,
    toast,
  ])

  // ── Troco (depende de total) ───────────────────────────────────────────────
  const trocoFinal = useMemo(() => {
    const recebido = parseFloat(valorRecebido.replace(",", ".")) || 0
    return Math.max(0, recebido - total)
  }, [valorRecebido, total])

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#000000]">
      {/* Convergência P1.3: barra de caixa compartilhada (sangria/suprimento +
          terminal + fechamento ERP) também no Black. Gated/experimental — o shell
          preto mantém seus controles; visual unificado fica para follow-up. */}
      <CaixaStatusBar variant="pdv" />
      <PdvBlackShell
        // Caixa
        caixaAberto={caixa.isOpen}
        turno={turno}
        cupomNum={cupomNum}
        operadorNome={operadorNome}
        storeName={storeName}
        onAbrirCaixa={handleAbrirCaixa}
        onFecharCaixa={handleFecharCaixa}
        // Carrinho
        cartRows={cartRows}
        highlightLineId={highlightLineId}
        selectedLineId={selectedLineId}
        onSelectLine={setSelectedLineId}
        onRemoveLine={removeLine}
        total={total}
        itemCount={itemCount}
        lastAddedItem={lastAddedItem}
        // Barcode
        bipeCode={bipeCode}
        onBipeChange={setBipeCode}
        bipeRef={bipeRef}
        onBipeKeyDown={handleBipeKeyDown}
        // Cliente
        customerDisplay={customerDisplay}
        onClientSearchOpen={() => setClientSearchOpen(true)}
        // Documento fiscal
        emitirNota={emitirNota}
        onEmitirNotaChange={setEmitirNota}
        // Valor recebido / troco
        valorRecebido={valorRecebido}
        onValorRecebidoChange={setValorRecebido}
        troco={trocoFinal}
        // Ações
        onShortcutAction={handleShortcutAction}
        onFinalizeClick={() => { if (cartRows.length > 0) setPaymentOpen(true) }}
        // Diálogos
        products={products}
        productSearchOpen={productSearchOpen}
        productSearchInitial={productSearchInitial}
        onProductSearchOpenChange={(open) => {
          setProductSearchOpen(open)
          if (!open) {
            setProductSearchInitial("")
            focusBipe()
          }
        }}
        onAddProductFromSearch={(product) => {
          addProduct(product)
          setProductSearchOpen(false)
          setProductSearchInitial("")
        }}
        clientSearchOpen={clientSearchOpen}
        onClientSearchOpenChange={(open) => {
          setClientSearchOpen(open)
          if (!open) focusBipe()
        }}
        clientOptions={clientOptions}
        onPickClient={(label) => {
          const opt = clientOptions.find((o) => o.label === label)
          const full = opt ? clientResults.find((c) => c.id === opt.id) : undefined
          setSelectedClienteId(opt?.id ?? null)
          setCustomerDisplay(label.split(" — ")[0] || label)
          setSelectedCustomer(
            full
              ? { id: full.id, name: full.name, cpf: (full.document ?? "").trim(), phone: (full.phone ?? "").trim() }
              : null,
          )
          setClientSearchOpen(false)
          focusBipe()
        }}
        qtyEditOpen={qtyEditOpen}
        onQtyEditOpenChange={(open) => {
          setQtyEditOpen(open)
          if (!open) focusBipe()
        }}
        qtyEditDefault={String(selectedLineQty)}
        onQtyEditConfirm={(raw) => {
          const qty = Math.max(0.001, parseFloat(raw.replace(",", ".")) || 1)
          setCartRows((prev) =>
            prev.map((r) => r.lineId === selectedLineId ? { ...r, qty } : r)
          )
          setQtyEditOpen(false)
          focusBipe()
        }}
        cancelSaleOpen={cancelSaleOpen}
        onCancelSaleOpenChange={setCancelSaleOpen}
        onConfirmCancelSale={() => {
          setCartRows([])
          setSelectedLineId(null)
          setLastAddedItem(null)
          setBipeCode("") // limpar busca ao cancelar (GOAL limpeza pós-ação)
          setCancelSaleOpen(false)
          focusBipe()
        }}
      />

      {/* Modais do caixa */}
      <AberturaCaixaModal isOpen={showAbertura} onClose={() => setShowAbertura(false)} />
      <SupervisorGateDialog
        open={fecharGateOpen}
        onOpenChange={setFecharGateOpen}
        onAuthorized={() => setShowFechamento(true)}
        title="Fechar caixa"
        description="Fechar o caixa exige a senha de um supervisor/gerente."
      />
      <FechamentoCaixaModal isOpen={showFechamento} onClose={() => setShowFechamento(false)} />

      {/* Seletor de cliente (com cadastro rápido) para venda à prazo — por cima do pagamento */}
      <PdvClientePicker
        open={aPrazoClientePickerOpen}
        storeId={lojaAtivaId ?? ""}
        onClose={() => setAPrazoClientePickerOpen(false)}
        onSelect={(c: PdvClienteResult) => {
          setSelectedCustomer({
            id: c.id,
            name: c.name,
            cpf: (c.document ?? "").trim(),
            phone: (c.phone ?? "").trim(),
          })
          setSelectedClienteId(c.id)
          setCustomerDisplay(c.name)
          setAPrazoClientePickerOpen(false)
        }}
      />

      {/* Modal de pagamento */}
      <PaymentModal
        isOpen={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        cartSubtotal={total}
        total={total}
        discountReais={0}
        discountPercent={0}
        onDiscountReaisChange={() => {}}
        onDiscountPercentChange={() => {}}
        selectedCustomer={selectedCustomer}
        onCustomerCpfUpdate={(id, cpf) =>
          setSelectedCustomer((prev) => (prev && prev.id === id ? { ...prev, cpf } : prev))
        }
        onRequireCustomer={() => setAPrazoClientePickerOpen(true)}
        cashierId={operadorNome}
        onConfirm={handlePaymentConfirm}
      />
    </div>
  )
}
