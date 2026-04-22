"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
  type Dispatch,
  type SetStateAction,
} from "react"
import { useLojaAtiva } from "@/lib/loja-ativa"
import {
  type Carteira,
  type MovimentoFinanceiro,
  type TransferenciaCarteira,
  type ContaPagarItem,
  CARTEIRAS_INICIAIS,
} from "@/lib/financeiro-types"

export function financeiroStorageKey(lojaId: string): string {
  return `assistec-pro-financeiro-v2-${lojaId}`
}

function financeiroLegacyStorageKey(lojaId: string): string {
  return `assistec-pro-financeiro-v1-${lojaId}`
}

function todayISO(): string {
  return new Date().toISOString().split("T")[0]
}

export interface FinanceiroState {
  carteiras: Carteira[]
  movimentos: MovimentoFinanceiro[]
  transferencias: TransferenciaCarteira[]
  contasPagar: ContaPagarItem[]
}

type FinanceiroContextType = FinanceiroState & {
  setCarteiras: Dispatch<SetStateAction<Carteira[]>>
  setMovimentos: Dispatch<SetStateAction<MovimentoFinanceiro[]>>
  setTransferencias: Dispatch<SetStateAction<TransferenciaCarteira[]>>
  setContasPagar: Dispatch<SetStateAction<ContaPagarItem[]>>
  saldoCarteira: (carteiraId: string) => number
  adicionarMovimento: (m: Omit<MovimentoFinanceiro, "id" | "at"> & { at?: string }) => void
  registrarTransferencia: (deId: string, paraId: string, valor: number, observacao?: string) => boolean
  boletosVencendoHojeOuAmanha: () => ContaPagarItem[]
  gastosPorCategoria: () => { categoria: string; valor: number }[]
  receitasPorCarteiraEmpresa: () => { nome: string; valor: number }[]
}

const FinanceiroContext = createContext<FinanceiroContextType | null>(null)

function parseFinanceiroState(raw: unknown): Partial<FinanceiroState> | null {
  if (!raw || typeof raw !== "object") return null
  const o = raw as Record<string, unknown>
  return {
    carteiras: Array.isArray(o.carteiras) ? (o.carteiras as Carteira[]) : undefined,
    movimentos: Array.isArray(o.movimentos) ? (o.movimentos as MovimentoFinanceiro[]) : undefined,
    transferencias: Array.isArray(o.transferencias) ? (o.transferencias as TransferenciaCarteira[]) : undefined,
    contasPagar: Array.isArray(o.contasPagar) ? (o.contasPagar as ContaPagarItem[]) : undefined,
  }
}

