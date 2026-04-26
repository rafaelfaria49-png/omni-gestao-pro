"use client"

import type { KeyboardEvent } from "react"
import { Barcode, Sparkles, Zap } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { PdvCatalogProduct } from "@/lib/pdv-catalog"
import type { PdvOmniCartRow } from "./pdv-omni-classic-shell"

const fmt = (n: number) =>
  n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export type PdvNeonShellProps = {
  storeName: string
  products: PdvCatalogProduct[]
  cartRows: PdvOmniCartRow[]
  selectedLineId: string | null
  onSelectLine: (lineId: string) => void
  total: number
  itemCount: number
  bipeCode: string
  onBipeChange: (v: string) => void
  bipeRef: React.RefObject<HTMLInputElement | null>
  onBipeKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void
  onAddProduct: (p: PdvCatalogProduct) => void
  onFinalize: () => void
  onOpenProductSearch: () => void
  onOpenClientSearch: () => void
}

export function PdvNeonShell(props: PdvNeonShellProps) {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-black text-white transition-colors duration-300">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-[20%] -top-[30%] h-[55%] w-[50%] rounded-full bg-fuchsia-600/20 blur-[120px]" />
        <div className="absolute -right-[15%] top-[10%] h-[45%] w-[45%] rounded-full bg-cyan-500/15 blur-[100px]" />
        <div className="absolute bottom-[-20%] left-[15%] h-[50%] w-[55%] rounded-full bg-violet-600/12 blur-[130px]" />
      </div>

      <header className="relative z-10 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-white/5 px-4 py-3 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-fuchsia-500/40 bg-gradient-to-br from-fuchsia-600/40 to-cyan-500/30 shadow-[0_0_28px_rgba(217,70,239,0.35)]">
            <Zap className="h-5 w-5 text-fuchsia-200" />
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/50">PDV Neon</p>
            <p className="text-sm font-semibold tracking-tight text-white">{props.storeName}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            className="bg-gradient-to-r from-fuchsia-600 to-cyan-500 font-semibold text-white shadow-[0_0_24px_rgba(217,70,239,0.4)]"
            onClick={props.onFinalize}
          >
            Finalizar
          </Button>
        </div>
      </header>

      <div className="relative z-10 grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 lg:grid-cols-[1fr_min(420px,40vw)]">
        <div className="flex min-h-0 flex-col gap-3 overflow-hidden">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-white/45">Código / Bipe</label>
            <div className="relative mt-1.5">
              <Barcode className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-white/35" />
              <input
                ref={props.bipeRef}
                value={props.bipeCode}
                onChange={(e) => props.onBipeChange(e.target.value)}
                onKeyDown={props.onBipeKeyDown}
                placeholder="Bipe ou digite…"
                autoComplete="off"
                className="h-12 w-full rounded-xl border border-white/10 bg-black/40 pl-11 pr-3 text-base text-white outline-none ring-0 placeholder:text-white/30 focus:border-cyan-400/50 focus:shadow-[0_0_0_3px_rgba(34,211,238,0.15)]"
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="border-white/10 bg-white/5 text-xs text-white/80 hover:bg-white/10"
                onClick={props.onOpenClientSearch}
              >
                F2 Cliente
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="border-white/10 bg-white/5 text-xs text-white/80 hover:bg-white/10"
                onClick={props.onOpenProductSearch}
              >
                F3 Produtos
              </Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-white/10 bg-white/[0.04] p-2 backdrop-blur-xl [scrollbar-gutter:stable]">
            <div className="mb-2 flex items-center gap-2 px-1">
              <Sparkles className="h-4 w-4 text-fuchsia-300" />
              <span className="text-xs font-semibold uppercase tracking-wider text-white/55">Grade touch</span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
              {props.products.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => props.onAddProduct(product)}
                  className={cn(
                    "group flex min-h-[108px] flex-col justify-between rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.08] to-black/40 p-3 text-left shadow-[0_0_0_1px_rgba(255,255,255,0.04)_inset] transition-all duration-300",
                    "hover:-translate-y-0.5 hover:border-cyan-400/35 hover:shadow-[0_0_32px_rgba(34,211,238,0.12)]"
                  )}
                >
                  <span className="line-clamp-2 text-sm font-semibold leading-snug text-white">{product.name}</span>
                  <div className="mt-2 flex items-end justify-between gap-1 border-t border-white/5 pt-2">
                    <span className="text-sm font-bold tabular-nums text-cyan-300">
                      {product.vendaPorPeso ? `${fmt(product.precoPorKg ?? product.price)}/kg` : fmt(product.price)}
                    </span>
                    <Badge
                      variant="secondary"
                      className="border-white/10 bg-black/50 text-[10px] text-white/70"
                    >
                      {product.vendaPorPeso ? `${product.stock} kg` : `${product.stock} un`}
                    </Badge>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        <aside className="flex min-h-0 flex-col gap-3 overflow-hidden">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-xl">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-white/45">Total</p>
            <p className="mt-1 text-3xl font-bold tabular-nums text-transparent bg-clip-text bg-gradient-to-r from-fuchsia-300 to-cyan-300">
              R$ {fmt(props.total)}
            </p>
            <p className="mt-1 text-xs text-white/50">{props.itemCount} itens</p>
            <Button
              type="button"
              className="mt-4 w-full bg-gradient-to-r from-fuchsia-600 to-pink-500 font-semibold text-white shadow-[0_0_28px_rgba(236,72,153,0.35)]"
              onClick={props.onFinalize}
            >
              Finalizar (F1)
            </Button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/50 backdrop-blur-xl">
            <div className="border-b border-white/10 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-white/50">
              Cupom
            </div>
            <div className="min-h-0 flex-1 divide-y divide-white/10 overflow-y-auto">
              {props.cartRows.length === 0 ? (
                <p className="p-4 text-center text-sm text-white/45">Toque nos produtos ou bipe</p>
              ) : (
                props.cartRows.map((row) => (
                  <button
                    key={row.lineId}
                    type="button"
                    onClick={() => props.onSelectLine(row.lineId)}
                    className={cn(
                      "flex w-full flex-col gap-0.5 px-3 py-2.5 text-left text-sm transition-colors",
                      row.lineId === props.selectedLineId ? "bg-cyan-500/15" : "hover:bg-white/5"
                    )}
                  >
                    <span className="font-medium text-white">{row.description}</span>
                    {row.detail ? (
                      <span className="line-clamp-2 text-[10px] leading-snug text-cyan-200/85">{row.detail}</span>
                    ) : null}
                    <span className="text-xs tabular-nums text-white/55">
                      {row.qty} × R$ {fmt(row.unitPrice)} = R$ {fmt(row.qty * row.unitPrice)}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
