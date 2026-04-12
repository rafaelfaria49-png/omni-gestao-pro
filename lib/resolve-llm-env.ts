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
 * Prioridade: OpenAI → Gemini (Google AI Studio / Generative Language API).
 */
export function resolveLlmEnv(): ResolvedLlmEnv {
  const openai = stripEnv(process.env.OPENAI_API_KEY)
  if (openai.length >= 8 && openai.startsWith("sk-")) {
    return { ok: true, backend: "openai", key: openai }
  }
  const gemini =
    stripEnv(process.env.GOOGLE_GENERATIVE_AI_API_KEY) ||
    stripEnv(process.env.GEMINI_API_KEY) ||
    stripEnv(process.env.GOOGLE_AI_API_KEY)
  if (gemini.length >= 8) {
    return { ok: true, backend: "gemini", key: gemini }
  }
  if (openai.length >= 8) {
    return { ok: true, backend: "openai", key: openai }
  }
  return { ok: false, reason: "missing" }
}
