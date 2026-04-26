import { APP_DISPLAY_NAME } from "@/lib/app-brand"
import { resolveLlmEnv } from "@/lib/resolve-llm-env"

export type FinanceiroTipo = "ENTRADA" | "SAIDA"

export type TextoFinanceiroProcessado = {
  valor: number
  categoria: string
  fornecedor: string
  formaPagamento: string
  tipo: FinanceiroTipo
}

type OpenRouterChatResponse = {
  choices?: Array<{ message?: { content?: string } }>
  error?: { message?: string }
}

type OpenAiChatResponse = {
  choices?: Array<{ message?: { content?: string } }>
  error?: { message?: string }
}

type GeminiGenResponse = {
  promptFeedback?: { blockReason?: string }
  candidates?: Array<{
    finishReason?: string
    content?: { parts?: Array<{ text?: string }> }
  }>
}

function openrouterApiKey(): string {
  const k = process.env.OPENROUTER_API_KEY
  return typeof k === "string" ? k.replace(/^[\s'"]+|[\s'"]+$/g, "").trim() : ""
}

function buildSystemPrompt(): string {
  return `Você é um parser estrito de texto financeiro para o ${APP_DISPLAY_NAME}.

Tarefa: analisar o texto do usuário (em pt-BR) e retornar EXCLUSIVAMENTE um objeto JSON válido, SEM markdown, SEM texto extra, SEM comentários, SEM quebras fora do JSON.

Estrutura obrigatória:
{ "valor": number, "categoria": string, "fornecedor": string, "formaPagamento": string, "tipo": "ENTRADA" | "SAIDA" }

Regras:
- "valor" deve ser número (ex.: 50 ou 50.75). Se o usuário usar vírgula, converta para ponto.
- "tipo": "SAIDA" para gastos/despesas/pagamentos; "ENTRADA" para recebimentos/vendas/entradas.
- "formaPagamento": normalize para um texto curto (ex.: "PIX", "DINHEIRO", "CARTAO_DEBITO", "CARTAO_CREDITO", "BOLETO", "TRANSFERENCIA", "OUTRO"). Se não houver, use "OUTRO".
- "categoria": escolha uma categoria curta e útil (ex.: "ALIMENTACAO", "FORNECEDOR", "TRANSPORTE", "ALUGUEL", "MARKETING", "SERVICOS", "IMPOSTOS", "SALARIOS", "VENDAS", "OUTROS").
- "fornecedor": nome do local/fornecedor (ex.: "Padaria", "Supermercado X"). Se não houver, use string vazia "".

Exemplos:
Usuário: "Gastei 50 reais de padaria no pix"
Saída: {"valor":50,"categoria":"ALIMENTACAO","fornecedor":"Padaria","formaPagamento":"PIX","tipo":"SAIDA"}

Usuário: "Recebi 120 no dinheiro de conserto"
Saída: {"valor":120,"categoria":"SERVICOS","fornecedor":"","formaPagamento":"DINHEIRO","tipo":"ENTRADA"}`
}

function stripToJsonObject(raw: string): string {
  const t = (raw || "").trim()
  if (!t) return ""

  // Remove cercas markdown comuns
  const noFences = t
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim()

  // Pega o primeiro objeto JSON plausível
  const firstBrace = noFences.indexOf("{")
  const lastBrace = noFences.lastIndexOf("}")
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return noFences
  return noFences.slice(firstBrace, lastBrace + 1).trim()
}

function asProcessed(input: unknown): TextoFinanceiroProcessado {
  if (!input || typeof input !== "object") throw new Error("IA retornou payload inválido (não-objeto)")
  const o = input as Record<string, unknown>
  const valor = typeof o.valor === "number" ? o.valor : Number(String(o.valor ?? "").replace(",", "."))
  if (!Number.isFinite(valor)) throw new Error("IA retornou valor inválido")
  const categoria = String(o.categoria ?? "").trim()
  const fornecedor = String(o.fornecedor ?? "").trim()
  const formaPagamento = String(o.formaPagamento ?? "").trim()
  const tipoRaw = String(o.tipo ?? "").trim()
  const tipo: FinanceiroTipo = tipoRaw === "ENTRADA" ? "ENTRADA" : tipoRaw === "SAIDA" ? "SAIDA" : (() => { throw new Error("IA retornou tipo inválido") })()

  if (!categoria) throw new Error("IA retornou categoria vazia")
  if (!formaPagamento) throw new Error("IA retornou formaPagamento vazia")

  return {
    valor: Math.round(valor * 100) / 100,
    categoria,
    fornecedor,
    formaPagamento,
    tipo,
  }
}

async function completeViaOpenRouter(system: string, userText: string): Promise<string> {
  const key = openrouterApiKey()
  if (!key) throw new Error("OPENROUTER_KEY_MISSING")
  const model = (process.env.OPENROUTER_FINANCE_MODEL || "").trim() || "openrouter/auto"
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000",
      "X-Title": APP_DISPLAY_NAME,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 220,
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
    throw new Error(`OPENROUTER_FAILED:${res.status}:${msg}`)
  }
  const j = JSON.parse(raw) as OpenRouterChatResponse
  return String(j.choices?.[0]?.message?.content ?? "").trim()
}

async function completeViaOpenAi(system: string, userText: string, apiKey: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_FINANCE_MODEL?.trim() || "gpt-4o-mini",
      temperature: 0,
      max_tokens: 220,
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
    throw new Error(`OPENAI_FAILED:${res.status}:${msg}`)
  }
  const j = JSON.parse(raw) as OpenAiChatResponse
  return String(j.choices?.[0]?.message?.content ?? "").trim()
}

async function completeViaGemini(system: string, userText: string, apiKey: string): Promise<string> {
  const model = process.env.GEMINI_FINANCE_MODEL?.trim() || "gemini-1.5-flash"
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`
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
      generationConfig: { temperature: 0, maxOutputTokens: 220 },
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
    throw new Error(`GEMINI_FAILED:${res.status}:${msg}`)
  }
  const j = JSON.parse(raw) as GeminiGenResponse
  return String(j.candidates?.[0]?.content?.parts?.[0]?.text ?? "").trim()
}

/**
 * Analisa texto financeiro livre e retorna uma estrutura normalizada.
 * Usa OpenRouter quando disponível (mesmo backend principal do "Mestre"), com fallback em OpenAI/Gemini conforme env.
 */
export async function processarTextoFinanceiro(texto: string): Promise<TextoFinanceiroProcessado> {
  const userText = String(texto || "").trim()
  if (!userText) {
    throw new Error("Texto vazio")
  }

  const system = buildSystemPrompt()

  let out = ""
  try {
    out = await completeViaOpenRouter(system, userText)
  } catch (e) {
    const env = resolveLlmEnv()
    if (!env.ok) throw e instanceof Error ? e : new Error(String(e))
    if (env.backend === "gemini") out = await completeViaGemini(system, userText, env.key)
    else out = await completeViaOpenAi(system, userText, env.key)
  }

  const jsonText = stripToJsonObject(out)
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    throw new Error("IA não retornou JSON puro válido")
  }
  return asProcessed(parsed)
}

