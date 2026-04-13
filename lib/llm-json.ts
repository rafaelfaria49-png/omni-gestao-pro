import { getGoogleGenerativeAiKey, resolveLlmEnv } from "@/lib/resolve-llm-env"

function stripJsonFence(raw: string): string {
  const t = raw.trim()
  const m = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(t)
  return m ? m[1].trim() : t
}

function parseJsonObject(text: string): Record<string, unknown> {
  const s = stripJsonFence(text)
  const parsed = JSON.parse(s) as unknown
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>
  }
  throw new Error("Resposta da IA não é um objeto JSON")
}

async function openAiJson(system: string, user: string, key: string): Promise<Record<string, unknown>> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: 1024,
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`OpenAI: ${res.status} ${err.slice(0, 200)}`)
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const text = data.choices?.[0]?.message?.content?.trim()
  if (!text) throw new Error("OpenAI retornou texto vazio")
  return parseJsonObject(text)
}

async function geminiJson(system: string, user: string, key: string): Promise<Record<string, unknown>> {
  const model = "gemini-2.0-flash"
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`
  const body = {
    systemInstruction: { parts: [{ text: `${system}\nResponda APENAS um objeto JSON válido, sem markdown.` }] },
    contents: [{ parts: [{ text: user }] }],
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const raw = await res.text()
  if (!res.ok) throw new Error(`Gemini: ${res.status} ${raw.slice(0, 220)}`)
  const data = JSON.parse(raw) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim()
  if (!text) throw new Error("Gemini retornou texto vazio")
  return parseJsonObject(text)
}

/**
 * Chama OpenAI (JSON mode) ou Gemini conforme variáveis de ambiente.
 */
export async function llmJsonCompletion(system: string, user: string): Promise<Record<string, unknown>> {
  const llm = resolveLlmEnv()
  if (llm.ok) {
    if (llm.backend === "gemini") {
      return geminiJson(system, user, llm.key)
    }
    return openAiJson(system, user, llm.key)
  }
  const g = getGoogleGenerativeAiKey()
  if (g.length > 0) {
    return geminiJson(system, user, g)
  }
  throw new Error("IA indisponível")
}
