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

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const r = await fetch("/api/settings/perfil-loja", { credentials: "include", cache: "no-store" })
        const j = (await r.json()) as { perfilLoja?: string }
        if (!cancelled) setPerfilLojaState(parsePerfilLoja(j.perfilLoja))
      } catch {
        if (!cancelled) setPerfilLojaState(PERFIL_LOJA_DEFAULT)
      } finally {
        if (!cancelled) setPerfilHydrated(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const setPerfilLoja = useCallback(async (p: PerfilLojaId) => {
    setPerfilLojaState(p)
    try {
      await fetch("/api/settings/perfil-loja", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ perfilLoja: p }),
      })
    } catch {
      /* rede — estado local já atualizado */
    }
  }, [])

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
