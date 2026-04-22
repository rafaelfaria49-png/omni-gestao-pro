"use client"

import { useMemo, useState } from "react"
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Percent,
  Download,
  Calendar,
  BarChart3,
  PieChart as PieChartIcon,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react"
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useFinanceiro } from "@/lib/financeiro-store"

const PIE_COLORS = ["#0ea5e9", "#f97316", "#22c55e", "#a855f7", "#eab308", "#64748b"]

const resumoMensal = {
  receitaTotal: 45800.00,
  despesaTotal: 18200.00,
  lucroLiquido: 27600.00,
  margemLucro: 60.26,
  ticketMedio: 385.00,
  totalVendas: 119
}

const categoriasReceitas = [
  { categoria: "Ordens de Serviço", valor: 22500, percentual: 49.1 },
  { categoria: "Vendas Produtos", valor: 18300, percentual: 40.0 },
  { categoria: "Carnês", valor: 3500, percentual: 7.6 },
  { categoria: "Serviços Extras", valor: 1500, percentual: 3.3 },
]

export function RelatoriosFinanceiros() {
  const [periodoSelecionado, setPeriodoSelecionado] = useState("mes")
  const { gastosPorCategoria, receitasPorCarteiraEmpresa } = useFinanceiro()

  const dadosPizza = useMemo(() => {
    const rows = gastosPorCategoria()
    return rows.map((r) => ({
      name: r.categoria,
      value: r.valor,
    }))
  }, [gastosPorCategoria])

  const dadosBarrasLojas = useMemo(() => {
    const lojas = receitasPorCarteiraEmpresa()
    return lojas.map((l) => ({
      loja: l.nome.length > 14 ? `${l.nome.slice(0, 12)}…` : l.nome,
      receita: l.valor,
    }))
  }, [receitasPorCarteiraEmpresa])

  return (
    <div className="space-y-6">
      {/* Header com filtros */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between">
        <div className="flex gap-2">
          {["semana", "mes", "trimestre", "ano"].map((periodo) => (
            <Button
              key={periodo}
              variant={periodoSelecionado === periodo ? "default" : "outline"}
              size="sm"
              onClick={() => setPeriodoSelecionado(periodo)}
              className="capitalize"
            >
              {periodo === "mes" ? "Este Mês" : periodo === "semana" ? "Semana" : periodo === "trimestre" ? "Trimestre" : "Ano"}
            </Button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm">
            <Calendar className="w-4 h-4 mr-2" />
            Período Personalizado
          </Button>
          <Button variant="outline" size="sm">
            <Download className="w-4 h-4 mr-2" />
            Exportar PDF
          </Button>
        </div>
      </div>

      {/* Cards de Resumo Principal */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Receita Total</p>
                <p className="text-2xl font-bold text-green-500">
                  R$ {resumoMensal.receitaTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </p>
                <div className="flex items-center gap-1 mt-1 text-sm text-green-500">
                  <ArrowUpRight className="w-4 h-4" />
                  <span>+12.5% vs mês anterior</span>
                </div>
              </div>
              <div className="w-14 h-14 rounded-full bg-green-500/10 flex items-center justify-center">
                <TrendingUp className="w-7 h-7 text-green-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Despesa Total</p>
                <p className="text-2xl font-bold text-red-500">
                  R$ {resumoMensal.despesaTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </p>
                <div className="flex items-center gap-1 mt-1 text-sm text-red-500">
                  <ArrowUpRight className="w-4 h-4" />
                  <span>+8.3% vs mês anterior</span>
                </div>
              </div>
              <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center">
                <TrendingDown className="w-7 h-7 text-red-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border sm:col-span-2 lg:col-span-1">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Lucro Líquido</p>
                <p className="text-2xl font-bold text-primary">
                  R$ {resumoMensal.lucroLiquido.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </p>
                <div className="flex items-center gap-1 mt-1 text-sm text-primary">
                  <Percent className="w-4 h-4" />
                  <span>Margem: {resumoMensal.margemLucro}%</span>
                </div>
              </div>
              <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                <DollarSign className="w-7 h-7 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Cards Secundários */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Ticket Médio</p>
            <p className="text-xl font-bold text-foreground">
              R$ {resumoMensal.ticketMedio.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Total Vendas</p>
            <p className="text-xl font-bold text-foreground">{resumoMensal.totalVendas}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Média Diária</p>
            <p className="text-xl font-bold text-foreground">
              R$ {(resumoMensal.receitaTotal / 30).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">OS/Dia</p>
            <p className="text-xl font-bold text-foreground">{Math.round(resumoMensal.totalVendas / 30)}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-card border-border">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Gastos por categoria</CardTitle>
                <CardDescription>Lançamentos de saída nas carteiras (pizza)</CardDescription>
              </div>
              <PieChartIcon className="w-5 h-5 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            {dadosPizza.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                Ainda não há despesas lançadas. Use Carteiras → Lançamento inteligente.
              </p>
            ) : (
              <div className="h-[280px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={dadosPizza}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={90}
                      label={({ name, percent }) =>
                        `${name} (${(percent * 100).toFixed(0)}%)`
                      }
                    >
                      {dadosPizza.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: number) =>
                        value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
                      }
                    />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Receitas por loja (carteiras empresa)</CardTitle>
                <CardDescription>Entradas registradas por carteira tipo Empresa</CardDescription>
              </div>
              <BarChart3 className="w-5 h-5 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            {dadosBarrasLojas.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                Cadastre carteiras do tipo Empresa (ex.: loja principal e filial) e lance entradas.
              </p>
            ) : (
              <div className="h-[280px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dadosBarrasLojas} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                    <XAxis dataKey="loja" tick={{ fontSize: 12 }} />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      tickFormatter={(v) =>
                        typeof v === "number"
                          ? v.toLocaleString("pt-BR", { maximumFractionDigits: 0 })
                          : String(v)
                      }
                    />
                    <Tooltip
                      formatter={(value: number) =>
                        value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
                      }
                    />
                    <Bar dataKey="receita" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Receita" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle>Distribuição de receitas (referência)</CardTitle>
          <CardDescription>Exemplo de mix — registre vendas no PDV para alimentar o fluxo real</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {categoriasReceitas.map((item, index) => {
              const colors = ["bg-primary", "bg-green-500", "bg-blue-500", "bg-yellow-500"]
              return (
                <div key={item.categoria} className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-foreground">{item.categoria}</span>
                    <span className="text-muted-foreground">
                      R$ {item.valor.toLocaleString("pt-BR")} ({item.percentual}%)
                    </span>
                  </div>
                  <div className="h-2 bg-secondary rounded-full overflow-hidden">
                    <div
                      className={cn("h-full rounded-full", colors[index % colors.length])}
                      style={{ width: `${item.percentual}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
