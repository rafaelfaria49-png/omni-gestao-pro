"use client"

import Link from "next/link"
import {
  AlertTriangle,
  Banknote,
  ClipboardList,
  ShoppingCart,
  TrendingUp,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { ASSISTEC_LOJA_HEADER } from "@/lib/assistec-headers"
import { resolveLojaIdParaConsultaClientes } from "@/lib/clientes-loja-resolve"
import { useLojaAtiva } from "@/lib/loja-ativa"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Button } from "@/components/ui/button"

export default function DashboardInicioPage() {
  const { lojaAtivaId, lojas } = useLojaAtiva()
  const lojaHeader = useMemo(() => resolveLojaIdParaConsultaClientes(lojaAtivaId), [lojaAtivaId])
  const lojaNome = useMemo(() => {
    const id = (lojaAtivaId || "").trim()
    const hit = id ? lojas.find((l) => l.id === id) : null
    return (hit?.nomeFantasia || "").trim() || "sua loja"
  }, [lojaAtivaId, lojas])

  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [cards, setCards] = useState({
    faturamentoHoje: 0,
    osEmAberto: 0,
    alertaEstoqueCount: 0,
    contasReceberHoje: 0,
  })
  const [faturamento7d, setFaturamento7d] = useState<Array<{ day: string; total: number }>>([])
  const [movimentos, setMovimentos] = useState<
    Array<{ kind: "venda" | "os"; id: string; label: string; value: number; at: string }>
  >([])
  const [estoqueCritico, setEstoqueCritico] = useState<Array<{ id: string; name: string; stock: number }>>([])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        setLoading(true)
        const r = await fetch(`/api/dashboard/elite?storeId=${encodeURIComponent(lojaHeader)}`, {
          cache: "no-store",
          credentials: "include",
          headers: { [ASSISTEC_LOJA_HEADER]: lojaHeader },
        })
        const j = (await r.json().catch(() => null)) as any
        if (cancelled) return
        if (!r.ok || !j?.ok) throw new Error(String(j?.error || "Falha ao carregar dashboard"))

        setErr(null)
        setCards({
          faturamentoHoje: Number(j.cards?.faturamentoHoje || 0),
          osEmAberto: Number(j.cards?.osEmAberto || 0),
          alertaEstoqueCount: Number(j.cards?.alertaEstoqueCount || 0),
          contasReceberHoje: Number(j.cards?.contasReceberHoje || 0),
        })
        setFaturamento7d(Array.isArray(j.faturamento7d) ? j.faturamento7d : [])
        setMovimentos(Array.isArray(j.movimentos) ? j.movimentos : [])
        setEstoqueCritico(Array.isArray(j.estoqueCritico) ? j.estoqueCritico : [])
      } catch {
        if (!cancelled) {
          setErr("Falha ao carregar dashboard")
          setCards({ faturamentoHoje: 0, osEmAberto: 0, alertaEstoqueCount: 0, contasReceberHoje: 0 })
          setFaturamento7d([])
          setMovimentos([])
          setEstoqueCritico([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [lojaHeader])

  const brl = useMemo(
    () => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }),
    []
  )

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-background p-4 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">
            Olá, <span className="text-primary">Administrador</span>! Veja como está a{" "}
            <span className="text-primary">{lojaNome}</span> hoje.
          </h1>
          <p className="text-sm text-muted-foreground">Dashboard de alto nível (por unidade ativa).</p>
          {err ? (
            <p className="mt-2 text-sm text-destructive">{err}</p>
          ) : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Faturamento hoje</CardTitle>
              <TrendingUp className="h-5 w-5 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-black tabular-nums text-foreground">
                {loading ? "—" : brl.format(cards.faturamentoHoje)}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Total de vendas registradas hoje.</p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">OS em aberto</CardTitle>
              <ClipboardList className="h-5 w-5 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-black tabular-nums text-foreground">
                {loading ? "—" : cards.osEmAberto}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Aberto + Em análise.</p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Alerta de estoque</CardTitle>
              <AlertTriangle className="h-5 w-5 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-black tabular-nums text-foreground">
                {loading ? "—" : cards.alertaEstoqueCount}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Itens com estoque zerado.</p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Contas a receber (hoje)</CardTitle>
              <Banknote className="h-5 w-5 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-black tabular-nums text-foreground">
                {loading ? "—" : brl.format(cards.contasReceberHoje)}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Vencimentos pendentes para hoje.</p>
            </CardContent>
          </Card>
        </div>

        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShoppingCart className="h-4 w-4 text-primary" />
              Faturamento dos últimos 7 dias
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={faturamento7d} margin={{ left: 8, right: 8, top: 10, bottom: 0 }}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="4 4" />
                <XAxis
                  dataKey="day"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                  tickFormatter={(v) => String(v).slice(5)}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                  tickFormatter={(v) => `${Number(v) / 1000}k`}
                />
                <Tooltip
                  cursor={{ stroke: "hsl(var(--primary))", strokeWidth: 1 }}
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 12,
                    color: "hsl(var(--foreground))",
                  }}
                  formatter={(value: any) => brl.format(Number(value || 0))}
                  labelFormatter={(l) => `Dia ${String(l)}`}
                />
                <Area
                  type="monotone"
                  dataKey="total"
                  stroke="var(--primary)"
                  fill="hsl(var(--primary) / 0.18)"
                  strokeWidth={2.25}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Últimas vendas/OS</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-background/60">
                    <tr className="text-left">
                      <th className="px-3 py-2 font-semibold text-foreground">Cliente</th>
                      <th className="px-3 py-2 font-semibold text-foreground">Valor</th>
                      <th className="px-3 py-2 font-semibold text-foreground">Data</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movimentos.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">
                          {loading ? "Carregando…" : "Sem movimentações recentes."}
                        </td>
                      </tr>
                    ) : (
                      movimentos.map((m) => (
                        <tr key={`${m.kind}-${m.id}`} className="border-t border-border hover:bg-muted/30">
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <span
                                className={cn(
                                  "inline-flex h-6 items-center rounded-md px-2 text-[11px] font-semibold",
                                  m.kind === "venda"
                                    ? "bg-emerald-500/15 text-emerald-600"
                                    : "bg-blue-500/15 text-blue-600"
                                )}
                              >
                                {m.kind === "venda" ? "Venda" : "OS"}
                              </span>
                              <span className="truncate font-medium text-foreground">{m.label}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2 tabular-nums font-semibold text-foreground">
                            {brl.format(m.value)}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {new Date(m.at).toLocaleString("pt-BR")}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Resumo de estoque crítico</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {estoqueCritico.length === 0 ? (
                <div className="rounded-lg border border-border bg-background/40 px-4 py-6 text-center text-sm text-muted-foreground">
                  {loading ? "Carregando…" : "Sem itens para exibir."}
                </div>
              ) : (
                <ul className="space-y-2">
                  {estoqueCritico.map((p) => (
                    <li
                      key={p.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background/40 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">{p.name}</p>
                        <p className="text-xs text-muted-foreground">
                          Estoque atual: <span className="font-semibold tabular-nums">{p.stock}</span>
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        asChild
                        className="shrink-0"
                      >
                        <Link href="/?page=planejamento-compras">Pedir mais</Link>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
