"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import {
  useConfigEmpresa,
  type ConfiguracaoEmpresa,
  configPadrao,
  type PerfilLojaUnidade,
} from "@/lib/config-empresa"

const LOJA_ATIVA_STORAGE = "assistec-pro-loja-ativa-v1"
export const OPS_KEY_LEGACY = "assistec-pro-ops-v1"

export function opsKeyForLoja(lojaId: string): string {
  return `assistec-pro-ops-v1-${lojaId}`
}

/** Mescla o cadastro matriz com o perfil da unidade (documentos / térmica). */
export function mergeEmpresaComLoja(
  base: ConfiguracaoEmpresa,
  loja: PerfilLojaUnidade | undefined
): ConfiguracaoEmpresa {
  if (!loja) return base
  return {
    ...base,
    nomeFantasia: (loja.nomeFantasia || "").trim() || base.nomeFantasia,
    razaoSocial: (loja.razaoSocial || "").trim() || base.razaoSocial,
    cnpj: (loja.cnpj || "").trim() || base.cnpj,
    endereco: { ...base.endereco, ...loja.endereco },
    identidadeVisual: {
      ...base.identidadeVisual,
      logoUrl: (loja.logoUrl || "").trim() || base.identidadeVisual.logoUrl,
    },
  }
}

export function formatEnderecoEmpresa(e: ConfiguracaoEmpresa["endereco"]): string {
  const { rua, numero, bairro, cidade, estado, cep } = e
  return `${rua}, ${numero} - ${bairro}, ${cidade}/${estado} - CEP: ${cep}`
}

type LojaAtivaContextType = {
  lojas: PerfilLojaUnidade[]
  lojaAtivaId: string | null
  setLojaAtivaId: (id: string) => void
  /** Empresa efetiva para cupom, OS e garantias (unidade atual). */
  empresaDocumentos: ConfiguracaoEmpresa
  getEnderecoDocumentos: () => string
  opsStorageKey: string
}

const LojaAtivaContext = createContext<LojaAtivaContextType | null>(null)

export function LojaAtivaProvider({ children }: { children: ReactNode }) {
  const { config, configHydrated } = useConfigEmpresa()
  const lojas = config.minhasLojas?.lojas ?? []
  const [lojaAtivaId, setLojaAtivaIdState] = useState<string | null>(null)

  useEffect(() => {
    if (!configHydrated || typeof window === "undefined") return
    try {
      const raw = localStorage.getItem(LOJA_ATIVA_STORAGE)
      if (raw && lojas.some((l) => l.id === raw)) {
        setLojaAtivaIdState(raw)
        return
      }
      if (lojas.length > 0) {
        const first = lojas[0].id
        setLojaAtivaIdState(first)
        localStorage.setItem(LOJA_ATIVA_STORAGE, first)
      } else {
        setLojaAtivaIdState(null)
        localStorage.removeItem(LOJA_ATIVA_STORAGE)
      }
    } catch {
      /* ignore */
    }
  }, [configHydrated, lojas])

  const setLojaAtivaId = useCallback((id: string) => {
    if (!lojas.some((l) => l.id === id)) return
    setLojaAtivaIdState(id)
    try {
      localStorage.setItem(LOJA_ATIVA_STORAGE, id)
    } catch {
      /* ignore */
    }
  }, [lojas])

  const lojaSelecionada = useMemo(() => {
    if (lojas.length === 0) return undefined
    const id = lojaAtivaId && lojas.some((l) => l.id === lojaAtivaId) ? lojaAtivaId : lojas[0]?.id
    return lojas.find((l) => l.id === id)
  }, [lojas, lojaAtivaId])

  const empresaDocumentos = useMemo(
    () => mergeEmpresaComLoja(config.empresa, lojaSelecionada),
    [config.empresa, lojaSelecionada]
  )

  const getEnderecoDocumentos = useCallback(() => {
    const e = { ...configPadrao.empresa.endereco, ...empresaDocumentos.endereco }
    return formatEnderecoEmpresa(e)
  }, [empresaDocumentos.endereco])

  const opsStorageKey = useMemo(() => {
    if (lojas.length === 0) return OPS_KEY_LEGACY
    const id = lojaSelecionada?.id ?? lojas[0].id
    return opsKeyForLoja(id)
  }, [lojas, lojaSelecionada])

  const value = useMemo<LojaAtivaContextType>(
    () => ({
      lojas,
      lojaAtivaId: lojaSelecionada?.id ?? null,
      setLojaAtivaId,
      empresaDocumentos,
      getEnderecoDocumentos,
      opsStorageKey,
    }),
    [lojas, lojaSelecionada?.id, setLojaAtivaId, empresaDocumentos, getEnderecoDocumentos, opsStorageKey]
  )

  return <LojaAtivaContext.Provider value={value}>{children}</LojaAtivaContext.Provider>
}

export function useLojaAtiva(): LojaAtivaContextType {
  const ctx = useContext(LojaAtivaContext)
  if (!ctx) {
    const fallbackEmpresa = configPadrao.empresa
    return {
      lojas: [],
      lojaAtivaId: null,
      setLojaAtivaId: () => {},
      empresaDocumentos: fallbackEmpresa,
      getEnderecoDocumentos: () => formatEnderecoEmpresa(fallbackEmpresa.endereco),
      opsStorageKey: OPS_KEY_LEGACY,
    }
  }
  return ctx
}
