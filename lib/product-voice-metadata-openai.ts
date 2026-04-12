/**
 * Extrai preço de custo, preço de venda e quantidade em estoque a partir do texto falado.
 * Trata números por extenso em PT-BR (ex.: "vender por trinta" → 30).
 */

export type ProductVoiceMetadata = {
  preco_custo: number | null
  preco_venda: number | null
  quantidade_estoque: number | null
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string") {
    const n = parseFloat(v.replace(",", ".").replace(/[^\d.,-]/g, ""))
    return Number.isFinite(n) ? n : null
  }
  return null
}

export async function extractProductMetadataFromTranscript(
  transcript: string
): Promise<ProductVoiceMetadata> {
  const key = process.env.OPENAI_API_KEY
  if (!key) {
    throw new Error("OPENAI_API_KEY não configurada")
  }

  const t = transcript.trim()
  if (!t) {
    return { preco_custo: null, preco_venda: null, quantidade_estoque: null }
  }

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
        {
          role: "system",
          content: `Você interpreta falas de donos de loja cadastrando produto.
Extraia APENAS um JSON com as chaves:
- "preco_custo": número em reais (use ponto decimal) ou null se não mencionado
- "preco_venda": número em reais ou null se não mencionado
- "quantidade_estoque": número inteiro (unidades) ou null se não mencionado

Regras importantes:
- "vender por trinta", "por trinta reais", "venda trinta" → preco_venda = 30 (não 3000)
- "custo quinze", "paguei vinte no fornecedor" → preco_custo numérico correspondente
- Números por extenso em português: converta (um=1, dois=2, … dez=10, onze…vinte, trinta, quarenta, cinquenta, sessenta, setenta, oitenta, noventa, cem, duzentos…)
- Se disser só "trinta" depois de "vender por", é o preço de venda 30.00
- Se ambíguo, prefira valores plausíveis para varejo (ex.: 30 reais, não 30 mil)
Responda só o JSON, sem markdown.`,
        },
        { role: "user", content: t },
      ],
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`OpenAI: ${res.status} ${err.slice(0, 400)}`)
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const text = data.choices?.[0]?.message?.content?.trim()
  if (!text) {
    return { preco_custo: null, preco_venda: null, quantidade_estoque: null }
  }

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(text) as Record<string, unknown>
  } catch {
    return { preco_custo: null, preco_venda: null, quantidade_estoque: null }
  }

  let preco_custo = numOrNull(parsed.preco_custo)
  let preco_venda = numOrNull(parsed.preco_venda)
  let quantidade_estoque =
    numOrNull(parsed.quantidade_estoque) != null
      ? Math.round(numOrNull(parsed.quantidade_estoque)!)
      : null

  const tl = t.toLowerCase()
  if (preco_venda == null && /\bvender\s+por\s+trinta\b/.test(tl)) {
    preco_venda = 30
  }

  return {
    preco_custo,
    preco_venda,
    quantidade_estoque,
  }
}