export function FinanceiroProvider({ children }: { children: ReactNode }) {
  const { lojaAtivaId, lojas } = useLojaAtiva()
  const key = lojaAtivaId ?? lojas[0]?.id ?? "default"

  const [carteiras, setCarteiras] = useState<Carteira[]>(CARTEIRAS_INICIAIS)
  const [movimentos, setMovimentos] = useState<MovimentoFinanceiro[]>([])
  const [transferencias, setTransferencias] = useState<TransferenciaCarteira[]>([])
  const [contasPagar, setContasPagar] = useState<ContaPagarItem[]>([])

  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      const k = financeiroStorageKey(key)
      let raw = localStorage.getItem(k)
      if (!raw) {
        const legacy = localStorage.getItem(financeiroLegacyStorageKey(key))
        if (legacy) {
          try {
            const parsedLegacy = parseFinanceiroState(JSON.parse(legacy))
            if (parsedLegacy?.carteiras?.length) setCarteiras(parsedLegacy.carteiras)
            else setCarteiras(CARTEIRAS_INICIAIS)
            setMovimentos([])
            setTransferencias([])
            setContasPagar([])
            return
          } catch {
            /* fall through */
          }
        }
        setCarteiras(CARTEIRAS_INICIAIS)
        setMovimentos([])
        setTransferencias([])
        setContasPagar([])
        return
      }
      const parsed = parseFinanceiroState(JSON.parse(raw))
      if (parsed?.carteiras?.length) setCarteiras(parsed.carteiras)
      else setCarteiras(CARTEIRAS_INICIAIS)
      setMovimentos(parsed?.movimentos ?? [])
      setTransferencias(parsed?.transferencias ?? [])
      setContasPagar(Array.isArray(parsed?.contasPagar) ? parsed.contasPagar : [])
    } catch {
      setCarteiras(CARTEIRAS_INICIAIS)
    }
  }, [key])

  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      const payload: FinanceiroState = { carteiras, movimentos, transferencias, contasPagar }
      localStorage.setItem(financeiroStorageKey(key), JSON.stringify(payload))
    } catch {
      /* ignore */
    }
  }, [key, carteiras, movimentos, transferencias, contasPagar])

  const saldoCarteira = useCallback(
    (carteiraId: string): number => {
      const c = carteiras.find((x) => x.id === carteiraId)
      if (!c) return 0
      let s = c.saldoInicial
      for (const m of movimentos) {
        if (m.carteiraId !== carteiraId) continue
        s += m.tipo === "entrada" ? m.valor : -m.valor
      }
      for (const t of transferencias) {
        if (t.deCarteiraId === carteiraId) s -= t.valor
        if (t.paraCarteiraId === carteiraId) s += t.valor
      }
      return Math.round(s * 100) / 100
    },
    [carteiras, movimentos, transferencias]
  )

  const adicionarMovimento = useCallback(
    (m: Omit<MovimentoFinanceiro, "id" | "at"> & { at?: string }) => {
      const row: MovimentoFinanceiro = {
        ...m,
        id: `mov-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        at: m.at ?? new Date().toISOString(),
      }
      setMovimentos((prev) => [...prev, row])
    },
    []
  )

  const registrarTransferencia = useCallback(
    (deId: string, paraId: string, valor: number, observacao?: string): boolean => {
      if (deId === paraId || valor <= 0) return false
      if (saldoCarteira(deId) < valor) return false
      const t: TransferenciaCarteira = {
        id: `tr-${Date.now()}`,
        deCarteiraId: deId,
        paraCarteiraId: paraId,
        valor,
        at: new Date().toISOString(),
        observacao,
      }
      setTransferencias((prev) => [...prev, t])
      return true
    },
    [saldoCarteira]
  )

  const boletosVencendoHojeOuAmanha = useCallback((): ContaPagarItem[] => {
    const hoje = todayISO()
    const t = new Date()
    t.setDate(t.getDate() + 1)
    const amanha = t.toISOString().split("T")[0]
    return contasPagar.filter((c) => {
      if (c.status !== "pendente") return false
      return c.dataVencimento === hoje || c.dataVencimento === amanha
    })
  }, [contasPagar])

  const gastosPorCategoria = useCallback((): { categoria: string; valor: number }[] => {
    const map = new Map<string, number>()
    for (const m of movimentos) {
      if (m.tipo !== "saida") continue
      const cat = m.categoria?.trim() || "Outros"
      map.set(cat, (map.get(cat) ?? 0) + m.valor)
    }
    return Array.from(map.entries())
      .map(([categoria, valor]) => ({ categoria, valor }))
      .sort((a, b) => b.valor - a.valor)
  }, [movimentos])

  const receitasPorCarteiraEmpresa = useCallback((): { nome: string; valor: number }[] => {
    const empresas = carteiras.filter((c) => c.tipo === "empresa")
    return empresas.map((c) => {
      let v = 0
      for (const m of movimentos) {
        if (m.carteiraId !== c.id || m.tipo !== "entrada") continue
        v += m.valor
      }
      return { nome: c.nome, valor: Math.round(v * 100) / 100 }
    })
  }, [carteiras, movimentos])

  const value = useMemo(
    () => ({
      carteiras,
      movimentos,
      transferencias,
      contasPagar,
      setCarteiras,
      setMovimentos,
      setTransferencias,
      setContasPagar,
      saldoCarteira,
      adicionarMovimento,
      registrarTransferencia,
      boletosVencendoHojeOuAmanha,
      gastosPorCategoria,
      receitasPorCarteiraEmpresa,
    }),
    [
      carteiras,
      movimentos,
      transferencias,
      contasPagar,
      saldoCarteira,
      adicionarMovimento,
      registrarTransferencia,
      boletosVencendoHojeOuAmanha,
      gastosPorCategoria,
      receitasPorCarteiraEmpresa,
    ]
  )

  return <FinanceiroContext.Provider value={value}>{children}</FinanceiroContext.Provider>
}

export function useFinanceiro(): FinanceiroContextType {
  const ctx = useContext(FinanceiroContext)
  if (!ctx) {
    throw new Error("useFinanceiro deve estar dentro de FinanceiroProvider")
  }
  return ctx
}
