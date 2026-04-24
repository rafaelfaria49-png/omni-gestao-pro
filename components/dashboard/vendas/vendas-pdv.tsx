"use client"

import { useEffect, useState } from "react"
import { PdvClassic, type VendasPDVProps } from "./pdv-classic"
import { PdvSupermercado } from "./pdv-supermercado"
import { usePerfilLoja } from "@/lib/perfil-loja-provider"
import { useLojaAtiva } from "@/lib/loja-ativa"
import { LEGACY_PRIMARY_STORE_ID } from "@/lib/store-defaults"

type PdvLayout = "classic" | "supermercado"

const PDV_LAYOUT_STORAGE_KEY = "@omnigestao:pdv-layout"
const RAMO_ATUACAO_STORAGE_PREFIX = "@omnigestao:ramo-atuacao:"

export function VendasPDV(props: VendasPDVProps) {
  const [layout, setLayout] = useState<PdvLayout>("classic")
  const { perfilLoja } = usePerfilLoja()
  const { lojaAtivaId } = useLojaAtiva()

  useEffect(() => {
    const readLayout = () => {
      try {
        const raw = String(localStorage.getItem(PDV_LAYOUT_STORAGE_KEY) || "").trim()
        if (raw === "supermercado" || raw === "classic") {
          setLayout(raw)
          return
        }

        // Smart defaults: se não houver escolha manual, inferir pelo ramo.
        const storeId = (lojaAtivaId || LEGACY_PRIMARY_STORE_ID).trim() || LEGACY_PRIMARY_STORE_ID
        const ramoKey = `${RAMO_ATUACAO_STORAGE_PREFIX}${storeId}`
        const ramoRaw = String(localStorage.getItem(ramoKey) || "").trim()
        const inferred =
          ramoRaw && ramoRaw !== "assistencia"
            ? "supermercado"
            : perfilLoja === "supermercado" || perfilLoja === "variedades"
              ? "supermercado"
              : "classic"
        setLayout(inferred)
      } catch {
        setLayout(perfilLoja === "supermercado" || perfilLoja === "variedades" ? "supermercado" : "classic")
      }
    }

    readLayout()

    const onStorage = (e: StorageEvent) => {
      if (e.key === PDV_LAYOUT_STORAGE_KEY) readLayout()
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [lojaAtivaId, perfilLoja])

  if (layout === "supermercado") return <PdvSupermercado {...props} />
  return <PdvClassic {...props} />
}
