/** Pack de Crescimento (Feed + Reels + Stories) e Brand Voice do Estúdio Marketing. */

export type MarketingContentTab = "feed" | "reels" | "stories"

/** Abas do resultado: texto do pack + Estúdio de Mídia. */
export type MarketingPackMainTab = MarketingContentTab | "media"

export type BrandVoiceProfile = "tecnico" | "amigavel" | "luxo" | "varejo"

export type GrowthPackV2 = {
  feed: string
  reels: string
  stories: string
}

const PACK_DB_VERSION = 2

export const BRAND_VOICE_STORAGE_KEY = "omni-marketing-brand-voice"

export function brandVoiceLabel(v: BrandVoiceProfile): string {
  if (v === "tecnico") return "Especialista Técnico"
  if (v === "amigavel") return "Amigável / Descontraído"
  if (v === "luxo") return "Luxo / Exclusivo"
  return "Direto / Varejo"
}

export function brandVoiceInstructions(v: BrandVoiceProfile): string {
  switch (v) {
    case "tecnico":
      return "Vocabulário preciso, confiável, termos técnicos quando fizer sentido, sem exageros em gírias."
    case "amigavel":
      return "Tom leve, próximo do cliente, gírias suaves e emojis com moderação (opcional), conversa natural."
    case "luxo":
      return "Linguagem sofisticada, exclusividade, ritmo pausado, foco em experiência premium e detalhes de qualidade."
    default:
      return "Direto ao ponto, clareza de varejo, benefício em destaque, chamada à ação objetiva."
  }
}

export function emotionalToneLabel(tone: string): string {
  if (tone === "urg") return "urgência"
  if (tone === "irr") return "irreverente"
  return "profissional"
}

export function buildGrowthPackCommand(opts: {
  brandVoice: BrandVoiceProfile
  toneEmotional: string
  product: string
  brief: string
}): string {
  const productTag = opts.product.trim()
  const brief = opts.brief.trim()
  const bv = brandVoiceInstructions(opts.brandVoice)
  const emo = emotionalToneLabel(opts.toneEmotional)

  return [
    "Modo: PACK DE CRESCIMENTO (uma única resposta, multiformato). Idioma: pt-BR.",
    "",
    `Personalidade da marca (Brand Voice): ${brandVoiceLabel(opts.brandVoice)} — ${bv}`,
    `Tom emocional secundário (intensidade do post): ${emo}.`,
    productTag ? `Produto ou serviço: ${productTag}.` : "",
    brief ? `Brief do usuário:\n${brief}` : "",
    "",
    "Entregue APENAS um objeto JSON válido (UTF-8), sem markdown, sem texto antes ou depois, neste formato exato:",
    "{",
    '  "feed": "Uma legenda estratégica para o Feed do Instagram: gancho + benefício + CTA suave + 3 a 5 hashtags no final.",',
    '  "reels": "Roteiro de Reels dividido em três partes com estes títulos em linhas próprias: ### Gancho ### Conteúdo ### CTA. Cada parte com 2 a 5 linhas objetivas.",',
    '  "stories": "Exatamente 3 sugestões numeradas (1), (2), (3): (1) Story com enquete para engajamento (pergunta + opções A/B). (2) Story de curiosidade técnica sobre o produto/serviço. (3) Story de prova social (depoimento fictício curto ou formato de quote)."',
    "}",
    "",
    "Regras: strings em JSON podem usar \\n para quebra de linha; evite aspas duplas não escapadas dentro dos valores.",
  ]
    .filter(Boolean)
    .join("\n")
}

