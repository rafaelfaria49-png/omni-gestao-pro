import type { OrchestratorDecision, PlanoAssinatura } from "@/services/ai-orchestrator"
import { getGoogleGenerativeAiKey, resolveLlmEnv } from "@/lib/resolve-llm-env"

export type StockSummaryRow = { name: string; stock: number; price: number; category: string }

function buildSystemPrompt(
  decision: OrchestratorDecision,
  plano: PlanoAssinatura | string,
  stockBlock: string
): string {
  return `Você é o assistente "IA Mestre" de uma loja (assistência técnica e/ou varejo).
Use o estoque em tempo real abaixo para responder perguntas sobre produtos, preços e disponibilidade.
Seja breve e claro em português do Brasil.
Roteamento técnico: ${decision.label} — ${decision.reason}.
Plano do cliente: ${plano}.

Estoque da unidade:
${stockBlock}`
}

async function openAiComplete(system: string, userText: string, apiKey: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: userText },
      ],
      max_tokens: 500,
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`OpenAI: ${res.status} ${err.slice(0, 200)}`)
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const text = data.choices?.[0]?.message?.content?.trim()
  return text ?? ""
}

async function geminiComplete(system: string, userText: string, apiKey: string): Promise<string> {
  const model = "gemini-2.0-flash"
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`
  const tryBodies = [
    {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ parts: [{ text: userText }] }],
    },
    {
      contents: [
        {
          parts: [{ text: `${system}\n\n---\nPergunta:\n${userText}` }],
        },
      ],
    },
  ]
  let lastErr = ""
  for (const body of tryBodies) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const raw = await res.text()
    if (!res.ok) {
      lastErr = raw.slice(0, 220)
      continue
    }
    let data: { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
    try {
      data = JSON.parse(raw) as typeof data
    } catch {
      lastErr = raw.slice(0, 220)
      continue
    }
    const parts = data.candidates?.[0]?.content?.parts
    const text = parts?.map((p) => p.text ?? "").join("").trim()
    if (text) return text
  }
  throw new Error(`Gemini: ${lastErr || "resposta vazia"}`)
}

export type MestreComposeMeta = {
  llmConfigured: boolean
  backend: "openai" | "gemini" | null
}

/**
 * Gera a mensagem do Mestre: OpenAI ou Gemini (Google AI Studio), conforme variáveis no servidor.
 */
export async function composeMestreUserMessage(
  userText: string,
  decision: OrchestratorDecision,
  plano: PlanoAssinatura | string,
  stock: StockSummaryRow[]
): Promise<{ message: string; meta: MestreComposeMeta }> {
  const stockBlock =
    stock.length === 0
      ? "(Nenhum produto cadastrado no estoque desta unidade.)"
      : stock
          .slice(0, 80)
          .map((s) => `- ${s.name} | estoque: ${s.stock} | R$ ${s.price.toFixed(2)} | ${s.category || "—"}`)
          .join("\n")

  const system = buildSystemPrompt(decision, plano, stockBlock)
  const lines = stock.slice(0, 15).map((s) => `- ${s.name}: ${s.stock} un., R$ ${s.price.toFixed(2)}`)
  const stockOnlyReply = `Roteado para ${decision.label}. Estoque atual:\n${lines.join("\n") || "(vazio)"}`

  const geminiKey = getGoogleGenerativeAiKey()
  if (geminiKey.length > 0) {
    try {
      const text = await geminiComplete(system, userText, geminiKey)
      if (text) {
        return { message: text, meta: { llmConfigured: true, backend: "gemini" as const } }
      }
    } catch (e) {
      console.error("[IA Mestre] Gemini:", e instanceof Error ? e.message : e)
    }
  }

  const llm = resolveLlmEnv()
  if (llm.ok) {
    try {
      const text =
        llm.backend === "openai"
          ? await openAiComplete(system, userText, llm.key)
          : await geminiComplete(system, userText, llm.key)
      if (text) {
        return { message: text, meta: { llmConfigured: true, backend: llm.backend } }
      }
    } catch (e) {
      console.error("[IA Mestre] LLM:", e instanceof Error ? e.message : e)
    }
  }

  return {
    message: stockOnlyReply,
    meta: { llmConfigured: false, backend: null },
  }
}
