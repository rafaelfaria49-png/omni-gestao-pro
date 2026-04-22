/**
 * NLP para lançamentos em carteiras (pt-BR): voz ou texto.
 */

import { extractBrlFromUtterance, voiceNormalize } from "@/lib/voice-intents"
import type { Carteira } from "@/lib/financeiro-types"

export type ParsedLancamentoCarteira = {
  tipo: "entrada" | "saida"
  valor: number
  descricao: string
  categoria: string
  /** Nome mencionado pelo usuário (para casar com carteira). */
  carteiraMencionada: string | null
  /** true se não deu para inferir a carteira. */
  precisaEscolherCarteira: boolean
}

function extractValor(text: string): number | undefined {
  const v = extractBrlFromUtterance(text)
  if (v != null) return v
  const m = text.match(
    /(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:reais?|r\$)/i
  )
  if (m) {
    const raw = m[1].replace(/\./g, "").replace(",", ".")
    const n = parseFloat(raw)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

/** Trecho após "na carteira" / "carteira X" / "no bolso". */
function extractCarteiraMencionada(text: string): string | null {
  const raw = text.trim()
  const patterns = [
    /(?:na\s+carteira|carteira|conta)\s+(?:da\s+|do\s+|de\s+)?["']?([^."'\n]+?)["']?(?:\.|$|\s+(?:com|para|de|sobre))/i,
    /(?:na\s+carteira|carteira)\s+["']?([^."'\n]+)["']?$/i,
    /(?:carteira)\s+([A-Za-zÀ-ÿ0-9\s]+?)(?:\s+com|\s+de|\s+para|$)/i,
  ]
  for (const re of patterns) {
    const m = raw.match(re)
    if (m?.[1]) {
      const nome = m[1].trim()
      if (nome.length >= 2) return nome
    }
  }
  return null
}

/** Remove valor e trechos de carteira para obter descrição do gasto/recebimento. */
function extractDescricaoCategoria(text: string, tipo: "entrada" | "saida"): { descricao: string; categoria: string } {
  let t = text
    .replace(/\b(?:gastei|paguei|debito|débito|sa[ií])\b/gi, "")
    .replace(/\b(?:entrada|recebi|credito|crédito|deposito|dep[oó]sito)\b/gi, "")
    .replace(/\b(?:na\s+carteira|carteira)\b[^.]+/gi, "")
    .replace(/r\$\s*[\d.,]+/gi, "")
    .replace(/\d+(?:[.,]\d{1,2})?\s*reais?/gi, "")
    .replace(/\s+/g, " ")
    .trim()

  const gas = /\b(gasolina|combust[ií]vel|uber|ifood|alimenta)/i.test(text)
  const forn = /\b(forne|pe[cç]a|estoque)/i.test(text)

  let categoria = "Geral"
  if (gas) categoria = "Transporte/Combustível"
  else if (forn) categoria = "Fornecedores"
  else if (tipo === "saida") categoria = "Despesas variáveis"
  else categoria = "Receitas"

  const descricao = t.slice(0, 120) || (tipo === "saida" ? "Saída" : "Entrada")
  return { descricao, categoria }
}

export function parseLancamentoCarteira(text: string): ParsedLancamentoCarteira | null {
  const raw = text.trim()
  if (!raw) return null

  const n = voiceNormalize(raw)
  const valor = extractValor(raw)
  if (valor == null || valor <= 0) return null

  const isEntrada =
    /\b(entrada|recebi|recebimento|credito|crédito|deposito|dep[oó]sito|entrou)\b/i.test(n) ||
    (!/\b(gastei|paguei|sa[ií]da|debito|débito)\b/i.test(n) && /entrada/i.test(raw))

  const tipo: "entrada" | "saida" = isEntrada ? "entrada" : "saida"

  let carteiraMencionada = extractCarteiraMencionada(raw)
  if (!carteiraMencionada) {
    const mEmpresa = raw.match(/\b(empresa|carteira\s*empresa|caixa)\b/i)
    if (mEmpresa) carteiraMencionada = "empresa"
    const mLegado = raw.match(/\b(assistec|rafacell|rafa\s*brinquedos)\b/i)
    if (!carteiraMencionada && mLegado) carteiraMencionada = mLegado[1].replace(/\s+/g, " ").trim()
  }

  const { descricao, categoria } = extractDescricaoCategoria(raw, tipo)

  return {
    tipo,
    valor,
    descricao,
    categoria,
    carteiraMencionada,
    precisaEscolherCarteira: !carteiraMencionada,
  }
}

/** Encontra carteira por nome aproximado. */
export function resolverCarteiraPorNome(carteiras: Carteira[], mencao: string): Carteira | null {
  const q = voiceNormalize(mencao).replace(/[^\w\s]/g, "")
  if (!q) return null
  if (q.includes("assistec") || q.includes("rafacell") || q.includes("empresa") || q === "caixa") {
    const hit =
      carteiras.find((c) => c.id === "cart-rafacell") ??
      carteiras.find((c) => voiceNormalize(c.nome).includes("empresa")) ??
      carteiras.find((c) => c.tipo === "empresa")
    if (hit) return hit
  }
  if (q.includes("brinquedo")) {
    const hit = carteiras.find((c) => voiceNormalize(c.nome).includes("brinquedo"))
    if (hit) return hit
  }
  let best: Carteira | null = null
  let bestScore = 0
  for (const c of carteiras) {
    const cn = voiceNormalize(c.nome).replace(/[^\w\s]/g, "")
    if (cn === q) return c
    if (cn.includes(q) || q.includes(cn)) {
      const score = Math.min(cn.length, q.length)
      if (score > bestScore) {
        bestScore = score
        best = c
      }
    }
  }
  return best
}
