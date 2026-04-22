"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { useLojaAtiva } from "@/lib/loja-ativa"
import { LEGACY_PRIMARY_STORE_ID } from "@/lib/store-defaults"
import { ASSISTEC_LOJA_HEADER } from "@/lib/assistec-headers"
import type { StorePdvParams, StoreSettingsApi, StoreSettingsBlob } from "@/lib/store-settings-types"
import { configPadrao, type CategoriaGarantia, type TermosGarantia } from "@/lib/config-empresa"

type StoreSettingsContextType = {
  storeId: string
  hydrated: boolean
  settings: StoreSettingsApi | null
  blob: StoreSettingsBlob
  pdvParams: StorePdvParams
  termosGarantia: TermosGarantia
  getGarantiaById: (id: string) => CategoriaGarantia | undefined
  refresh: () => Promise<void>
  save: (patch: Partial<StoreSettingsApi> & { printerConfig?: unknown }) => Promise<void>
}

const StoreSettingsContext = createContext<StoreSettingsContextType | null>(null)

function safeObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {}
}

function parseBlob(printerConfig: unknown): StoreSettingsBlob {
  const o = safeObj(printerConfig)
  const planoRaw = typeof (o as any).planoAssinaturaOverride === "string" ? String((o as any).planoAssinaturaOverride).trim() : ""
  const planoAssinaturaOverride =
    planoRaw === "bronze" || planoRaw === "prata" || planoRaw === "ouro" ? (planoRaw as "bronze" | "prata" | "ouro") : undefined
  return {
    pdvParams: safeObj(o.pdvParams),
    termosGarantia: safeObj(o.termosGarantia),
    certificadoA1: safeObj(o.certificadoA1),
    aiMestreModel: typeof (o as any).aiMestreModel === "string" ? String((o as any).aiMestreModel).trim() : undefined,
    planoAssinaturaOverride,
  } as StoreSettingsBlob
}

const GARANTIA_LEGAL_CDC =
  "Garantia Legal de 90 dias para serviços e produtos duráveis, conforme o Código de Defesa do Consumidor (CDC)"

function defaultPdvParams(): StorePdvParams {
  return {
    atalhosRapidos: configPadrao.pdv.atalhosRapidos,
    ocultarCategoriasNoPdv: !!configPadrao.pdv.ocultarCategoriasNoPdv,
    categoriasOcultasNoPdv: [...(configPadrao.pdv.categoriasOcultasNoPdv ?? [])],
    garantiaPadraoDias: configPadrao.pdv.garantiaPadraoDias,
    validadeOrcamentoDias: configPadrao.pdv.validadeOrcamentoDias,
    incluirImpostoEstimadoNoPdv: !!configPadrao.pdv.incluirImpostoEstimadoNoPdv,
    aliquotaImpostoEstimadoPdv: Number(configPadrao.pdv.aliquotaImpostoEstimadoPdv) || 0,
    moduloControleConsumo: !!configPadrao.pdv.moduloControleConsumo,
  }
}

function mergePdvParams(base: StorePdvParams, patch: Partial<StorePdvParams> | undefined): StorePdvParams {
  const p = patch ?? {}
  return {
    ...base,
    ...p,
    atalhosRapidos: Array.isArray(p.atalhosRapidos) ? p.atalhosRapidos : base.atalhosRapidos,
    categoriasOcultasNoPdv: Array.isArray(p.categoriasOcultasNoPdv) ? p.categoriasOcultasNoPdv : base.categoriasOcultasNoPdv,
  }
}

function mergeTermosGarantia(patch: unknown): TermosGarantia {
  const p = safeObj(patch)
  const categorias = Array.isArray((p as any).categorias) ? ((p as any).categorias as any[]) : configPadrao.termosGarantia.categorias
  const mergedCats: CategoriaGarantia[] = categorias.map((c) => ({
    id: String((c as any).id),
    servico: String((c as any).servico ?? ""),
    detalhes: String((c as any).detalhes ?? ""),
  }))
  const garantiaLegal = String((p as any).garantiaLegal ?? "").trim() || GARANTIA_LEGAL_CDC
  const tituloGeral = String((p as any).tituloGeral ?? "").trim() || configPadrao.termosGarantia.tituloGeral
  return { ...configPadrao.termosGarantia, tituloGeral, garantiaLegal, categorias: mergedCats }
}

export function StoreSettingsProvider({ children }: { children: ReactNode }) {
  const { lojaAtivaId, storesRefreshNonce } = useLojaAtiva()
  const storeId = useMemo(
    () => (lojaAtivaId || LEGACY_PRIMARY_STORE_ID).trim() || LEGACY_PRIMARY_STORE_ID,
    [lojaAtivaId]
  )
  const [hydrated, setHydrated] = useState(false)
  const [settings, setSettings] = useState<StoreSettingsApi | null>(null)

  const refresh = useCallback(async () => {
    setHydrated(false)
    try {
      const r = await fetch(`/api/stores/${encodeURIComponent(storeId)}/settings`, {
        credentials: "include",
        cache: "no-store",
        headers: { [ASSISTEC_LOJA_HEADER]: storeId },
      })
      const j = (await r.json().catch(() => null)) as { settings?: StoreSettingsApi | null } | null
      setSettings(j?.settings ?? null)
    } catch {
      setSettings(null)
    } finally {
      setHydrated(true)
    }
  }, [storeId])

  useEffect(() => {
    void refresh()
  }, [refresh, storesRefreshNonce])

  const blob = useMemo(() => parseBlob(settings?.printerConfig), [settings?.printerConfig])
  const pdvParams = useMemo(() => mergePdvParams(defaultPdvParams(), blob.pdvParams), [blob.pdvParams])
  const termosGarantia = useMemo(() => mergeTermosGarantia(blob.termosGarantia), [blob.termosGarantia])
  const getGarantiaById = useCallback(
    (id: string) => termosGarantia.categorias.find((c) => c.id === id),
    [termosGarantia.categorias]
  )

  const save = useCallback(
    async (patch: Partial<StoreSettingsApi> & { printerConfig?: unknown }) => {
      await fetch(`/api/stores/${encodeURIComponent(storeId)}/settings`, {
        method: "PUT",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          [ASSISTEC_LOJA_HEADER]: storeId,
        },
        body: JSON.stringify(patch),
      })
      await refresh()
    },
    [refresh, storeId]
  )

  const value = useMemo<StoreSettingsContextType>(
    () => ({
      storeId,
      hydrated,
      settings,
      blob,
      pdvParams,
      termosGarantia,
      getGarantiaById,
      refresh,
      save,
    }),
    [storeId, hydrated, settings, blob, pdvParams, termosGarantia, getGarantiaById, refresh, save]
  )

  return <StoreSettingsContext.Provider value={value}>{children}</StoreSettingsContext.Provider>
}

export function useStoreSettings(): StoreSettingsContextType {
  const c = useContext(StoreSettingsContext)
  if (!c) {
    const base = defaultPdvParams()
    return {
      storeId: LEGACY_PRIMARY_STORE_ID,
      hydrated: false,
      settings: null,
      blob: {},
      pdvParams: base,
      termosGarantia: { ...configPadrao.termosGarantia, garantiaLegal: GARANTIA_LEGAL_CDC },
      getGarantiaById: () => undefined,
      refresh: async () => {},
      save: async () => {},
    }
  }
  return c
}

