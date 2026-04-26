/** Checklist visual rápido na entrada do aparelho (Assistência Técnica). */

export const ENTRADA_COMPONENT_IDS = ["tela", "bateria", "wifi", "camera", "som"] as const
export type EntradaComponentId = (typeof ENTRADA_COMPONENT_IDS)[number]

/** ok = operando; defeito = com problema; nao_testado = ainda não marcado */
export type EntradaEstado = "ok" | "defeito" | "nao_testado"

export const ENTRADA_LABELS: Record<EntradaComponentId, string> = {
  tela: "Tela",
  bateria: "Bateria",
  wifi: "Wi-Fi",
  camera: "Câmera",
  som: "Som",
}

export function defaultEntradaRapida(): Record<EntradaComponentId, EntradaEstado> {
  return {
    tela: "nao_testado",
    bateria: "nao_testado",
    wifi: "nao_testado",
    camera: "nao_testado",
    som: "nao_testado",
  }
}

export function mergeEntradaRapida(
  raw: Partial<Record<EntradaComponentId, EntradaEstado>> | undefined | null
): Record<EntradaComponentId, EntradaEstado> {
  const d = defaultEntradaRapida()
  if (!raw || typeof raw !== "object") return d
  for (const id of ENTRADA_COMPONENT_IDS) {
    const v = raw[id]
    if (v === "ok" || v === "defeito" || v === "nao_testado") d[id] = v
  }
  return d
}

export function cycleEntradaEstado(s: EntradaEstado): EntradaEstado {
  if (s === "nao_testado") return "ok"
  if (s === "ok") return "defeito"
  return "nao_testado"
}

/** Texto curto para carrinho PDV / cupom (ex.: Tela:OK · Bateria:! …). */
export function formatEntradaRapidaResumo(r: Record<EntradaComponentId, EntradaEstado>): string {
  const parts: string[] = []
  for (const id of ENTRADA_COMPONENT_IDS) {
    const e = r[id]
    const short = e === "ok" ? "OK" : e === "defeito" ? "!" : "—"
    parts.push(`${ENTRADA_LABELS[id]}:${short}`)
  }
  return parts.join(" · ")
}
