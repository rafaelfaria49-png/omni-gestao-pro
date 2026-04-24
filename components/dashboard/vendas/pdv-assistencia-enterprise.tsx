"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  Barcode,
  Banknote,
  CreditCard,
  CircleDot,
  Clock,
  Trash2,
  QrCode,
  User,
  Wrench,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

type QuickItem = {
  id: string
  kind: "servico" | "produto"
  title: string
  price: number
  hint?: string
}

type CartLine = {
  id: string
  title: string
  price: number
  qty: number
}

const QUICK_SERVICOS: QuickItem[] = [
  { id: "svc_tela", kind: "servico", title: "Troca de Tela", price: 350, hint: "iPhone / Android" },
  { id: "svc_limpeza", kind: "servico", title: "Limpeza Técnica", price: 90, hint: "Preventiva" },
  { id: "svc_software", kind: "servico", title: "Software / Desbloqueio", price: 120, hint: "Flash / Reset" },
  { id: "svc_conector", kind: "servico", title: "Conector de Carga", price: 150, hint: "Troca / Reparo" },
]

const QUICK_PRODUTOS: QuickItem[] = [
  { id: "prd_capinha", kind: "produto", title: "Capinha Anti-impacto", price: 40, hint: "Acessório" },
  { id: "prd_pelicula", kind: "produto", title: "Película 3D / Vidro", price: 25, hint: "Aplicação" },
  { id: "prd_cabo", kind: "produto", title: "Carregador / Cabo", price: 45, hint: "Turbo / USB-C" },
  { id: "prd_fone", kind: "produto", title: "Fone Bluetooth", price: 79.9, hint: "TWS" },
]

function brl(n: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n)
}

function newLineId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

