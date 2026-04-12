"use client"

import { createContext, useContext, ReactNode } from "react"
import { useOperationsStore } from "@/lib/operations-store"

interface CaixaState {
  isOpen: boolean
  saldoInicial: number
  dataAbertura: Date | null
  totalEntradas: number
  totalSaidas: number
}

interface CaixaContextType {
  caixa: CaixaState
  abrirCaixa: (saldoInicial: number) => void
  fecharCaixa: () => void
  adicionarEntrada: (valor: number) => void
  adicionarSaida: (valor: number) => void
  getSaldoAtual: () => number
}

const CaixaContext = createContext<CaixaContextType | undefined>(undefined)

export function CaixaProvider({ children }: { children: ReactNode }) {
  const {
    caixa,
    abrirCaixa,
    fecharCaixa,
    adicionarEntrada,
    adicionarSaida,
    getSaldoAtual,
  } = useOperationsStore()

  return (
    <CaixaContext.Provider value={{ 
      caixa, 
      abrirCaixa, 
      fecharCaixa, 
      adicionarEntrada, 
      adicionarSaida,
      getSaldoAtual 
    }}>
      {children}
    </CaixaContext.Provider>
  )
}

const defaultCaixaState: CaixaState = {
  isOpen: false,
  saldoInicial: 0,
  dataAbertura: null,
  totalEntradas: 0,
  totalSaidas: 0
}

const defaultContext: CaixaContextType = {
  caixa: defaultCaixaState,
  abrirCaixa: () => {},
  fecharCaixa: () => {},
  adicionarEntrada: () => {},
  adicionarSaida: () => {},
  getSaldoAtual: () => 0
}

export function useCaixa() {
  const context = useContext(CaixaContext)
  if (!context) {
    return defaultContext
  }
  return context
}
