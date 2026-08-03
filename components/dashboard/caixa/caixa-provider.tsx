"use client"

import { createContext, useCallback, useContext, type ReactNode } from "react"
import { useOperationsStore } from "@/lib/operations-store"
import { isCaixaReferenceStale, type CaixaRefreshOutcome } from "@/lib/pdv-caixa-session"

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
  /** ID da sessão no servidor (persistido em localStorage via OperationsProvider). */
  sessaoId: string | null
  setSessaoId: (id: string | null) => void
  /**
   * Reconsulta a sessão ativa da loja no servidor e re-hidrata o estado local.
   * Ação de recuperação ("Atualizar caixa") — não toca no carrinho nem em vendas.
   */
  refreshSession: () => Promise<CaixaRefreshOutcome>
  /**
   * Caixa aparece aberto mas sem referência de sessão utilizável: a finalização
   * seria recusada com "Sessão de caixa inválida". A UI deve oferecer recuperação.
   */
  sessaoDesatualizada: boolean
}

const CaixaContext = createContext<CaixaContextType | undefined>(undefined)

export function CaixaProvider({ children }: { children: ReactNode }) {
  const {
    caixa,
    caixaSessaoId,
    setCaixaSessaoId,
    refreshCaixaSession,
    abrirCaixa: _abrirCaixa,
    fecharCaixa: _fecharCaixa,
    adicionarEntrada,
    adicionarSaida,
    getSaldoAtual,
  } = useOperationsStore()

  const abrirCaixa = useCallback(
    (saldoInicial: number) => {
      _abrirCaixa(saldoInicial)
    },
    [_abrirCaixa]
  )

  const fecharCaixa = useCallback(() => {
    _fecharCaixa()
  }, [_fecharCaixa])

  return (
    <CaixaContext.Provider
      value={{
        caixa,
        abrirCaixa,
        fecharCaixa,
        adicionarEntrada,
        adicionarSaida,
        getSaldoAtual,
        sessaoId: caixaSessaoId,
        setSessaoId: setCaixaSessaoId,
        refreshSession: refreshCaixaSession,
        sessaoDesatualizada: isCaixaReferenceStale({ isOpen: caixa.isOpen, sessaoId: caixaSessaoId }),
      }}
    >
      {children}
    </CaixaContext.Provider>
  )
}

const defaultCaixaState: CaixaState = {
  isOpen: false,
  saldoInicial: 0,
  dataAbertura: null,
  totalEntradas: 0,
  totalSaidas: 0,
}

const defaultContext: CaixaContextType = {
  caixa: defaultCaixaState,
  abrirCaixa: () => {},
  fecharCaixa: () => {},
  adicionarEntrada: () => {},
  adicionarSaida: () => {},
  getSaldoAtual: () => 0,
  sessaoId: null,
  setSessaoId: () => {},
  refreshSession: async () => ({ ok: false, status: "falha", reason: "rede" }),
  sessaoDesatualizada: false,
}

export function useCaixa() {
  const context = useContext(CaixaContext)
  if (!context) {
    return defaultContext
  }
  return context
}
