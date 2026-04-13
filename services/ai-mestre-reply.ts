import type { OrchestratorDecision, PlanoAssinatura } from "@/services/ai-orchestrator"

/** Chave Google AI (Vercel): leitura explícita — mesma variável que o painel injeta. */
function mestreGoogleApiKey(): string {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
  if (typeof apiKey !== "string") return ""
  return apiKey.replace(/^[\s'"]+|[\s'"]+$/g, "").trim()
}

export type StockSummaryRow = { name: string; stock: number; price: number; category: string }

const BRAND = "RAFACELL ASSISTEC"

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

async function geminiGenerateContent(
  model: string,
  /** Sempre `process.env.GOOGLE_GENERATIVE_AI_API_KEY` (via mestreGoogleApiKey). */
  apiKey: string,
  body: Record<string, unknown>
): Promise<{ ok: true; text: string } | { ok: false; raw: string }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const raw = await res.text()
  if (!res.ok) {
    return { ok: false, raw: `HTTP ${res.status} ${raw.slice(0, 400)}` }
  }
  let data: GeminiGenResponse
  try {
    data = JSON.parse(raw) as GeminiGenResponse
  } catch {
    return { ok: false, raw: raw.slice(0, 400) }
  }
  const block = data.promptFeedback?.blockReason
  if (block) {
    return { ok: false, raw: `blocked: ${block}` }
  }
  const parts = data.candidates?.[0]?.content?.parts
  const text = parts?.map((p) => p.text ?? "").join("").trim() ?? ""
  if (text) return { ok: true, text }
  const fr = data.candidates?.[0]?.finishReason
  return { ok: false, raw: fr ? `empty candidates, finishReason=${fr}` : "empty response" }
}

/**
 * Google Generative AI (Gemini) apenas — múltiplos formatos e modelos de fallback.
 */
async function geminiCompleteMestre(system: string, userText: string, apiKey: string): Promise<string> {
  /** `gemini-1.5-flash`: melhor compatibilidade com Edge / ambientes restritos na Vercel. */
  const models = ["gemini-1.5-flash"]
  const attempts: Array<Record<string, unknown>> = [
    {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ parts: [{ text: userText }] }],
      generationConfig: { temperature: 0.6, maxOutputTokens: 1024 },
    },
    {
      contents: [{ parts: [{ text: `${system}\n\n---\nPergunta:\n${userText}` }] }],
      generationConfig: { temperature: 0.6, maxOutputTokens: 1024 },
    },
  ]

  const errors: string[] = []
  for (const model of models) {
    for (let i = 0; i < attempts.length; i++) {
      const result = await geminiGenerateContent(model, apiKey, attempts[i])
      if (result.ok && result.text) {
        return result.text
      }
      errors.push(`${model}#${i}: ${result.ok ? "empty" : result.raw}`)
    }
  }

  console.error("[IA Mestre] Gemini todas as tentativas falharam:", errors.slice(0, 6).join(" | "))
  throw new Error("GEMINI_FAILED")
}

export type MestreComposeMeta = {
  llmConfigured: boolean
  backend: "openai" | "gemini" | null
}

/**
 * Resposta do Mestre: somente Google Generative AI (Gemini). Sem fallback de texto fixo de estoque.
 */
export async function composeMestreUserMessage(
  userText: string,
  decision: OrchestratorDecision,
  plano: PlanoAssinatura | string,
  stock: StockSummaryRow[]
): Promise<{ message: string; meta: MestreComposeMeta }> {
  const stockBlock =
    stock.length === 0
      ? "(Sem itens cadastrados nesta unidade no momento.)"
      : stock
          .slice(0, 80)
          .map((s) => `- ${s.name} | estoque: ${s.stock} | R$ ${s.price.toFixed(2)} | ${s.category || "—"}`)
          .join("\n")

  const system = buildSystemPrompt(decision, plano, stockBlock)
  const apiKey = mestreGoogleApiKey()

  if (!apiKey.length) {
    console.error("[IA Mestre] GOOGLE_GENERATIVE_AI_API_KEY ausente no processo do servidor")
    throw new Error("MESTRE_GEMINI_KEY_MISSING")
  }

  const text = await geminiCompleteMestre(system, userText, apiKey)
  return {
    message: text,
    meta: { llmConfigured: true, backend: "gemini" },
  }
}
