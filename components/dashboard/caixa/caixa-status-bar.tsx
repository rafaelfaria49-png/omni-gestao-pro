"use client"

import { useEffect, useState } from "react"
import { 
  Lock, 
  Unlock, 
  Clock, 
  DollarSign, 
  TrendingUp, 
  TrendingDown,
  AlertTriangle,
  X
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useCaixa } from "./caixa-provider"
import { AberturaCaixaModal } from "./abertura-caixa-modal"
import { FechamentoCaixaModal } from "./fechamento-caixa-modal"

interface CaixaStatusBarProps {
  /** Incrementado por comando de voz para abrir o fluxo de abertura de caixa. */
  openAberturaSignal?: number
  onOpenAberturaSignalConsumed?: () => void
}

export function CaixaStatusBar({
  openAberturaSignal = 0,
  onOpenAberturaSignalConsumed,
}: CaixaStatusBarProps) {
  const { caixa, getSaldoAtual } = useCaixa()
  const [showAbertura, setShowAbertura] = useState(false)
  const [showFechamento, setShowFechamento] = useState(false)

  useEffect(() => {
    if (!openAberturaSignal) return
    if (!caixa.isOpen) {
      setShowAbertura(true)
    }
    onOpenAberturaSignalConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sinal é um contador; callback opcional
  }, [openAberturaSignal, caixa.isOpen])

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL"
    }).format(value)
  }

  const formatTime = (date: Date | null) => {
    if (!date) return "--:--"
    return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
  }

  if (!caixa.isOpen) {
    return (
      <>
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 mb-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center">
                <Lock className="w-5 h-5 text-amber-500" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-amber-500">Caixa Fechado</span>
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                </div>
                <p className="text-sm text-muted-foreground">Abra o caixa para realizar vendas</p>
              </div>
            </div>
            <Button 
              onClick={() => setShowAbertura(true)}
              className="bg-primary hover:bg-primary/90 font-semibold"
            >
              <Unlock className="w-4 h-4 mr-2" />
              Abrir Caixa
            </Button>
          </div>
        </div>

        <AberturaCaixaModal 
          isOpen={showAbertura} 
          onClose={() => setShowAbertura(false)} 
        />
      </>
    )
  }

  return (
    <>
      <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 mb-4">
        <div className="flex flex-col lg:flex-row items-center justify-between gap-4">
          {/* Status Principal */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
              <Unlock className="w-5 h-5 text-green-500" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-green-500">Caixa Aberto</span>
                <Badge variant="outline" className="text-xs border-green-500/50 text-green-500">
                  <Clock className="w-3 h-3 mr-1" />
                  Desde {formatTime(caixa.dataAbertura)}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">Pronto para vendas</p>
            </div>
          </div>

          {/* Resumo do Caixa */}
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-2 bg-secondary rounded-lg">
              <DollarSign className="w-4 h-4 text-muted-foreground" />
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Abertura</p>
                <p className="font-semibold text-sm">{formatCurrency(caixa.saldoInicial)}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 px-3 py-2 bg-green-500/10 rounded-lg">
              <TrendingUp className="w-4 h-4 text-green-500" />
              <div className="text-right">
                <p className="text-xs text-green-400">Entradas</p>
                <p className="font-semibold text-sm text-green-500">{formatCurrency(caixa.totalEntradas)}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 px-3 py-2 bg-red-500/10 rounded-lg">
              <TrendingDown className="w-4 h-4 text-red-500" />
              <div className="text-right">
                <p className="text-xs text-red-400">Saidas</p>
                <p className="font-semibold text-sm text-red-500">{formatCurrency(caixa.totalSaidas)}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 px-4 py-2 bg-primary/10 border border-primary/30 rounded-lg">
              <div className="text-right">
                <p className="text-xs text-primary">Saldo Atual</p>
                <p className="font-bold text-lg text-primary">{formatCurrency(getSaldoAtual())}</p>
              </div>
            </div>
          </div>

          {/* Botao Fechar Caixa */}
          <Button 
            variant="outline"
            onClick={() => setShowFechamento(true)}
            className="border-red-500/50 text-red-500 hover:bg-red-500 hover:text-white"
          >
            <Lock className="w-4 h-4 mr-2" />
            Fechar Caixa
          </Button>
        </div>
      </div>

      <FechamentoCaixaModal 
        isOpen={showFechamento} 
        onClose={() => setShowFechamento(false)} 
      />
    </>
  )
}
