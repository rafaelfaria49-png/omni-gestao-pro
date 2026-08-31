"use client"

import { useState } from "react"
import { Clock, RotateCcw, Trash2, PauseCircle } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import type { HeldSale } from "@/lib/pdv-hold"

function formatTime(isoStr: string): string {
  try {
    return new Date(isoStr).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
  } catch {
    return ""
  }
}

function saleTotal(sale: HeldSale): number {
  const gross = sale.items.reduce((acc, i) => acc + i.price * i.quantity, 0)
  const discR = sale.discountReais ?? 0
  const discP = sale.discountPercent ?? 0
  const afterPct = gross * (1 - discP / 100)
  return Math.max(0, afterPct - discR)
}

interface VendaEsperaModalProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  heldSales: HeldSale[]
  cartEmpty: boolean
  onHold: () => void
  onResume: (sale: HeldSale) => boolean | void
  onDiscard: (id: string) => void
}

export function VendaEsperaModal({
  open,
  onOpenChange,
  heldSales,
  cartEmpty,
  onHold,
  onResume,
  onDiscard,
}: VendaEsperaModalProps) {
  const [pendingResume, setPendingResume] = useState<HeldSale | null>(null)
  const [pendingDiscardId, setPendingDiscardId] = useState<string | null>(null)

  const resume = (sale: HeldSale) => {
    if (!cartEmpty) {
      setPendingResume(sale)
      return
    }
    if (onResume(sale) !== false) onOpenChange(false)
  }

  const confirmResumeWithCurrentHold = () => {
    if (!pendingResume) return
    onHold()
    const resumed = onResume(pendingResume)
    if (resumed !== false) {
      setPendingResume(null)
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PauseCircle className="h-5 w-5 text-primary" />
            Vendas em espera
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {!cartEmpty && (
            <Button
              onClick={() => {
                onHold()
                onOpenChange(false)
              }}
              className="w-full"
              variant="default"
            >
              <PauseCircle className="mr-2 h-4 w-4" />
              Colocar venda atual em espera
            </Button>
          )}

          {heldSales.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-4">Nenhuma venda em espera.</p>
          ) : (
            <ScrollArea className="max-h-72">
              <div className="flex flex-col gap-2 pr-2">
                {heldSales.map((sale) => (
                  <div
                    key={sale.id}
                    className="rounded-lg border border-border bg-muted/30 p-3 flex flex-col gap-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{sale.label}</span>
                        {sale.customer?.name ? (
                          <Badge variant="outline" className="text-xs">
                            {sale.customer.name}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">Consumidor</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {formatTime(sale.savedAt)}
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {sale.items.reduce((total, item) => total + item.quantity, 0)} {sale.items.reduce((total, item) => total + item.quantity, 0) === 1 ? "item" : "itens"}
                      </span>
                      <span className="font-semibold text-foreground">
                        {saleTotal(sale).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                      </span>
                    </div>

                    <p className="truncate text-xs text-muted-foreground" title={sale.items[0]?.name ?? "Venda sem itens"}>
                      {sale.items[0]?.name ?? "Venda sem itens"}
                      {sale.items.length > 1 ? ` + ${sale.items.length - 1} ${sale.items.length === 2 ? "item" : "itens"}` : ""}
                    </p>

                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="default"
                        className="flex-1"
                        onClick={() => resume(sale)}
                      >
                        <RotateCcw className="mr-1 h-3 w-3" />
                        Retomar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        aria-label={`Descartar ${sale.label}`}
                        onClick={() => setPendingDiscardId(sale.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      </DialogContent>

      <AlertDialog open={pendingResume !== null} onOpenChange={(value) => !value && setPendingResume(null)}>
        <AlertDialogContent className="max-w-sm border-border bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle>Carrinho atual não está vazio</AlertDialogTitle>
            <AlertDialogDescription>
              Para retomar {pendingResume?.label ?? "esta venda"}, o carrinho atual precisa ser preservado.
              Coloque-o em espera e abra a venda selecionada?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmResumeWithCurrentHold}>
              Colocar atual em espera
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={pendingDiscardId !== null} onOpenChange={(value) => !value && setPendingDiscardId(null)}>
        <AlertDialogContent className="max-w-sm border-border bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle>Descartar venda em espera?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação remove apenas o hold local. Nenhuma venda real, estoque, Financeiro ou Caixa será alterado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDiscardId) onDiscard(pendingDiscardId)
                setPendingDiscardId(null)
              }}
            >
              Descartar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}
