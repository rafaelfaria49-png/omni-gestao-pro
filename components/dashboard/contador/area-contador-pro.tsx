"use client"

import { useMemo, useState, useCallback, useEffect } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ArrowLeft,
  Download,
  FileSpreadsheet,
  LogOut,
  TrendingDown,
  TrendingUp,
  Wallet,
  Percent,
  FileCode2,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { useOperationsStore } from "@/lib/operations-store"
import {
  buildMovimentosMes,
  estimativaImposto,
  movimentosToCsv,
  movimentosToXml,
  sumCustosPecas,
  sumFaturamento,
} from "@/lib/contador-aggregates"
import { useConfigEmpresa } from "@/lib/config-empresa"

function downloadBlob(filename: string, mime: string, content: string) {
  const blob = new Blob([content], { type: mime + ";charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

const brl = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n)

export function AreaContadorPro() {
  const router = useRouter()
  const { config } = useConfigEmpresa()
  const { sales, ordens, inventory } = useOperationsStore()

  const now = new Date()
  const [period, setPeriod] = useState(() => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`)
  const [aliquotaPct, setAliquotaPct] = useState(6)
  const [subscriptionOk, setSubscriptionOk] = useState<"loading" | "ok" | "blocked">("loading")

  const [y, m] = period.split("-").map((x) => parseInt(x, 10))

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const r = await fetch("/api/subscription/verify", { credentials: "include", cache: "no-store" })
        const j = (await r.json()) as { valid?: boolean }
        if (cancelled) return
        if (j.valid === true) {
          setSubscriptionOk("ok")
        } else {
          setSubscriptionOk("blocked")
          router.replace("/meu-plano?blocked=1&renew=1")
        }
      } catch {
        if (!cancelled) setSubscriptionOk("blocked")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [router])

  const movimentos = useMemo(() => {
    if (!Number.isFinite(y) || !Number.isFinite(m)) return []
    return buildMovimentosMes(sales, ordens, inventory, y, m)
  }, [sales, ordens, inventory, y, m])

  const faturamento = useMemo(() => sumFaturamento(movimentos), [movimentos])
  const custosPecas = useMemo(() => sumCustosPecas(movimentos), [movimentos])
  const lucroOperacional = faturamento - custosPecas
  const impostoEst = estimativaImposto(faturamento, aliquotaPct)
  const lucroAposImpostoEst = lucroOperacional - impostoEst

  const mesLabel = useMemo(() => {
    try {
      return new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" })
    } catch {
      return period
    }
  }, [y, m, period])

  const exportarCsv = useCallback(() => {
    const csv = movimentosToCsv(movimentos, mesLabel)
    downloadBlob(`assistec-contador-${y}-${String(m).padStart(2, "0")}.csv`, "text/csv", csv)
  }, [movimentos, mesLabel, y, m])

  const exportarXml = useCallback(() => {
    const xml = movimentosToXml(movimentos, y, m)
    downloadBlob(`assistec-contador-${y}-${String(m).padStart(2, "0")}.xml`, "application/xml", xml)
  }, [movimentos, y, m])

  const sair = useCallback(async () => {
    await fetch("/api/auth/contador", { method: "DELETE" })
    router.push("/")
    router.refresh()
  }, [router])

  if (subscriptionOk === "loading") {
    return (
      <div className="min-h-[40vh] flex items-center justify-center text-muted-foreground text-sm">
        Verificando assinatura…
      </div>
    )
  }

  if (subscriptionOk === "blocked") {
    return (
      <div className="min-h-[40vh] flex items-center justify-center text-muted-foreground text-sm">
        Redirecionando…
      </div>
    )
  }

  const nomeEmpresa =
    (config.empresa.nomeFantasia || "").trim() || (config.empresa.razaoSocial || "").trim() || "Empresa"

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-12">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between border-b border-border pb-6">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Contabilidade</p>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Área do Contador</h1>
          <p className="text-sm text-muted-foreground max-w-xl">
            {nomeEmpresa} — visão financeira do período (vendas PDV e ordens de serviço finalizadas sem duplicar
            fechamentos ligados ao caixa).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Painel principal
            </Link>
          </Button>
          <Button variant="ghost" size="sm" onClick={sair}>
            <LogOut className="w-4 h-4 mr-2" />
            Sair
          </Button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 sm:items-end">
        <div className="space-y-2">
          <Label htmlFor="periodo">Mês / ano</Label>
          <Input
            id="periodo"
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="w-full sm:w-56 bg-secondary border-border"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="aliquota">Alíquota estimada (%)</Label>
          <Input
            id="aliquota"
            type="number"
            min={0}
            max={100}
            step={0.1}
            value={aliquotaPct}
            onChange={(e) => setAliquotaPct(parseFloat(e.target.value) || 0)}
            className="w-full sm:w-36 bg-secondary border-border"
          />
          <p className="text-xs text-muted-foreground">Base para estimativa sobre o faturamento bruto (ex.: Simples).</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-500" />
              Faturamento bruto
            </CardDescription>
            <CardTitle className="text-xl tabular-nums">{brl(faturamento)}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">Total vendido no período (Vendas + OS não duplicadas).</CardContent>
        </Card>
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-orange-400" />
              Custos (peças)
            </CardDescription>
            <CardTitle className="text-xl tabular-nums">{brl(custosPecas)}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            PDV: custo de estoque nas linhas. OS: campo &quot;valor peças&quot; da ordem.
          </CardContent>
        </Card>
        <Card className="border-border bg-card sm:col-span-2 lg:col-span-1">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Wallet className="w-4 h-4 text-primary" />
              Lucro operacional
            </CardDescription>
            <CardTitle className="text-xl tabular-nums">{brl(lucroOperacional)}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">Faturamento − custos de peças do período.</CardContent>
        </Card>
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Percent className="w-4 h-4 text-muted-foreground" />
              Imposto estimado
            </CardDescription>
            <CardTitle className="text-xl tabular-nums">{brl(impostoEst)}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {aliquotaPct}% sobre {brl(faturamento)}. Lucro após estimativa:{" "}
            <span className="text-foreground font-medium">{brl(lucroAposImpostoEst)}</span>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-lg">Entradas e saídas</CardTitle>
          <CardDescription>Resumo do mês selecionado ({mesLabel})</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-2 gap-6 text-sm">
            <div className="rounded-lg border border-border p-4 space-y-2">
              <p className="font-medium text-emerald-600 dark:text-emerald-400">Entradas (receita)</p>
              <p className="text-2xl font-semibold tabular-nums">{brl(faturamento)}</p>
              <p className="text-muted-foreground text-xs">
                {movimentos.filter((x) => x.tipo === "Venda").length} venda(s) PDV +{" "}
                {movimentos.filter((x) => x.tipo === "OS").length} OS exclusiva(s) no período.
              </p>
            </div>
            <div className="rounded-lg border border-border p-4 space-y-2">
              <p className="font-medium text-orange-600 dark:text-orange-400">Saídas (custo de peças)</p>
              <p className="text-2xl font-semibold tabular-nums">{brl(custosPecas)}</p>
              <p className="text-muted-foreground text-xs">
                Soma dos custos calculados conforme estoque (vendas) e valores de peça nas OS.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <CardTitle className="text-lg">Exportar para contador</CardTitle>
            <CardDescription>
              CSV (Excel) ou XML com: data, tipo, valor total, custo da peça e forma de pagamento.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={exportarCsv} className="gap-2">
              <FileSpreadsheet className="w-4 h-4" />
              Exportar CSV
            </Button>
            <Button type="button" variant="outline" onClick={exportarXml} className="gap-2">
              <FileCode2 className="w-4 h-4" />
              Exportar XML
            </Button>
          </div>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground flex items-start gap-2">
          <Download className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            O arquivo inclui {movimentos.length} linha(s). Em OS quitada pelo PDV no mesmo dia e valor, a receita entra
            apenas como Venda para evitar duplicidade.
          </span>
        </CardContent>
      </Card>
    </div>
  )
}
