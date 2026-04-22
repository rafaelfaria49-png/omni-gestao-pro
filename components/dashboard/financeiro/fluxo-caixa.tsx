"use client"

import { useMemo, useState } from "react"
import {
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ArrowDownRight,
  Calendar,
  Filter,
  Download,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useFinanceiro } from "@/lib/financeiro-store"

function startOfTodayMs(): number {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function inPeriod(at: string, periodo: string): boolean {
  const t = new Date(at).getTime()
  if (Number.isNaN(t)) return false
  const now = new Date()
  if (periodo === "hoje") {
    const start = startOfTodayMs()
    return t >= start && t < start + 86400000
  }
  if (periodo === "semana") {
    const start = new Date(now)
    start.setDate(now.getDate() - now.getDay())
    start.setHours(0, 0, 0, 0)
    return t >= start.getTime()
  }
  if (periodo === "mes") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
    return t >= start
  }
  if (periodo === "ano") {
    const start = new Date(now.getFullYear(), 0, 1).getTime()
    return t >= start
  }
  return true
}

function formatPtBrDate(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString("pt-BR")
}

export function FluxoCaixa() {
  const [periodoSelecionado, setPeriodoSelecionado] = useState("mes")
  const { movimentos, carteiras, saldoCarteira } = useFinanceiro()

  const movFiltrados = useMemo(
    () => movimentos.filter((m) => inPeriod(m.at, periodoSelecionado)),
    [movimentos, periodoSelecionado]
  )

  const resumoFinanceiro = useMemo(() => {
    let entradas = 0
    let saidas = 0
    for (const m of movFiltrados) {
      if (m.tipo === "entrada") entradas += m.valor
      else saidas += m.valor
    }
    const saldoAtual = carteiras.reduce((s, c) => s + saldoCarteira(c.id), 0)
    return {
      saldoAtual: Math.round(saldoAtual * 100) / 100,
      entradas: Math.round(entradas * 100) / 100,
      saidas: Math.round(saidas * 100) / 100,
      resultadoPeriodo: Math.round((entradas - saidas) * 100) / 100,
    }
  }, [movFiltrados, carteiras, saldoCarteira])

  const listaOrdenada = useMemo(
    () =>
      [...movFiltrados].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 50),
    [movFiltrados]
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-4 justify-between">
        <div className="flex gap-2 flex-wrap">
          {["hoje", "semana", "mes", "ano"].map((periodo) => (
            <Button
              key={periodo}
              variant={periodoSelecionado === periodo ? "default" : "outline"}
              size="sm"
              onClick={() => setPeriodoSelecionado(periodo)}
              className="capitalize"
            >
              {periodo === "mes" ? "Este mês" : periodo === "semana" ? "Semana" : periodo === "ano" ? "Ano" : "Hoje"}
            </Button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" type="button" disabled title="Em breve">
            <Calendar className="w-4 h-4 mr-2" />
            Período
          </Button>
          <Button variant="outline" size="sm" type="button" disabled title="Em breve">
            <Filter className="w-4 h-4 mr-2" />
            Filtrar
          </Button>
          <Button variant="outline" size="sm" type="button" disabled title="Em breve">
            <Download className="w-4 h-4 mr-2" />
            Exportar
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Saldo (carteiras)</p>
                <p className="text-2xl font-bold text-foreground">
                  R$ {resumoFinanceiro.saldoAtual.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </p>
              </div>
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                <TrendingUp className="w-6 h-6 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Entradas (período)</p>
                <p className="text-2xl font-bold text-green-500">
                  R$ {resumoFinanceiro.entradas.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </p>
              </div>
              <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center">
                <ArrowUpRight className="w-6 h-6 text-green-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Saídas (período)</p>
                <p className="text-2xl font-bold text-red-500">
                  R$ {resumoFinanceiro.saidas.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </p>
              </div>
              <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center">
                <ArrowDownRight className="w-6 h-6 text-red-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Resultado (período)</p>
                <p className="text-2xl font-bold text-foreground">
                  R$ {resumoFinanceiro.resultadoPeriodo.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </p>
              </div>
              <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center">
                <TrendingDown className="w-6 h-6 text-blue-500" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle>Movimentações financeiras</CardTitle>
          <CardDescription>Extrato do fluxo de caixa — entradas e saídas registradas</CardDescription>
        </CardHeader>
        <CardContent>
          {listaOrdenada.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Nenhuma movimentação neste período. Use Carteiras ou importações para registrar lançamentos.
            </p>
          ) : (
            <div className="space-y-3">
              {listaOrdenada.map((mov) => (
                <div
                  key={mov.id}
                  className="flex items-center justify-between p-4 rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div
                      className={cn(
                        "w-10 h-10 rounded-full flex items-center justify-center",
                        mov.tipo === "entrada" ? "bg-green-500/10" : "bg-red-500/10"
                      )}
                    >
                      {mov.tipo === "entrada" ? (
                        <ArrowUpRight className="w-5 h-5 text-green-500" />
                      ) : (
                        <ArrowDownRight className="w-5 h-5 text-red-500" />
                      )}
                    </div>
                    <div>
                      <p className="font-medium text-foreground">{mov.descricao}</p>
                      <p className="text-sm text-muted-foreground">
                        {mov.categoria?.trim() || "Sem categoria"} • {formatPtBrDate(mov.at)}
                      </p>
                    </div>
                  </div>
                  <p
                    className={cn("font-semibold", mov.tipo === "entrada" ? "text-green-500" : "text-red-500")}
                  >
                    {mov.tipo === "entrada" ? "+" : "-"} R${" "}
                    {mov.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
