"use client"

import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from "react"
import {
  Barcode,
  Calculator,
  ChevronRight,
  Hash,
  Loader2,
  PackageOpen,
  PauseCircle,
  Receipt,
  Search,
  User2,
  UserCog,
  Wifi,
  Zap,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { filterPdvCatalogBySearch } from "@/lib/pdv-product-search"
import { cn } from "@/lib/utils"
import type { PdvCatalogProduct } from "@/lib/pdv-catalog"

const fmt = (n: number) =>
  n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export type PdvOmniCartRow = {
  lineId: string
  code: string
  description: string
  /** Subtítulo (ex.: checklist de entrada da O.S. no serviço). */
  detail?: string
  unit: string
  unitPrice: number
  qty: number
}

const PosField = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & {
    label: string
    hint?: string
    icon?: ReactNode
    fieldClassName?: string
  }
>((({ label, hint, icon, className, fieldClassName, ...props }, ref) => {
  return (
    <label className={cn("flex flex-col gap-1", fieldClassName)}>
      <span className="flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80">
        <span>{label}</span>
        {hint ? (
          <kbd className="rounded border border-b-2 border-border bg-muted/65 px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground uppercase tracking-normal">
            {hint}
          </kbd>
        ) : null}
      </span>
      <div className="relative">
        {icon ? (
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60">
            {icon}
          </span>
        ) : null}
        <input
          ref={ref}
          className={cn(
            "tabular-pdv h-9 w-full rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground/70 shadow-sm outline-none transition-colors focus:border-[hsl(var(--pos-action))]/60 focus:ring-2 focus:ring-[hsl(var(--pos-action))]/20",
            icon && "pl-8",
            className
          )}
          {...props}
        />
      </div>
    </label>
  )
}))
PosField.displayName = "PosField"

const shortcuts = [
  { key: "F1", label: "Finalizar Venda", tone: "accent" as const },
  { key: "F2", label: "Cliente" },
  { key: "F3", label: "Produto" },
  { key: "F4", label: "Alt. Qtd" },
  { key: "F5", label: "Receber Conta", tone: "accent" as const },
  { key: "F6", label: "Cancelar Venda", tone: "destructive" as const },
  { key: "F7", label: "Venda em Espera" },
  { key: "F8", label: "Voltar ao Bipe" },
  { key: "F9", label: "Receber Conta" },
  { key: "CTRL", label: "Funções Avançadas" },
]

function ShortcutBar({ onAction }: { onAction: (key: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5 border-t border-border bg-card px-3 py-2">
      {shortcuts.map((s) => (
        <button
          key={s.key}
          type="button"
          onClick={() => onAction(s.key)}
          className={cn(
            "group flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium shadow-sm transition-all cursor-pointer hover:-translate-y-px hover:border-primary/50 hover:shadow-md active:translate-y-0 text-foreground/80"
          )}
        >
          <kbd
            className={cn(
              "rounded border border-b-2 px-1.5 py-0.5 text-[10px] font-bold tabular-pdv",
              s.tone === "accent"
                ? "border-primary/40 bg-primary/10 text-primary"
                : s.tone === "destructive"
                  ? "border-destructive/40 bg-destructive/10 text-destructive"
                  : "border-border bg-muted/60 text-muted-foreground"
            )}
          >
            {s.key}
          </kbd>
          <span className="text-muted-foreground group-hover:text-foreground">
            {s.label}
          </span>
        </button>
      ))}
    </div>
  )
}

function ItemsTable({
  rows,
  highlightLineId,
  flashLineId,
  selectedLineId,
  onSelect,
}: {
  rows: PdvOmniCartRow[]
  highlightLineId: string | null
  flashLineId?: string | null
  selectedLineId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
      <div className="min-w-[820px] flex flex-col flex-1 min-h-0">
        <div className="grid grid-cols-[48px_130px_1fr_64px_110px_80px_130px] gap-2 border-b border-border bg-muted/30 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/75">
          <div>Item</div>
          <div>Código</div>
          <div>Descrição</div>
          <div>Unid.</div>
          <div className="text-right">Unitário</div>
          <div className="text-right">Qtd</div>
          <div className="text-right">Total</div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto bg-card">
          {rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground/85">
              <PackageOpen className="h-10 w-10 opacity-65 text-muted-foreground" strokeWidth={1.5} />
              <p className="text-sm font-semibold text-foreground/90">Nenhum item bipado</p>
              <p className="max-w-sm px-4 text-center text-xs text-muted-foreground/80">
                Bipe no campo acima ou pressione{" "}
                <kbd className="rounded border border-b-2 border-border bg-muted/65 px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
                  F3
                </kbd>{" "}
                para pesquisar
              </p>
            </div>
          ) : (
            rows.map((item, idx) => {
              const lineTotal = item.qty * item.unitPrice
              const isHighlight = item.lineId === highlightLineId
              const isFlash = flashLineId != null && item.lineId === flashLineId
              const isSelected = item.lineId === selectedLineId
              return (
                <button
                  type="button"
                  key={item.lineId}
                  onClick={() => onSelect(item.lineId)}
                  className={cn(
                    "grid w-full grid-cols-[48px_130px_1fr_64px_110px_80px_130px] gap-2 border-b border-border/60 px-4 py-2.5 text-left text-sm tabular-pdv transition-colors cursor-pointer text-foreground",
                    isFlash && "pdv-rapido-row-flash",
                    idx % 2 === 0 ? "bg-card" : "bg-muted/10",
                    isHighlight && "bg-primary/10 animate-in fade-in duration-300",
                    isSelected && "ring-1 ring-inset ring-primary/60",
                    "hover:bg-primary/5"
                  )}
                >
                  <div className="font-mono text-muted-foreground/50">{String(idx + 1).padStart(3, "0")}</div>
                  <div className="font-mono truncate min-w-0 text-foreground/80" title={item.code}>{item.code}</div>
                  <div className="min-w-0">
                    <div className="truncate font-medium" title={item.description}>{item.description}</div>
                    {item.detail ? (
                      <div className="mt-0.5 truncate font-mono text-[10px] leading-snug text-primary/70" title={item.detail}>
                        {item.detail}
                      </div>
                    ) : null}
                  </div>
                  <div className="text-muted-foreground/50">{item.unit}</div>
                  <div className="text-right text-foreground/80">R$ {fmt(item.unitPrice)}</div>
                  <div className="text-right font-medium">{fmt(item.qty)}</div>
                  <div className="text-right font-semibold text-[hsl(var(--pos-action))]">R$ {fmt(lineTotal)}</div>
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

export type PdvOmniClassicShellProps = {
  storeName: string
  /** Id da unidade ativa (ex.: "loja-1"). Exibido junto ao nome para o operador
   * confirmar a loja antes de vender e evitar gravar na unidade errada. */
  storeId?: string
  cartRows: PdvOmniCartRow[]
  highlightLineId: string | null
  /** Flash curto ao adicionar item (modo rápido). */
  flashLineId?: string | null
  selectedLineId: string | null
  onSelectLine: (lineId: string) => void
  total: number
  itemCount: number
  previousSaleTotal: number | null
  bipeCode: string
  onBipeChange: (v: string) => void
  bipeRef: React.RefObject<HTMLInputElement | null>
  onBipeKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void
  /** Sugestões para autocomplete do campo BIPE (max 8). */
  bipeSuggestions?: PdvCatalogProduct[]
  onBipeSuggestionSelect?: (product: PdvCatalogProduct) => void
  customerDisplay: string
  onCustomerDisplayChange: (v: string) => void
  nextQtyStr: string
  onNextQtyStrChange: (v: string) => void
  seller: string
  onSellerChange: (v: string) => void
  info: string
  onShortcutAction: (key: string) => void
  onFinalizeClick: () => void
  products: PdvCatalogProduct[]
  productSearchOpen: boolean
  onProductSearchOpenChange: (open: boolean) => void
  clientSearchOpen: boolean
  onClientSearchOpenChange: (open: boolean) => void
  clientOptions: Array<{ id: string; label: string }>
  onPickClient: (label: string) => void
  /** Live search query for the F2 client picker (controlled from parent). */
  clientSearchQuery?: string
  onClientSearchQueryChange?: (v: string) => void
  clientSearchLoading?: boolean
  qtyEditOpen: boolean
  onQtyEditOpenChange: (open: boolean) => void
  qtyEditDefault: string
  onQtyEditConfirm: (raw: string) => boolean | void
  cancelSaleOpen: boolean
  onCancelSaleOpenChange: (open: boolean) => void
  onConfirmCancelSale: () => void
  advancedOpen: boolean
  onAdvancedOpenChange: (open: boolean) => void
  /** Abre o fluxo real de Troca / Devolução (chamado pelos botões Trocas/Devoluções). */
  onOpenTrocas?: () => void
  receivablesOpen: boolean
  onReceivablesOpenChange: (open: boolean) => void
  onOpenReceivablesModule: () => void
  onAddProductFromSearch: (product: PdvCatalogProduct) => void
  /** PDV rápido: menos cromo (atalhos visíveis, painel lateral, infos decorativas). */
  isModoRapido?: boolean
  /** Quantidade de holds do tipo Classic no terminal atual. */
  heldSalesCount: number
}

export function PdvOmniClassicShell(props: PdvOmniClassicShellProps) {
  const isModoRapido = props.isModoRapido === true
  const qtyEditRef = useRef<HTMLInputElement>(null)
  const qtyEditBusyRef = useRef(false)
  const clientSearchInputRef = useRef<HTMLInputElement>(null)

  // Explicit focus when F2 dialog opens (autoFocus unreliable inside Radix Dialog)
  useEffect(() => {
    if (props.clientSearchOpen) {
      window.setTimeout(() => clientSearchInputRef.current?.focus(), 60)
    }
  }, [props.clientSearchOpen])

  const [currentTime, setCurrentTime] = useState("")

  useEffect(() => {
    const updateClock = () => {
      setCurrentTime(new Date().toLocaleString("pt-BR"))
    }
    updateClock()
    const interval = setInterval(updateClock, 1000)
    return () => clearInterval(interval)
  }, [])

  // Índice da sugestão activa via teclado (-1 = nenhuma)
  const [bipeActiveIdx, setBipeActiveIdx] = useState(-1)
  const activeItemRef = useRef<HTMLButtonElement>(null)

  // Reseta seleção quando o texto muda
  useEffect(() => {
    setBipeActiveIdx(-1)
  }, [props.bipeCode])

  // Scroll automático para manter item ativo visível
  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: "nearest" })
  }, [bipeActiveIdx])

  const handleBipeKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      const suggestions = props.bipeSuggestions ?? []
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setBipeActiveIdx((prev) => Math.min(prev + 1, suggestions.length - 1))
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setBipeActiveIdx((prev) => Math.max(prev - 1, -1))
        return
      }
      if (e.key === "Escape") {
        e.preventDefault()
        props.onBipeChange("")
        setBipeActiveIdx(-1)
        return
      }
      if (e.key === "Enter" && bipeActiveIdx >= 0 && suggestions[bipeActiveIdx]) {
        e.preventDefault()
        props.onBipeSuggestionSelect?.(suggestions[bipeActiveIdx])
        setBipeActiveIdx(-1)
        return
      }
      props.onBipeKeyDown(e)
    },
    [bipeActiveIdx, props]
  )

  useEffect(() => {
    if (!props.qtyEditOpen) return
    qtyEditBusyRef.current = false
    const id = window.requestAnimationFrame(() => {
      qtyEditRef.current?.focus()
      qtyEditRef.current?.select?.()
    })
    return () => window.cancelAnimationFrame(id)
  }, [props.qtyEditOpen])

  const refocusQtyEdit = useCallback(() => {
    window.requestAnimationFrame(() => {
      qtyEditRef.current?.focus()
      qtyEditRef.current?.select?.()
    })
  }, [])

  const handleQtyEditCancel = useCallback(() => {
    props.onQtyEditOpenChange(false)
  }, [props])

  const handleQtyEditConfirm = useCallback(() => {
    if (qtyEditBusyRef.current) return
    qtyEditBusyRef.current = true
    const ok = props.onQtyEditConfirm(qtyEditRef.current?.value ?? "1")
    if (ok === false) {
      qtyEditBusyRef.current = false
      refocusQtyEdit()
      return
    }
    window.requestAnimationFrame(() => {
      qtyEditBusyRef.current = false
    })
  }, [props, refocusQtyEdit])

  const handleQtyEditKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Enter") {
        e.preventDefault()
        handleQtyEditConfirm()
        return
      }
      if (e.key === "Escape") {
        e.preventDefault()
        handleQtyEditCancel()
      }
    },
    [handleQtyEditCancel, handleQtyEditConfirm]
  )

  const [productDialogQuery, setProductDialogQuery] = useState("")
  const [productActiveIdx, setProductActiveIdx] = useState(0)
  const productSearchInputRef = useRef<HTMLInputElement>(null)
  const productActiveItemRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!props.productSearchOpen) return
    setProductDialogQuery("")
    setProductActiveIdx(0)
    const id = window.setTimeout(() => productSearchInputRef.current?.focus(), 60)
    return () => window.clearTimeout(id)
  }, [props.productSearchOpen])

  const productsForDialog = useMemo(
    () => filterPdvCatalogBySearch(props.products, productDialogQuery),
    [props.products, productDialogQuery]
  )

  // Novo filtro → volta a seleção para o primeiro resultado.
  useEffect(() => {
    setProductActiveIdx(0)
  }, [productDialogQuery])

  // Mantém a linha activa visível ao navegar por teclado (↑/↓).
  useEffect(() => {
    productActiveItemRef.current?.scrollIntoView({ block: "nearest" })
  }, [productActiveIdx])

  const handleProductDialogKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      const list = productsForDialog
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setProductActiveIdx((prev) => Math.min(prev + 1, list.length - 1))
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setProductActiveIdx((prev) => Math.max(prev - 1, 0))
        return
      }
      if (e.key === "Enter") {
        const sel = list[productActiveIdx]
        if (!sel) return
        e.preventDefault()
        props.onProductSearchOpenChange(false)
        props.onAddProductFromSearch(sel)
      }
    },
    [productsForDialog, productActiveIdx, props]
  )

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card/80 px-3 py-2 shadow-sm backdrop-blur-xl sm:px-4">
        <div className="flex min-w-0 items-center gap-3 md:gap-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary shadow-sm">
            <Zap className="h-5 w-5" />
          </div>
          <div className="hidden h-8 w-px md:block bg-border" />
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground/60">
              Estabelecimento
            </span>
            <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <span className="truncate">{props.storeName}</span>
              {props.storeId ? (
                <span className="shrink-0 rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {props.storeId}
                </span>
              ) : null}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => props.onShortcutAction("F7")}
            aria-label={`Abrir vendas em espera${props.heldSalesCount > 0 ? ` (${props.heldSalesCount})` : ""}`}
            title="Vendas em espera (F7)"
            className="inline-flex min-w-0 shrink-0 items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
          >
            <PauseCircle className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden sm:inline">Em espera</span>
            {props.heldSalesCount > 0 ? (
              <span className="rounded bg-primary/15 px-1.5 py-0.5 tabular-nums">{props.heldSalesCount}</span>
            ) : null}
            <kbd className="hidden rounded border border-primary/30 bg-primary/10 px-1 py-px text-[9px] font-bold sm:inline">F7</kbd>
          </button>
          {!isModoRapido ? (
            <>
              <span className="hidden items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary md:inline-flex">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" /> Online
              </span>
              <span className="hidden items-center gap-1.5 text-xs text-muted-foreground/60 md:inline-flex">
                <Wifi className="h-3.5 w-3.5" /> Conexão estável
              </span>
            </>
          ) : null}
          <span className="text-xs font-mono tabular-nums text-muted-foreground/75">{currentTime}</span>
        </div>
      </header>

      <section className="grid grid-cols-12 gap-3 border-b border-border bg-card px-3 py-3 sm:px-4">
        {/* BIPE com dropdown de autocomplete */}
        <div className={cn("relative col-span-12", isModoRapido ? "md:col-span-5" : "md:col-span-4")}>
          <PosField
            ref={props.bipeRef}
            label="Código / Bipe"
            hint="ENTER"
            icon={<Barcode className="h-4 w-4" />}
            value={props.bipeCode}
            onChange={(e) => props.onBipeChange(e.target.value)}
            onKeyDown={handleBipeKeyDown}
            placeholder="Bipe ou digite o código do produto"
            autoComplete="off"
          />
          {props.bipeCode.trim().length >= 1 ? (
            <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-border bg-card shadow-xl">
              {props.bipeSuggestions && props.bipeSuggestions.length > 0 ? (
                <ul className="max-h-60 overflow-y-auto">
                  {props.bipeSuggestions.map((product, idx) => {
                    const isActive = idx === bipeActiveIdx
                    return (
                      <li key={`${product.id}-${product.dbId ?? ""}`}>
                        <button
                          ref={isActive ? activeItemRef : undefined}
                          type="button"
                          className={cn(
                            "flex w-full items-center gap-3 border-t border-border px-3 py-2.5 text-left text-sm transition-colors first:border-0 hover:bg-muted/65 cursor-pointer text-foreground",
                            isActive && "bg-primary/10 text-primary"
                          )}
                          onMouseDown={(e) => {
                            e.preventDefault()
                            props.onBipeSuggestionSelect?.(product)
                          }}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium" title={product.name}>{product.name}</div>
                            <div className="text-xs text-muted-foreground/60">
                              {[
                                product.sku ? `SKU ${product.sku}` : null,
                                product.barcode ? `EAN ${product.barcode}` : null,
                                `Estoque: ${product.stock}`,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </div>
                          </div>
                          <span className="shrink-0 font-semibold tabular-pdv text-primary">
                            R$ {fmt(product.price)}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <div className="px-4 py-3 text-sm text-muted-foreground/60">
                  Nenhum produto encontrado para{" "}
                  <span className="font-medium text-foreground">
                    &quot;{props.bipeCode.trim()}&quot;
                  </span>
                </div>
              )}
            </div>
          ) : null}
        </div>
        <PosField
          fieldClassName={cn("col-span-6", isModoRapido ? "md:col-span-4" : "md:col-span-3")}
          label="Cliente"
          hint="F2"
          icon={<User2 className="h-4 w-4" />}
          value={props.customerDisplay}
          onChange={(e) => props.onCustomerDisplayChange(e.target.value)}
        />
        <PosField
          fieldClassName={cn("col-span-6", isModoRapido ? "md:col-span-3" : "md:col-span-2")}
          label="Quantidade"
          hint="F4"
          icon={<Hash className="h-4 w-4" />}
          value={props.nextQtyStr}
          onChange={(e) => props.onNextQtyStrChange(e.target.value)}
          inputMode="decimal"
          // Seleciona todo o valor ao focar/clicar (igual ao F4): digitar substitui direto.
          // onFocus cobre Tab/foco programático; onClick garante a seleção no clique do mouse
          // (o mouseup após o clique desfaz a seleção feita só no onFocus).
          onFocus={(e) => e.currentTarget.select()}
          onClick={(e) => e.currentTarget.select()}
        />
        {!isModoRapido ? (
          <PosField
            fieldClassName="col-span-12 md:col-span-3"
            label="Vendedor"
            icon={<UserCog className="h-4 w-4" />}
            value={props.seller}
            onChange={(e) => props.onSellerChange(e.target.value)}
          />
        ) : null}
      </section>

      <main className="min-h-0 flex-1 overflow-hidden p-2 sm:p-3 bg-background">
        {isModoRapido ? (
          <div className="flex min-h-0 min-w-0 flex-1 gap-2 overflow-hidden bg-background">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <ItemsTable
                rows={props.cartRows}
                highlightLineId={props.highlightLineId}
                flashLineId={props.flashLineId}
                selectedLineId={props.selectedLineId}
                onSelect={props.onSelectLine}
              />
            </div>
            <aside className="flex w-[min(280px,34vw)] min-w-[232px] max-w-[300px] shrink-0 flex-col justify-between gap-3 self-stretch border-l border-border bg-card px-3 py-3 sm:px-4">
              <div className="min-w-0 rounded-xl border border-border p-4 bg-muted/20 shadow-sm space-y-4">
                <div>
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                    Total
                  </span>
                  <div className="text-2xl font-extrabold sm:text-3xl mt-1 tabular-nums text-[hsl(var(--pos-action))]">
                    R$ {fmt(props.total)}
                  </div>
                </div>
                
                <div className="border-t border-border pt-3 space-y-2 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground/60">Nº de itens</span>
                    <span className="font-semibold tabular-nums text-foreground">
                      {props.itemCount} {props.itemCount === 1 ? "item" : "itens"}
                    </span>
                  </div>
                  {props.previousSaleTotal != null && (
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground/60">Venda anterior</span>
                      <span className="font-semibold tabular-nums text-foreground">
                        R$ {fmt(props.previousSaleTotal)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              <div className="rounded-xl border border-border bg-card p-3 shadow-sm space-y-2 text-xs">
                <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 mb-1">Atalhos Operacionais</div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">F2 Cliente</span>
                  <kbd className="rounded border border-b-2 border-border bg-muted/60 px-1.5 py-0.5 text-[9px] font-bold font-mono">F2</kbd>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">F3 Buscar Produto</span>
                  <kbd className="rounded border border-b-2 border-border bg-muted/60 px-1.5 py-0.5 text-[9px] font-bold font-mono">F3</kbd>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">F4 Alterar Qtd</span>
                  <kbd className="rounded border border-b-2 border-border bg-muted/60 px-1.5 py-0.5 text-[9px] font-bold font-mono">F4</kbd>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">F12 Pagto Múltiplo</span>
                  <kbd className="rounded border border-b-2 border-border bg-muted/60 px-1.5 py-0.5 text-[9px] font-bold font-mono">F12</kbd>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">INS Item Avulso</span>
                  <kbd className="rounded border border-b-2 border-border bg-muted/60 px-1.5 py-0.5 text-[9px] font-bold font-mono">INS</kbd>
                </div>
              </div>
              <Button
                type="button"
                onClick={() => props.onShortcutAction("F1")}
                className="h-11 w-full shrink-0 gap-2 bg-[hsl(var(--pos-action))] font-semibold text-[hsl(var(--pos-action-foreground))] hover:bg-[hsl(var(--pos-action))]/90 cursor-pointer transition-colors shadow-sm"
              >
                <Receipt className="h-4 w-4 shrink-0" />
                <span>Finalizar Venda</span>
                <kbd className="ml-auto rounded border border-b-2 border-primary-foreground/30 bg-primary-foreground/10 px-1.5 py-0.5 text-[10px] font-bold font-mono">F1</kbd>
              </Button>
            </aside>
          </div>
        ) : (
          <div className="grid grid-cols-12 gap-3 h-full min-h-0 overflow-hidden bg-background">
            <div className="flex min-h-0 flex-col overflow-hidden col-span-12 md:col-span-8 lg:col-span-9">
              <ItemsTable
                rows={props.cartRows}
                highlightLineId={props.highlightLineId}
                flashLineId={props.flashLineId}
                selectedLineId={props.selectedLineId}
                onSelect={props.onSelectLine}
              />
            </div>
            <aside className="col-span-12 flex min-h-0 flex-col gap-3 overflow-y-auto md:col-span-4 lg:col-span-3">
              <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
                    Total da Venda
                  </span>
                  <Calculator className="h-4 w-4 text-muted-foreground/65" />
                </div>
                <div className="mt-2 text-[clamp(1.75rem,5vw,2.5rem)] font-semibold leading-none tracking-tight tabular-pdv text-[hsl(var(--pos-action))]">
                  R$ {fmt(props.total)}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border pt-3 text-xs">
                  <div>
                    <div className="text-muted-foreground/60">Nº de itens</div>
                    <div className="font-semibold tabular-pdv text-foreground">{props.itemCount}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-muted-foreground/60">Venda anterior</div>
                    <div className="font-semibold tabular-pdv text-foreground">
                      {props.previousSaleTotal != null ? `R$ ${fmt(props.previousSaleTotal)}` : "—"}
                    </div>
                  </div>
                  <div className="col-span-2">
                    <div className="text-muted-foreground/60">Total sem desconto</div>
                    <div className="font-semibold tabular-pdv text-foreground">R$ {fmt(props.total)}</div>
                  </div>
                </div>
                <Button
                  type="button"
                  onClick={() => props.onShortcutAction("F1")}
                  className="mt-4 w-full gap-2 bg-[hsl(var(--pos-action))] font-semibold text-[hsl(var(--pos-action-foreground))] hover:bg-[hsl(var(--pos-action))]/90 cursor-pointer transition-colors shadow-sm"
                >
                  <Receipt className="h-4 w-4 shrink-0" />
                  <span>Finalizar Venda</span>
                  <kbd className="ml-auto rounded border border-b-2 border-primary-foreground/30 bg-primary-foreground/10 px-1.5 py-0.5 text-[10px] font-bold font-mono">F1</kbd>
                </Button>
              </div>
              <div className="rounded-xl border border-border bg-card p-3 shadow-sm space-y-2 text-xs">
                <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                  Também disponíveis
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Pagamento Múltiplo</span>
                  <kbd className="rounded border border-b-2 border-border bg-muted/60 px-1.5 py-0.5 text-[9px] font-bold font-mono">F12</kbd>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Item Avulso</span>
                  <kbd className="rounded border border-b-2 border-border bg-muted/60 px-1.5 py-0.5 text-[9px] font-bold font-mono">INS</kbd>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Venda em Espera</span>
                  <kbd className="rounded border border-b-2 border-border bg-muted/60 px-1.5 py-0.5 text-[9px] font-bold font-mono">F7</kbd>
                </div>
              </div>
            </aside>
          </div>
        )}
      </main>

      {!isModoRapido ? <ShortcutBar onAction={props.onShortcutAction} /> : null}

      <Dialog open={props.productSearchOpen} onOpenChange={props.onProductSearchOpenChange}>
        <DialogContent className="w-[94vw] max-w-[1000px] sm:max-w-[1000px] border-border bg-card text-foreground">
          <DialogHeader>
            <DialogTitle>Pesquisar Produto (F3)</DialogTitle>
            <DialogDescription className="text-muted-foreground/75">
              Nome, categoria, SKU, código ou EAN · ↑↓ navega · Enter adiciona · Esc fecha. Lista vazia mostra o catálogo.
            </DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={productSearchInputRef}
              value={productDialogQuery}
              onChange={(e) => setProductDialogQuery(e.target.value)}
              onKeyDown={handleProductDialogKeyDown}
              placeholder="Digite nome, código, SKU ou EAN…"
              className="h-11 border-border bg-background pl-9 text-foreground"
              autoComplete="off"
            />
          </div>
          <div className="flex items-center justify-between gap-2 px-0.5 text-xs">
            <span className={cn("font-medium", productsForDialog.length === 0 ? "text-muted-foreground/70" : "text-foreground")}>
              {productsForDialog.length === 0
                ? "Nenhum produto encontrado"
                : `${productsForDialog.length} ${productsForDialog.length === 1 ? "produto encontrado" : "produtos encontrados"}`}
            </span>
            <span className="truncate text-muted-foreground/55">
              {productDialogQuery.trim() ? `Filtro: “${productDialogQuery.trim()}”` : "Catálogo completo"}
            </span>
          </div>
          {productsForDialog.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-border px-4 py-12 text-center text-sm text-muted-foreground/60">
              <PackageOpen className="h-9 w-9 opacity-40" strokeWidth={1.5} />
              <p className="font-medium text-foreground">Nenhum produto encontrado</p>
              <p className="text-xs">Ajuste o termo ou limpe o filtro para ver o catálogo completo.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border">
              <div className="grid grid-cols-[minmax(220px,50fr)_minmax(96px,15fr)_minmax(104px,15fr)_minmax(64px,10fr)_minmax(88px,10fr)] items-center gap-3 border-b border-border bg-muted/50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <span>Produto</span>
                <span>Cód. / SKU</span>
                <span>EAN</span>
                <span className="text-right">Estoque</span>
                <span className="text-right">Preço</span>
              </div>
              <div className="max-h-[56vh] overflow-y-auto">
                {productsForDialog.map((p, idx) => {
                  const isService = p.category === "Servicos"
                  const unlimited = p.stock >= 999
                  const sku = p.sku || p.codigo || p.id
                  const ean = p.codigoBarras || p.barcode || ""
                  const isActive = idx === productActiveIdx
                  return (
                    <button
                      key={p.id}
                      ref={isActive ? productActiveItemRef : undefined}
                      type="button"
                      onMouseEnter={() => setProductActiveIdx(idx)}
                      onClick={() => {
                        props.onProductSearchOpenChange(false)
                        props.onAddProductFromSearch(p)
                      }}
                      className={cn(
                        "grid w-full grid-cols-[minmax(220px,50fr)_minmax(96px,15fr)_minmax(104px,15fr)_minmax(64px,10fr)_minmax(88px,10fr)] items-center gap-3 border-b border-border/50 px-3 py-2 text-left text-sm text-foreground transition-colors cursor-pointer",
                        isActive ? "bg-primary/10 ring-1 ring-inset ring-primary/40" : "hover:bg-muted/65",
                      )}
                    >
                      <div className="min-w-0">
                        <div className="line-clamp-2 break-words font-medium leading-snug text-foreground" title={p.name}>{p.name}</div>
                        <div className="truncate text-[11px] text-muted-foreground/55">{p.category}</div>
                      </div>
                      <div className="truncate font-mono text-xs text-foreground" title={sku}>{sku}</div>
                      <div className="truncate font-mono text-xs text-muted-foreground/75" title={ean || "sem EAN"}>{ean || "—"}</div>
                      <div
                        className={cn(
                          "text-right text-xs tabular-pdv",
                          isService || unlimited
                            ? "text-muted-foreground/40"
                            : p.stock <= 0
                              ? "text-destructive/80"
                              : p.stock <= 5
                                ? "text-amber-500"
                                : "text-muted-foreground/70",
                        )}
                      >
                        {isService ? "Serviço" : unlimited ? "—" : `${p.stock} un`}
                      </div>
                      <span className="text-right font-semibold tabular-pdv text-[hsl(var(--pos-action))]">
                        {p.vendaPorPeso ? `R$ ${fmt(p.precoPorKg ?? p.price)}/kg` : `R$ ${fmt(p.price)}`}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={props.clientSearchOpen} onOpenChange={props.onClientSearchOpenChange}>
        <DialogContent className="w-[92vw] max-w-xl border-border bg-card text-foreground">
          <DialogHeader>
            <DialogTitle>Pesquisar Cliente (F2)</DialogTitle>
            <DialogDescription className="text-muted-foreground/75">Identifique o cliente desta venda.</DialogDescription>
          </DialogHeader>
          <div className="relative">
            {props.clientSearchLoading ? (
              <Loader2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            ) : (
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            )}
            <Input
              ref={clientSearchInputRef}
              value={props.clientSearchQuery ?? ""}
              onChange={(e) => props.onClientSearchQueryChange?.(e.target.value)}
              placeholder="Nome, CPF/CNPJ ou telefone…"
              className="h-9 rounded-lg border-border bg-background pl-9 text-sm"
            />
          </div>
          {/* Always show CONSUMIDOR as "no client" option */}
          <button
            type="button"
            onClick={() => {
              props.onPickClient("CONSUMIDOR")
              props.onClientSearchOpenChange(false)
            }}
            className="flex w-full items-center justify-between rounded-lg border border-border bg-background px-3 py-2 text-left text-sm hover:border-primary/50 cursor-pointer"
          >
            <span className="font-medium text-foreground">CONSUMIDOR (sem identificação)</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </button>
          <div className="max-h-52 space-y-1 overflow-y-auto">
            {!(props.clientSearchQuery ?? "").trim() ? (
              <p className="py-2 text-center text-sm text-muted-foreground">
                Digite para buscar um cliente.
              </p>
            ) : props.clientSearchLoading ? (
              <div className="flex items-center justify-center gap-2 py-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Buscando…
              </div>
            ) : props.clientOptions.filter((c) => c.id !== "0").length === 0 ? (
              <p className="py-2 text-center text-sm text-muted-foreground">
                Nenhum resultado para &ldquo;{props.clientSearchQuery}&rdquo;.
              </p>
            ) : (
              props.clientOptions
                .filter((c) => c.id !== "0")
                .map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      props.onPickClient(c.label)
                      props.onClientSearchOpenChange(false)
                    }}
                    className="flex w-full items-center justify-between rounded-lg border border-border bg-background px-3 py-2 text-left text-sm hover:border-primary/50 cursor-pointer"
                  >
                    <span className="font-medium text-foreground">{c.label}</span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </button>
                ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={props.qtyEditOpen} onOpenChange={props.onQtyEditOpenChange}>
        <DialogContent className="max-w-sm border-border bg-card text-foreground" onKeyDown={handleQtyEditKeyDown}>
          <DialogHeader>
            <DialogTitle>Alterar Quantidade (F4)</DialogTitle>
            <DialogDescription className="text-muted-foreground/75">Defina a nova quantidade para o item selecionado.</DialogDescription>
          </DialogHeader>
          <input
            key={props.qtyEditDefault}
            ref={qtyEditRef}
            defaultValue={props.qtyEditDefault}
            inputMode="decimal"
            className="tabular-pdv h-11 w-full rounded-lg border border-border bg-background px-3 text-2xl font-semibold outline-none focus:border-[hsl(var(--pos-action))]/60 focus:ring-1 focus:ring-[hsl(var(--pos-action))]/25"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" className="cursor-pointer" onClick={handleQtyEditCancel}>
              Voltar
            </Button>
            <Button
              type="button"
              className="bg-[hsl(var(--pos-action))] text-[hsl(var(--pos-action-foreground))] hover:bg-[hsl(var(--pos-action))]/90 cursor-pointer"
              onClick={handleQtyEditConfirm}
            >
              Aplicar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={props.cancelSaleOpen} onOpenChange={props.onCancelSaleOpenChange}>
        <DialogContent className="max-w-md border-border bg-card text-foreground">
          <DialogHeader>
            <DialogTitle>Cancelar Venda (F6)</DialogTitle>
            <DialogDescription className="text-muted-foreground/75">Todos os itens serão removidos. Confirme para limpar o cupom.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" className="cursor-pointer" onClick={() => props.onCancelSaleOpenChange(false)}>
              Voltar
            </Button>
            <Button type="button" variant="destructive" className="cursor-pointer" onClick={props.onConfirmCancelSale}>
              Cancelar venda
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={props.receivablesOpen} onOpenChange={props.onReceivablesOpenChange}>
        <DialogContent className="max-w-md border-border bg-card text-foreground">
          <DialogHeader>
            <DialogTitle>Contas a Receber (F9)</DialogTitle>
            <DialogDescription className="text-muted-foreground/75">Abra o módulo financeiro para títulos e recebimentos.</DialogDescription>
          </DialogHeader>
          <Button type="button" className="w-full cursor-pointer" onClick={props.onOpenReceivablesModule}>
            Ir para Contas a Receber
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog open={props.advancedOpen} onOpenChange={props.onAdvancedOpenChange}>
        <DialogContent className="max-w-md border-border bg-card text-foreground">
          <DialogHeader>
            <DialogTitle>Funções avançadas (CTRL)</DialogTitle>
            <DialogDescription className="text-muted-foreground/75">Atalhos adicionais do caixa.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            {["Orçamentos", "Trocas", "Devoluções", "Sangria", "Suprimento", "Reimprimir"].map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => {
                  props.onAdvancedOpenChange(false)
                  if (opt === "Trocas" || opt === "Devoluções") props.onOpenTrocas?.()
                }}
                className="rounded-lg border border-border bg-background px-3 py-3 text-sm font-medium text-foreground hover:border-primary/40 hover:bg-muted/65 cursor-pointer transition-colors"
              >
                {opt}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
