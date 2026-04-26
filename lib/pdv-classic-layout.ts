import type { PdvClassicLayoutKind } from "@/lib/store-settings-types"

/** Preferência global no navegador (espelha `StorePdvParams.pdvClassicLayout` após hidratação). */
export const PDV_CLASSIC_LAYOUT_STORAGE_KEY = "omni-pdv-classic-layout"

export const PDV_CLASSIC_LAYOUT_CHANGED_EVENT = "omni-pdv-classic-layout-changed"

export function readPdvClassicLayout(): PdvClassicLayoutKind {
  if (typeof window === "undefined") return "lovable"
  try {
    const v = String(localStorage.getItem(PDV_CLASSIC_LAYOUT_STORAGE_KEY) || "").trim()
    return v === "services" ? "services" : "lovable"
  } catch {
    return "lovable"
  }
}

export function writePdvClassicLayout(kind: PdvClassicLayoutKind) {
  try {
    localStorage.setItem(PDV_CLASSIC_LAYOUT_STORAGE_KEY, kind)
  } catch {
    /* ignore */
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(PDV_CLASSIC_LAYOUT_CHANGED_EVENT))
  }
}
