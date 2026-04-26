"use client"

import { forwardRef, useEffect, useRef, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from "react"
import {
  Barcode,
  Calculator,
  ChevronRight,
  Hash,
  PackageOpen,
  Receipt,
  User2,
  UserCog,
  Wifi,
  Zap,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useStudioTheme } from "@/components/theme/ThemeProvider"
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
    /** Black Edition: preto absoluto nos campos; Classic: tokens Lovable. */
    tone?: "black" | "classic"
  }
>(({ label, hint, icon, className, fieldClassName, tone = "classic", ...props }, ref) => {
  const isBlack = tone === "black"
  return (
    <label className={cn("flex flex-col gap-1", fieldClassName)}>
      <span
        className={cn(
          "flex items-center justify-between text-[11px] font-medium uppercase tracking-wider",
          isBlack ? "text-white/55" : "text-pos-label"
        )}
      >
        <span>{label}</span>
        {hint ? (
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-semibold",
              isBlack ? "bg-white/10 text-white/80" : "bg-secondary text-secondary-foreground"
            )}
          >
            {hint}
          </span>
        ) : null}
      </span>
      <div className="relative">
        {icon ? (
          <span
            className={cn(
              "pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2",
              isBlack ? "text-white/45" : "text-pos-label"
            )}
          >
            {icon}
          </span>
        ) : null}
        <input
          ref={ref}
          className={cn(
            "tabular-pdv h-9 w-full rounded-md border px-3 text-sm font-medium shadow-pos outline-none transition-colors",
            isBlack
              ? "border-white/15 bg-[#000000] text-white placeholder:text-white/40 focus:border-emerald-500/70 focus:ring-2 focus:ring-emerald-500/25"
              : "border-[hsl(var(--pos-input-border))] bg-[hsl(var(--pos-input))] text-foreground placeholder:text-pos-label/60 focus:border-[hsl(var(--pos-input-focus))] focus:ring-2 focus:ring-[hsl(var(--pos-input-focus)/0.18)]",
            icon && "pl-8",
            className
          )}
          {...props}
        />
      </div>
    </label>
  )
})
PosField.displayName = "PosField"

const shortcuts = [
  { key: "F1", label: "Finalizar Venda", tone: "accent" as const },
  { key: "F2", label: "Cliente" },
  { key: "F3", label: "Produto" },
  { key: "F4", label: "Alt. Qtd" },
  { key: "F5", label: "Cancelar Item" },
  { key: "F6", label: "Cancelar Venda", tone: "destructive" as const },
  { key: "F7", label: "Voltar ao Bipe" },
  { key: "F8", label: "Voltar ao Bipe" },
  { key: "F9", label: "Contas a Receber" },
  { key: "CTRL", label: "Funções Avançadas" },
]

