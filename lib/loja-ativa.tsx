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
import { ASSISTEC_ACTIVE_STORE_COOKIE, LEGACY_PRIMARY_STORE_ID } from "@/lib/store-defaults"
import { nomeFantasiaOuFallbackUnidade } from "@/lib/store-display-name"

const LOJA_ATIVA_STORAGE = "assistec-pro-loja-ativa-v1"

/** Disparado após salvar dados da unidade: outras abas escutam `storage` e chamam `refreshStoresList`. */
export const ASSISTEC_STORES_SYNC_STORAGE_KEY = "assistec-stores-sync-v1"

function setActiveStoreCookie(id: string) {
  if (typeof document === "undefined") return
  try {
    document.cookie = `${ASSISTEC_ACTIVE_STORE_COOKIE}=${encodeURIComponent(id)}; Path=/; Max-Age=31536000; SameSite=Lax`
  } catch {
    /* ignore */
  }
}
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
  const nomeUnidade = nomeFantasiaOuFallbackUnidade(loja.id, loja.nomeFantasia)
  return {
    ...base,
    nomeFantasia: nomeUnidade,
    razaoSocial: (loja.razaoSocial || "").trim() || nomeUnidade,
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
  /** Recarrega `/api/stores` (ex.: após salvar Dados da Empresa) para atualizar o header. */
  refreshStoresList: () => Promise<void>
  /** Incrementa após cada refresh da lista de lojas (mesma aba + sinal para refetch em telas como o PDV). */
  storesRefreshNonce: number
  /** Dados brutos da unidade ativa (sem fallback de nome). */
  lojaAtivaRaw: PerfilLojaUnidade | null
  /** Primeiro acesso: cadastro básico ainda não preenchido (nome fantasia e CNPJ). */
  cadastroBasicoIncompleto: boolean
  /** Empresa efetiva para cupom, OS e garantias (unidade atual). */
  empresaDocumentos: ConfiguracaoEmpresa
  getEnderecoDocumentos: () => string
  opsStorageKey: string
}

const LojaAtivaContext = createContext<LojaAtivaContextType | null>(null)

function parseStoreProfile(raw: unknown): NonNullable<PerfilLojaUnidade["storeProfile"]> {
  const p = String(raw ?? "ASSISTENCIA").toUpperCase()
  if (p === "VARIEDADES" || p === "SUPERMERCADO") return p
  return "ASSISTENCIA"
}

function mapStoresResponseToPerfis(stores: Array<Record<string, unknown>>): PerfilLojaUnidade[] {
  return stores.map((s) => {
    const addr = s.address && typeof s.address === "object" ? (s.address as Record<string, unknown>) : {}
    return {
      id: String(s.id || "").trim() || LEGACY_PRIMARY_STORE_ID,
      nomeFantasia: String(s.name || "").trim(),
      razaoSocial: String(s.name || "").trim(),
      cnpj: String(s.cnpj || "").trim(),
      endereco: {
        rua: String(addr.rua || ""),
        numero: String(addr.numero || ""),
        bairro: String(addr.bairro || ""),
        cidade: String(addr.cidade || ""),
        estado: String(addr.estado || ""),
        cep: String(addr.cep || ""),
      },
      logoUrl: String(s.logoUrl || "").trim(),
      storeProfile: parseStoreProfile(s.profile),
    }
  })
}

