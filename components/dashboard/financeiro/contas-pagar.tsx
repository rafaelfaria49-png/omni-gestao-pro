"use client"

import { useMemo, useState } from "react"
import {
  Plus,
  Search,
  AlertCircle,
  CheckCircle2,
  Clock,
  MoreHorizontal,
  Calendar,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { useFinanceiro } from "@/lib/financeiro-store"
import type { ContaPagarItem } from "@/lib/financeiro-types"
import { useToast } from "@/hooks/use-toast"

function todayISO(): string {
  return new Date().toISOString().split("T")[0]
}

function effectiveStatus(c: ContaPagarItem): ContaPagarItem["status"] {
  if (c.status === "pago") return "pago"
  const d = c.dataVencimento
  if (d < todayISO()) return "atrasado"
  return "pendente"
}

export function ContasPagar() {
  const { contasPagar, setContasPagar } = useFinanceiro()
  const { toast } = useToast()
  const [filtro, setFiltro] = useState("todos")
  const [busca, setBusca] = useState("")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<ContaPagarItem | null>(null)
  const [form, setForm] = useState({
    descricao: "",
    fornecedor: "",
    valor: "",
    dataVencimento: todayISO(),
    categoria: "Despesas Fixas",
    status: "pendente" as ContaPagarItem["status"],
  })

  const contasComStatus = useMemo(
    () =>
      contasPagar.map((c) => ({
        ...c,
        status: effectiveStatus(c),
      })),
    [contasPagar]
  )

  const contasFiltradas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return contasComStatus.filter((c) => {
      const matchFiltro = filtro === "todos" || c.status === filtro
      const matchBusca =
        !q ||
        c.descricao.toLowerCase().includes(q) ||
        c.fornecedor.toLowerCase().includes(q)
      return matchFiltro && matchBusca
    })
  }, [contasComStatus, filtro, busca])

  const resumo = useMemo(() => {
    const pendentes = contasComStatus.filter((c) => c.status === "pendente" || c.status === "atrasado")
    const totalPagar = pendentes.reduce((s, c) => s + c.valor, 0)
    const hoje = todayISO()
    const amanha = new Date()
    amanha.setDate(amanha.getDate() + 1)
    const amanhaStr = amanha.toISOString().split("T")[0]
    const vencendo = contasComStatus.filter(
      (c) =>
        (c.status === "pendente" || c.status === "atrasado") &&
        (c.dataVencimento === hoje || c.dataVencimento === amanhaStr)
    ).length
    const atrasados = contasComStatus.filter((c) => c.status === "atrasado").length
    const pagoMes = contasComStatus
      .filter((c) => c.status === "pago")
      .reduce((s, c) => s + c.valor, 0)
    return { totalPagar, vencendo, atrasados, pagoMes }
  }, [contasComStatus])

  const openNovo = () => {
    setEditing(null)
    setForm({
      descricao: "",
      fornecedor: "",
      valor: "",
      dataVencimento: todayISO(),
      categoria: "Despesas Fixas",
      status: "pendente",
    })
    setDialogOpen(true)
  }

  const openEdit = (c: ContaPagarItem) => {
    setEditing(c)
    setForm({
      descricao: c.descricao,
      fornecedor: c.fornecedor,
      valor: String(c.valor),
      dataVencimento: c.dataVencimento,
      categoria: c.categoria,
      status: c.status === "atrasado" ? "pendente" : c.status,
    })
    setDialogOpen(true)
  }

  const salvar = () => {
    const valor = parseFloat(form.valor.replace(",", "."))
    if (!form.descricao.trim() || !Number.isFinite(valor) || valor <= 0) {
      toast({ title: "Preencha descrição e valor válidos", variant: "destructive" })
      return
    }
    const row: ContaPagarItem = {
      id: editing?.id ?? `cp-${Date.now()}`,
      descricao: form.descricao.trim(),
      fornecedor: form.fornecedor.trim(),
      valor,
      dataVencimento: form.dataVencimento,
      status: form.status,
      categoria: form.categoria,
    }
    if (editing) {
      setContasPagar((prev) => prev.map((x) => (x.id === editing.id ? row : x)))
      toast({ title: "Conta atualizada" })
    } else {
      setContasPagar((prev) => [...prev, row])
      toast({ title: "Conta adicionada" })
    }
    setDialogOpen(false)
  }

  const getStatusConfig = (status: string) => {
    switch (status) {
      case "pago":
        return { icon: CheckCircle2, color: "text-green-500", bg: "bg-green-500/10", label: "Pago" }
      case "atrasado":
        return { icon: AlertCircle, color: "text-red-500", bg: "bg-red-500/10", label: "Atrasado" }
      default:
        return { icon: Clock, color: "text-yellow-500", bg: "bg-yellow-500/10", label: "Pendente" }
    }
  }

  const fmtData = (iso: string) => {
    const [y, m, d] = iso.split("-")
    if (!y || !m || !d) return iso
    return `${d}/${m}/${y}`
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Total a Pagar</p>
            <p className="text-xl font-bold text-foreground">
              {resumo.totalPagar.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Vencem hoje/amanhã</p>
            <p className="text-xl font-bold text-yellow-500">{resumo.vencendo}</p>
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
            <p className="text-sm text-muted-foreground">Pago (marcados)</p>
            <p className="text-xl font-bold text-green-500">
              {resumo.pagoMes.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 justify-between">
        <div className="flex gap-2 flex-wrap">
          {[
            { key: "todos", label: "Todos" },
            { key: "pendente", label: "Pendentes" },
            { key: "atrasado", label: "Atrasados" },
            { key: "pago", label: "Pagos" },
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
        <div className="flex gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar conta..."
              className="pl-10"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <Button onClick={openNovo}>
            <Plus className="w-4 h-4 mr-2" />
            Nova Conta
          </Button>
        </div>
      </div>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle>Contas a Pagar</CardTitle>
          <CardDescription>Despesas com data de vencimento para agenda de boletos</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {contasFiltradas.map((conta) => {
              const statusConfig = getStatusConfig(conta.status)
              const StatusIcon = statusConfig.icon

              return (
                <div
                  key={conta.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors"
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <div className={cn("w-10 h-10 rounded-full flex items-center justify-center shrink-0", statusConfig.bg)}>
                      <StatusIcon className={cn("w-5 h-5", statusConfig.color)} />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-foreground truncate">{conta.descricao}</p>
                      <p className="text-sm text-muted-foreground truncate">
                        {conta.fornecedor} • {conta.categoria}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 flex-wrap justify-end">
                    <div className="text-right">
                      <p className="font-semibold text-foreground">
                        {conta.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                      </p>
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Calendar className="w-3 h-3" />
                        Venc.: {fmtData(conta.dataVencimento)}
                      </div>
                    </div>
                    <span
                      className={cn(
                        "px-2 py-1 rounded-full text-xs font-medium",
                        statusConfig.bg,
                        statusConfig.color
                      )}
                    >
                      {statusConfig.label}
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => openEdit(conta)}>
                      Editar
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar conta" : "Nova conta a pagar"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>Descrição</Label>
              <Input
                value={form.descricao}
                onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Fornecedor</Label>
              <Input
                value={form.fornecedor}
                onChange={(e) => setForm((f) => ({ ...f, fornecedor: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>Valor (R$)</Label>
                <Input
                  value={form.valor}
                  onChange={(e) => setForm((f) => ({ ...f, valor: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Data de vencimento</Label>
                <Input
                  type="date"
                  value={form.dataVencimento}
                  onChange={(e) => setForm((f) => ({ ...f, dataVencimento: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Categoria</Label>
              <Input
                value={form.categoria}
                onChange={(e) => setForm((f) => ({ ...f, categoria: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) => setForm((f) => ({ ...f, status: v as ContaPagarItem["status"] }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pendente">Pendente</SelectItem>
                  <SelectItem value="pago">Pago</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={salvar}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
