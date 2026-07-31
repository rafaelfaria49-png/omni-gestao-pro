/**
 * Score de completude do cadastro de produto (0–100, sem IA).
 *
 * O score antigo partia de 35 "de graça" e pontuava qualquer string não vazia: os 13
 * produtos da NF-e Martins marcavam 75 mesmo com SKU `linha-N`, sem código de barras,
 * sem fornecedor, preço zero e marca igual à categoria. Agora:
 *
 *  - a base é 0 — nada é dado de graça;
 *  - identificador só pontua se for real (`isRealProductSku`);
 *  - marca só pontua se não for cópia da categoria;
 *  - preço só pontua acima de zero;
 *  - NCM e revisão concluída entram no cálculo;
 *  - cada item é explicável (`explicarQualityScore`) para tooltip/painel.
 */

import { chaveCategoria } from "@/lib/cadastros/importacao-produtos/categoria"
import { getImportacaoMetadata } from "@/lib/cadastros/importacao-produtos/metadata"
import { isRealProductSku } from "@/lib/cadastros/importacao-produtos/sku"
import { getProdutoFiscal } from "@/lib/produto-fiscal"

/** Placeholders que a camada de exibição usa para "não informado". */
function vazio(v: unknown): boolean {
  const s = String(v ?? "").trim()
  return !s || s === "—" || s === "-"
}

export type ProdutoQualityInput = {
  nome: string
  sku: string
  barras: string
  categoria: string
  preco: number
  fornecedor: string
  marca: string
  /** Não entra no score — aceito para compatibilidade com os callers existentes. */
  garantia?: number
  /** `metadata.fiscal.ncm` (ou legado). */
  ncm?: string
  /** `metadata.importacao.ultimoLote.statusRevisao === "revisado"`. */
  revisado?: boolean
}

export type QualityScoreItem = {
  chave: string
  label: string
  peso: number
  ganho: number
  ok: boolean
  /** Por que não pontuou. Vazio quando `ok`. */
  motivo: string
}

export type QualityScoreExplicado = {
  score: number
  itens: QualityScoreItem[]
  /** Pendências ordenadas por peso — o que mais adianta corrigir primeiro. */
  pendencias: QualityScoreItem[]
}

/**
 * Pesos somam 100. Nome e preço dominam porque são o que torna o produto vendável
 * (ver `avaliarAptidaoAtivacao`); fiscal e revisão são o acabamento.
 */
const PESOS = {
  nome: 18,
  identificador: 14,
  barras: 14,
  categoria: 14,
  preco: 18,
  marca: 6,
  fornecedor: 6,
  ncm: 6,
  revisado: 4,
} as const

export function explicarQualityScore(p: ProdutoQualityInput): QualityScoreExplicado {
  const marcaEhCategoria =
    !vazio(p.marca) && !vazio(p.categoria) && chaveCategoria(p.marca) === chaveCategoria(p.categoria)

  const itens: QualityScoreItem[] = [
    {
      chave: "nome",
      label: "Nome do produto",
      peso: PESOS.nome,
      ok: !vazio(p.nome),
      motivo: "Sem nome",
    },
    {
      chave: "identificador",
      label: "SKU / código interno real",
      peso: PESOS.identificador,
      ok: isRealProductSku(p.sku),
      motivo: vazio(p.sku)
        ? "Sem SKU"
        : "SKU sintético do importador (linha-N / IMP-*) não conta como identificador",
    },
    {
      chave: "barras",
      label: "Código de barras",
      peso: PESOS.barras,
      ok: !vazio(p.barras),
      motivo: "Sem código de barras",
    },
    {
      chave: "categoria",
      label: "Categoria",
      peso: PESOS.categoria,
      ok: !vazio(p.categoria),
      motivo: "Sem categoria",
    },
    {
      chave: "preco",
      label: "Preço de venda",
      peso: PESOS.preco,
      ok: Number(p.preco) > 0,
      motivo: "Preço de venda zerado",
    },
    {
      chave: "marca",
      label: "Marca real",
      peso: PESOS.marca,
      ok: !vazio(p.marca) && !marcaEhCategoria,
      motivo: marcaEhCategoria ? "Marca é a própria categoria" : "Sem marca",
    },
    {
      chave: "fornecedor",
      label: "Fornecedor",
      peso: PESOS.fornecedor,
      ok: !vazio(p.fornecedor),
      motivo: "Sem fornecedor",
    },
    {
      chave: "ncm",
      label: "NCM",
      peso: PESOS.ncm,
      ok: !vazio(p.ncm),
      motivo: "Sem NCM",
    },
    {
      chave: "revisado",
      label: "Revisão da importação concluída",
      peso: PESOS.revisado,
      ok: p.revisado === true,
      motivo: "Importação ainda pendente de revisão",
    },
  ].map((i) => ({ ...i, ganho: i.ok ? i.peso : 0, motivo: i.ok ? "" : i.motivo }))

  const score = Math.min(100, Math.round(itens.reduce((acc, i) => acc + i.ganho, 0)))

  return {
    score,
    itens,
    pendencias: itens.filter((i) => !i.ok).sort((a, b) => b.peso - a.peso),
  }
}

/** Score 0–100 a partir da completude do cadastro (sem IA). */
export function catalogQualityScore(p: ProdutoQualityInput): number {
  return explicarQualityScore(p).score
}

/** Garantia não entra no score — mantido documentado para não voltar por engano. */
export const QUALITY_SCORE_PESOS = PESOS

/**
 * Deriva o input do score a partir de um produto da listagem, lendo NCM pelo helper
 * fiscal canônico e o status de revisão pela proveniência da importação.
 * Evita que a tela tenha de conhecer o formato do `metadata`.
 */
export function qualityScoreInputFromProduto(p: {
  nome: string
  sku: string
  barras: string
  categoria: string
  preco: number
  fornecedor: string
  marca: string
  metadata?: Record<string, unknown> | null
}): ProdutoQualityInput {
  const fiscal = getProdutoFiscal({ metadata: p.metadata })
  const importacao = getImportacaoMetadata({ metadata: p.metadata })
  return {
    nome: p.nome,
    sku: p.sku,
    barras: p.barras,
    categoria: p.categoria,
    preco: p.preco,
    fornecedor: p.fornecedor,
    marca: p.marca,
    ncm: fiscal.ncm,
    // Produto que nunca passou por importação não é penalizado por "não revisado":
    // o item é considerado cumprido quando não há lote pendente.
    revisado: importacao ? importacao.ultimoLote.statusRevisao === "revisado" : true,
  }
}
