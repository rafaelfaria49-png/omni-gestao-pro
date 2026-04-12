import type { VisionProductResult } from "@/lib/vision-product-openai"
import type { ProductVoiceMetadata } from "@/lib/product-voice-metadata-openai"

export type ProductFormSlice = {
  nome: string
  categoria: "peca" | "acessorio" | "servico"
  ncm: string
  descricaoVenda: string
  precoCusto: number
  precoVenda: number
  estoqueAtual: number
}

/**
 * Une resultado da IA de Visão (nome, categoria, NCM, descrição) com metadados de voz (preços e estoque).
 */
export function mergeCadastroRelampago(
  vision: VisionProductResult,
  voice: ProductVoiceMetadata | null,
  prev: ProductFormSlice
): ProductFormSlice {
  return {
    nome: vision.nome.trim() || prev.nome,
    categoria: vision.categoria,
    ncm: vision.ncm.replace(/\D/g, "").slice(0, 8) || prev.ncm,
    descricaoVenda: vision.descricaoVenda.trim() || prev.descricaoVenda,
    precoCusto:
      voice?.preco_custo != null && voice.preco_custo >= 0
        ? voice.preco_custo
        : prev.precoCusto,
    precoVenda:
      voice?.preco_venda != null && voice.preco_venda >= 0
        ? voice.preco_venda
        : prev.precoVenda,
    estoqueAtual:
      voice?.quantidade_estoque != null && voice.quantidade_estoque >= 0
        ? voice.quantidade_estoque
        : prev.estoqueAtual,
  }
}
