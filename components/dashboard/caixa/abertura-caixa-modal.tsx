"use client"

import { useState } from "react"
import { Unlock, DollarSign, Calculator } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { useCaixa } from "./caixa-provider"
import { useConfigEmpresa } from "@/lib/config-empresa"
import { appendAuditLog } from "@/lib/audit-log"

interface AberturaCaixaModalProps {
  isOpen: boolean
  onClose: () => void
}

export function AberturaCaixaModal({ isOpen, onClose }: AberturaCaixaModalProps) {
  const { abrirCaixa } = useCaixa()
  const { config } = useConfigEmpresa()
  const [saldoInicial, setSaldoInicial] = useState("")

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL"
    }).format(value)
  }

  const handleQuickValue = (value: number) => {
    setSaldoInicial(value.toString())
  }

  const handleAbrirCaixa = () => {
    const valor = parseFloat(saldoInicial) || 0
    abrirCaixa(valor)
    appendAuditLog({
      action: "caixa_aberto",
      userLabel: `${(config.empresa.nomeFantasia || "Loja").trim() || "Administrador"} (sessão local)`,
      detail: `Saldo inicial ${formatCurrency(valor)}`,
    })
    setSaldoInicial("")
    onClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md bg-card border-border">
        <DialogHeader className="pb-2">
          <DialogTitle className="text-xl font-bold text-foreground flex items-center gap-2">
            <Unlock className="w-6 h-6 text-primary" />
            Abertura de Caixa
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Informe o valor em dinheiro disponivel para iniciar as operacoes do dia.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 pt-4">
          {/* Icone Central */}
          <div className="flex justify-center">
            <div className="w-20 h-20 rounded-full bg-primary/10 border-2 border-primary/30 flex items-center justify-center">
              <DollarSign className="w-10 h-10 text-primary" />
            </div>
          </div>

          {/* Input de Valor */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Saldo Inicial do Caixa</Label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground text-lg">R$</span>
              <Input
                type="number"
                placeholder="0,00"
                value={saldoInicial}
                onChange={(e) => setSaldoInicial(e.target.value)}
                className="pl-12 h-14 text-2xl font-bold text-center bg-secondary border-border"
              />
            </div>
          </div>

          {/* Valores Rapidos */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Valores rapidos</Label>
            <div className="grid grid-cols-4 gap-2">
              {[50, 100, 200, 300].map((value) => (
                <Button
                  key={value}
                  variant="outline"
                  size="sm"
                  onClick={() => handleQuickValue(value)}
                  className="border-border hover:bg-primary hover:text-primary-foreground"
                >
                  R$ {value}
                </Button>
              ))}
            </div>
          </div>

          {/* Preview */}
          <Card className="bg-secondary border-border">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Calculator className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Valor de abertura:</span>
                </div>
                <span className="text-xl font-bold text-primary">
                  {formatCurrency(parseFloat(saldoInicial) || 0)}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Botoes */}
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={onClose}
              className="flex-1 h-12 border-border"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleAbrirCaixa}
              className="flex-1 h-12 bg-primary hover:bg-primary/90 font-semibold"
            >
              <Unlock className="w-4 h-4 mr-2" />
              Abrir Caixa
            </Button>
          </div>

          {/* Informacao */}
          <p className="text-xs text-center text-muted-foreground">
            O valor informado sera usado como troco inicial para as vendas do dia.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
