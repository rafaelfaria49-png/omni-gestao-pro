/**
 * Após Whisper: classifica se o áudio trata de gasto/financeiro ou dúvida (suporte).
 */

export type AudioFinanceClass = "gasto_financeiro" | "suporte"

const GASTO_RE =
  /\b(gastei|gasto|paguei|pagar|despesa|compra|comprei|sangria|suprimento|retirada|dinheiro|reais?|r\$|pix\s+d[eoa]|cart[aã]o|boleto|fornecedor|nota\s+fiscal)\b/i

export function classifyTranscriptFinanceVsSuporte(transcript: string): AudioFinanceClass {
  const t = transcript.trim()
  if (!t) return "suporte"

  if (GASTO_RE.test(t)) return "gasto_financeiro"

  const hasMoney =
    /r\$\s*\d/.test(t) ||
    /\d+[,.]\d{2}\s*reais?/i.test(t) ||
    /\b\d{1,4}(?:[.,]\d{1,2})?\s*(?:reais?|real)\b/i.test(t)
  if (hasMoney && t.length < 280) return "gasto_financeiro"

  return "suporte"
}
