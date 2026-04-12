"use client"

import { CheckCircle2, ShoppingCart, Wallet, Package, Clock } from "lucide-react"
import { Card } from "@/components/ui/card"

const activities = [
  {
    id: 1,
    type: "os_completed",
    title: "OS #1234 finalizada",
    description: "Reparo de smartphone - Cliente: João Silva",
    time: "Há 5 min",
    icon: CheckCircle2,
  },
  {
    id: 2,
    type: "sale",
    title: "Nova venda realizada",
    description: "Capinha protetora + Película - R$ 89,90",
    time: "Há 12 min",
    icon: ShoppingCart,
  },
  {
    id: 3,
    type: "payment",
    title: "Pagamento recebido",
    description: "Pix - OS #1230 - R$ 250,00",
    time: "Há 25 min",
    icon: Wallet,
  },
  {
    id: 4,
    type: "stock",
    title: "Estoque atualizado",
    description: "Entrada: 50x Tela iPhone 12",
    time: "Há 1 hora",
    icon: Package,
  },
  {
    id: 5,
    type: "os_pending",
    title: "OS #1235 aguardando peça",
    description: "Reparo de notebook - Cliente: Maria Santos",
    time: "Há 2 horas",
    icon: Clock,
  },
]

function getIconColor(type: string) {
  switch (type) {
    case "os_completed":
      return "text-primary"
    case "sale":
      return "text-primary"
    case "payment":
      return "text-primary"
    case "stock":
      return "text-primary"
    case "os_pending":
      return "text-primary/80"
    default:
      return "text-muted-foreground"
  }
}

export function ActivityList() {
  return (
    <Card className="bg-card border-border">
      <div className="p-4 border-b border-border">
        <h2 className="text-lg font-semibold text-foreground">Últimas Atividades</h2>
        <p className="text-sm text-muted-foreground">Atualizações em tempo real</p>
      </div>
      <div className="divide-y divide-border">
        {activities.map((activity) => (
          <div
            key={activity.id}
            className="flex items-start gap-4 p-4 hover:bg-secondary/50 transition-colors"
          >
            <div className={`mt-0.5 ${getIconColor(activity.type)}`}>
              <activity.icon className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">{activity.title}</p>
              <p className="text-xs text-muted-foreground truncate">{activity.description}</p>
            </div>
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {activity.time}
            </span>
          </div>
        ))}
      </div>
    </Card>
  )
}
