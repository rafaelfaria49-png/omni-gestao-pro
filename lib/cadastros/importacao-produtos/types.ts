/**
 * Contrato semântico da importação de PRODUTOS por planilha.
 *
 * Núcleo puro (sem Prisma, sem React): tudo aqui é determinístico e testável.
 * O persistidor (`lib/importador-avancado/persistidor.ts`) busca os candidatos no
 * banco e delega a decisão para estas funções — nenhuma regra de identidade vive
 * dentro do acesso a dados.
 */

/** Como a linha da planilha foi casada com um produto já existente na loja. */
export type ProdutoImportMatch = "barcode" | "sku" | "codigo_fornecedor" | "nome_exato"

/** Resultado previsto para uma linha antes de persistir. */
export type ProdutoImportAcao = "criar" | "atualizar" | "ignorar" | "conflito"

/**
 * Política de estoque do lote. `nao_movimentar` é o padrão: cadastro sem tocar em
 * saldo. Nenhuma das duas opções sobrescreve o estoque de produto já existente.
 */
export type PoliticaEstoqueImport = "nao_movimentar" | "planilha_somente_novos"

/** Identidade fiscal aceita pela planilha — subconjunto do contrato `lib/produto-fiscal.ts`. */
export type ProdutoImportFiscal = {
  ncm: string
  cest: string
  unidadeComercial: string
  unidadeTributavel: string
  gtinComercial: string
  gtinTributavel: string
}

/** Campo fiscal recebido em formato inválido — vira alerta visível, nunca silêncio. */
export type ProdutoImportFiscalInvalido = {
  campo: "ncm" | "cest"
  valorOriginal: string
  motivo: string
}

/** Linha da planilha já normalizada para o vocabulário do cadastro. */
export type ProdutoImportLinha = {
  /** 1-based, referente à ordem das linhas de dados do arquivo. */
  linhaOrigem: number
  nome: string
  /** SKU real da planilha. `null` quando ausente — nunca `linha-N`, nunca sintético. */
  sku: string | null
  barcode: string | null
  codigoFornecedor: string | null
  /** Nome legível (ex.: "Pilhas e Baterias"), nunca slug. */
  categoria: string
  /** Só preenchido quando a planilha informou marca de verdade. */
  marca: string
  fornecedorNome: string
  custo: number
  preco: number
  /** `null` = planilha não trouxe estoque. */
  estoque: number | null
  garantiaDias: number | null
  fiscal: ProdutoImportFiscal
  fiscalInvalido: ProdutoImportFiscalInvalido[]
}

/** Produto já existente na loja, no mínimo necessário para decidir o match e a escrita. */
export type ProdutoCandidato = {
  id: string
  name: string
  sku: string | null
  barcode: string | null
  /** Necessário para detectar a marca corrompida (`brand` = categoria) e limpá-la. */
  brand: string
  supplierName: string
  active: boolean
  price: number
}

/** Candidatos buscados no banco pelo caller — o planejador não faz I/O. */
export type ContextoMatchProduto = {
  /** Produto cujo `barcode` bate exatamente com o da linha. */
  porBarcode: ProdutoCandidato | null
  /** Produto cujo `sku` bate exatamente com o SKU real da linha. */
  porSku: ProdutoCandidato | null
  /** Produtos vinculados ao MESMO fornecedor com o código do fornecedor informado. */
  porCodigoFornecedor: ProdutoCandidato[]
  /** Produtos com o nome normalizado idêntico ao da linha. */
  porNomeExato: ProdutoCandidato[]
}

export type PlanoMatchProduto = {
  acao: ProdutoImportAcao
  produtoId: string | null
  matchPor: ProdutoImportMatch | null
  /** Texto curto, exibido no preview e gravado na auditoria do lote. */
  motivo: string
  /** Ids em disputa quando `acao === "conflito"`. */
  conflitos: string[]
}

/** Contexto humano do lote (fornecedor + documento de origem). Tudo opcional. */
export type ContextoLoteImport = {
  fornecedor: { nome: string; documento: string } | null
  documento: {
    tipo: "nfe" | "outro"
    numero: string
    serie: string
    chave: string
    dataEmissao: string
  } | null
  observacao: string
  politicaEstoque: PoliticaEstoqueImport
}

export const CONTEXTO_LOTE_VAZIO: Readonly<ContextoLoteImport> = Object.freeze({
  fornecedor: null,
  documento: null,
  observacao: "",
  politicaEstoque: "nao_movimentar" as const,
})
