"use client"

import { useMemo, useState, useEffect } from "react"
import { startOfMonth, endOfMonth } from "date-fns"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts"
import { Calendar, Filter, Search, TrendingUp, Package, Wrench, Users } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { useOperationsStore } from "@/lib/operations-store"
import { useFinanceiro } from "@/lib/financeiro-store"
import {
  computeLucroReal,
  computeRankingProdutos,
  computeRankingServicosOs,
  computeTicketMedio,
  buildTimelineCliente,
  type Dashboard360Filters,
  type FonteDados360,
  type CategoriaMix360,
} from "@/lib/dashboard-360-compute"
import {
  loadOsEquipamentos,
  loadVendasProdutosPorPedido,
  type VendasProdutosPorPedidoPayload,
  type OsEquipamentosPayload,
} from "@/lib/import-cross-analytics"

function formatBrl(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

const MESES = [
  { v: "1", label: "Janeiro" },
  { v: "2", label: "Fevereiro" },
  { v: "3", label: "Março" },
  { v: "4", label: "Abril" },
  { v: "5", label: "Maio" },
  { v: "6", label: "Junho" },
  { v: "7", label: "Julho" },
  { v: "8", label: "Agosto" },
  { v: "9", label: "Setembro" },
  { v: "10", label: "Outubro" },
  { v: "11", label: "Novembro" },
  { v: "12", label: "Dezembro" },
]

export function Dashboard360() {
  const { sales, ordens, inventory } = useOperationsStore()
  const { contasPagar, movimentos } = useFinanceiro()

  const [mes, setMes] = useState(() => String(new Date().getMonth() + 1))
  const [ano, setAno] = useState(() => String(new Date().getFullYear()))
  const [fonte, setFonte] = useState<FonteDados360>("todos")
  const [categoriaMix, setCategoriaMix] = useState<CategoriaMix360>("todos")
  const [vendedorTexto, setVendedorTexto] = useState("")
  const [clienteQ, setClienteQ] = useState("")

  const [impVendas, setImpVendas] = useState<VendasProdutosPorPedidoPayload | null>(null)
  const [impOs, setImpOs] = useState<OsEquipamentosPayload | null>(null)

  useEffect(() => {
    setImpVendas(loadVendasProdutosPorPedido())
    setImpOs(loadOsEquipamentos())
  }, [])

  const filters: Dashboard360Filters = useMemo(() => {
    const m = Math.max(1, Math.min(12, parseInt(mes, 10) || 1))
    const y = parseInt(ano, 10) || new Date().getFullYear()
    const base = new Date(y, m - 1, 1)
    const inicio = startOfMonth(base)
    const fim = endOfMonth(base)
    return {
      inicio,
      fim,
      fonte,
      categoriaMix,
      vendedorTexto,
    }
  }, [mes, ano, fonte, categoriaMix, vendedorTexto])

  const lucro = useMemo(
    () => computeLucroReal(sales, ordens, contasPagar, movimentos ?? [], filters),
    [sales, ordens, contasPagar, movimentos, filters]
  )

  const chartLucro = useMemo(
    () => [
      {
        nome: "Faturamento bruto",
        valor: Math.round(lucro.faturamentoBruto * 100) / 100,
      },
      {
        nome: "Contas a pagar (mês)",
        valor: Math.round(lucro.totalContasPagar * 100) / 100,
      },
      {
        nome: "Lucro líquido (aprox.)",
        valor: Math.round(lucro.lucroLiquido * 100) / 100,
      },
    ],
    [lucro]
  )

  const rankProd = useMemo(
    () => computeRankingProdutos(sales, inventory, filters, impVendas),
    [sales, inventory, filters, impVendas]
  )

  const rankOs = useMemo(
    () => computeRankingServicosOs(ordens, filters, impOs),
    [ordens, filters, impOs]
  )

  const ticket = useMemo(() => computeTicketMedio(sales, ordens, filters), [sales, ordens, filters])

  const timeline = useMemo(() => buildTimelineCliente(clienteQ, sales, ordens), [clienteQ, sales, ordens])

  const anosOpts = useMemo(() => {
    const y = new Date().getFullYear()
    return [y - 2, y - 1, y, y + 1].map(String)
  }, [])

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Filter className="w-5 h-5" />
            Filtros
          </CardTitle>
          <CardDescription>Mês/ano, origem dos dados, categoria (PDV) e texto em movimentações importadas.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <div className="space-y-2">
            <Label>Mês</Label>
            <Select value={mes} onValueChange={setMes}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MESES.map((x) => (
                  <SelectItem key={x.v} value={x.v}>
                    {x.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Ano</Label>
            <Select value={ano} onValueChange={setAno}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {anosOpts.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Fonte</Label>
            <Select value={fonte} onValueChange={(v) => setFonte(v as FonteDados360)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos (PDV + importações)</SelectItem>
                <SelectItem value="pdv">Só PDV / OS no sistema</SelectItem>
                <SelectItem value="planilhas">Só importações (financeiro)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Categoria (linhas do PDV)</Label>
            <Select value={categoriaMix} onValueChange={(v) => setCategoriaMix(v as CategoriaMix360)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Produto + serviço</SelectItem>
                <SelectItem value="produto">Produto</SelectItem>
                <SelectItem value="servico">Serviço</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Filtrar movimentações (texto na descrição)</Label>
            <Input
              placeholder="Opcional — importações de extrato/vendas"
              value={vendedorTexto}
              onChange={(e) => setVendedorTexto(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-emerald-600" />
              Lucro real (aproximado)
            </CardTitle>
            <CardDescription>
              (Vendas PDV + vendas importadas + OS) − contas a pagar com vencimento no mês filtrado. Não substitui
              contabilidade.
            </CardDescription>
          </CardHeader>
          <CardContent className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartLucro} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="nome" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => `R$${v}`} width={56} />
                <Tooltip formatter={(v: number) => formatBrl(Number(v))} />
                <Legend />
                <Bar dataKey="valor" name="R$" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <div className="rounded-md border border-border bg-secondary/30 px-3 py-2">
                <div className="text-muted-foreground text-xs">Vendas PDV</div>
                <div className="font-semibold tabular-nums">{formatBrl(lucro.totalVendasPdv)}</div>
              </div>
              <div className="rounded-md border border-border bg-secondary/30 px-3 py-2">
                <div className="text-muted-foreground text-xs">Importadas</div>
                <div className="font-semibold tabular-nums">{formatBrl(lucro.totalVendasPlanilha)}</div>
              </div>
              <div className="rounded-md border border-border bg-secondary/30 px-3 py-2">
                <div className="text-muted-foreground text-xs">OS</div>
                <div className="font-semibold tabular-nums">{formatBrl(lucro.totalOs)}</div>
              </div>
              <div className="rounded-md border border-border bg-secondary/30 px-3 py-2">
                <div className="text-muted-foreground text-xs">A pagar (mês)</div>
                <div className="font-semibold tabular-nums">{formatBrl(lucro.totalContasPagar)}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="w-5 h-5" />
              Ticket médio
            </CardTitle>
            <CardDescription>Por transação e média por cliente (com nome).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <div className="text-muted-foreground text-xs">Venda — ticket / transação</div>
              <div className="text-lg font-semibold tabular-nums">{formatBrl(ticket.ticketMedioPorVenda)}</div>
              <div className="text-xs text-muted-foreground">{ticket.qtdTransacoesVenda} venda(s)</div>
            </div>
            <Separator />
            <div>
              <div className="text-muted-foreground text-xs">OS — ticket / transação</div>
              <div className="text-lg font-semibold tabular-nums">{formatBrl(ticket.ticketMedioPorOs)}</div>
              <div className="text-xs text-muted-foreground">{ticket.qtdTransacoesOs} OS</div>
            </div>
            <Separator />
            <div>
              <div className="text-muted-foreground text-xs">Média por cliente (vendas nomeadas)</div>
              <div className="font-semibold tabular-nums">{formatBrl(ticket.mediaPorClienteVenda)}</div>
              <div className="text-xs text-muted-foreground">{ticket.clientesDistintosVenda} cliente(s)</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Média por cliente (OS nomeadas)</div>
              <div className="font-semibold tabular-nums">{formatBrl(ticket.mediaPorClienteOs)}</div>
              <div className="text-xs text-muted-foreground">{ticket.clientesDistintosOs} cliente(s)</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Package className="w-5 h-5" />
              Top 10 produtos
            </CardTitle>
            <CardDescription>
              PDV + importação (vendas × produtos). Com coluna de custo na planilha, ordena por lucro estimado.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {rankProd.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem dados no período.</p>
            ) : (
              rankProd.map((p, i) => (
                <div
                  key={p.nome}
                  className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <Badge variant="secondary" className="shrink-0">
                      {i + 1}
                    </Badge>
                    <span className="truncate font-medium">{p.nome}</span>
                  </span>
                  <span className="shrink-0 text-right text-muted-foreground tabular-nums text-xs sm:text-sm">
                    <span className="block">{p.quantidade} un. · Fat. {formatBrl(p.receita)}</span>
                    {p.lucroEstimado != null && (
                      <span className="block font-medium text-emerald-700 dark:text-emerald-400">
                        Lucro est. {formatBrl(p.lucroEstimado)}
                      </span>
                    )}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Wrench className="w-5 h-5" />
              Top 5 serviços / defeitos (OS)
            </CardTitle>
            <CardDescription>
              Defeito/serviço importado (servicos × equipamentos) ou OS no sistema; valores quando a planilha trouxer.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {rankOs.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem OS no período.</p>
            ) : (
              rankOs.map((p, i) => (
                <div
                  key={`${p.label}-${i}`}
                  className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <Badge variant="secondary" className="shrink-0">
                      {i + 1}
                    </Badge>
                    <span className="line-clamp-2 font-medium">{p.label}</span>
                  </span>
                  <span className="shrink-0 text-right text-muted-foreground tabular-nums text-xs sm:text-sm">
                    <span className="block">{p.quantidade}×</span>
                    {p.receita != null && p.receita > 0 && (
                      <span className="block font-medium">{formatBrl(p.receita)}</span>
                    )}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="w-5 h-5" />
            Cliente — linha do tempo
          </CardTitle>
          <CardDescription>Busque por nome (vendas com cliente e OS). Ordens mais recentes primeiro.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-2">
              <Label>Nome do cliente</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Ex.: Maria"
                  value={clienteQ}
                  onChange={(e) => setClienteQ(e.target.value)}
                />
              </div>
            </div>
            <Button type="button" variant="secondary" onClick={() => setClienteQ("")}>
              Limpar
            </Button>
          </div>
          {clienteQ.trim().length < 2 ? (
            <p className="text-sm text-muted-foreground">Digite pelo menos 2 caracteres.</p>
          ) : timeline.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum registro encontrado.</p>
          ) : (
            <ul className="space-y-3 border-l-2 border-primary/30 pl-4 ml-2">
              {timeline.map((ev) => (
                <li key={`${ev.tipo}-${ev.id}`} className="relative">
                  <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-primary" />
                  <div className="rounded-lg border border-border bg-card px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Badge variant={ev.tipo === "venda" ? "default" : "secondary"}>
                        {ev.tipo === "venda" ? "Venda" : "OS"}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        <Calendar className="inline w-3 h-3 mr-1" />
                        {new Date(ev.at).toLocaleString("pt-BR")}
                      </span>
                    </div>
                    <p className="font-medium mt-1">{ev.titulo}</p>
                    <p className="text-sm text-muted-foreground line-clamp-3">{ev.detalhe}</p>
                    <p className="text-sm font-semibold tabular-nums mt-1">{formatBrl(ev.valor)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
