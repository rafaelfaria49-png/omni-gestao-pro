import { llmJsonCompletion } from "@/lib/llm-json"

export type NcmSuggestResult = {
  ncm: string
  descricao: string
}

export type FiscalClassifyResult = {
  ncm: string
  cest: string
  cfop: string
  origemMercadoria: string
  observacao?: string
}

const SYS_NCM = `Você é especialista em NCM (Nomenclatura Comum do Mercosul) para comércio no Brasil.
Dado o NOME de um produto ou serviço em português, sugira o código NCM mais adequado (exatamente 8 dígitos numéricos, sem pontos).
Responda JSON com as chaves: "ncm" (string 8 dígitos), "descricao" (breve, em português, alinhada à lista NCM).
Se não tiver certeza, escolha o NCM mais provável para varejo/assistência técnica e indique na descrição que é sugestão.`

export async function suggestNcmFromProductName(nome: string): Promise<NcmSuggestResult> {
  const n = nome.trim()
  if (!n) throw new Error("Nome do produto vazio")
  const raw = await llmJsonCompletion(SYS_NCM, `Nome do produto: "${n}"`)
  const ncm = String(raw.ncm ?? "").replace(/\D/g, "").slice(0, 8)
  if (ncm.length !== 8) throw new Error("NCM sugerido inválido — verifique o nome e tente de novo")
  return {
    ncm,
    descricao: String(raw.descricao ?? "").trim() || "Classificação sugerida pela IA",
  }
}

const SYS_FISCAL = `Você classifica produtos para NF-e no Brasil (ICMS, NCM, CEST quando aplicável, CFOP venda interna, origem da mercadoria).
Categorias do sistema: "peca", "acessorio", "servico".
Responda APENAS JSON com chaves:
- "ncm": string, 8 dígitos
- "cest": string, 7 dígitos ou "" se não aplicável
- "cfop": string, 4 dígitos (venda mercadoria adquirida/recebida de terceiros em operação interna típica: 5102; serviço pode ser 5932 ou 5101 conforme caso — use o mais comum)
- "origemMercadoria": um caractere "0" a "8" (use "0" para nacional se não souber)
- "observacao": string curta com ressalvas legais (sugestão automática, validar com contador)`

export async function classifyProductFiscal(input: {
  nome: string
  descricao?: string
  categoria: "peca" | "acessorio" | "servico"
}): Promise<FiscalClassifyResult> {
  const nome = input.nome.trim()
  if (!nome) throw new Error("Nome do produto vazio")
  const user = JSON.stringify({
    nome,
    descricao: (input.descricao ?? "").trim(),
    categoria: input.categoria,
  })
  const raw = await llmJsonCompletion(SYS_FISCAL, user)
  const ncm = String(raw.ncm ?? "").replace(/\D/g, "").slice(0, 8)
  if (ncm.length !== 8) throw new Error("NCM inválido na classificação fiscal")
  let cest = String(raw.cest ?? "").replace(/\D/g, "").slice(0, 7)
  if (cest.length > 0 && cest.length < 7) cest = cest.padStart(7, "0")
  const cfop = String(raw.cfop ?? "5102").replace(/\D/g, "").slice(0, 4).padStart(4, "0")
  const origem = String(raw.origemMercadoria ?? "0").replace(/\D/g, "").slice(0, 1) || "0"
  const observacao = raw.observacao != null ? String(raw.observacao).trim() : undefined
  return {
    ncm,
    cest: cest.length === 7 ? cest : "",
    cfop: cfop.length === 4 ? cfop : "5102",
    origemMercadoria: /^[0-8]$/.test(origem) ? origem : "0",
    observacao,
  }
}

export type VoiceFormExtract = {
  nome: string | null
  categoria: "peca" | "acessorio" | "servico" | null
  preco_custo: number | null
  preco_venda: number | null
  quantidade_estoque: number | null
  ncm: string | null
}

const SYS_VOICE_FORM = `Você interpreta o que o lojista FALOU para cadastrar um produto em português do Brasil.
Extraia um JSON com as chaves:
- "nome": string ou null (nome do produto; se não disser, null)
- "categoria": "peca" | "acessorio" | "servico" ou null
- "preco_custo": número em reais ou null
- "preco_venda": número em reais ou null  
- "quantidade_estoque": inteiro ou null
- "ncm": string com 8 dígitos ou null se não mencionado
Números por extenso devem virar números (ex.: trinta reais -> 30).
Peça/acessório/serviço: deduza de contexto (película, tela, troca, etc.).`

export async function extractProductFormFromTranscript(transcript: string): Promise<VoiceFormExtract> {
  const t = transcript.trim()
  if (!t) {
    return {
      nome: null,
      categoria: null,
      preco_custo: null,
      preco_venda: null,
      quantidade_estoque: null,
      ncm: null,
    }
  }
  const raw = await llmJsonCompletion(SYS_VOICE_FORM, t)
  const cat = raw.categoria
  const categoria =
    cat === "peca" || cat === "acessorio" || cat === "servico" ? cat : null
  const nome = typeof raw.nome === "string" && raw.nome.trim() ? raw.nome.trim() : null
  const num = (v: unknown) => {
    if (v == null) return null
    if (typeof v === "number" && Number.isFinite(v)) return v
    if (typeof v === "string") {
      const n = parseFloat(v.replace(",", ".").replace(/[^\d.,-]/g, ""))
      return Number.isFinite(n) ? n : null
    }
    return null
  }
  let ncmStr: string | null = null
  if (raw.ncm != null) {
    const d = String(raw.ncm).replace(/\D/g, "").slice(0, 8)
    ncmStr = d.length === 8 ? d : null
  }
  const q = num(raw.quantidade_estoque)
  return {
    nome,
    categoria,
    preco_custo: num(raw.preco_custo),
    preco_venda: num(raw.preco_venda),
    quantidade_estoque: q != null ? Math.round(q) : null,
    ncm: ncmStr,
  }
}
