/**
 * Lê chaves de LLM no servidor (Next carrega .env / .env.local).
 * Aceita aspas acidentais e espaços.
 */
function stripEnv(v: string | undefined): string {
  if (!v) return ""
  return v.replace(/^[\s'"]+|[\s'"]+$/g, "").trim()
}

export type LlmBackendKind = "openai" | "gemini"

export type ResolvedLlmEnv =
  | { ok: true; backend: LlmBackendKind; key: string }
  | { ok: false; reason: "missing" }

/**
 * Chave explícita do Google (Vercel / AI Studio). Usada para forçar Gemini antes de OpenAI.
 */
export function getGoogleGenerativeAiKey(): string {
  return (
    stripEnv(process.env.GOOGLE_GENERATIVE_AI_API_KEY) ||
    stripEnv(process.env.GEMINI_API_KEY) ||
    stripEnv(process.env.GOOGLE_AI_API_KEY)
  )
}

/**
 * Prioridade: GOOGLE_GENERATIVE_AI_API_KEY (Gemini) → OpenAI.
 */
export function resolveLlmEnv(): ResolvedLlmEnv {
  const gemini = getGoogleGenerativeAiKey()
  if (gemini.length > 0) {
    return { ok: true, backend: "gemini", key: gemini }
  }
  const openai = stripEnv(process.env.OPENAI_API_KEY)
  if (openai.length >= 8 && openai.startsWith("sk-")) {
    return { ok: true, backend: "openai", key: openai }
  }
  if (openai.length >= 8) {
    return { ok: true, backend: "openai", key: openai }
  }
  return { ok: false, reason: "missing" }
}
