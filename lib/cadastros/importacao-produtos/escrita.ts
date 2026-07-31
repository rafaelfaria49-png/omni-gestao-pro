/**
 * Regras de escrita do produto importado (puras).
 *
 * O persistidor Prisma consome exatamente estas funções, e o teste de regressão da
 * NF-e Martins também — assim o que o teste prova é o que o banco recebe.
 *
 * Invariantes:
 *  - `brand` nunca recebe o nome da categoria (defeito original) nem é inventado do nome;
 *  - `stock` de produto existente NUNCA é tocado (saldo só muda por movimentação auditada);
 *  - `active`/`status` saem SEMPRE de `resolveImportProductActivation` — criação e
 *    atualização usam a mesma política (F-05). Produto que termina a importação com
 *    preço <= 0 fica inativo e incompleto, seja ele novo ou existente;
 *  - SKU sintético é limpo; SKU real é gravado; ausência preserva o que já existe.
 */

import {
  resolveImportProductActivation,
  type CampoCriticoImport,
  type ResultadoAtivacaoImport,
} from "./ativacao"
import { chaveCategoria } from "./categoria"
import type { StatusRevisaoImport } from "./metadata"
import { isSyntheticImportSku } from "./sku"
import type { PoliticaEstoqueImport, ProdutoCandidato, ProdutoImportLinha } from "./types"

/** Marca a gravar: só quando informada e diferente da categoria. */
export function marcaParaGravar(linha: ProdutoImportLinha, categoria: string): string {
  const marca = linha.marca.trim()
  if (!marca) return ""
  if (categoria.trim() && chaveCategoria(marca) === chaveCategoria(categoria)) return ""
  return marca
}

/**
 * `true` quando a marca gravada no produto é, na prática, a categoria — a assinatura
 * exata do defeito `brand = category` do persistidor antigo (inclusive na forma
 * slugada `pilhas_e_baterias`). Compara contra a categoria resolvida E a da planilha
 * para não depender de qual das duas grafias está no banco.
 *
 * Marca curada pelo operador ("Duracell", "Panasonic") nunca cai aqui.
 */
export function marcaEhCopiaDaCategoria(
  marcaAtual: string | null | undefined,
  categoriaResolvida: string,
  categoriaDaPlanilha: string,
): boolean {
  const atual = chaveCategoria(marcaAtual)
  if (!atual) return false
  return (
    atual === chaveCategoria(categoriaResolvida) || atual === chaveCategoria(categoriaDaPlanilha)
  )
}

/** Campos fiscais que vão para o helper canônico `mergeProdutoFiscalIntoMetadata`. */
export function fiscalInputDaLinha(linha: ProdutoImportLinha): {
  ncm: string | null
  cest: string | null
  unidadeComercial: string | null
  unidadeTributavel: string | null
} {
  return {
    ncm: linha.fiscal.ncm || null,
    cest: linha.fiscal.cest || null,
    unidadeComercial: linha.fiscal.unidadeComercial || null,
    unidadeTributavel: linha.fiscal.unidadeTributavel || null,
  }
}

export type DadosCriacaoProduto = {
  name: string
  sku: string | null
  barcode: string | null
  category: string | null
  brand: string
  supplierName: string
  precoCusto: number
  price: number
  stock: number
  warrantyDays: number
  active: boolean
  status: "Ativo" | "Inativo" | "Incompleto"
}

export function montarCriacaoProduto(
  linha: ProdutoImportLinha,
  opts: { categoria: string; politicaEstoque: PoliticaEstoqueImport },
): DadosCriacaoProduto {
  const categoria = opts.categoria.trim()
  // `nao_movimentar` (padrão) cadastra com saldo 0 — entrada física/fiscal é outro fluxo.
  const stock = opts.politicaEstoque === "planilha_somente_novos" ? (linha.estoque ?? 0) : 0
  const ativacao = ativacaoDaCriacao(linha, categoria)

  return {
    name: linha.nome,
    sku: linha.sku,
    barcode: linha.barcode,
    category: categoria || null,
    brand: marcaParaGravar(linha, categoria),
    supplierName: linha.fornecedorNome,
    precoCusto: linha.custo,
    price: linha.preco,
    stock,
    warrantyDays: linha.garantiaDias ?? 0,
    // Criação sempre decide as duas colunas — o `??` só existe porque o tipo do
    // resultado permite "não tocar", situação que nunca ocorre em criação.
    active: ativacao.active ?? false,
    status: ativacao.status ?? "Inativo",
  }
}

/** Política de ativação aplicada à CRIAÇÃO. Exportada para o preview e a auditoria. */
export function ativacaoDaCriacao(
  linha: ProdutoImportLinha,
  categoria: string,
): ResultadoAtivacaoImport {
  return resolveImportProductActivation({
    operacao: "criacao",
    nome: linha.nome,
    categoria: categoria.trim() || null,
    preco: linha.preco,
  })
}

/**
 * Patch de atualização. Chaves ausentes significam "não tocar" — é assim que
 * estoque e preço já curado ficam preservados.
 *
 * `active`/`status` só aparecem quando a política MANDA rebaixar (preço final <= 0).
 * Produto com preço válido continua com a chave ausente: importação não reativa
 * cadastro que o operador desligou.
 */