export function LojaAtivaProvider({ children }: { children: ReactNode }) {
  const { config, configHydrated } = useConfigEmpresa()
  const lojasConfig = useMemo(() => config.minhasLojas?.lojas ?? [], [config.minhasLojas?.lojas])
  const [lojasRemote, setLojasRemote] = useState<PerfilLojaUnidade[] | null>(null)
  const [storesRefreshNonce, setStoresRefreshNonce] = useState(0)
  const lojas = useMemo(() => {
    const map = new Map<string, PerfilLojaUnidade>()
    for (const l of lojasConfig) {
      if (!l?.id) continue
      map.set(l.id, l)
    }
    // Remote sobrescreve campos da config, mas não “apaga” lojas locais.
    for (const l of lojasRemote ?? []) {
      if (!l?.id) continue
      const prev = map.get(l.id)
      map.set(l.id, prev ? { ...prev, ...l, endereco: { ...prev.endereco, ...l.endereco } } : l)
    }
    const out = Array.from(map.values())
    out.sort((a, b) => a.id.localeCompare(b.id))
    return out
  }, [lojasRemote, lojasConfig])
  const [lojaAtivaId, setLojaAtivaIdState] = useState<string | null>(null)

  const refreshStoresList = useCallback(async () => {
    if (typeof window === "undefined") return
    try {
      const r = await fetch("/api/stores", { credentials: "include", cache: "no-store" })
      if (!r.ok) return
      const j = (await r.json()) as { stores?: Array<Record<string, unknown>> }
      const stores = Array.isArray(j.stores) ? j.stores : []
      setLojasRemote(mapStoresResponseToPerfis(stores))
      setStoresRefreshNonce((n) => n + 1)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return
    const onStorage = (e: StorageEvent) => {
      if (e.key !== ASSISTEC_STORES_SYNC_STORAGE_KEY) return
      void refreshStoresList()
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [refreshStoresList])

  useEffect(() => {
    if (!configHydrated || typeof window === "undefined") return
    void refreshStoresList()
  }, [configHydrated, refreshStoresList])

  useEffect(() => {
    if (!configHydrated || typeof window === "undefined") return
    try {
      const raw = localStorage.getItem(LOJA_ATIVA_STORAGE)
      // Migração de sessão: se ficou preso no id antigo, force para `loja-1`.
      if (raw === "loja-antiga") {
        localStorage.setItem(LOJA_ATIVA_STORAGE, LEGACY_PRIMARY_STORE_ID)
      }
      const normalized = raw === "loja-antiga" ? LEGACY_PRIMARY_STORE_ID : raw
      // Persistência forte: se existe um id salvo, mantenha-o mesmo que a lista ainda não tenha carregado.
      if (normalized && normalized.trim()) {
        const nid = normalized.trim()
        setLojaAtivaIdState(nid)
        setActiveStoreCookie(nid)
        return
      }
      const fallback = lojas[0]?.id || LEGACY_PRIMARY_STORE_ID
      setLojaAtivaIdState(fallback)
      localStorage.setItem(LOJA_ATIVA_STORAGE, fallback)
      setActiveStoreCookie(fallback)
    } catch {
      /* ignore */
    }
  }, [configHydrated, lojas])

  const setLojaAtivaId = useCallback((id: string) => {
    const next = id.trim()
    if (!next) return
    setLojaAtivaIdState(next)
    try {
      localStorage.setItem(LOJA_ATIVA_STORAGE, next)
    } catch {
      /* ignore */
    }
    setActiveStoreCookie(next)
  }, [lojas])

  const lojaSelecionada = useMemo(() => {
    if (lojas.length === 0) return undefined
    const id = lojaAtivaId?.trim()
    if (id) {
      const hit = lojas.find((l) => l.id === id)
      if (hit) return hit
      // Loja selecionada ainda não cadastrada na lista: mantém contexto mínimo para isolar dados.
      return {
        id,
        nomeFantasia: "",
        razaoSocial: "",
        cnpj: "",
        endereco: { ...configPadrao.empresa.endereco },
        logoUrl: "",
        storeProfile: "ASSISTENCIA",
      } satisfies PerfilLojaUnidade
    }
    return lojas[0]
  }, [lojas, lojaAtivaId])

  const cadastroBasicoIncompleto = useMemo(() => {
    const nome = (lojaSelecionada?.nomeFantasia || "").trim()
    const cnpj = (lojaSelecionada?.cnpj || "").trim()
    return !nome || !cnpj
  }, [lojaSelecionada?.cnpj, lojaSelecionada?.nomeFantasia])

  const empresaDocumentos = useMemo(
    () => mergeEmpresaComLoja(config.empresa, lojaSelecionada),
    [config.empresa, lojaSelecionada]
  )

  const getEnderecoDocumentos = useCallback(() => {
    const e = { ...configPadrao.empresa.endereco, ...empresaDocumentos.endereco }
    return formatEnderecoEmpresa(e)
  }, [empresaDocumentos.endereco])

  const opsStorageKey = useMemo(() => {
    const id =
      (lojaSelecionada?.id || lojaAtivaId || lojas[0]?.id || LEGACY_PRIMARY_STORE_ID).trim() ||
      LEGACY_PRIMARY_STORE_ID
    return opsKeyForLoja(id)
  }, [lojas, lojaSelecionada])

  const value = useMemo<LojaAtivaContextType>(
    () => ({
      lojas,
      lojaAtivaId: lojaSelecionada?.id ?? null,
      setLojaAtivaId,
      refreshStoresList,
      storesRefreshNonce,
      lojaAtivaRaw: lojaSelecionada ?? null,
      cadastroBasicoIncompleto,
      empresaDocumentos,
      getEnderecoDocumentos,
      opsStorageKey,
    }),
    [
      lojas,
      lojaSelecionada?.id,
      setLojaAtivaId,
      refreshStoresList,
      storesRefreshNonce,
      lojaSelecionada,
      cadastroBasicoIncompleto,
      empresaDocumentos,
      getEnderecoDocumentos,
      opsStorageKey,
    ]
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
      refreshStoresList: async () => {},
      storesRefreshNonce: 0,
      empresaDocumentos: fallbackEmpresa,
      getEnderecoDocumentos: () => formatEnderecoEmpresa(fallbackEmpresa.endereco),
      opsStorageKey: OPS_KEY_LEGACY,
    }
  }
  return ctx
}
