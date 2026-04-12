"use client"

import { useState } from "react"
import { 
  TrendingUp, 
  TrendingDown, 
  ArrowUpRight, 
  ArrowDownRight,
  Calendar,
  Filter,
  Download
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const resumoFinanceiro = {
  saldoAtual: 15750.00,
  entradas: 28450.00,
  saidas: 12700.00,
  previsaoMes: 18500.00
}

const movimentacoes = [
  { id: 1, tipo: "entrada", descricao: "Venda - iPhone 13 Pro", valor: 4500.00, data: "09/04/2026", categoria: "Vendas" },
  { id: 2, tipo: "entrada", descricao: "OS #1234 - Troca de Tela", valor: 350.00, data: "09/04/2026", categoria: "Serviços" },
  { id: 3, tipo: "saida", descricao: "Fornecedor - Peças Samsung", valor: 1200.00, data: "08/04/2026", categoria: "Fornecedores" },
  { id: 4, tipo: "entrada", descricao: "Carnê - João Silva (3/6)", valor: 150.00, data: "08/04/2026", categoria: "Carnê" },
  { id: 5, tipo: "saida", descricao: "Conta de Luz", valor: 450.00, data: "07/04/2026", categoria: "Despesas Fixas" },
  { id: 6, tipo: "entrada", descricao: "Venda - Carregador Original", valor: 89.90, data: "07/04/2026", categoria: "Vendas" },
  { id: 7, tipo: "saida", descricao: "Aluguel da Loja", valor: 2500.00, data: "05/04/2026", categoria: "Despesas Fixas" },
  { id: 8, tipo: "entrada", descricao: "OS #1230 - Reparo Placa", valor: 800.00, data: "05/04/2026", categoria: "Serviços" },
]

export function FluxoCaixa() {
  const [periodoSelecionado, setPeriodoSelecionado] = useState("mes")

  return (
    <div className="space-y-6">
      {/* Header com filtros */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between">
        <div className="flex gap-2">
          {["hoje", "semana", "mes", "ano"].map((periodo) => (
            <Button
              key={periodo}
              variant={periodoSelecionado === periodo ? "default" : "outline"}
              size="sm"
              onClick={() => setPeriodoSelecionado(periodo)}
              className="capitalize"
            >
              {periodo === "mes" ? "Este Mês" : periodo === "semana" ? "Semana" : periodo === "ano" ? "Ano" : "Hoje"}
            </Button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm">
            <Calendar className="w-4 h-4 mr-2" />
            Período
          </Button>
          <Button variant="outline" size="sm">
            <Filter className="w-4 h-4 mr-2" />
            Filtrar
          </Button>
          <Button variant="outline" size="sm">
            <Download className="w-4 h-4 mr-2" />
            Exportar
          </Button>
        </div>
      </div>

      {/* Cards de Resumo */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Saldo Atual</p>
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
                <p className="text-sm text-muted-foreground">Entradas</p>
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
                <p className="text-sm text-muted-foreground">Saídas</p>
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
                <p className="text-sm text-muted-foreground">Previsão Mês</p>
                <p className="text-2xl font-bold text-foreground">
                  R$ {resumoFinanceiro.previsaoMes.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </p>
              </div>
              <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center">
                <TrendingDown className="w-6 h-6 text-blue-500" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Lista de Movimentações */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle>Movimentações Recentes</CardTitle>
          <CardDescription>Histórico de entradas e saídas do caixa</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {movimentacoes.map((mov) => (
              <div 
                key={mov.id} 
                className="flex items-center justify-between p-4 rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className={cn(
                    "w-10 h-10 rounded-full flex items-center justify-center",
                    mov.tipo === "entrada" ? "bg-green-500/10" : "bg-red-500/10"
                  )}>
                    {mov.tipo === "entrada" ? (
                      <ArrowUpRight className="w-5 h-5 text-green-500" />
                    ) : (
                      <ArrowDownRight className="w-5 h-5 text-red-500" />
                    )}
                  </div>
                  <div>
                    <p className="font-medium text-foreground">{mov.descricao}</p>
                    <p className="text-sm text-muted-foreground">{mov.categoria} • {mov.data}</p>
                  </div>
                </div>
                <p className={cn(
                  "font-semibold",
                  mov.tipo === "entrada" ? "text-green-500" : "text-red-500"
                )}>
                  {mov.tipo === "entrada" ? "+" : "-"} R$ {mov.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
