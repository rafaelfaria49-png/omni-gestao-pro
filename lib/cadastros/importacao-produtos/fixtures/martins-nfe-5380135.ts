/**
 * Fixture de regressão — NF-e 5.380.135 (MARTINS COM SERV DISTR SA).
 *
 * Reproduz a planilha real que originou o GOAL: 13 itens, cabeçalho
 * "Código de barras" no PLURAL (alias que o dicionário genérico não conhecia),
 * SEM coluna de SKU (foi por isso que o merger promoveu `linha-N` a código
 * comercial) e sem coluna de preço de venda.
 *
 * Também descreve o estado DEGRADADO em que os 13 produtos ficaram no banco da
 * Loja 2 — é contra esse estado que o reparo é validado.
 */

import type { ProdutoCandidatoRow } from "../candidatos"
import type { ContextoLoteImport } from "../types"

export const MARTINS_HEADERS = [
  "Código de barras",
  "Descrição",
  "Categoria",
  "NCM",
  "CEST",
  "Valor de custo",
  "Fornecedor",
] as const

export type LinhaMartins = {
  ean: string
  descricao: string
  categoria: string
  ncm: string
  cest: string
  custo: string
}

/** Os 13 itens exatamente como aparecem na nota. */
export const MARTINS_ITENS: ReadonlyArray<LinhaMartins> = [
  { ean: "7892840819170", descricao: "ACHOC.TODDY ORIGINAL POTE 750G", categoria: "Mercearia", ncm: "18069000", cest: "1700600", custo: "14,94" },
  { ean: "7896193236769", descricao: "ADES.FITA D.F.ADERE T.12X2M", categoria: "Fitas e Adesivos", ncm: "35069190", cest: "", custo: "7,10" },
  { ean: "7891155064886", descricao: "ASSAD.MX C/T.QUAD.M.622225 6X", categoria: "Utilidades de Cozinha", ncm: "70134900", cest: "1400100", custo: "148,46" },
  { ean: "7898216296767", descricao: "ESPREM.MON.ULTRA E-03 BCO 110V", categoria: "Eletroportáteis", ncm: "85094040", cest: "2104100", custo: "63,61" },
  { ean: "7896480669041", descricao: "FITA EMP.PRAT.48MMX45M TR.5X1", categoria: "Fitas e Adesivos", ncm: "39191010", cest: "", custo: "13,02" },
  { ean: "7891108030289", descricao: "GFA ALADDIN CONT.0,5L 3028 SOR", categoria: "Garrafas e Térmicos", ncm: "96170010", cest: "", custo: "28,29" },
  { ean: "7898586137028", descricao: "LAMP.LED A.P.FOX.75W 6,5K E27", categoria: "Iluminação", ncm: "85395200", cest: "0900500", custo: "43,60" },
  { ean: "7899882308945", descricao: "LIQ.MONDIAL L-99 PTO 110V", categoria: "Eletroportáteis", ncm: "85094010", cest: "2104100", custo: "103,10" },
  { ean: "041333038865", descricao: "PILH.DURACELL MOEDA 2032 5X1", categoria: "Pilhas e Baterias", ncm: "85065010", cest: "", custo: "34,91" },
  { ean: "7896067203040", descricao: "PILH.PANAS.COMUM PAL.R03UA 40X", categoria: "Pilhas e Baterias", ncm: "85061020", cest: "", custo: "54,10" },
  { ean: "7896067203880", descricao: "PILH.PANAS.COMUM PEQ.3SH 52X1", categoria: "Pilhas e Baterias", ncm: "85061020", cest: "", custo: "57,89" },
  { ean: "7891155037880", descricao: "PRATO NADIR OPAL.PETALA FD.24X", categoria: "Utilidades", ncm: "70134900", cest: "1400100", custo: "117,21" },
  { ean: "7899963915352", descricao: "VENT.M.BRITAN.BVT301 30CM 110V", categoria: "Utilidades", ncm: "84145110", cest: "2108800", custo: "106,43" },
]

export const MARTINS_FORNECEDOR = "MARTINS COM SERV DISTR SA"
export const MARTINS_CNPJ = "43.214.055/0040-13"
export const MARTINS_ARQUIVO = "nfe-5380135-martins.xlsx"

export const MARTINS_CONTEXTO: ContextoLoteImport = {
  fornecedor: { nome: MARTINS_FORNECEDOR, documento: MARTINS_CNPJ },
  documento: {
    tipo: "nfe",
    numero: "5380135",
    serie: "0",
    chave: "52260143214055004013550000053801351857035145",
    dataEmissao: "2026-01-02",
  },
  observacao: "Nota antiga — cadastro apenas, sem movimentar estoque",
  politicaEstoque: "nao_movimentar",
}

/** Categoria como o persistidor antigo gravava (slug com underscore). */
export function categoriaSlugLegado(nome: string): string {
  return nome
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "_")
}

/** Linhas cruas (header → valor), como o parser XLSX entrega. */
export function martinsLinhasBrutas(): Array<Record<string, unknown>> {
  return MARTINS_ITENS.map((it) => ({
    "Código de barras": it.ean,
    "Descrição": it.descricao,
    "Categoria": it.categoria,
    "NCM": it.ncm,
    "CEST": it.cest,
    "Valor de custo": it.custo,
    "Fornecedor": MARTINS_FORNECEDOR,
  }))
}

/**
 * Estado DEGRADADO no banco depois da importação original:
 * SKU `linha-1..13`, barcode vazio, `brand` = categoria slugada, preço 0, estoque 0.
 */
export function martinsProdutosDegradados(storeId = "loja-2"): ProdutoCandidatoRow[] {
  return MARTINS_ITENS.map((it, i) => ({
    id: `${storeId}-prod-${i + 1}`,
    name: it.descricao,
    sku: `linha-${i + 1}`,
    barcode: null,
    // O persistidor antigo gravava `brand = category` já slugado.
    brand: categoriaSlugLegado(it.categoria),
    supplierName: "",
    active: true,
    price: 0,
    metadata: null,
  }))
}