function ShortcutBar({ onAction, isBlack }: { onAction: (key: string) => void; isBlack: boolean }) {
  return (
    <div
      className={cn(
        "flex flex-wrap gap-1.5 border-t px-3 py-2",
        isBlack ? "border-white/10 bg-[#000000]" : "pos-divider bg-pos-header"
      )}
    >
      {shortcuts.map((s) => (
        <button
          key={s.key}
          type="button"
          onClick={() => onAction(s.key)}
          className={cn(
            "group flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-medium shadow-pos transition-all",
            isBlack
              ? "border-white/10 bg-[#000000] text-white/90 hover:-translate-y-px hover:border-emerald-500/50 hover:shadow-md active:translate-y-0"
              : "border-[hsl(var(--pos-divider))] bg-pos-panel text-foreground hover:-translate-y-px hover:border-[hsl(var(--pos-input-focus)/0.4)] hover:shadow-pos-md active:translate-y-0",
            !isBlack && s.tone === "accent" && "border-emerald-500/30 dark:border-emerald-400/30",
            !isBlack && s.tone === "destructive" && "border-destructive/30",
            isBlack && s.tone === "accent" && "border-emerald-500/40",
            isBlack && s.tone === "destructive" && "border-red-500/40"
          )}
        >
          <kbd
            className={cn(
              "rounded border border-b-2 px-1.5 py-0.5 text-[10px] font-bold tabular-pdv",
              isBlack
                ? s.tone === "accent"
                  ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-300"
                  : s.tone === "destructive"
                    ? "border-red-400/50 bg-red-500/15 text-red-300"
                    : "border-white/20 bg-black text-white/80"
                : s.tone === "accent"
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : s.tone === "destructive"
                    ? "border-destructive/40 bg-destructive/10 text-destructive"
                    : "border-[hsl(var(--pos-input-border))] bg-secondary text-pos-label"
            )}
          >
            {s.key}
          </kbd>
          <span className={cn("group-hover:opacity-100", isBlack ? "text-white/60 group-hover:text-white" : "text-pos-label group-hover:text-foreground")}>
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
  selectedLineId,
  onSelect,
  isBlack,
}: {
  rows: PdvOmniCartRow[]
  highlightLineId: string | null
  selectedLineId: string | null
  onSelect: (id: string) => void
  isBlack: boolean
}) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden rounded-md border shadow-pos",
        isBlack ? "border-white/10 bg-[#000000]" : "pos-divider bg-pos-panel"
      )}
    >
      <div
        className={cn(
          "grid grid-cols-[56px_110px_1fr_72px_120px_88px_140px] gap-3 border-b px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider",
          isBlack ? "border-white/10 bg-[#000000] text-white/55" : "pos-divider bg-pos-header text-pos-label"
        )}
      >
        <div>Item</div>
        <div>Código</div>
        <div>Descrição</div>
        <div>Unid.</div>
        <div className="text-right">Unitário</div>
        <div className="text-right">Qtd</div>
        <div className="text-right">Total</div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <div
            className={cn(
              "flex h-full min-h-[200px] flex-col items-center justify-center gap-2 py-16",
              isBlack ? "text-white/50" : "text-pos-label"
            )}
          >
            <PackageOpen className="h-10 w-10 opacity-40" strokeWidth={1.5} />
            <p className={cn("text-sm font-medium", isBlack && "text-white/80")}>Nenhum item bipado</p>
            <p className={cn("max-w-sm px-4 text-center text-xs", isBlack && "text-white/55")}>
              Bipe no campo acima ou pressione{" "}
              <kbd
                className={cn(
                  "rounded border px-1 text-[10px] font-bold",
                  isBlack ? "border-white/20 bg-black text-white/80" : "border-[hsl(var(--pos-input-border))] bg-secondary"
                )}
              >
                F3
              </kbd>{" "}
              para pesquisar
            </p>
          </div>
        ) : (
          rows.map((item, idx) => {
            const lineTotal = item.qty * item.unitPrice
            const isHighlight = item.lineId === highlightLineId
            const isSelected = item.lineId === selectedLineId
            return (
              <button
                type="button"
                key={item.lineId}
                onClick={() => onSelect(item.lineId)}
                className={cn(
                  "grid w-full grid-cols-[56px_110px_1fr_72px_120px_88px_140px] gap-3 border-b px-4 py-2.5 text-left text-sm tabular-pdv transition-colors",
                  isBlack
                    ? cn(
                        "border-white/10 bg-[#000000] text-white",
                        isHighlight && "bg-emerald-500/15 animate-in fade-in duration-300",
                        isSelected && "ring-1 ring-inset ring-emerald-400/70",
                        "hover:bg-emerald-500/10"
                      )
                    : cn(
                        "border-[hsl(var(--pos-divider))] text-foreground",
                        idx % 2 === 0 ? "bg-pos-row" : "bg-pos-row-alt",
                        isHighlight && "bg-pos-row-highlight animate-in fade-in duration-300",
                        isSelected && "ring-1 ring-inset ring-[hsl(var(--pos-input-focus))]",
                        "hover:bg-pos-row-highlight/60"
                      )
                )}
              >
                <div className={cn("font-mono", isBlack ? "text-white/45" : "text-pos-label")}>{String(idx + 1).padStart(3, "0")}</div>
                <div className={cn("font-mono", isBlack ? "text-white" : "text-foreground")}>{item.code}</div>
                <div className="min-w-0">
                  <div className="truncate font-medium">{item.description}</div>
                  {item.detail ? (
                    <div
                      className={cn(
                        "mt-0.5 truncate font-mono text-[10px] leading-snug",
                        isBlack ? "text-cyan-200/80" : "text-slate-600"
                      )}
                      title={item.detail}
                    >
                      {item.detail}
                    </div>
                  ) : null}
                </div>
                <div className={isBlack ? "text-white/45" : "text-pos-label"}>{item.unit}</div>
                <div className="text-right">R$ {fmt(item.unitPrice)}</div>
                <div className="text-right font-medium">{fmt(item.qty)}</div>
                <div className="text-right font-semibold">R$ {fmt(lineTotal)}</div>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}

export type PdvOmniClassicShellProps = {
  storeName: string
  cartRows: PdvOmniCartRow[]
  highlightLineId: string | null
  selectedLineId: string | null
  onSelectLine: (lineId: string) => void
  total: number
  itemCount: number
  previousSaleTotal: number | null
  bipeCode: string
  onBipeChange: (v: string) => void
  bipeRef: React.RefObject<HTMLInputElement | null>
  onBipeKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void
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
  qtyEditOpen: boolean
  onQtyEditOpenChange: (open: boolean) => void
  qtyEditDefault: string
  onQtyEditConfirm: (raw: string) => void
  cancelSaleOpen: boolean
  onCancelSaleOpenChange: (open: boolean) => void
  onConfirmCancelSale: () => void
  advancedOpen: boolean
  onAdvancedOpenChange: (open: boolean) => void
  receivablesOpen: boolean
  onReceivablesOpenChange: (open: boolean) => void
  onOpenReceivablesModule: () => void
  onAddProductFromSearch: (product: PdvCatalogProduct) => void
}

export function PdvOmniClassicShell(props: PdvOmniClassicShellProps) {
  const qtyEditRef = useRef<HTMLInputElement>(null)
  const now = new Date().toLocaleString("pt-BR")
  const { mode: studioMode } = useStudioTheme()
  const isBlack = studioMode === "black"
  const fieldTone = isBlack ? ("black" as const) : ("classic" as const)

  useEffect(() => {
    if (!props.qtyEditOpen) return
    const id = window.requestAnimationFrame(() => {
      qtyEditRef.current?.focus()
      qtyEditRef.current?.select?.()
    })
    return () => window.cancelAnimationFrame(id)
  }, [props.qtyEditOpen])

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col transition-colors duration-300",
        isBlack ? "bg-[#000000] text-white" : "bg-slate-50 text-foreground"
      )}
    >
      <header
        className={cn(
          "flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 shadow-pos sm:px-4",
          isBlack ? "border-white/10 bg-[#000000]" : "border-slate-200/90 bg-slate-50"
        )}
      >
        <div className="flex min-w-0 items-center gap-3 md:gap-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <Zap className="h-5 w-5" />
          </div>
          <div className={cn("hidden h-8 w-px md:block", isBlack ? "bg-white/15" : "bg-[hsl(var(--pos-divider))]")} />
          <div className="hidden min-w-0 flex-col leading-tight md:flex">
            <span className={cn("text-[11px] uppercase tracking-wider", isBlack ? "text-white/50" : "text-pos-label")}>
              Estabelecimento
            </span>
            <span className={cn("truncate text-sm font-medium", isBlack ? "text-white" : "text-foreground")}>{props.storeName}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span
            className={cn(
              "hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium md:inline-flex",
              isBlack ? "bg-emerald-500/15 text-emerald-300" : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            )}
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" /> Online
          </span>
          <span className={cn("hidden items-center gap-1.5 text-xs md:inline-flex", isBlack ? "text-white/50" : "text-pos-label")}>
            <Wifi className="h-3.5 w-3.5" /> Conexão estável
          </span>
          <span className={cn("text-xs tabular-pdv", isBlack ? "text-white/45" : "text-pos-label")}>{now}</span>
        </div>
      </header>

      <section
        className={cn(
          "grid grid-cols-12 gap-3 border-b px-3 py-3 sm:px-4",
          isBlack ? "border-white/10 bg-[#000000]" : "border-slate-200/90 bg-white"
        )}
      >
        <PosField
          ref={props.bipeRef}
          tone={fieldTone}
          fieldClassName="col-span-12 md:col-span-4"
          label="Código / Bipe"
          hint="ENTER"
          icon={<Barcode className="h-4 w-4" />}
          value={props.bipeCode}
          onChange={(e) => props.onBipeChange(e.target.value)}
          onKeyDown={props.onBipeKeyDown}
          placeholder="Bipe ou digite o código do produto"
          autoComplete="off"
        />
        <PosField
          tone={fieldTone}
          fieldClassName="col-span-6 md:col-span-3"
          label="Cliente"
          hint="F2"
          icon={<User2 className="h-4 w-4" />}
          value={props.customerDisplay}
          onChange={(e) => props.onCustomerDisplayChange(e.target.value)}
        />
        <PosField
          tone={fieldTone}
          fieldClassName="col-span-3 md:col-span-2"
          label="Quantidade"
          hint="F4"
          icon={<Hash className="h-4 w-4" />}
          value={props.nextQtyStr}
          onChange={(e) => props.onNextQtyStrChange(e.target.value)}
          inputMode="decimal"
        />
        <PosField
          tone={fieldTone}
          fieldClassName="col-span-3 md:col-span-3"
          label="Vendedor"
          icon={<UserCog className="h-4 w-4" />}
          value={props.seller}
          onChange={(e) => props.onSellerChange(e.target.value)}
        />
      </section>

      <main className={cn("grid min-h-0 flex-1 grid-cols-12 gap-3 overflow-hidden p-2 sm:p-3", isBlack ? "bg-[#000000]" : "bg-slate-50")}>
        <div className="col-span-12 flex min-h-0 flex-col overflow-hidden lg:col-span-9">
          <ItemsTable
            rows={props.cartRows}
            highlightLineId={props.highlightLineId}
            selectedLineId={props.selectedLineId}
            onSelect={props.onSelectLine}
            isBlack={isBlack}
          />
        </div>
        <aside className="col-span-12 flex min-h-0 flex-col gap-3 overflow-y-auto lg:col-span-3">
          <div
            className={cn(
              "rounded-md border p-4 shadow-pos",
              isBlack ? "border-white/10 bg-[#000000]" : "border-slate-200/90 bg-white"
            )}
          >
            <div className="flex items-center justify-between">
              <span className={cn("text-[11px] font-medium uppercase tracking-wider", isBlack ? "text-white/50" : "text-pos-label")}>
                Total da Venda
              </span>
              <Calculator className={cn("h-4 w-4", isBlack ? "text-white/45" : "text-pos-label")} />
            </div>
            <div
              className={cn(
                "mt-2 text-[clamp(1.75rem,5vw,2.5rem)] font-semibold leading-none tracking-tight tabular-pdv",
                isBlack ? "text-emerald-400" : "text-pos-total"
              )}
            >
              R$ {fmt(props.total)}
            </div>
            <div className={cn("mt-3 grid grid-cols-2 gap-2 border-t pt-3 text-xs", isBlack ? "border-white/10" : "pos-divider")}>
              <div>
                <div className={isBlack ? "text-white/45" : "text-pos-label"}>Nº de itens</div>
                <div className={cn("font-semibold tabular-pdv", isBlack ? "text-white" : "text-foreground")}>{props.itemCount}</div>
              </div>
              <div className="text-right">
                <div className={isBlack ? "text-white/45" : "text-pos-label"}>Venda anterior</div>
                <div className={cn("font-semibold tabular-pdv", isBlack ? "text-white" : "text-foreground")}>
                  {props.previousSaleTotal != null ? `R$ ${fmt(props.previousSaleTotal)}` : "—"}
                </div>
              </div>
              <div>
                <div className={isBlack ? "text-white/45" : "text-pos-label"}>Troco</div>
                <div className={cn("font-semibold tabular-pdv", isBlack ? "text-white" : "text-foreground")}>R$ 0,00</div>
              </div>
              <div className="text-right">
                <div className={isBlack ? "text-white/45" : "text-pos-label"}>Sem desc.</div>
                <div className={cn("font-semibold tabular-pdv", isBlack ? "text-white" : "text-foreground")}>R$ {fmt(props.total)}</div>
              </div>
            </div>
            <Button
              type="button"
              onClick={() => props.onShortcutAction("F1")}
              className="mt-4 w-full gap-2 bg-emerald-600 font-semibold text-white hover:bg-emerald-500 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
            >
              <Receipt className="h-4 w-4" />
              Finalizar (F1)
              <ChevronRight className="ml-auto h-4 w-4" />
            </Button>
          </div>
          <div
            className={cn(
              "rounded-md border p-4 shadow-pos",
              isBlack ? "border-white/10 bg-[#000000]" : "border-slate-200/90 bg-white"
            )}
          >
            <div className={cn("text-[11px] font-medium uppercase tracking-wider", isBlack ? "text-white/50" : "text-pos-label")}>Informativo</div>
            <p className={cn("mt-2 text-sm leading-relaxed", isBlack ? "text-white/85" : "text-foreground")}>{props.info}</p>
          </div>
          <div
            className={cn(
              "rounded-md border p-3 text-[11px]",
              isBlack ? "border-white/10 bg-[#000000] text-white/50" : "pos-divider bg-pos-header text-pos-label"
            )}
          >
            <div className="flex justify-between">
              <span>Caixa</span>
              <span className={cn("font-medium", isBlack ? "text-white" : "text-foreground")}>PDV</span>
            </div>
            <div className="flex justify-between">
              <span>Atalhos</span>
              <span className={cn("font-medium", isBlack ? "text-white" : "text-foreground")}>F1–F9</span>
            </div>
          </div>
        </aside>
      </main>

      <ShortcutBar onAction={props.onShortcutAction} isBlack={isBlack} />

      <Dialog open={props.productSearchOpen} onOpenChange={props.onProductSearchOpenChange}>
        <DialogContent className="max-w-lg border-border bg-card">
          <DialogHeader>
            <DialogTitle>Pesquisar Produto (F3)</DialogTitle>
            <DialogDescription>Selecione um produto para adicionar à venda.</DialogDescription>
          </DialogHeader>
          <div className="max-h-72 overflow-y-auto rounded-md border border-border">
            {props.products.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  props.onProductSearchOpenChange(false)
                  props.onAddProductFromSearch(p)
                }}
                className="grid w-full grid-cols-[100px_1fr_70px_100px] gap-2 border-b border-border px-3 py-2 text-left text-sm hover:bg-muted/60"
              >
                <span className="font-mono text-muted-foreground">{p.barcode || p.id}</span>
                <span className="truncate text-foreground">{p.name}</span>
                <span className="text-muted-foreground">{p.vendaPorPeso ? "KG" : "UN"}</span>
                <span className="text-right font-semibold tabular-pdv text-foreground">
                  {p.vendaPorPeso ? `R$ ${fmt(p.precoPorKg ?? p.price)}/kg` : `R$ ${fmt(p.price)}`}
                </span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={props.clientSearchOpen} onOpenChange={props.onClientSearchOpenChange}>
        <DialogContent className="max-w-md border-border bg-card">
          <DialogHeader>
            <DialogTitle>Pesquisar Cliente (F2)</DialogTitle>
            <DialogDescription>Identifique o cliente desta venda.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {props.clientOptions.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  props.onPickClient(c.label)
                  props.onClientSearchOpenChange(false)
                }}
                className="flex w-full items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-left text-sm hover:border-primary/40"
              >
                <span className="font-medium text-foreground">{c.label}</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={props.qtyEditOpen} onOpenChange={props.onQtyEditOpenChange}>
        <DialogContent className="max-w-sm border-border bg-card">
          <DialogHeader>
            <DialogTitle>Alterar Quantidade (F4)</DialogTitle>
            <DialogDescription>Defina a nova quantidade para o item selecionado.</DialogDescription>
          </DialogHeader>
          <input
            key={props.qtyEditDefault}
            ref={qtyEditRef}
            defaultValue={props.qtyEditDefault}
            inputMode="decimal"
            className="tabular-pdv h-11 w-full rounded-md border border-[hsl(var(--pos-input-border))] bg-[hsl(var(--pos-input))] px-3 text-2xl font-semibold outline-none focus:border-[hsl(var(--pos-input-focus))]"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => props.onQtyEditOpenChange(false)}>
              Voltar
            </Button>
            <Button
              type="button"
              className="bg-emerald-600 text-white hover:bg-emerald-500"
              onClick={() => props.onQtyEditConfirm(qtyEditRef.current?.value ?? "1")}
            >
              Aplicar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={props.cancelSaleOpen} onOpenChange={props.onCancelSaleOpenChange}>
        <DialogContent className="max-w-md border-border bg-card">
          <DialogHeader>
            <DialogTitle>Cancelar Venda (F6)</DialogTitle>
            <DialogDescription>Todos os itens serão removidos. Confirme para limpar o cupom.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => props.onCancelSaleOpenChange(false)}>
              Voltar
            </Button>
            <Button type="button" variant="destructive" onClick={props.onConfirmCancelSale}>
              Cancelar venda
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={props.receivablesOpen} onOpenChange={props.onReceivablesOpenChange}>
        <DialogContent className="max-w-md border-border bg-card">
          <DialogHeader>
            <DialogTitle>Contas a Receber (F9)</DialogTitle>
            <DialogDescription>Abra o módulo financeiro para títulos e recebimentos.</DialogDescription>
          </DialogHeader>
          <Button type="button" className="w-full" onClick={props.onOpenReceivablesModule}>
            Ir para Contas a Receber
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog open={props.advancedOpen} onOpenChange={props.onAdvancedOpenChange}>
        <DialogContent className="max-w-md border-border bg-card">
          <DialogHeader>
            <DialogTitle>Funções avançadas (CTRL)</DialogTitle>
            <DialogDescription>Atalhos adicionais do caixa.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            {["Orçamentos", "Trocas", "Devoluções", "Sangria", "Suprimento", "Reimprimir"].map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => props.onAdvancedOpenChange(false)}
                className="rounded-md border border-border bg-background px-3 py-3 text-sm font-medium text-foreground hover:bg-muted/60"
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
