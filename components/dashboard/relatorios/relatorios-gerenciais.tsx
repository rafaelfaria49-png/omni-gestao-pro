"use client"

import { useCallback, useEffect, useState } from "react"
import {
  Calendar,
  Download,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Package,
  ShoppingCart,
  ClipboardList,
  Wrench,
  BarChart3,
  PieChart,
  CreditCard,
  Banknote,
  Smartphone,
  FileText,
  ScrollText,
  AlertTriangle,
  Users,
  Timer,
  Shield,
  Warehouse,
  Landmark,
  Receipt,
  FileSpreadsheet,
  Loader2,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts"
import { cn } from "@/lib/utils"
import { useConfigEmpresa, configPadrao } from "@/lib/config-empresa"
import { APP_DISPLAY_NAME } from "@/lib/app-brand"
import {
  type PeriodoRelatorio,
  type ResumoGerencial,
  type RecebimentosPorCanal,
  type PontoGraficoDiario,
  type MetricasVendas,
  type MetricasOS,
  type MetricasEstoque,
  type MetricasFinanceiro,
  type DocumentoHistorico,
  fetchResumoGerencial,
  fetchRecebimentos,
  fetchGraficoBalcaoVsOSUltimos30Dias,
  fetchMetricasVendas,
  fetchMetricasOS,
  fetchMetricasEstoque,
  fetchMetricasFinanceiro,
  fetchDocumentosHistorico,
  getLabelPeriodo,
} from "@/lib/relatorios-dados"

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

function abrirPdfFechamentoDia(payload: {
  periodoLabel: string
  resumo: ResumoGerencial
  recebimentos: RecebimentosPorCanal
  empresa: { nome: string; cnpj: string; endereco: string }
}) {
  const { periodoLabel, resumo, recebimentos, empresa } = payload
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Fechamento - ${APP_DISPLAY_NAME}</title>
  <style>
    body{font-family:system-ui,sans-serif;padding:24px;color:#111;max-width:720px;margin:0 auto}
    h1{font-size:20px;border-bottom:2px solid #dc2626;padding-bottom:8px}
    table{width:100%;border-collapse:collapse;margin-top:16px;font-size:13px}
    th,td{border:1px solid #ddd;padding:8px;text-align:left}
    th{background:#f4f4f5}
    .muted{color:#666;font-size:12px}
  </style></head><body>
  <h1>${empresa.nome} — Fechamento</h1>
  <p class="muted">CNPJ: ${empresa.cnpj}</p>
  <p class="muted">Endereço: ${empresa.endereco}</p>
  <p class="muted">Período: ${periodoLabel}</p>
  <p><strong>Faturamento bruto:</strong> ${formatCurrency(resumo.faturamentoBruto)}</p>
  <p><strong>Custo de mercadoria:</strong> ${formatCurrency(resumo.custoMercadoria)}</p>
  <p><strong>Despesas:</strong> ${formatCurrency(resumo.despesas)}</p>
  <p><strong>Lucro líquido:</strong> ${formatCurrency(resumo.lucroLiquido)}</p>
  <p><strong>Vendas (qtd):</strong> ${resumo.totalVendas} &nbsp;|&nbsp; <strong>OS (qtd):</strong> ${resumo.totalOs}</p>
  <h2 style="font-size:16px;margin-top:20px">Recebimentos (por canal)</h2>
  <table>
  <tr><th>Canal</th><th>Valor</th></tr>
  <tr><td>Pix</td><td>${formatCurrency(recebimentos.pix)}</td></tr>
  <tr><td>Dinheiro</td><td>${formatCurrency(recebimentos.dinheiro)}</td></tr>
  <tr><td>Cartão</td><td>${formatCurrency(recebimentos.cartao)}</td></tr>
  <tr><td>Carnês (a receber)</td><td>${formatCurrency(recebimentos.carneAReceber)}</td></tr>
  </table>
  <p class="muted" style="margin-top:24px">Documento gerado para conferência. Integração com NF-e futura.</p>
  </body></html>`
  const w = window.open("", "_blank")
  if (w) {
    w.document.write(html)
    w.document.close()
    w.focus()
    setTimeout(() => w.print(), 300)
  }
}

export function RelatoriosGerenciais() {
  const { config, getEnderecoCompleto } = useConfigEmpresa()
  const [periodo, setPeriodo] = useState<PeriodoRelatorio>("7dias")
  const [dataInicio, setDataInicio] = useState("")
  const [dataFim, setDataFim] = useState("")
  const [loading, setLoading] = useState(true)
  const [resumo, setResumo] = useState<ResumoGerencial | null>(null)
  const [recebimentos, setRecebimentos] = useState<RecebimentosPorCanal | null>(null)
  const [grafico30, setGrafico30] = useState<PontoGraficoDiario[]>([])
  const [vendas, setVendas] = useState<MetricasVendas | null>(null)
  const [osMetrics, setOsMetrics] = useState<MetricasOS | null>(null)
  const [estoque, setEstoque] = useState<MetricasEstoque | null>(null)
  const [financeiro, setFinanceiro] = useState<MetricasFinanceiro | null>(null)
  const [documentos, setDocumentos] = useState<DocumentoHistorico[]>([])
  const [exporting, setExporting] = useState(false)

  const carregar = useCallback(async () => {
    setLoading(true)
    const customRange =
      periodo === "personalizado" && dataInicio && dataFim
        ? { inicio: dataInicio, fim: dataFim }
        : undefined
    try {
      const [r, rec, g, v, o, e, f, d] = await Promise.all([
        fetchResumoGerencial(periodo, customRange),
        fetchRecebimentos(periodo, customRange),
        fetchGraficoBalcaoVsOSUltimos30Dias(),
        fetchMetricasVendas(periodo, customRange),
        fetchMetricasOS(periodo, customRange),
        fetchMetricasEstoque(),
        fetchMetricasFinanceiro(periodo, customRange),
        fetchDocumentosHistorico(),
      ])
      setResumo(r)
      setRecebimentos(rec)
      setGrafico30(g)
      setVendas(v)
      setOsMetrics(o)
      setEstoque(e)
      setFinanceiro(f)
      setDocumentos(d)
    } finally {
      setLoading(false)
    }
  }, [periodo, dataInicio, dataFim])

  useEffect(() => {
    carregar()
  }, [carregar])

  const margemPct =
    resumo && resumo.faturamentoBruto > 0
      ? ((resumo.lucroLiquido / resumo.faturamentoBruto) * 100).toFixed(1)
      : "0"

  const handleExportPdf = () => {
    if (!resumo || !recebimentos) return
    const nomeEmpresa = (config.empresa.nomeFantasia || "").trim() || configPadrao.empresa.nomeFantasia
    const cnpjEmpresa = (config.empresa.cnpj || "").trim() || configPadrao.empresa.cnpj
    setExporting(true)
    setTimeout(() => {
      abrirPdfFechamentoDia({
        periodoLabel:
          periodo === "personalizado" && dataInicio && dataFim
            ? `${dataInicio} a ${dataFim}`
            : getLabelPeriodo(periodo),
        resumo,
        recebimentos,
        empresa: {
          nome: nomeEmpresa,
          cnpj: cnpjEmpresa,
          endereco: getEnderecoCompleto(),
        },
      })
      setExporting(false)
    }, 400)
  }

  const totalRecebimentos = recebimentos
    ? recebimentos.pix +
      recebimentos.dinheiro +
      recebimentos.cartao +
      recebimentos.carneAReceber
    : 0

  const pct = (parte: number) =>
    totalRecebimentos > 0 ? Math.round((parte / totalRecebimentos) * 1000) / 10 : 0

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950 text-zinc-100 shadow-xl shadow-black/40">
      {/* Toolbar */}
      <div className="border-b border-zinc-800/80 p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-white sm:text-xl">
              Relatórios Gerenciais
            </h2>
            <p className="text-sm text-zinc-500">
              {APP_DISPLAY_NAME} — visão unificada (dados dinâmicos; conexão com banco em breve)
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                ["hoje", "Hoje"],
                ["7dias", "7 dias"],
                ["mes", "Mês atual"],
                ["personalizado", "Personalizado"],
              ] as const
            ).map(([id, label]) => (
              <Button
                key={id}
                size="sm"
                variant={periodo === id ? "default" : "outline"}
                className={cn(
                  "h-9 border-zinc-700",
                  periodo === id
                    ? "bg-orange-600 text-white hover:bg-orange-500"
                    : "bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-white"
                )}
                onClick={() => setPeriodo(id)}
              >
                <Calendar className="mr-1.5 h-3.5 w-3.5" />
                {label}
              </Button>
            ))}
            <Button
              size="sm"
              className="h-9 bg-gradient-to-r from-red-600 to-orange-600 text-white hover:from-red-500 hover:to-orange-500"
              onClick={handleExportPdf}
              disabled={exporting || !resumo || !recebimentos}
            >
              {exporting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              Exportar fechamento (PDF)
            </Button>
          </div>
        </div>
        {periodo === "personalizado" && (
          <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-zinc-800/80 pt-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-500">Data inicial</Label>
              <Input
                type="date"
                value={dataInicio}
                onChange={(e) => setDataInicio(e.target.value)}
                className="h-9 border-zinc-700 bg-zinc-900 text-zinc-100"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-500">Data final</Label>
              <Input
                type="date"
                value={dataFim}
                onChange={(e) => setDataFim(e.target.value)}
                className="h-9 border-zinc-700 bg-zinc-900 text-zinc-100"
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              className="border-zinc-600 text-zinc-300"
              onClick={() => carregar()}
              disabled={!dataInicio || !dataFim}
            >
              Aplicar
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-6 p-4 sm:p-6">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-12 text-zinc-500">
            <Loader2 className="h-6 w-6 animate-spin text-orange-500" />
            Carregando indicadores…
          </div>
        )}

        {!loading && resumo && recebimentos && (
          <>
            {/* Cards resumo */}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Card className="border-zinc-800/90 bg-zinc-900/60 shadow-inner shadow-black/20">
                <CardContent className="p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                        Faturamento bruto
                      </p>
                      <p className="mt-1 text-2xl font-bold tabular-nums text-white sm:text-3xl">
                        {formatCurrency(resumo.faturamentoBruto)}
                      </p>
                      <p className="mt-2 text-xs text-zinc-500">
                        Vendas de balcão + ordens de serviço
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Badge className="border-orange-500/40 bg-orange-500/15 text-orange-300">
                          <ShoppingCart className="mr-1 h-3 w-3" />
                          {resumo.totalVendas} vendas
                        </Badge>
                        <Badge className="border-red-500/40 bg-red-500/10 text-red-300">
                          <ClipboardList className="mr-1 h-3 w-3" />
                          {resumo.totalOs} OS
                        </Badge>
                      </div>
                    </div>
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-orange-600/30 to-red-600/20 ring-1 ring-orange-500/30">
                      <DollarSign className="h-6 w-6 text-orange-400" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-zinc-800/90 bg-zinc-900/60">
                <CardContent className="p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                        Custo de mercadoria
                      </p>
                      <p className="mt-1 text-2xl font-bold tabular-nums text-white sm:text-3xl">
                        {formatCurrency(resumo.custoMercadoria)}
                      </p>
                      <p className="mt-2 text-xs text-zinc-500">
                        Saídas de estoque (custo)
                      </p>
                      <p className="mt-3 text-xs text-orange-300/90">
                        {resumo.faturamentoBruto > 0
                          ? `${((resumo.custoMercadoria / resumo.faturamentoBruto) * 100).toFixed(1)}% do faturamento`
                          : "—"}
                      </p>
                    </div>
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-800 ring-1 ring-zinc-700">
                      <Package className="h-6 w-6 text-orange-400" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-zinc-800/90 bg-zinc-900/60">
                <CardContent className="p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                        Lucro líquido
                      </p>
                      <p className="mt-1 bg-gradient-to-r from-orange-400 to-red-400 bg-clip-text text-2xl font-bold tabular-nums text-transparent sm:text-3xl">
                        {formatCurrency(resumo.lucroLiquido)}
                      </p>
                      <p className="mt-2 text-xs text-zinc-500">
                        Faturamento − custos − despesas
                      </p>
                      <div className="mt-3 flex items-center gap-1.5 text-xs text-emerald-400/90">
                        <TrendingUp className="h-3.5 w-3.5" />
                        {margemPct}% margem
                      </div>
                    </div>
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-950/50 ring-1 ring-emerald-700/40">
                      <PieChart className="h-6 w-6 text-emerald-400" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-zinc-800/90 bg-zinc-900/60">
                <CardContent className="p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                        Despesas
                      </p>
                      <p className="mt-1 text-2xl font-bold tabular-nums text-zinc-200 sm:text-3xl">
                        {formatCurrency(resumo.despesas)}
                      </p>
                      <p className="mt-2 text-xs text-zinc-500">Fixas e variáveis do período</p>
                      <div className="mt-3 flex items-center gap-1 text-xs text-zinc-500">
                        <TrendingDown className="h-3.5 w-3.5" />
                        {resumo.faturamentoBruto > 0
                          ? `${((resumo.despesas / resumo.faturamentoBruto) * 100).toFixed(1)}% do faturamento`
                          : "—"}
                      </div>
                    </div>
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-zinc-800 ring-1 ring-zinc-700">
                      <Receipt className="h-6 w-6 text-zinc-400" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Recebimentos por canal */}
            <Card className="border-zinc-800/90 bg-zinc-900/40">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base font-semibold text-white">
                  <Landmark className="h-5 w-5 text-orange-400" />
                  Recebimentos
                </CardTitle>
                <CardDescription className="text-zinc-500">
                  Divisão por Pix, dinheiro, cartão e carnês (valor a receber)
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  {
                    label: "Pix",
                    value: recebimentos.pix,
                    icon: Smartphone,
                    bar: "bg-orange-500",
                  },
                  {
                    label: "Dinheiro",
                    value: recebimentos.dinheiro,
                    icon: Banknote,
                    bar: "bg-amber-500",
                  },
                  {
                    label: "Cartão",
                    value: recebimentos.cartao,
                    icon: CreditCard,
                    bar: "bg-red-500",
                  },
                  {
                    label: "Carnês (a receber)",
                    value: recebimentos.carneAReceber,
                    icon: FileSpreadsheet,
                    bar: "bg-orange-600",
                  },
                ].map((c) => (
                  <div
                    key={c.label}
                    className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <c.icon className="h-5 w-5 text-orange-400/90" />
                      <span className="text-xs text-zinc-500">{pct(c.value)}%</span>
                    </div>
                    <p className="mt-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                      {c.label}
                    </p>
                    <p className="mt-1 text-lg font-bold tabular-nums text-white">
                      {formatCurrency(c.value)}
                    </p>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className={cn("h-full rounded-full transition-all", c.bar)}
                        style={{ width: `${Math.min(100, pct(c.value))}%` }}
                      />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Gráfico 30 dias */}
            <Card className="border-zinc-800/90 bg-zinc-900/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg text-white">
                  <BarChart3 className="h-5 w-5 text-orange-500" />
                  Vendas de balcão × Ordens de serviço
                </CardTitle>
                <CardDescription className="text-zinc-500">
                  Últimos 30 dias (diário)
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-72 w-full min-w-0 sm:h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <RechartsBarChart
                      data={grafico30}
                      margin={{ top: 12, right: 8, left: 4, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" opacity={0.5} />
                      <XAxis
                        dataKey="diaLabel"
                        tick={{ fill: "#a1a1aa", fontSize: 10 }}
                        interval="preserveStartEnd"
                      />
                      <YAxis
                        tick={{ fill: "#a1a1aa", fontSize: 11 }}
                        tickFormatter={(v) =>
                          `R$ ${(v / 1000).toFixed(v >= 1000 ? 1 : 0)}${v >= 1000 ? "k" : ""}`
                        }
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#18181b",
                          border: "1px solid #3f3f46",
                          borderRadius: "8px",
                          color: "#fafafa",
                        }}
                        formatter={(value: number, name: string) => [
                          formatCurrency(value),
                          name === "vendasBalcao" ? "Vendas balcão" : "Ordens de serviço",
                        ]}
                      />
                      <Legend
                        wrapperStyle={{ color: "#a1a1aa", fontSize: 12 }}
                        formatter={(value) =>
                          value === "vendasBalcao" ? "Vendas de balcão" : "Ordens de serviço"
                        }
                      />
                      <Bar
                        dataKey="vendasBalcao"
                        name="vendasBalcao"
                        fill="#ea580c"
                        radius={[4, 4, 0, 0]}
                      />
                      <Bar
                        dataKey="ordensServico"
                        name="ordensServico"
                        fill="#dc2626"
                        radius={[4, 4, 0, 0]}
                      />
                    </RechartsBarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Abas de relatórios */}
            <Tabs defaultValue="vendas" className="w-full">
              <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-xl border border-zinc-800 bg-zinc-900/80 p-1 sm:grid-cols-5">
                {[
                  { id: "vendas", label: "Vendas", icon: ShoppingCart },
                  { id: "os", label: "Ordens de serviço", icon: Wrench },
                  { id: "estoque", label: "Estoque", icon: Warehouse },
                  { id: "financeiro", label: "Financeiro", icon: Landmark },
                  { id: "documentos", label: "Documentos", icon: ScrollText },
                ].map((t) => (
                  <TabsTrigger
                    key={t.id}
                    value={t.id}
                    className="rounded-lg py-2.5 text-xs text-zinc-400 data-[state=active]:bg-gradient-to-r data-[state=active]:from-red-600/90 data-[state=active]:to-orange-600/90 data-[state=active]:text-white sm:text-sm"
                  >
                    <t.icon className="mr-1.5 hidden h-4 w-4 sm:inline" />
                    {t.label}
                  </TabsTrigger>
                ))}
              </TabsList>

              <TabsContent value="vendas" className="mt-4 space-y-4 outline-none">
                {vendas && (
                  <>
                    <div className="grid gap-4 md:grid-cols-3">
                      <Card className="border-zinc-800 bg-zinc-900/60">
                        <CardContent className="flex items-center gap-3 p-4">
                          <Users className="h-10 w-10 text-orange-400" />
                          <div>
                            <p className="text-xs text-zinc-500">Ticket médio</p>
                            <p className="text-xl font-bold text-white">
                              {formatCurrency(vendas.ticketMedio)}
                            </p>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                    <Card className="border-zinc-800 bg-zinc-900/60">
                      <CardHeader>
                        <CardTitle className="text-base text-white">Produtos mais vendidos</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        {vendas.produtosMaisVendidos.map((p, i) => (
                          <div
                            key={p.id}
                            className="flex items-center justify-between rounded-lg border border-zinc-800/80 bg-zinc-950/40 px-3 py-2"
                          >
                            <span className="text-sm text-zinc-300">
                              <span className="mr-2 text-zinc-600">{i + 1}.</span>
                              {p.nome}
                            </span>
                            <span className="text-sm tabular-nums text-orange-300">
                              {p.quantidade} un. · {formatCurrency(p.receita)}
                            </span>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                    <Card className="border-zinc-800 bg-zinc-900/60">
                      <CardHeader>
                        <CardTitle className="text-base text-white">Vendas por vendedor</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        {vendas.vendasPorVendedor.map((v) => (
                          <div
                            key={v.vendedorId}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800/80 px-3 py-2"
                          >
                            <span className="font-medium text-zinc-200">{v.nome}</span>
                            <span className="text-sm text-zinc-500">
                              {v.quantidadeVendas} vendas
                            </span>
                            <span className="ml-auto font-semibold tabular-nums text-white">
                              {formatCurrency(v.total)}
                            </span>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  </>
                )}
              </TabsContent>

              <TabsContent value="os" className="mt-4 outline-none">
                {osMetrics && (
                  <div className="grid gap-4 md:grid-cols-3">
                    <Card className="border-zinc-800 bg-zinc-900/60">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                          <Timer className="h-9 w-9 text-orange-400" />
                          <div>
                            <p className="text-xs text-zinc-500">Tempo médio de conserto</p>
                            <p className="text-xl font-bold text-white">
                              {osMetrics.tempoMedioConsertoHoras} h
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                    <Card className="border-zinc-800 bg-zinc-900/60">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                          <Shield className="h-9 w-9 text-red-400" />
                          <div>
                            <p className="text-xs text-zinc-500">OS com garantia (período)</p>
                            <p className="text-xl font-bold text-white">
                              {osMetrics.osComGarantiaNoPeriodo}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                    <Card className="border-zinc-800 bg-zinc-900/60">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                          <TrendingDown className="h-9 w-9 text-amber-400" />
                          <div>
                            <p className="text-xs text-zinc-500">Retorno em garantia</p>
                            <p className="text-xl font-bold text-white">
                              {osMetrics.taxaRetornoGarantiaPct}%
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="estoque" className="mt-4 outline-none">
                {estoque && (
                  <div className="space-y-4">
                    <Card className="border-zinc-800 bg-zinc-900/60">
                      <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5">
                        <div className="flex items-center gap-3">
                          <Package className="h-10 w-10 text-orange-400" />
                          <div>
                            <p className="text-xs uppercase tracking-wide text-zinc-500">
                              Valor total em estoque
                            </p>
                            <p className="text-2xl font-bold text-white">
                              {formatCurrency(estoque.valorTotalEstoque)}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                    <Card className="border border-red-900/50 bg-red-950/20">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base text-red-300">
                          <AlertTriangle className="h-5 w-5" />
                          Estoque baixo
                        </CardTitle>
                        <CardDescription className="text-red-200/70">
                          Itens abaixo do mínimo — reposição necessária
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        {estoque.itensBaixoEstoque.map((it) => (
                          <div
                            key={it.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-900/40 bg-red-950/30 px-3 py-2 text-sm"
                          >
                            <span className="font-medium text-red-100">{it.nome}</span>
                            <span className="text-xs text-red-200/80">{it.sku}</span>
                            <span className="ml-auto tabular-nums text-red-200">
                              {it.quantidade} / mín. {it.minimo} · {formatCurrency(it.valorUnitario)}{" "}
                              un.
                            </span>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="financeiro" className="mt-4 outline-none">
                {financeiro && (
                  <div className="grid gap-4 lg:grid-cols-2">
                    <Card className="border-zinc-800 bg-zinc-900/60">
                      <CardHeader>
                        <CardTitle className="text-base text-white">Fluxo de caixa (resumo)</CardTitle>
                        <p className="text-sm text-zinc-500">
                          Saldo do período:{" "}
                          <span
                            className={cn(
                              "font-semibold",
                              financeiro.saldoFluxoPeriodo >= 0
                                ? "text-emerald-400"
                                : "text-red-400"
                            )}
                          >
                            {formatCurrency(financeiro.saldoFluxoPeriodo)}
                          </span>
                        </p>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        {financeiro.lancamentos.map((l) => (
                          <div
                            key={l.id}
                            className="flex justify-between gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-sm"
                          >
                            <span className="text-zinc-400">{l.data}</span>
                            <span className="flex-1 text-zinc-200">{l.descricao}</span>
                            {l.entrada > 0 && (
                              <span className="text-emerald-400">+ {formatCurrency(l.entrada)}</span>
                            )}
                            {l.saida > 0 && (
                              <span className="text-red-400">− {formatCurrency(l.saida)}</span>
                            )}
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                    <Card className="border-zinc-800 bg-zinc-900/60">
                      <CardHeader>
                        <CardTitle className="text-base text-white">Inadimplência — carnê</CardTitle>
                        <CardDescription className="text-zinc-500">
                          Clientes com parcelas em atraso
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        {financeiro.inadimplentesCarne.map((n) => (
                          <div
                            key={n.id}
                            className="rounded-lg border border-orange-900/40 bg-orange-950/20 px-3 py-2"
                          >
                            <div className="flex justify-between gap-2">
                              <span className="font-medium text-orange-100">{n.cliente}</span>
                              <span className="text-sm font-semibold text-white">
                                {formatCurrency(n.valor)}
                              </span>
                            </div>
                            <div className="mt-1 flex flex-wrap justify-between text-xs text-orange-200/80">
                              <span>
                                {n.parcela} · venc. {n.vencimento}
                              </span>
                              <span className="text-red-400">{n.diasAtraso} dias de atraso</span>
                            </div>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="documentos" className="mt-4 outline-none">
                <Card className="border-zinc-800 bg-zinc-900/60">
                  <CardHeader>
                    <CardTitle className="text-base text-white">Histórico de documentos</CardTitle>
                    <CardDescription className="text-zinc-500">
                      Notas fiscais e contratos de garantia gerados
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {documentos.map((doc) => (
                      <div
                        key={doc.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 px-3 py-2"
                      >
                        <div className="flex items-center gap-2">
                          {doc.tipo === "nf" ? (
                            <FileText className="h-4 w-4 text-orange-400" />
                          ) : (
                            <ScrollText className="h-4 w-4 text-red-400" />
                          )}
                          <div>
                            <p className="text-sm font-medium text-white">{doc.numero}</p>
                            <p className="text-xs text-zinc-500">{doc.referencia}</p>
                          </div>
                        </div>
                        <div className="text-right text-xs text-zinc-500">{doc.data}</div>
                        <Badge
                          variant="outline"
                          className="border-zinc-600 text-zinc-300"
                        >
                          {doc.status}
                        </Badge>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>

            <Separator className="bg-zinc-800" />
            <p className="text-center text-xs text-zinc-600">
              Os valores são carregados dinamicamente pelas funções em{" "}
              <code className="rounded bg-zinc-900 px-1 py-0.5 text-zinc-500">lib/relatorios-dados.ts</code>{" "}
              — substitua por chamadas ao banco quando disponível.
            </p>
            <p className="text-center text-xs text-zinc-500">
              {(config.empresa.nomeFantasia || "").trim() || configPadrao.empresa.nomeFantasia} · CNPJ:{" "}
              {(config.empresa.cnpj || "").trim() || configPadrao.empresa.cnpj} · {getEnderecoCompleto()}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
