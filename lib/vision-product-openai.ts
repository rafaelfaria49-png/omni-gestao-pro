/**
 * Análise de foto de produto via OpenAI Vision (GPT-4o-mini).
 * Requer OPENAI_API_KEY.
 */

export type VisionProductResult = {
  nome: string
  categoria: "peca" | "acessorio" | "servico"
  ncm: string
  descricaoVenda: string
}

function normalizeNcm(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 8)
  return d
}

function normalizeCategoria(v: unknown): VisionProductResult["categoria"] {
  const s = typeof v === "string" ? v.trim().toLowerCase() : ""
  if (s === "peca" || s === "acessorio" || s === "servico") return s
  if (s.includes("acess")) return "acessorio"
  if (s.includes("serv")) return "servico"
  return "peca"
}

export async function analyzeProductImageFromDataUrl(
  imageDataUrl: string
): Promise<VisionProductResult> {
  const key = process.env.OPENAI_API_KEY
  if (!key) {
    throw new Error("OPENAI_API_KEY não configurada")
  }

  if (!imageDataUrl.startsWith("data:image/")) {
    throw new Error("Imagem inválida: use data URL (data:image/...)")
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
          content: `Você ajuda no cadastro de produtos em loja de assistência técnica, celulares e variedades (ex.: brinquedos).
Analise a foto: embalagem, produto, rótulos, logos.
Responda APENAS um objeto JSON com exatamente estas chaves:
- "nome": string, nome comercial curto (marca/modelo se visível na foto).
- "categoria": exatamente uma destas strings em minúsculas: "peca", "acessorio", "servico".
  * peça de reposição (tela, bateria, placa) = "peca"
  * capas, películas, fones, brinquedos avulsos de uso = "acessorio"
  * apenas serviço sem item físico = "servico"
- "ncm": string com 8 dígitos numéricos, código NCM Mercosul mais coerente (ex.: 85171231 telefonia celular, 85177090 telas, 85076000 baterias, 39269090 plásticos diversos, 95030099 brinquedos). Se incerto, aproxime ao tipo de mercadoria.
- "descricaoVenda": string em português do Brasil, 2 a 3 linhas, tom atrativo para varejo, sem markdown nem aspas internas estranhas.`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Identifique o produto na imagem e preencha o JSON conforme instruções do sistema.",
            },
            {
              type: "image_url",
              image_url: { url: imageDataUrl },
            },
          ],
        },
      ],
    }),
  })

  if (!res.ok) {
    const t = await res.text()
    throw new Error(`OpenAI: ${res.status} ${t.slice(0, 400)}`)
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const text = data.choices?.[0]?.message?.content?.trim()
  if (!text) {
    throw new Error("Resposta vazia da IA")
  }

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error("JSON inválido retornado pela IA")
  }

  const nome = String(parsed.nome ?? "").trim() || "Produto (revise o nome)"
  const cat = normalizeCategoria(parsed.categoria)

  const ncm = normalizeNcm(String(parsed.ncm ?? ""))

  const descricaoVenda = String(parsed.descricaoVenda ?? "").trim() || nome

  return {
    nome,
    categoria: cat,
    ncm,
    descricaoVenda,
  }
}