export type PatchAtualizacaoProduto = {
  name: string
  sku?: string | null
  barcode?: string
  category?: string
  brand?: string
  supplierName?: string
  precoCusto?: number
  price?: number
  warrantyDays?: number
  active?: boolean
  status?: "Ativo" | "Inativo" | "Incompleto"
}

/** Alvo mínimo para decidir a atualização: identidade + situação + preço atual. */
export type AlvoAtualizacao = Pick<ProdutoCandidato, "sku" | "brand" | "price" | "active">

export function montarAtualizacaoProduto(
  linha: ProdutoImportLinha,
  alvo: AlvoAtualizacao,
  opts: { categoria: string; statusRevisaoAtual?: StatusRevisaoImport },
): PatchAtualizacaoProduto {
  const categoria = opts.categoria.trim()
  const marca = marcaParaGravar(linha, categoria)

  const patch: PatchAtualizacaoProduto = { name: linha.nome }

  if (linha.sku) patch.sku = linha.sku
  else if (isSyntheticImportSku(alvo.sku)) patch.sku = null

  if (linha.barcode) patch.barcode = linha.barcode
  if (categoria) patch.category = categoria

  if (marca) patch.brand = marca
  // Planilha sem marca: limpa apenas a marca que É a categoria (defeito conhecido).
  // Marca curada pelo operador é preservada por omissão da chave.
  else if (marcaEhCopiaDaCategoria(alvo.brand, categoria, linha.categoria)) patch.brand = ""

  if (linha.fornecedorNome) patch.supplierName = linha.fornecedorNome
  if (linha.custo > 0) patch.precoCusto = linha.custo
  if (linha.preco > 0) patch.price = linha.preco
  if (linha.garantiaDias != null) patch.warrantyDays = linha.garantiaDias

  // ── Política de ativação (F-05) ────────────────────────────────────────────
  // Decidida sobre o preço FINAL: o da planilha quando ela trouxe preço, senão o
  // que já estava no banco. Sem isso, produto que continua a R$ 0,00 seguia ativo
  // e vendável — foi o que manteve os 13 itens da NF-e Martins no PDV.
  const ativacao = ativacaoDaAtualizacao(linha, alvo, opts)
  if (ativacao.active !== undefined) patch.active = ativacao.active
  if (ativacao.status !== undefined) patch.status = ativacao.status

  return patch
}

/** Política de ativação aplicada à ATUALIZAÇÃO. Exportada para o preview e a auditoria. */
export function ativacaoDaAtualizacao(
  linha: ProdutoImportLinha,
  alvo: AlvoAtualizacao,
  opts: {
    categoria: string
    statusRevisaoAtual?: StatusRevisaoImport
    camposCriticosAlterados?: readonly CampoCriticoImport[]
    temConflitoIdentidade?: boolean
  },
): ResultadoAtivacaoImport {
  const categoria = opts.categoria.trim()
  const precoFinal = linha.preco > 0 ? linha.preco : Number(alvo.price ?? 0)
  return resolveImportProductActivation({
    operacao: "atualizacao",
    nome: linha.nome,
    categoria: categoria || null,
    preco: precoFinal,
    activeAtual: alvo.active,
    statusRevisaoAtual: opts.statusRevisaoAtual,
    camposCriticosAlterados: opts.camposCriticosAlterados,
    temConflitoIdentidade: opts.temConflitoIdentidade,
  })
}

/** Campos que a atualização vai mexer / preservar — texto do preview. */
export function diffAtualizacao(
  linha: ProdutoImportLinha,
  alvo: Pick<ProdutoCandidato, "name" | "sku" | "barcode" | "brand" | "price" | "active">,
  opts: { categoria: string; statusRevisaoAtual?: StatusRevisaoImport },
): { alterados: string[]; preservados: string[] } {
  const patch = montarAtualizacaoProduto(linha, alvo, opts)
  const alterados: string[] = []
  // A situação só é "preservada" quando a política NÃO mandou rebaixar o produto.
  const preservados: string[] = ["estoque"]
  if (patch.active === undefined) preservados.push("situação ativo/inativo")
  else if (patch.active === false) alterados.push("situação (inativado: sem preço de venda)")

  if (patch.name !== alvo.name) alterados.push("nome")
  if (patch.sku !== undefined) {
    alterados.push(patch.sku === null ? "sku (limpeza do sintético)" : "sku")
  }
  if (patch.barcode !== undefined && patch.barcode !== alvo.barcode) alterados.push("código de barras")
  if (patch.category !== undefined) alterados.push("categoria")
  if (patch.brand !== undefined) {
    alterados.push(patch.brand === "" ? "marca (limpeza da cópia da categoria)" : "marca")
  }
  if (patch.supplierName !== undefined) alterados.push("fornecedor")
  if (patch.precoCusto !== undefined) alterados.push("custo")
  if (patch.price !== undefined) alterados.push("preço")
  else preservados.unshift("preço atual")
  if (patch.warrantyDays !== undefined) alterados.push("garantia")
  if (linha.fiscal.ncm || linha.fiscal.cest) alterados.push("NCM/CEST")

  return { alterados, preservados }
}
