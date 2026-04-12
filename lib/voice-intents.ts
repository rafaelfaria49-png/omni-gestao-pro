/**
 * Parser de intenções para comandos de voz (pt-BR).
 * Não depende de frases exatas — usa padrões e normalização leve.
 */

export type VoiceIntent =
  | { kind: "pdv_sale"; itemName: string; price?: number }
  | { kind: "os_new"; clienteNome?: string }
  | { kind: "cadastro_cliente" }
  | { kind: "cadastro_produto" }
  | { kind: "cadastro_fornecedor" }
  | { kind: "estoque_view" }
  | { kind: "preco_consulta"; produtoQuery: string }
  | { kind: "entrada_mercadoria" }
  | { kind: "abrir_caixa" }
  | { kind: "relatorio_vendas" }
  | { kind: "faturamento" }
  | { kind: "orcamento" }
  | { kind: "consultar_credito" }
  | { kind: "fechar_dia" }

function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "")
}

/** Texto para matching de palavras-chave (minúsculas, sem acento). */
export function voiceNormalize(s: string): string {
  return stripDiacritics(s).toLowerCase().replace(/\s+/g, " ").trim()
}

function parseMoneyFragment(raw: string): number | undefined {
  const n = raw.replace(",", ".").replace(/[^\d.]/g, "")
  if (!n) return undefined
  const v = parseFloat(n)
  return Number.isFinite(v) ? v : undefined
}

/** Extrai valor em reais de falas como "R$ 25", "25 reais", "por 30". */
export function extractBrlFromUtterance(text: string): number | undefined {
  const t = text.trim()
  const r1 = t.match(/r\$\s*(\d+(?:[.,]\d{1,2})?)/i)
  if (r1) return parseMoneyFragment(r1[1])
  const r2 = t.match(/(\d+(?:[.,]\d{1,2})?)\s*reais?\b/i)
  if (r2) return parseMoneyFragment(r2[1])
  const r3 = t.match(/\b(?:por|de)\s+(\d+(?:[.,]\d{1,2})?)(?:\s*reais?)?\s*$/i)
  if (r3) return parseMoneyFragment(r3[1])
  return undefined
}

/** Remove trechos monetários para isolar o nome do item. */
function stripMoneyPhrases(text: string): string {
  return text
    .replace(/r\$\s*\d+(?:[.,]\d{1,2})?/gi, " ")
    .replace(/\d+(?:[.,]\d{1,2})?\s*reais?/gi, " ")
    .replace(/\b(?:por|de)\s+\d+(?:[.,]\d{1,2})?(?:\s*reais?)?\s*$/i, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function extractPdvItemName(raw: string, price: number | undefined): string {
  let t = raw.trim()
  t = stripMoneyPhrases(t)
  const n = voiceNormalize(t)

  let m = t.match(/^\s*venda\s+de\s+(.+)$/i)
  if (m) {
    let name = m[1].trim().replace(/\s+de\s*$/i, "").trim()
    return name || "Item"
  }

  m = t.match(/^\s*vender\s+(.+)$/i)
  if (m) return m[1].trim() || "Item"

  if (n.includes("venda") || n.includes("vender")) {
    const afterDe = t.match(/(?:venda\s+de|vender)\s+(.+)/i)
    if (afterDe) {
      let name = stripMoneyPhrases(afterDe[1]).replace(/\s+de\s*$/i, "").trim()
      return name || "Item"
    }
  }

  if (price != null && t) return t
  return ""
}

/**
 * Interpreta o texto reconhecido. Retorna null se nenhum intent couber.
 */
export function parseVoiceIntent(text: string): VoiceIntent | null {
  const raw = text.trim()
  if (!raw) return null

  const n = voiceNormalize(raw)

  if (/\bconsultar\s+preco\s+de\s+/.test(n) || /\bconsultar\s+pre[cç]o\s+de\s+/.test(n)) {
    const m = raw.match(/consultar\s+pre[cç]o\s+de\s+(.+)/i)
    const q = m?.[1]?.trim()
    if (q) return { kind: "preco_consulta", produtoQuery: stripMoneyPhrases(q) }
  }

  if (n.includes("preco de") || n.includes("preço de")) {
    const m = raw.match(/pre[cç]o\s+de\s+(.+)/i)
    const q = m?.[1]?.trim()
    if (q) return { kind: "preco_consulta", produtoQuery: stripMoneyPhrases(q) }
  }

  if (n.includes("entrada de mercadoria") || n.includes("entrada mercadoria")) {
    return { kind: "entrada_mercadoria" }
  }

  if (
    n.includes("ver estoque") ||
    n === "estoque" ||
    n.startsWith("mostrar estoque") ||
    /\bquanto\s+tem\s+de\b.*\bno\s+estoque\b/.test(n) ||
    n.includes("verifica quanto tem de")
  ) {
    return { kind: "estoque_view" }
  }

  if (n.includes("cadastrar fornecedor") || n.includes("novo fornecedor")) {
    return { kind: "cadastro_fornecedor" }
  }

  if (n.includes("novo produto") || n.includes("cadastrar produto")) {
    return { kind: "cadastro_produto" }
  }

  if (n.includes("cadastrar cliente") || n.includes("novo cliente")) {
    return { kind: "cadastro_cliente" }
  }

  if (
    n.includes("nova ordem de servico") ||
    n.includes("nova ordem de serviço") ||
    /\bnova\s+os\b/.test(n) ||
    n.includes("abrir os") ||
    n.includes("abrir o.s") ||
    n.includes("abrir o s") ||
    n.includes("abrir ordem de servico") ||
    n.includes("abrir ordem de serviço")
  ) {
    return { kind: "os_new" }
  }

  const servCliente = raw.match(/servi[cç]o\s+para\s+(.+)/i)
  if (servCliente) {
    const nome = servCliente[1]?.trim()
    return { kind: "os_new", clienteNome: nome || undefined }
  }

  if (n.includes("relatorio de venda") || n.includes("relatório de venda")) {
    return { kind: "relatorio_vendas" }
  }

  if (
    n.includes("fechar dia") ||
    n.includes("fechar o dia") ||
    n.includes("fechamento do dia") ||
    n.includes("encerrar dia") ||
    n.includes("resumo do dia")
  ) {
    return { kind: "fechar_dia" }
  }

  if (n.includes("ver faturamento") || n.includes("faturamento") || n.includes("ver faturamentos")) {
    return { kind: "faturamento" }
  }

  if (n.includes("abrir caixa")) {
    return { kind: "abrir_caixa" }
  }

  if (
    n.includes("novo orcamento") ||
    n.includes("novo orçamento") ||
    n.includes("faz um orcamento") ||
    n.includes("faz um orçamento")
  ) {
    return { kind: "orcamento" }
  }

  if (n.includes("consultar credito") || n.includes("consultar crédito")) {
    return { kind: "consultar_credito" }
  }

  if (n.includes("nova venda") || n.includes("fazer uma venda") || n.includes("iniciar venda")) {
    return { kind: "pdv_sale", itemName: "" }
  }

  if (
    n.includes("abrir pdv") ||
    (n.includes("abrir") && n.includes("pdv")) ||
    n.includes("nova venda rapida") ||
    n.includes("nova venda rápida")
  ) {
    return { kind: "pdv_sale", itemName: "" }
  }

  const price = extractBrlFromUtterance(raw)
  if (n.includes("venda") || n.includes("vender")) {
    const itemName = extractPdvItemName(raw, price)
    if (itemName) return { kind: "pdv_sale", itemName, price }
    if (price != null) return { kind: "pdv_sale", itemName: "Item", price }
  }

  return null
}
