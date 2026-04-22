import type { OrchestratorDecision, PlanoAssinatura } from "@/services/ai-orchestrator"
import { APP_DISPLAY_NAME } from "@/lib/app-brand"
import { resolveLlmEnv } from "@/lib/resolve-llm-env"

export type StockSummaryRow = { name: string; stock: number; price: number; category: string }

const BRAND = APP_DISPLAY_NAME

/**
 * Assistente geral da loja; estoque é contexto opcional, não o único tema.
 */
function buildSystemPrompt(
  decision: OrchestratorDecision,
  plano: PlanoAssinatura | string,
  stockBlock: string
): string {
  return `Você é o assistente virtual oficial da ${BRAND} (assistência técnica e comércio de eletrônicos e acessórios).

Seu papel é ajudar clientes e equipe com cordialidade, em português do Brasil: dúvidas sobre a loja, horários, serviços, orientações gerais, produtos, e quando fizer sentido, orientações técnicas de alto nível (sem substituir diagnóstico presencial quando não tiver dados).

Não limite suas respostas só a estoque. Só mencione itens, preços ou quantidades quando a pergunta do usuário for sobre disponibilidade, valores ou comparar produtos — ou quando o estoque abaixo for útil para responder.

Quando precisar usar dados de estoque, baseie-se exclusivamente no bloco "Referência de estoque" abaixo. Se estiver vazio ou não houver o item, diga de forma natural que não há registro ou que não localizou — não invente produtos nem preços.

Contexto interno (não leia em voz alta): roteamento ${decision.label} — ${decision.reason}. Plano: ${plano}.

Referência de estoque (pode estar vazio):
${stockBlock}`
}

type GeminiGenResponse = {
  promptFeedback?: { blockReason?: string }
  candidates?: Array<{
    finishReason?: string
    content?: { parts?: Array<{ text?: string }> }
  }>
}

export type MestreComposeMeta = {
  llmConfigured: boolean
  backend: "openrouter" | "gemini" | "openai" | null
  fallbackUsed?: boolean
}

type OpenRouterChatResponse = {
  choices?: Array<{ message?: { content?: string } }>
  error?: { message?: string }
}

function openrouterApiKey(): string {
  const k = process.env.OPENROUTER_API_KEY
  return typeof k === "string" ? k.replace(/^[\s'"]+|[\s'"]+$/g, "").trim() : ""
}

async function openrouterCompleteMestre(system: string, userText: string, apiKey: string, model: string): Promise<string> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      // OpenRouter recomenda esses headers (opcionais) para ranking/telemetria.
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000",
      "X-Title": APP_DISPLAY_NAME,
    },
    body: JSON.stringify({
      model,
      temperature: 0.6,
      max_tokens: 800,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userText },
      ],
    }),
  })
  const raw = await res.text()
  if (!res.ok) {
    let msg = raw.slice(0, 240)
    try {
      const j = JSON.parse(raw) as OpenRouterChatResponse
      msg = j.error?.message || msg
    } catch {
      /* ignore */
    }
    console.error("[IA Mestre] OpenRouter falhou:", `HTTP ${res.status}`, msg)
    throw new Error("OPENROUTER_FAILED")
  }
  let j: OpenRouterChatResponse
  try {
    j = JSON.parse(raw) as OpenRouterChatResponse
  } catch {
    throw new Error("OPENROUTER_FAILED")
  }
  const text = (j.choices?.[0]?.message?.content ?? "").trim()
  if (!text) throw new Error("OPENROUTER_FAILED")
  return text
}

type OpenAiChatResponse = {
  choices?: Array<{ message?: { content?: string } }>
  error?: { message?: string }
}

