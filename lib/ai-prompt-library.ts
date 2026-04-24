/**
 * Biblioteca de prompts profissionais para a Central de IA (IA Mestre).
 * Variáveis no texto do prompt: use [NOME_DA_VARIÁVEL] para o utilizador completar antes de enviar.
 */

export type PromptCategory = "Marketing" | "Vendas" | "Financeiro" | "Suporte" | "Estratégia"

export type AiPromptLibraryEntry = {
  id: string
  category: PromptCategory
  /** Emoji ou carácter curto para o card. */
  icon: string
  title: string
  description: string
  /** Texto completo enviado ao modelo após o utilizador editar [variáveis]. */
  promptText: string
  /**
   * Prompts mais complexos: visíveis e com badge PREMIUM apenas no plano Ouro.
   */
  premiumOnly?: boolean
}

export const AI_PROMPT_CATEGORIES: readonly PromptCategory[] = [
  "Marketing",
  "Vendas",
  "Financeiro",
  "Suporte",
  "Estratégia",
] as const

export const AI_PROMPT_LIBRARY: readonly AiPromptLibraryEntry[] = [
  // --- Marketing ---
  {
    id: "mkt-calendario-30d",
    category: "Marketing",
    icon: "📱",
    title: "Calendário de 30 dias para Instagram",
    description: "Persona: Social Media Expert — calendário completo com legendas e hashtags.",
    promptText:
      "Atue como um Social Media Expert. Crie um calendário de 30 dias de postagens para o Instagram da minha loja, focando em [NOME DO FOCO]. Para cada dia inclua: ideia do post, legenda pronta, sugestão de hashtags e ideia de arte (descreva visualmente).",
    premiumOnly: true,
  },
  {
    id: "mkt-reels-viral",
    category: "Marketing",
    icon: "🎬",
    title: "Roteiro de Reels Viral",
    description: "Persona: Especialista em Vídeos Curtos — gancho, retenção e CTA.",
    promptText:
      "Atue como um Especialista em Vídeos Curtos (Reels/TikTok). Escreva um roteiro detalhado (com tempo aproximado por cena) para um Reels viral sobre [TEMA_DO_VÍDEO] para a minha loja. Inclua: gancho nos primeiros 2 segundos, desenvolvimento, CTA final e sugestão de texto na tela.",
    premiumOnly: true,
  },
  {
    id: "mkt-bio-instagram",
    category: "Marketing",
    icon: "✨",
    title: "Bio do Instagram (3 opções)",
    description: "Textos curtos e profissionais para perfil da loja.",
    promptText:
      "Crie 3 versões de bio para Instagram da minha loja (até 150 caracteres cada). Tom: [TOM: ex. profissional / descontraído]. Nicho: [NICHO]. Inclua uma linha com CTA (ex.: link na bio / WhatsApp).",
  },

  // --- Vendas ---
  {
    id: "vendas-reativacao",
    category: "Vendas",
    icon: "📞",
    title: "Script de Reativação de Clientes Inativos",
    description: "Persona: Especialista em CRM — mensagem por WhatsApp ou ligação.",
    promptText:
      "Atue como um Especialista em CRM. Escreva um script curto (WhatsApp + versão para ligação) para reativar clientes inativos da minha loja. Contexto: vendemos [TIPO_DE_PRODUTO_SERVIÇO]. Última compra há mais de [NÚMERO] dias. Tom cordial, sem pressão agressiva. Inclua 2 follow-ups se não responder.",
    premiumOnly: true,
  },
  {
    id: "vendas-descricao-conversao",
    category: "Vendas",
    icon: "🛒",
    title: "Descrição de Produto focada em Conversão",
    description: "Persona: Copywriter de E-commerce — bullets, benefícios e urgência leve.",
    promptText:
      "Atue como um Copywriter de E-commerce. Crie uma descrição persuasiva e otimizada para conversão do produto [NOME_DO_PRODUTO]. Inclua: headline, bullets de benefícios (não só características), prova social sugerida (placeholder se não houver dados), objeções comuns e respostas, e CTA final. Público: [PÚBLICO_ALVO].",
  },

  // --- Financeiro ---
  {
    id: "fin-cobranca-educada",
    category: "Financeiro",
    icon: "✉️",
    title: "Mensagem de Cobrança Educada mas Firme",
    description: "Persona: Gestor de Cobrança — WhatsApp ou e-mail.",
    promptText:
      "Atue como um Gestor de Cobrança. Redija uma mensagem educada mas firme para cobrar um cliente com atraso de [NÚMERO_DE_DIAS] dias no valor de [VALOR]. Canal: [CANAL: WhatsApp ou e-mail]. Inclua: lembrete do vencimento, opções de parcelamento (placeholder), tom profissional e prazo para resposta.",
  },
  {
    id: "fin-margem-lucro",
    category: "Financeiro",
    icon: "📈",
    title: "Estratégia para aumentar a Margem de Lucro",
    description: "Persona: Consultor Financeiro — levers práticos e priorização.",
    promptText:
      "Atue como um Consultor Financeiro. Analise o cenário de uma loja que vende [TIPO_DE_PRODUTO] com ticket médio aproximado de [TICKET_MÉDIO]. Sugira 5 alavancas práticas para aumentar margem de lucro (preço, mix, custos, bundling, upsell). Para cada uma: impacto estimado (baixo/médio/alto), esforço e risco. Termine com um plano em 30 dias em 4 passos.",
    premiumOnly: true,
  },

  // --- Suporte ---
  {
    id: "sup-reclamacao",
    category: "Suporte",
    icon: "🛡️",
    title: "Resposta a Reclamação Difícil",
    description: "Persona: Especialista em Sucesso do Cliente — empatia e próximo passo.",
    promptText:
      "Atue como um Especialista em Sucesso do Cliente. O cliente reclamou de: [RESUMO_DA_RECLAMAÇÃO]. Escreva uma resposta empática, profissional e objetiva (sem juridiquês excessivo), reconhecendo o incómodo, pedindo detalhes que faltam e propondo um próximo passo concreto (ex.: troca, reparo, estorno parcial). Tom: [TOM].",
    premiumOnly: true,
  },
  {
    id: "sup-garantia-cdc",
    category: "Suporte",
    icon: "⚖️",
    title: "Explicação de Garantia Legal (90 dias CDC)",
    description: "Persona: Consultor Jurídico — linguagem clara para cliente final.",
    promptText:
      "Atue como um Consultor Jurídico (linguagem clara para cliente final, sem substituir advogado). Explique de forma objetiva a garantia legal de 90 dias para serviços e produtos duráveis conforme o Código de Defesa do Consumidor (Brasil), no contexto de [TIPO_DE_SERVIÇO_OU_PRODUTO]. Inclua: o que cobre, o que não cobre, prazo, e como acionar na prática na loja.",
  },

  // --- Estratégia ---
  {
    id: "est-top3-semana",
    category: "Estratégia",
    icon: "📋",
    title: "TOP 3 da semana (foco operacional)",
    description: "Priorize tarefas com impacto em vendas e organização.",
    promptText:
      "Ajude-me a escolher as 3 prioridades mais importantes para a minha loja esta semana. Contexto: [RESUMO_DA_SITUAÇÃO]. Para cada prioridade: por que agora, primeira ação concreta em 15 minutos e como medir se deu certo no fim da semana.",
  },
  {
    id: "est-swot",
    category: "Estratégia",
    icon: "🎯",
    title: "SWOT da Loja em 2026",
    description: "Forças, fraquezas, oportunidades e ameaças com priorização.",
    promptText:
      "Atue como um consultor de estratégia para varejo. Monte uma matriz SWOT para a minha loja ([NOME_FANTASIA]), que atua em [SEGMENTO] na região [REGIÃO]. Para cada quadrante liste 4 itens. No final, indique as 3 ações prioritárias para os próximos 90 dias.",
    premiumOnly: true,
  },
  {
    id: "est-okrs",
    category: "Estratégia",
    icon: "🧭",
    title: "OKRs trimestrais (loja física + digital)",
    description: "Objetivos mensuráveis e resultados-chave alinhados à operação.",
    promptText:
      "Defina 3 OKRs para o próximo trimestre para uma loja de [SEGMENTO]. Para cada OKR: objetivo, 3 resultados-chave mensuráveis, métrica base sugerida (placeholder se não tiver dados) e rituais de acompanhamento semanais. Considere: vendas, estoque, financeiro e experiência do cliente.",
    premiumOnly: true,
  },
] as const

export function promptsForCategory(category: PromptCategory, isOuro: boolean): AiPromptLibraryEntry[] {
  return AI_PROMPT_LIBRARY.filter((p) => p.category === category && (!p.premiumOnly || isOuro))
}

export function promptsVisibleForPlan(isOuro: boolean): AiPromptLibraryEntry[] {
  return AI_PROMPT_LIBRARY.filter((p) => !p.premiumOnly || isOuro)
}
