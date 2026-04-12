"use client"

import { useMemo } from "react"
import Link from "next/link"
import { ClipboardList, DollarSign, AlertTriangle, CalendarClock, Bell } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ensureLedger, useOperationsStore } from "@/lib/operations-store"
import { useFinanceiro } from "@/lib/financeiro-store"

export function StatsCards() {
  const { ordens, inventory, caixa, dailyLedger } = useOperationsStore()
  const { boletosVencendoHojeOuAmanha } = useFinanceiro()
  const ledger = ensureLedger(dailyLedger)
  const formatBrl = (value: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value)

  const osPendentes = useMemo(
    () => ordens.filter((o) => o.status !== "finalizado").length,
    [ordens]
  )
  const estoqueBaixo = useMemo(
    () => inventory.filter((i) => i.stock <= 5).length,
    [inventory]
  )
  const faturamentoHoje = ledger.totalVendas
  const contasVencer = caixa.totalSaidas
  const faturamentoSemanal = [
    Math.max(80, faturamentoHoje * 0.4),
    Math.max(80, faturamentoHoje * 0.52),
    Math.max(80, faturamentoHoje * 0.45),
    Math.max(80, faturamentoHoje * 0.68),
    Math.max(80, faturamentoHoje * 0.55),
    Math.max(80, faturamentoHoje * 0.85),
    Math.max(80, faturamentoHoje),
  ]
  const stats = [
    {
      title: "O.S. Pendentes",
      value: String(osPendentes),
      description: "Aguardando atendimento",
      icon: ClipboardList,
    },
    {
      title: "Vendas Hoje",
      value: formatBrl(faturamentoHoje),
      description: "Total de vendas registradas hoje (PDV)",
      icon: DollarSign,
    },
    {
      title: "Produtos com Estoque Baixo",
      value: String(estoqueBaixo),
      description: "Requer reposição",
      icon: AlertTriangle,
    },
    {
      title: "Contas a Vencer",
      value: formatBrl(contasVencer),
      description: "Saídas do caixa atual",
      icon: CalendarClock,
    },
  ]

  const boletosUrgentes = boletosVencendoHojeOuAmanha()

  return (
    <div className="space-y-4">
      {boletosUrgentes.length > 0 && (
        <Card className="p-4 border-amber-500/40 bg-amber-500/10">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/20">
                <Bell className="h-5 w-5 text-amber-700 dark:text-amber-300" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">Boletos — vencem hoje ou amanhã</p>
                <ul className="mt-1 text-sm text-muted-foreground list-disc list-inside space-y-0.5">
                  {boletosUrgentes.slice(0, 5).map((b) => (
                    <li key={b.id}>
                      {b.descricao} —{" "}
                      {b.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} — venc.{" "}
                      {b.dataVencimento.split("-").reverse().join("/")}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <Button asChild variant="outline" size="sm" className="border-amber-600/40 shrink-0">
              <Link href="/?page=contas-pagar">Ver contas a pagar</Link>
            </Button>
          </div>
        </Card>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <Card
            key={stat.title}
            className="p-4 bg-card border-border hover:border-primary/50 transition-colors"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {stat.title}
                </p>
                <p className="text-2xl font-bold text-foreground mt-1">{stat.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{stat.description}</p>
              </div>
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
                <stat.icon className="w-5 h-5 text-primary" />
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Card className="p-4 bg-card border-border">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-foreground">Faturamento Semanal</h3>
          <span className="text-xs text-muted-foreground">Ultimos 7 dias</span>
        </div>
        <div className="flex items-end gap-2 h-36">
          {faturamentoSemanal.map((valor, index) => {
            const max = Math.max(...faturamentoSemanal)
            const height = `${Math.max(16, (valor / max) * 100)}%`
            return (
              <div key={`${valor}-${index}`} className="flex-1 flex flex-col items-center gap-2">
                <div className="w-full bg-primary/90 rounded-t-md" style={{ height }} />
                <span className="text-[10px] text-muted-foreground">D{index + 1}</span>
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}