async function openaiFallbackCompleteMestre(system: string, userText: string, apiKey: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_FALLBACK_MODEL?.trim() || "gpt-4o-mini",
      temperature: 0.6,
      max_tokens: 800,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userText },
      ],
    }),
  })
  const raw = await res.text()
  if (!res.ok) {
    let msg = raw.slice(0, 240)
    try {
      const j = JSON.parse(raw) as OpenAiChatResponse
      msg = j.error?.message || msg
    } catch {
      /* ignore */
    }
    console.error("[IA Mestre] OpenAI fallback falhou:", `HTTP ${res.status}`, msg)
    throw new Error("FALLBACK_FAILED")
  }
  let j: OpenAiChatResponse
  try {
    j = JSON.parse(raw) as OpenAiChatResponse
  } catch {
    throw new Error("FALLBACK_FAILED")
  }
  const text = (j.choices?.[0]?.message?.content ?? "").trim()
  if (!text) throw new Error("FALLBACK_FAILED")
  return text
}

async function geminiFallbackCompleteMestre(system: string, userText: string, apiKey: string): Promise<string> {
  const model = process.env.GEMINI_FALLBACK_MODEL?.trim() || "gemini-1.5-flash"
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(
    apiKey
  )}`
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: `${system}\n\n---\n\nUsuário: ${userText}` }],
        },
      ],
      generationConfig: { temperature: 0.6, maxOutputTokens: 800 },
    }),
  })
  const raw = await res.text()
  if (!res.ok) {
    let msg = raw.slice(0, 240)
    try {
      const j = JSON.parse(raw) as GeminiGenResponse
      msg = j.promptFeedback?.blockReason || msg
    } catch {
      /* ignore */
    }
    console.error("[IA Mestre] Gemini fallback falhou:", `HTTP ${res.status}`, msg)
    throw new Error("FALLBACK_FAILED")
  }
  let j: GeminiGenResponse
  try {
    j = JSON.parse(raw) as GeminiGenResponse
  } catch {
    throw new Error("FALLBACK_FAILED")
  }
  const text = (j.candidates?.[0]?.content?.parts?.[0]?.text ?? "").trim()
  if (!text) throw new Error("FALLBACK_FAILED")
  return text
}

/**
 * Resposta do Mestre: OpenRouter (mosaico de modelos).
 */
export async function composeMestreUserMessage(
  userText: string,
  decision: OrchestratorDecision,
  plano: PlanoAssinatura | string,
  stock: StockSummaryRow[],
  /** Modelo OpenRouter, ex.: `openai/gpt-4o`, `anthropic/claude-3.5-sonnet`. */
  model: string
): Promise<{ message: string; meta: MestreComposeMeta }> {
  const stockBlock =
    stock.length === 0
      ? "(Sem itens cadastrados nesta unidade no momento.)"
      : stock
          .slice(0, 80)
          .map((s) => `- ${s.name} | estoque: ${s.stock} | R$ ${s.price.toFixed(2)} | ${s.category || "—"}`)
          .join("\n")

  const system = buildSystemPrompt(decision, plano, stockBlock)
  const resolvedModel = (model || "").trim() || "openrouter/auto"
  try {
    const key = openrouterApiKey()
    if (!key) {
      console.error("[IA Mestre] OPENROUTER_API_KEY ausente no processo do servidor")
      throw new Error("OPENROUTER_KEY_MISSING")
    }
    const text = await openrouterCompleteMestre(system, userText, key, resolvedModel)
    return { message: text, meta: { llmConfigured: true, backend: "openrouter", fallbackUsed: false } }
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e)
    const env = resolveLlmEnv()
    if (!env.ok) throw new Error(err)
    try {
      if (env.backend === "gemini") {
        const text = await geminiFallbackCompleteMestre(system, userText, env.key)
        return { message: text, meta: { llmConfigured: true, backend: "gemini", fallbackUsed: true } }
      }
      const text = await openaiFallbackCompleteMestre(system, userText, env.key)
      return { message: text, meta: { llmConfigured: true, backend: "openai", fallbackUsed: true } }
    } catch {
      throw new Error(err)
    }
  }
}