export function buildGoogleReviewReplyCommand(opts: { brandVoice: BrandVoiceProfile; reviewText: string }): string {
  const review = opts.reviewText.trim()
  return [
    "Você é especialista em SEO local e Google Meu Negócio (Google Maps / GMB).",
    "O lojista colou uma avaliação de cliente. Gere UMA resposta oficial da loja em pt-BR, pronta para colar no Google.",
    "",
    `Tom da marca: ${brandVoiceLabel(opts.brandVoice)} — ${brandVoiceInstructions(opts.brandVoice)}`,
    "",
    "Requisitos:",
    "- 2 a 5 frases curtas; cordial e profissional.",
    "- Agradeça o feedback; se for crítica, acolha com empatia e proponha contato offline sem discussão pública.",
    "- Inclua de forma natural 2 a 4 termos úteis para SEO local (ex.: nome da cidade se inferível do texto, tipo de loja, serviço), sem keyword stuffing.",
    "- Não invente nome da loja se não estiver na avaliação; use \"nossa equipe\" / \"aqui na loja\" se precisar.",
    "",
    "Avaliação do cliente:",
    review,
  ].join("\n")
}

function stripCodeFences(s: string): string {
  let t = s.trim()
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "")
  }
  return t.trim()
}

export function parseGrowthPackFromAiMessage(raw: string): GrowthPackV2 {
  const cleaned = stripCodeFences(raw)
  try {
    const j = JSON.parse(cleaned) as Record<string, unknown>
    if (j && typeof j.feed === "string") {
      return {
        feed: j.feed.trim(),
        reels: typeof j.reels === "string" ? j.reels.trim() : "",
        stories: typeof j.stories === "string" ? j.stories.trim() : "",
      }
    }
  } catch {
    /* fallback */
  }
  const fb = cleaned.trim()
  return { feed: fb || "Sem conteúdo estruturado — tente gerar novamente.", reels: "", stories: "" }
}

export function serializePackForDb(pack: GrowthPackV2): string {
  return JSON.stringify({
    v: PACK_DB_VERSION,
    feed: pack.feed,
    reels: pack.reels,
    stories: pack.stories,
  })
}

export function tryDeserializePackFromDb(raw: string): GrowthPackV2 | null {
  const s = raw.trim()
  if (!s) return null
  try {
    const j = JSON.parse(s) as { v?: number; feed?: string; reels?: string; stories?: string }
    if (j && j.v === PACK_DB_VERSION && typeof j.feed === "string") {
      return {
        feed: j.feed.trim(),
        reels: typeof j.reels === "string" ? j.reels.trim() : "",
        stories: typeof j.stories === "string" ? j.stories.trim() : "",
      }
    }
  } catch {
    return null
  }
  return null
}

/** Texto simples legado (antes do Pack v2). */
export function legacyCaptionAsPack(raw: string): GrowthPackV2 {
  const t = raw.trim()
  return { feed: t, reels: "", stories: "" }
}

const WEEKDAY_TIPS_PT = [
  "Domingo: mostre o descanso da equipe ou um \"antes e depois\" relaxado — humaniza a marca.",
  "Segunda-feira: abra a semana com meta ou checklist rápido (1 frame) para gerar salvar/compartilhar.",
  "Terça-feira: poste os bastidores da sua bancada ou bancada de testes para gerar confiança técnica.",
  "Quarta-feira: dica rápida em 15s (mito vs verdade) sobre o produto que mais vende.",
  "Quinta-feira: prova social — print de avaliação (com permissão) ou frase de cliente fictícia no formato quote.",
  "Sexta-feira: oferta relâmpago ou combo com urgência honesta (fim de semana chegando).",
  "Sábado: tour de 30s pela loja ou vitrine com foco no que há de novo na prateleira.",
] as const

export function dailyPostingSuggestion(): string {
  return WEEKDAY_TIPS_PT[new Date().getDay()] ?? WEEKDAY_TIPS_PT[1]
}

export function readBrandVoiceFromStorage(): BrandVoiceProfile {
  if (typeof window === "undefined") return "varejo"
  try {
    const v = String(localStorage.getItem(BRAND_VOICE_STORAGE_KEY) || "").trim()
    if (v === "tecnico" || v === "amigavel" || v === "luxo" || v === "varejo") return v
  } catch {
    /* ignore */
  }
  return "varejo"
}

export function writeBrandVoiceToStorage(v: BrandVoiceProfile) {
  try {
    localStorage.setItem(BRAND_VOICE_STORAGE_KEY, v)
  } catch {
    /* ignore */
  }
}
