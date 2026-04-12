"use client"

import { useState } from "react"
import { 
  Plus, 
  Search, 
  AlertCircle,
  CheckCircle2,
  Clock,
  MoreHorizontal,
  Calendar,
  User,
  FileText,
  MessageSquare
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

const contasReceber = [
  { id: 1, descricao: "OS #1234 - Troca de Tela iPhone 12", cliente: "João Silva", valor: 450.00, vencimento: "15/04/2026", status: "pendente", tipo: "OS" },
  { id: 2, descricao: "Venda - Galaxy S22 Usado", cliente: "Maria Santos", valor: 2800.00, vencimento: "10/04/2026", status: "pendente", tipo: "Venda" },
  { id: 3, descricao: "Carnê 3/6 - Notebook Dell", cliente: "Pedro Costa", valor: 500.00, vencimento: "05/04/2026", status: "atrasado", tipo: "Carnê" },
  { id: 4, descricao: "OS #1228 - Reparo Placa Mãe", cliente: "Ana Oliveira", valor: 800.00, vencimento: "08/04/2026", status: "pago", tipo: "OS" },
  { id: 5, descricao: "Carnê 2/4 - iPhone 11", cliente: "Carlos Mendes", valor: 750.00, vencimento: "20/04/2026", status: "pendente", tipo: "Carnê" },
  { id: 6, descricao: "Venda - Acessórios", cliente: "Lucia Ferreira", valor: 189.90, vencimento: "09/04/2026", status: "pago", tipo: "Venda" },
  { id: 7, descricao: "OS #1235 - Troca Bateria", cliente: "Roberto Lima", valor: 150.00, vencimento: "12/04/2026", status: "pendente", tipo: "OS" },
]

const resumo = {
  totalReceber: 5649.90,
  receberHoje: 2,
  atrasados: 1,
  recebidoMes: 989.90
}

export function ContasReceber() {
  const [filtro, setFiltro] = useState("todos")

  const contasFiltradas = filtro === "todos" 
    ? contasReceber 
    : contasReceber.filter(c => c.status === filtro)

  const getStatusConfig = (status: string) => {
    switch (status) {
      case "pago":
        return { icon: CheckCircle2, color: "text-green-500", bg: "bg-green-500/10", label: "Recebido" }
      case "atrasado":
        return { icon: AlertCircle, color: "text-red-500", bg: "bg-red-500/10", label: "Atrasado" }
      default:
        return { icon: Clock, color: "text-yellow-500", bg: "bg-yellow-500/10", label: "Pendente" }
    }
  }

  const getTipoIcon = (tipo: string) => {
    switch (tipo) {
      case "OS":
        return FileText
      case "Carnê":
        return Calendar
      default:
        return User
    }
  }

  return (
    <div className="space-y-6">
      {/* Cards de Resumo */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Total a Receber</p>
            <p className="text-xl font-bold text-foreground">
              R$ {resumo.totalReceber.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Vencendo Hoje</p>
            <p className="text-xl font-bold text-yellow-500">{resumo.receberHoje}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Atrasados</p>
            <p className="text-xl font-bold text-red-500">{resumo.atrasados}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Recebido este Mês</p>
            <p className="text-xl font-bold text-green-500">
              R$ {resumo.recebidoMes.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filtros e Ações */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between">
        <div className="flex gap-2 flex-wrap">
          {[
            { key: "todos", label: "Todos" },
            { key: "pendente", label: "Pendentes" },
            { key: "atrasado", label: "Atrasados" },
            { key: "pago", label: "Recebidos" },
          ].map((item) => (
            <Button
              key={item.key}
              variant={filtro === item.key ? "default" : "outline"}
              size="sm"
              onClick={() => setFiltro(item.key)}
            >
              {item.label}
            </Button>
          ))}
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Buscar cliente..." className="pl-10 w-48" />
          </div>
          <Button>
            <Plus className="w-4 h-4 mr-2" />
            Nova Cobrança
          </Button>
        </div>
      </div>

      {/* Lista de Contas */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle>Contas a Receber</CardTitle>
          <CardDescription>Controle de pagamentos de OS, vendas e carnês</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {contasFiltradas.map((conta) => {
              const statusConfig = getStatusConfig(conta.status)
              const StatusIcon = statusConfig.icon
              const TipoIcon = getTipoIcon(conta.tipo)
              
              return (
                <div 
                  key={conta.id} 
                  className="flex items-center justify-between p-4 rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className={cn("w-10 h-10 rounded-full flex items-center justify-center", statusConfig.bg)}>
                      <StatusIcon className={cn("w-5 h-5", statusConfig.color)} />
                    </div>
                    <div>
                      <p className="font-medium text-foreground">{conta.descricao}</p>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <User className="w-3 h-3" />
                        {conta.cliente}
                        <span className="px-1.5 py-0.5 rounded bg-secondary text-xs">{conta.tipo}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="font-semibold text-foreground">
                        R$ {conta.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                      </p>
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Calendar className="w-3 h-3" />
                        {conta.vencimento}
                      </div>
                    </div>
                    <span className={cn(
                      "px-2 py-1 rounded-full text-xs font-medium",
                      statusConfig.bg,
                      statusConfig.color
                    )}>
                      {statusConfig.label}
                    </span>
                    {conta.status === "atrasado" && (
                      <Button variant="outline" size="sm" className="text-primary border-primary">
                        <MessageSquare className="w-4 h-4 mr-1" />
                        Cobrar
                      </Button>
                    )}
                    <Button variant="ghost" size="icon">
                      <MoreHorizontal className="w-4 h-4" />
                    </Button>
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
