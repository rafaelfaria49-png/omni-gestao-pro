export const runtime = "edge"

/**
 * Orquestrador de IA (Mestre): classifica o comando e escolhe o backend adequado.
 * Planos: "ouro" = Premium (mesmo nome de produto). IAs pesadas exigem Premium.
 *
 * O handler HTTP que consulta estoque (Prisma) permanece em `nodejs` em
 * `app/api/ai/orchestrate/route.ts`; a lógica pura deste módulo alinha-se ao Edge.
 */

export type PlanoAssinatura = "bronze" | "prata" | "ouro"

/** Destinos técnicos (nomes de produto conforme especificação do produto). */
export type AIProviderId =
  | "gemini_3_flash"
  | "nano_banana_2"
  | "nano_banana_pro"
  | "veo"
  | "lyria_3"
  | "perplexity_search"

export type IntentKind =
  | "texto_suporte"
  | "imagem_leve"
  | "imagem_pro"
  | "video_promo"
  | "musica_trilha"
  | "pesquisa_mercado"

export type OrchestratorDecision = {
  intent: IntentKind
  provider: AIProviderId
  /** Nome amigável para UI. */
  label: string
  /** Requer plano Premium (ouro). */
  requiresPremium: boolean
  /** Confiança heurística 0–1. */
  confidence: number
  /** Motivo curto para logs. */
  reason: string
}

const PREMIUM_ONLY: ReadonlySet<AIProviderId> = new Set(["veo", "nano_banana_pro"])

/** Premium = plano ouro (equivalente ao produto "Premium"). */
export function isPremiumPlan(plano: PlanoAssinatura | string): boolean {
  return plano === "ouro"
}

export function providerRequiresPremium(provider: AIProviderId): boolean {
  return PREMIUM_ONLY.has(provider)
}

export function canUseProvider(plano: PlanoAssinatura | string, provider: AIProviderId): boolean {
  if (!providerRequiresPremium(provider)) return true
  return isPremiumPlan(plano)
}

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
}

/**
 * Classifica o texto do usuário e escolhe provedor + intent.
 * Heurística por palavras-chave (sem chamada de rede).
 */
export function classifyUserCommand(raw: string): OrchestratorDecision {
  const t = norm(raw)

  if (!t) {
    return {
      intent: "texto_suporte",
      provider: "gemini_3_flash",
      label: "Gemini 3 Flash",
      requiresPremium: false,
      confidence: 0.2,
      reason: "entrada vazia — fallback suporte",
    }
  }

  // Vídeo promocional → Veo (Premium)
  if (
    /\b(veo|video promocional|v[ií]deo promocional|criar video|criar v[ií]deo|an[uú]ncio em v[ií]deo|spot publicit[aá]rio)\b/.test(
      t
    ) ||
    (t.includes("video") && (t.includes("promo") || t.includes("anuncio") || t.includes("anúncio")))
  ) {
    return {
      intent: "video_promo",
      provider: "veo",
      label: "Google Veo",
      requiresPremium: true,
      confidence: 0.85,
      reason: "pedido de vídeo promocional",
    }
  }

  // Trilha / música → Lyria 3
  if (
    /\b(lyria|trilha sonora|m[uú]sica para (o )?v[ií]deo|soundtrack|jingle|audio para video)\b/.test(t) ||
    (t.includes("musica") && t.includes("video"))
  ) {
    return {
      intent: "musica_trilha",
      provider: "lyria_3",
      label: "Lyria 3",
      requiresPremium: false,
      confidence: 0.8,
      reason: "trilha ou música para vídeo",
    }
  }

  // Pesquisa mercado / fornecedor → Perplexity
  if (
    /\b(perplexity|searchgpt|pesquisa|pre[cç]o de mercado|cota[cç][aã]o|fornecedor|melhor pre[cç]o|comparar pre[cç]o)\b/.test(
      t
    ) ||
    (t.includes("fornecedor") && (t.includes("preco") || t.includes("preço") || t.includes("quanto"))) ||
    (t.includes("mercado") && t.includes("preco"))
  ) {
    return {
      intent: "pesquisa_mercado",
      provider: "perplexity_search",
      label: "Perplexity / Search",
      requiresPremium: false,
      confidence: 0.82,
      reason: "pesquisa de preço ou fornecedor",
    }
  }

  // Imagem PRO (Premium) — remover fundo avançado, banner premium
  if (
    /\b(nano banana pro|fundo pro|recorte profissional|post premium|arte premium)\b/.test(t) ||
    (t.includes("nano banana") && t.includes("pro"))
  ) {
    return {
      intent: "imagem_pro",
      provider: "nano_banana_pro",
      label: "Nano Banana Pro",
      requiresPremium: true,
      confidence: 0.78,
      reason: "fluxo imagem premium",
    }
  }

  // Imagem leve — post, remover fundo simples, social
  if (
    /\b(nano banana|remover fundo|tirar fundo|fundo transparente|criar post|post instagram|story|banner simples|thumbnail)\b/.test(
      t
    ) ||
    (t.includes("imagem") && (t.includes("post") || t.includes("fundo"))) ||
    t.includes("figur") ||
    (t.includes("foto") && t.includes("fundo"))
  ) {
    return {
      intent: "imagem_leve",
      provider: "nano_banana_2",
      label: "Nano Banana 2",
      requiresPremium: false,
      confidence: 0.8,
      reason: "criação de imagem / fundo / post",
    }
  }

  // Default: dúvida técnica de bancada / suporte texto
  return {
    intent: "texto_suporte",
    provider: "gemini_3_flash",
    label: "Gemini 3 Flash",
    requiresPremium: false,
    confidence: 0.55,
    reason: "fallback suporte técnico / texto",
  }
}

export type OrchestrateResult =
  | {
      ok: true
      decision: OrchestratorDecision
      /** Mensagem para o usuário (Mestre). */
      message: string
    }
  | {
      ok: false
      decision: OrchestratorDecision
      blockedReason: "premium_required"
      message: string
    }

/**
 * Aplica política de plano sobre a decisão de roteamento.
 */
export function orchestrateCommand(
  userText: string,
  plano: PlanoAssinatura | string
): OrchestrateResult {
  const decision = classifyUserCommand(userText)

  if (decision.requiresPremium && !isPremiumPlan(plano)) {
    return {
      ok: false,
      decision,
      blockedReason: "premium_required",
      message: `Este recurso (${decision.label}) está disponível no plano Premium. Faça upgrade em Meu Plano para usar Veo e Nano Banana Pro.`,
    }
  }

  return {
    ok: true,
    decision,
    /** Preenchido em `/api/ai/orchestrate` (estoque + OpenAI). */
    message: "",
  }
}
