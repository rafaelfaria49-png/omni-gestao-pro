import type { PlanoAssinatura } from "@/services/ai-orchestrator"
import { AI_MODELS_MOSAIC } from "@/lib/ai-models-list"

export type MestreModelHint = string

const BASIC_MODELS = AI_MODELS_MOSAIC.filter((m) => m.basicOk).map((m) => m.id)
const PREMIUM_MODELS = AI_MODELS_MOSAIC.map((m) => m.id)
const PREMIUM_DEFAULT = "openrouter/auto"

export type PickedModelPolicy = {
  model: string
  /** Se false, o usuário não pode escolher (travado no backend). */
  allowUserSelect: boolean
  /** Modelos que a UI pode listar (para plano ouro). */
  options: readonly string[]
}

export function pickMestreModel(params: {
  plano: PlanoAssinatura | string
  requestedModel?: string | null
  storedModel?: string | null
}): string {
  const requested = (params.requestedModel || "").trim()
  const stored = (params.storedModel || "").trim()
  const isPremium = params.plano === "ouro"

  if (!isPremium) {
    // Básico: trava sempre no backend (não aceitar override do cliente).
    return BASIC_MODELS[0] || "google/gemini-flash-1.5"
  }

  const allowed = new Set(PREMIUM_MODELS as readonly string[])
  if (requested && allowed.has(requested)) return requested
  if (stored && allowed.has(stored)) return stored
  return PREMIUM_DEFAULT
}

export function mestreModelPolicy(plano: PlanoAssinatura | string): PickedModelPolicy {
  if (plano === "ouro") {
    return { model: PREMIUM_DEFAULT, allowUserSelect: true, options: PREMIUM_MODELS }
  }
  return { model: BASIC_MODELS[0] || "google/gemini-flash-1.5", allowUserSelect: false, options: BASIC_MODELS }
}