export function PdvAssistenciaEnterprise() {
  const inputRef = useRef<HTMLInputElement | null>(null)

  const [now, setNow] = useState(() => new Date())
  const [operatorName] = useState("Operador")
  const [search, setSearch] = useState("")
  const [tab, setTab] = useState<"servicos" | "produtos">("servicos")
  const [cart, setCart] = useState<CartLine[]>([])
  const [discount, setDiscount] = useState(0)

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(t)
  }, [])

  // Atalhos: F1 foco busca, F2/F3/F4 "pagamento"
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === "F1") {
        e.preventDefault()
        inputRef.current?.focus()
        return
      }
      if (e.key !== "F2" && e.key !== "F3" && e.key !== "F4") return
      if (cart.length === 0) return
      e.preventDefault()
      // visual-only: aqui seria abrir fluxo de pagamento
    }
    window.addEventListener("keydown", onKeyDown, { capture: true })
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true } as any)
  }, [cart.length])

  const subtotal = useMemo(() => cart.reduce((s, l) => s + l.price * l.qty, 0), [cart])
  const desconto = useMemo(() => Math.min(Math.max(0, discount), subtotal), [discount, subtotal])
  const total = useMemo(() => Math.max(0, subtotal - desconto), [subtotal, desconto])

  const quickList = tab === "servicos" ? QUICK_SERVICOS : QUICK_PRODUTOS
  const filteredQuick = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return quickList
    return quickList.filter((i) => i.title.toLowerCase().includes(term) || (i.hint ?? "").toLowerCase().includes(term))
  }, [quickList, search])

  const addQuick = (q: QuickItem) => {
    setCart((prev) => {
      const hit = prev.find((l) => l.title === q.title && Math.abs(l.price - q.price) < 0.0001)
      if (hit) return prev.map((l) => (l.id === hit.id ? { ...l, qty: l.qty + 1 } : l))
      return [...prev, { id: newLineId(), title: q.title, price: q.price, qty: 1 }]
    })
    queueMicrotask(() => inputRef.current?.focus())
  }

  const removeLine = (id: string) => setCart((prev) => prev.filter((l) => l.id !== id))

  return (
    <div className="relative flex h-[calc(100vh-4rem)] w-full overflow-hidden bg-slate-950 text-slate-100">
      {/* Glows de fundo */}
      <div className="pointer-events-none absolute -left-[10%] -top-[10%] h-[40%] w-[40%] rounded-full bg-violet-500/20 blur-[140px]" />
      <div className="pointer-events-none absolute -bottom-[10%] -right-[10%] h-[40%] w-[40%] rounded-full bg-blue-500/20 blur-[140px]" />

      {/* Header */}
      <header className="relative z-10 flex h-16 w-full items-center justify-between border-b border-white/10 bg-slate-950/40 px-4 backdrop-blur-2xl">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-primary via-primary/70 to-sky-500/40 shadow-lg shadow-primary/25">
            <Wrench className="h-5 w-5 text-white" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-bold tracking-tight text-white">OmniGestão Pro - PDV</div>
            <div className="text-xs text-slate-400">Alta Performance · Assistência Técnica</div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 backdrop-blur">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
            </span>
            <span className="text-xs font-semibold text-emerald-300">Caixa Aberto</span>
          </div>

          <div className="hidden sm:flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 backdrop-blur">
            <User className="h-4 w-4 text-slate-300" />
            <span className="text-xs text-slate-200">
              Operador: <span className="font-semibold text-white">{operatorName}</span>
            </span>
          </div>

          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 backdrop-blur">
            <Clock className="h-4 w-4 text-slate-300" />
            <span className="text-xs font-semibold tabular-nums text-white">
              {now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          </div>
        </div>
      </header>

      {/* Corpo */}
      <div className="relative z-10 flex min-h-0 flex-1 overflow-hidden">
        {/* Centro: busca + catálogo */}
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden border-r border-white/10 bg-slate-950/20 backdrop-blur-xl">
          <div className="shrink-0 p-4">
            <div className="relative">
              <Barcode className="pointer-events-none absolute left-4 top-1/2 h-6 w-6 -translate-y-1/2 text-slate-400" />
              <Input
                ref={inputRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Bipe o produto ou busque por nome/serviço (F1)"
                className="h-16 rounded-2xl border-white/10 bg-white/5 pl-14 text-lg font-semibold text-white placeholder:text-slate-400 backdrop-blur focus-visible:ring-2 focus-visible:ring-primary/40"
              />
            </div>
            <div className="mt-3 flex items-center gap-3 text-xs text-slate-400">
              <div className="flex items-center gap-2">
                <CircleDot className="h-4 w-4 text-primary" />
                <span>Dica: use F1 para focar na busca.</span>
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden px-4 pb-4">
            <Tabs value={tab} onValueChange={(v) => setTab(v === "produtos" ? "produtos" : "servicos")}>
              <TabsList className="grid w-full grid-cols-2 rounded-2xl border border-white/10 bg-white/5 p-1 backdrop-blur">
                <TabsTrigger value="servicos" className="rounded-xl data-[state=active]:bg-primary/20 data-[state=active]:text-white">
                  Serviços
                </TabsTrigger>
                <TabsTrigger value="produtos" className="rounded-xl data-[state=active]:bg-primary/20 data-[state=active]:text-white">
                  Produtos
                </TabsTrigger>
              </TabsList>

              <TabsContent value="servicos" className="mt-4 min-h-0">
                <ScrollArea className="h-[calc(100vh-4rem-16rem)] min-h-0">
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {filteredQuick.map((q) => (
                      <Card
                        key={q.id}
                        className="group cursor-pointer rounded-2xl border border-white/10 bg-white/5 p-4 shadow-lg shadow-black/20 backdrop-blur transition hover:border-primary/30 hover:bg-white/10"
                        onClick={() => addQuick(q)}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-bold text-white">{q.title}</div>
                            {q.hint ? <div className="mt-1 text-xs text-slate-400">{q.hint}</div> : null}
                          </div>
                          <div className="rounded-xl border border-white/10 bg-slate-950/40 px-3 py-1 text-xs font-semibold text-slate-200">
                            {brl(q.price)}
                          </div>
                        </div>
                        <div className="mt-4 flex items-center justify-between">
                          <div className="text-xs text-slate-400">Clique para adicionar</div>
                          <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-primary/30 to-sky-500/20 opacity-0 blur-[0px] transition group-hover:opacity-100" />
                        </div>
                      </Card>
                    ))}
                  </div>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="produtos" className="mt-4 min-h-0">
                <ScrollArea className="h-[calc(100vh-4rem-16rem)] min-h-0">
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {filteredQuick.map((q) => (
                      <Card
                        key={q.id}
                        className="group cursor-pointer rounded-2xl border border-white/10 bg-white/5 p-4 shadow-lg shadow-black/20 backdrop-blur transition hover:border-primary/30 hover:bg-white/10"
                        onClick={() => addQuick(q)}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-bold text-white">{q.title}</div>
                            {q.hint ? <div className="mt-1 text-xs text-slate-400">{q.hint}</div> : null}
                          </div>
                          <div className="rounded-xl border border-white/10 bg-slate-950/40 px-3 py-1 text-xs font-semibold text-slate-200">
                            {brl(q.price)}
                          </div>
                        </div>
                        <div className="mt-4 flex items-center justify-between">
                          <div className="text-xs text-slate-400">Clique para adicionar</div>
                          <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-primary/30 to-sky-500/20 opacity-0 blur-[0px] transition group-hover:opacity-100" />
                        </div>
                      </Card>
                    ))}
                  </div>
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </div>
        </main>

        {/* Direita: carrinho */}
        <aside className="flex h-full w-[520px] min-w-[520px] flex-col overflow-hidden bg-slate-950/35 backdrop-blur-2xl">
          <div className="shrink-0 border-b border-white/10 px-4 py-4">
            <div className="flex items-center justify-between">
              <div className="text-lg font-extrabold tracking-tight text-white">Carrinho</div>
              <Button
                type="button"
                variant="outline"
                className="h-10 rounded-xl border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
                onClick={() => setCart([])}
                disabled={cart.length === 0}
              >
                Limpar
              </Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden">
            {cart.length === 0 ? (
              <div className="flex h-full items-center justify-center p-8 text-center">
                <div className="max-w-sm space-y-2">
                  <div className="text-lg font-semibold text-white">Sem itens</div>
                  <div className="text-sm text-slate-400">Adicione serviços ou produtos pelos atalhos à esquerda.</div>
                </div>
              </div>
            ) : (
              <ScrollArea className="h-full">
                <div className="divide-y divide-white/10 px-3 py-2">
                  {cart.map((l) => (
                    <div key={l.id} className="flex items-center gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-white">{l.title}</div>
                        <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                          <span>{brl(l.price)}</span>
                          <span>×</span>
                          <span className="font-semibold text-slate-200">{l.qty}</span>
                        </div>
                      </div>
                      <div className="w-28 text-right text-sm font-bold tabular-nums text-white">{brl(l.price * l.qty)}</div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10 rounded-xl text-red-400 hover:bg-red-500/10 hover:text-red-300"
                        onClick={() => removeLine(l.id)}
                      >
                        <Trash2 className="h-5 w-5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>

          <div className="shrink-0 border-t border-white/10 bg-slate-950/40 p-4 backdrop-blur-xl">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm text-slate-300">
                <span>Subtotal</span>
                <span className="font-semibold tabular-nums text-white">{brl(subtotal)}</span>
              </div>

              <div className="flex items-center justify-between text-sm text-slate-300">
                <span>Desconto</span>
                <div className="flex items-center gap-2">
                  <Input
                    value={discount ? String(discount) : ""}
                    onChange={(e) => {
                      const v = Number(String(e.target.value || "").replace(",", "."))
                      setDiscount(Number.isFinite(v) ? v : 0)
                    }}
                    placeholder="0"
                    className="h-9 w-28 rounded-xl border-white/10 bg-white/5 text-right text-sm text-white placeholder:text-slate-500"
                    inputMode="decimal"
                  />
                  <span className="w-20 text-right font-semibold tabular-nums text-white">− {brl(desconto)}</span>
                </div>
              </div>

              <Separator className="bg-white/10" />

              <div className="flex items-baseline justify-between">
                <span className="text-sm font-semibold text-slate-300">Total a Pagar</span>
                <span className="text-3xl font-black tabular-nums tracking-tight text-emerald-400">{brl(total)}</span>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              <Button
                type="button"
                className={cn(
                  "h-14 rounded-2xl bg-emerald-600 text-base font-black text-white shadow-lg shadow-emerald-600/20 hover:bg-emerald-700",
                  cart.length === 0 && "opacity-50 pointer-events-none"
                )}
              >
                <Banknote className="mr-2 h-5 w-5" />
                Dinheiro <span className="ml-2 text-xs font-black opacity-90">[F2]</span>
              </Button>
              <Button
                type="button"
                className={cn(
                  "h-14 rounded-2xl bg-teal-600 text-base font-black text-white shadow-lg shadow-teal-600/20 hover:bg-teal-700",
                  cart.length === 0 && "opacity-50 pointer-events-none"
                )}
              >
                <QrCode className="mr-2 h-5 w-5" />
                PIX <span className="ml-2 text-xs font-black opacity-90">[F3]</span>
              </Button>
              <Button
                type="button"
                className={cn(
                  "h-14 rounded-2xl bg-blue-600 text-base font-black text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700",
                  cart.length === 0 && "opacity-50 pointer-events-none"
                )}
              >
                <CreditCard className="mr-2 h-5 w-5" />
                Cartão <span className="ml-2 text-xs font-black opacity-90">[F4]</span>
              </Button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

