"use client"

import { useState } from "react"
import { 
  Lock, 
  DollarSign, 
  TrendingUp, 
  TrendingDown, 
  Calculator,
  CheckCircle,
  AlertTriangle,
  Printer
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { useCaixa } from "./caixa-provider"
import { ensureLedger, useOperationsStore } from "@/lib/operations-store"
import { appendAuditLog } from "@/lib/audit-log"
import { useConfigEmpresa, configPadrao } from "@/lib/config-empresa"

interface FechamentoCaixaModalProps {
  isOpen: boolean
  onClose: () => void
}

export function FechamentoCaixaModal({ isOpen, onClose }: FechamentoCaixaModalProps) {
  const { caixa, fecharCaixa, getSaldoAtual } = useCaixa()
  const { dailyLedger } = useOperationsStore()
  const { config } = useConfigEmpresa()
  const [valorContado, setValorContado] = useState("")
  const ledger = ensureLedger(dailyLedger)
  const userAudit =
    (config.empresa.nomeFantasia || "").trim() || configPadrao.empresa.nomeFantasia

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL"
    }).format(value)
  }

  const saldoEsperado = getSaldoAtual()
  const valorContadoNum = parseFloat(valorContado) || 0
  const diferenca = valorContadoNum - saldoEsperado
  const temDiferenca = valorContado !== "" && Math.abs(diferenca) > 0.01

  const handleFecharCaixa = () => {
    if (valorContado !== "" && temDiferenca) {
      appendAuditLog({
        action: "quebra_caixa",
        userLabel: `${userAudit} (fechamento)`,
        detail: `Esperado ${formatCurrency(saldoEsperado)} | Contado ${formatCurrency(valorContadoNum)} | Diferença ${formatCurrency(diferenca)} | Dia: Din ${formatCurrency(ledger.vendasDinheiro)} Pix ${formatCurrency(ledger.vendasPix)} Déb ${formatCurrency(ledger.vendasCartaoDebito)} Créd ${formatCurrency(ledger.vendasCartaoCredito)} Carnê ${formatCurrency(ledger.vendasCarne)} Vale ${formatCurrency(ledger.vendasCreditoVale)}`,
      })
    }
    fecharCaixa()
    setValorContado("")
    onClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-lg bg-card border-border">
        <DialogHeader className="pb-2">
          <DialogTitle className="text-xl font-bold text-foreground flex items-center gap-2">
            <Lock className="w-6 h-6 text-red-500" />
            Fechamento de Caixa
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Confira os valores e conte o dinheiro em caixa antes de fechar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 pt-4">
          {/* Resumo do Dia */}
          <Card className="bg-secondary border-border">
            <CardContent className="pt-4 pb-4 space-y-4">
              <h3 className="font-semibold text-foreground flex items-center gap-2">
                <Calculator className="w-4 h-4" />
                Resumo do Caixa
              </h3>
              
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground flex items-center gap-2">
                    <DollarSign className="w-4 h-4" />
                    Abertura
                  </span>
                  <span className="font-medium">{formatCurrency(caixa.saldoInicial)}</span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-green-400 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4" />
                    Entradas (Vendas)
                  </span>
                  <span className="font-medium text-green-500">+ {formatCurrency(caixa.totalEntradas)}</span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-red-400 flex items-center gap-2">
                    <TrendingDown className="w-4 h-4" />
                    Saidas (Sangrias)
                  </span>
                  <span className="font-medium text-red-500">- {formatCurrency(caixa.totalSaidas)}</span>
                </div>

                <Separator className="bg-border" />

                <div className="flex justify-between items-center">
                  <span className="font-semibold text-foreground">Saldo Esperado</span>
                  <span className="text-xl font-bold text-primary">{formatCurrency(saldoEsperado)}</span>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-background/50 p-3 space-y-2 text-sm">
                <p className="font-medium text-foreground">Entradas do dia (fechamento cego)</p>
                <div className="grid grid-cols-1 gap-1.5 text-muted-foreground">
                  <div className="flex justify-between">
                    <span>Dinheiro</span>
                    <span className="text-foreground">{formatCurrency(ledger.vendasDinheiro)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Pix</span>
                    <span className="text-foreground">{formatCurrency(ledger.vendasPix)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Cartão débito</span>
                    <span className="text-foreground">{formatCurrency(ledger.vendasCartaoDebito)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Cartão crédito</span>
                    <span className="text-foreground">{formatCurrency(ledger.vendasCartaoCredito)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Carnê</span>
                    <span className="text-foreground">{formatCurrency(ledger.vendasCarne)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Crédito/Vale usado</span>
                    <span className="text-foreground">{formatCurrency(ledger.vendasCreditoVale)}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Input de Contagem */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Valor Contado em Caixa</Label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground text-lg">R$</span>
              <Input
                type="number"
                placeholder="Digite o valor contado..."
                value={valorContado}
                onChange={(e) => setValorContado(e.target.value)}
                className="pl-12 h-14 text-xl font-bold bg-secondary border-border"
              />
            </div>
          </div>

          {/* Status da Conferencia */}
          {valorContado !== "" && (
            <Card className={`border ${temDiferenca ? 'bg-amber-500/10 border-amber-500/30' : 'bg-green-500/10 border-green-500/30'}`}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {temDiferenca ? (
                      <AlertTriangle className="w-5 h-5 text-amber-500" />
                    ) : (
                      <CheckCircle className="w-5 h-5 text-green-500" />
                    )}
                    <span className={temDiferenca ? 'text-amber-500' : 'text-green-500'}>
                      {temDiferenca ? 'Diferenca Encontrada' : 'Conferencia OK'}
                    </span>
                  </div>
                  {temDiferenca && (
                    <span className={`font-bold ${diferenca > 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {diferenca > 0 ? '+' : ''}{formatCurrency(diferenca)}
                    </span>
                  )}
                </div>
                {temDiferenca && (
                  <p className="text-xs text-muted-foreground mt-2">
                    {diferenca > 0 
                      ? 'Ha dinheiro a mais no caixa. Verifique se houve entrada nao registrada.' 
                      : 'Ha dinheiro faltando no caixa. Verifique se houve saida nao registrada.'}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Botoes */}
          <div className="space-y-3">
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1 h-12 border-border"
              >
                <Printer className="w-4 h-4 mr-2" />
                Imprimir Relatorio
              </Button>
            </div>
            
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={onClose}
                className="flex-1 h-12 border-border"
              >
                Cancelar
              </Button>
              <Button
                onClick={handleFecharCaixa}
                className="flex-1 h-12 bg-red-500 hover:bg-red-600 font-semibold"
              >
                <Lock className="w-4 h-4 mr-2" />
                Confirmar Fechamento
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
