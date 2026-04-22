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
  PERFIL_LOJA_DEFAULT,
  parsePerfilLoja,
  type PerfilLojaId,
  perfilMostraModuloTecnicoAssistencia,
} from "@/lib/perfil-loja-types"
import { useLojaAtiva } from "@/lib/loja-ativa"
import { ASSISTEC_LOJA_HEADER } from "@/lib/assistec-headers"
import { LEGACY_PRIMARY_STORE_ID } from "@/lib/store-defaults"
import { ASSISTEC_STORES_SYNC_STORAGE_KEY } from "@/lib/loja-ativa"

type PerfilLojaContextType = {
  perfilLoja: PerfilLojaId
  setPerfilLoja: (p: PerfilLojaId) => Promise<void>
  /** Laudo OS + técnico em Serviços — só em Assistência Técnica. */
  mostraTecnicoLaudoOs: boolean
  perfilHydrated: boolean
}

const PerfilLojaContext = createContext<PerfilLojaContextType | null>(null)

export function PerfilLojaProvider({ children }: { children: ReactNode }) {
  const [perfilLoja, setPerfilLojaState] = useState<PerfilLojaId>(PERFIL_LOJA_DEFAULT)
  const [perfilHydrated, setPerfilHydrated] = useState(false)
  const { lojaAtivaId } = useLojaAtiva()
  const lojaHeader = lojaAtivaId || LEGACY_PRIMARY_STORE_ID

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const r = await fetch("/api/settings/perfil-loja", {
          credentials: "include",
          cache: "no-store",
          headers: { [ASSISTEC_LOJA_HEADER]: lojaHeader },
        })
        const j = (await r.json()) as { perfilLoja?: string }
        if (!cancelled) setPerfilLojaState(parsePerfilLoja(j.perfilLoja))
      } catch {
        if (!cancelled) setPerfilLojaState(PERFIL_LOJA_DEFAULT)
      } finally {
        if (!cancelled) setPerfilHydrated(true)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [lojaHeader])

  useEffect(() => {
    if (typeof window === "undefined") return
    const onStorage = (e: StorageEvent) => {
      if (e.key !== ASSISTEC_STORES_SYNC_STORAGE_KEY) return
      // Perfil é atributo do Store: refetch quando outra aba/fluxo salvar os dados.
      void (async () => {
        try {
          const r = await fetch("/api/settings/perfil-loja", {
            credentials: "include",
            cache: "no-store",
            headers: { [ASSISTEC_LOJA_HEADER]: lojaHeader },
          })
          const j = (await r.json()) as { perfilLoja?: string }
          setPerfilLojaState(parsePerfilLoja(j.perfilLoja))
        } catch {
          setPerfilLojaState(PERFIL_LOJA_DEFAULT)
        }
      })()
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [lojaHeader])

  const setPerfilLoja = useCallback(async (p: PerfilLojaId) => {
    // Perfil é atributo da Store e deve ser editado em "Gestão de Unidades".
    // Mantemos a função para compatibilidade, mas sem persistência.
    void p
    console.warn('[PerfilLojaProvider] setPerfilLoja ignorado. Edite o perfil em "Gestão de Unidades".')
  }, [lojaHeader])

  const value = useMemo<PerfilLojaContextType>(
    () => ({
      perfilLoja,
      setPerfilLoja,
      mostraTecnicoLaudoOs: perfilMostraModuloTecnicoAssistencia(perfilLoja),
      perfilHydrated,
    }),
    [perfilLoja, setPerfilLoja, perfilHydrated]
  )

  return <PerfilLojaContext.Provider value={value}>{children}</PerfilLojaContext.Provider>
}

export function usePerfilLoja(): PerfilLojaContextType {
  const c = useContext(PerfilLojaContext)
  if (!c) {
    return {
      perfilLoja: PERFIL_LOJA_DEFAULT,
      setPerfilLoja: async () => {},
      mostraTecnicoLaudoOs: true,
      perfilHydrated: false,
    }
  }
  return c
}
