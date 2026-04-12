"use client"

import { useState } from "react"
import { AlertTriangle, X, Package, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"

type LowStockItem = {
  id: string
  name: string
  stock: number
  minStock: number
}

const lowStockItems: LowStockItem[] = [
  { id: "1", name: "Tela iPhone 13", stock: 2, minStock: 5 },
  { id: "2", name: "Bateria Samsung S21", stock: 3, minStock: 5 },
  { id: "3", name: "Conector USB-C Universal", stock: 1, minStock: 10 },
]

interface StockAlertBannerProps {
  onNavigate?: (page: string) => void
}

export function StockAlertBanner({ onNavigate }: StockAlertBannerProps) {
  const [isVisible, setIsVisible] = useState(true)

  if (!isVisible || lowStockItems.length === 0) return null

  return (
    <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4 mb-6">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-10 h-10 rounded-full bg-destructive/20 flex items-center justify-center">
          <AlertTriangle className="w-5 h-5 text-destructive" />
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-4">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <Package className="w-4 h-4" />
              Alerta de Estoque Baixo
            </h3>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 flex-shrink-0"
              onClick={() => setIsVisible(false)}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
          
          <p className="text-sm text-muted-foreground mt-1">
            {lowStockItems.length} produto(s) precisam de reposição urgente
          </p>
          
          <div className="flex flex-wrap gap-2 mt-3">
            {lowStockItems.slice(0, 3).map((item) => (
              <div 
                key={item.id} 
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-destructive/20 text-sm"
              >
                <span className="text-foreground font-medium">{item.name}</span>
                <span className="text-destructive font-bold">{item.stock} un</span>
              </div>
            ))}
            {lowStockItems.length > 3 && (
              <span className="inline-flex items-center px-3 py-1.5 text-sm text-muted-foreground">
                +{lowStockItems.length - 3} mais
              </span>
            )}
          </div>
          
          <Button
            variant="link"
            className="p-0 h-auto mt-3 text-primary hover:text-primary/80"
            onClick={() => onNavigate?.("produtos")}
          >
            Ver todos os produtos em baixa
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      </div>
    </div>
  )
}
