export type AiModelEntry = {
  /** ID do OpenRouter (ex.: `anthropic/claude-3.5-sonnet`). */
  id: string
  label: string
  /** Sugerido para planos básicos (rápido/barato). */
  basicOk: boolean
}

/**
 * “Mosaico” curado — IDs oficiais do OpenRouter.
 *
 * Nota: o primeiro item deve ser `openrouter/auto` para o modo inteligente ("Piloto Automático").
 */
export const AI_MODELS_MOSAIC: readonly AiModelEntry[] = [
  // Auto (Piloto Automático)
  { id: "openrouter/auto", label: "Modo Inteligente — Auto (OpenRouter)", basicOk: false },

  // Anthropic
  { id: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet (Anthropic)", basicOk: false },
  { id: "anthropic/claude-3-opus", label: "Claude 3 Opus (Anthropic)", basicOk: false },
  { id: "anthropic/claude-3-haiku", label: "Claude 3 Haiku (Anthropic)", basicOk: false },

  // OpenAI
  { id: "openai/gpt-4o", label: "GPT-4o (OpenAI)", basicOk: false },
  { id: "openai/gpt-4o-mini", label: "GPT-4o mini (OpenAI)", basicOk: true },
  { id: "openai/gpt-4-turbo", label: "GPT-4 Turbo (OpenAI)", basicOk: false },

  // Google
  { id: "google/gemini-1.5-pro", label: "Gemini 1.5 Pro (Google)", basicOk: false },
  { id: "google/gemini-1.5-flash", label: "Gemini 1.5 Flash (Google)", basicOk: true },

  // Meta
  { id: "meta-llama/llama-3-70b-instruct", label: "Llama 3 70B Instruct (Meta)", basicOk: false },
  { id: "meta-llama/llama-3-8b-instruct", label: "Llama 3 8B Instruct (Meta)", basicOk: true },

  // Mistral
  { id: "mistralai/mistral-large", label: "Mistral Large (Mistral)", basicOk: false },
  { id: "mistralai/mixtral-8x22b", label: "Mixtral 8x22B (Mistral)", basicOk: false },

  // Perplexity (bom para web)
  {
    id: "perplexity/llama-3-sonar-large-32k-online",
    label: "Perplexity Sonar Llama 3 Online 32K (Perplexity)",
    basicOk: false,
  },
] as const

