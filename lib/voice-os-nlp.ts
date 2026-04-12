/**
 * Extração de campos para O.S. a partir de fala transcrita (pt-BR).
 */

import { extractBrlFromUtterance, voiceNormalize } from "@/lib/voice-intents"

export type OsVoiceExtract = {
  clienteNome: string
  aparelhoTexto: string
  marca: string
  modelo: string
  defeito: string
  valorTotal: number | undefined
}

function parseMoneyFragment(raw: string): number | undefined {
  const n = raw.replace(/\./g, "").replace(",", ".").replace(/[^\d.]/g, "")
  if (!n) return undefined
  const v = parseFloat(n)
  return Number.isFinite(v) ? v : undefined
}

/** Valor em reais (valor/preço/reais + padrões do PDV). */
export function extractOsValorReais(text: string): number | undefined {
  const base = extractBrlFromUtterance(text)
  if (base != null) return base

  const t = text.trim()
  const m1 = t.match(
    /(?:^|\s)(?:valor|pre[cç]o)\s*(?:de|é|eh)?\s*(?:r\$)?\s*(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/i
  )
  if (m1) {
    const rawNum = m1[1].includes(".") && m1[1].includes(",") ? m1[1].replace(/\./g, "") : m1[1]
    const v = parseMoneyFragment(rawNum.replace(/\./g, ""))
    if (v != null) return v
  }

  const m2 = t.match(/\b(?:por|de)\s+(\d+(?:[.,]\d{1,2})?)\s*reais?\b/i)
  if (m2) return parseMoneyFragment(m2[1])

  return undefined
}

const BRAND_HINTS: { re: RegExp; marca: string }[] = [
  { re: /\biphone\b/i, marca: "Apple" },
  { re: /\bipad\b/i, marca: "Apple" },
  { re: /\bapple\b/i, marca: "Apple" },
  { re: /\b(samsung|galaxy)\b/i, marca: "Samsung" },
  { re: /\b(motorola|moto\s?g|moto\s?e|moto\s)/i, marca: "Motorola" },
  { re: /\b(xiaomi|redmi|poco)\b/i, marca: "Xiaomi" },
  { re: /\blg\b/i, marca: "LG" },
  { re: /\bnokia\b/i, marca: "Nokia" },
  { re: /\basus\b|zenfone/i, marca: "Asus" },
  { re: /\brealme\b/i, marca: "Realme" },
  { re: /\boppo\b/i, marca: "Oppo" },
]

function inferMarcaModelo(aparelhoRaw: string): { marca: string; modelo: string; display: string } {
  const raw = aparelhoRaw.replace(/\s+/g, " ").trim()
  if (!raw) return { marca: "", modelo: "", display: "" }

  let marca = ""
  for (const { re, marca: m } of BRAND_HINTS) {
    if (re.test(raw)) {
      marca = m
      break
    }
  }

  let modelo = raw
  const iphone = raw.match(/\b(iphone\s+(?:se\s+)?[\w\s]+)/i)
  if (iphone) {
    modelo = iphone[1].replace(/\s+/g, " ").trim()
    if (!marca) marca = "Apple"
  } else if (marca) {
    modelo = raw.replace(new RegExp(`^.*?${marca}\\s*`, "i"), "").trim() || raw
  }

  const display = [marca, modelo].filter(Boolean).join(" ").trim() || raw
  return { marca, modelo: modelo || raw, display }
}

function extractCliente(raw: string): string {
  const m =
    raw.match(/\bcliente\s+(?:o\s+|a\s+)?([^.,]+?)(?=\s+(?:aparelho|defeito|problema|iphone|samsung|motorola|galaxy|valor|pre[cç]o|marca)\b|$)/i) ||
    raw.match(/\bpara\s+(?:o\s+|a\s+)?([^.,]+?)(?=\s+(?:aparelho|defeito|problema|iphone|samsung|motorola|galaxy|valor|pre[cç]o|marca)\b|$)/i)
  if (!m?.[1]) return ""
  return m[1].trim().replace(/\s+/g, " ")
}

function extractDefeito(raw: string): string {
  const m =
    raw.match(/\bdefeito\s*:?\s*([\s\S]+?)(?=\s+(?:valor|pre[cç]o|reais|\br\$)|$)/i) ||
    raw.match(/\bproblema\s*:?\s*([\s\S]+?)(?=\s+(?:valor|pre[cç]o|reais|\br\$)|$)/i)
  if (!m?.[1]) return ""
  return m[1].trim().replace(/\s+/g, " ")
}

function extractAparelho(raw: string): string {
  const m = raw.match(/\baparelho\s*:?\s*(.+?)(?=\s+(?:defeito|problema|valor|pre[cç]o)|$)/i)
  if (m?.[1]) return m[1].trim()

  const n = voiceNormalize(raw)
  const idxDef = raw.search(/\b(defeito|problema)\b/i)
  const idxVal = raw.search(/\b(valor|pre[cç]o)\b/i)
  let end = raw.length
  if (idxDef >= 0) end = Math.min(end, idxDef)
  if (idxVal >= 0) end = Math.min(end, idxVal)

  let slice = raw.slice(0, end)
  slice = slice.replace(/\b(?:servi[cç]o\s+)?para\s+(?:o\s+|a\s+)?[^.]+?(?=\s+(?:iphone|samsung|galaxy|motorola|moto|xiaomi|aparelho))/i, " ")
  slice = slice.replace(/\bcliente\s+.+?(?=\s+(?:iphone|samsung|galaxy|motorola|aparelho))/i, " ")

  const brandStart = BRAND_HINTS.map((b) => slice.search(b.re)).filter((i) => i >= 0)
  if (brandStart.length) {
    const start = Math.min(...brandStart)
    const chunk = slice.slice(start).trim()
    const words = chunk.split(/\s+/)
    if (words.length <= 8) return chunk
    return words.slice(0, 8).join(" ")
  }

  slice = slice.replace(/\s+/g, " ").trim()
  const parts = slice.split(/\s+/).filter((w) => w.length > 1)
  if (parts.length >= 2) return parts.slice(-4).join(" ")
  return slice
}

/**
 * Processa o texto transcrito e devolve campos para a O.S.
 */
export function parseOsVoiceUtterance(rawText: string): OsVoiceExtract {
  const raw = rawText.trim()
  const valorTotal = extractOsValorReais(raw)

  const clienteNome = extractCliente(raw)
  let defeito = extractDefeito(raw)
  let aparelhoTexto = extractAparelho(raw)

  if (!aparelhoTexto && clienteNome) {
    const stripped = raw
      .replace(new RegExp(`(?:para|cliente)\\s+(?:o\\s+|a\\s+)?${escapeRe(clienteNome)}`, "i"), " ")
      .replace(/\b(defeito|problema)\s*:?\s*[\s\S]+$/, "")
      .replace(/\b(valor|pre[cç]o|r\$|reais)\b.*$/i, "")
      .trim()
    aparelhoTexto = stripped.replace(/\s+/g, " ")
  }

  const { marca, modelo, display } = inferMarcaModelo(aparelhoTexto)

  if (!defeito) {
    const rest = raw
      .replace(/\b(?:para|cliente)\s+(?:o\s+|a\s+)?[^.]+?\b/i, " ")
      .replace(/\baparelho\s*:?.+?(?=\s+(?:valor|defeito|problema)|$)/i, "")
      .replace(/\b(valor|pre[cç]o)\b.*$/i, "")
      .trim()
    if (rest.length >= 4) defeito = rest.slice(0, 240)
  }

  return {
    clienteNome,
    aparelhoTexto: display || aparelhoTexto,
    marca,
    modelo: modelo || aparelhoTexto,
    defeito,
    valorTotal,
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function clienteJaExisteNasOrdens(
  ordens: { cliente: { nome: string } }[],
  nome: string
): boolean {
  const n = voiceNormalize(nome).replace(/[^\w\s]/g, "")
  if (n.length < 2) return false
  return ordens.some((o) => {
    const on = voiceNormalize(o.cliente.nome).replace(/[^\w\s]/g, "")
    return on === n || on.includes(n) || n.includes(on)
  })
}

/** Usado ao confirmar a OS para preencher marca/modelo no cadastro. */
export function resolveAparelhoParaOS(aparelhoTexto: string): { marca: string; modelo: string } {
  const { marca, modelo, display } = inferMarcaModelo(aparelhoTexto.trim())
  const m = modelo || display
  return { marca, modelo: m }
}
