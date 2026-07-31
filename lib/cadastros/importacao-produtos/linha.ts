/**
 * Linha de planilha → `ProdutoImportLinha` (vocabulário do cadastro).
 *
 * Entrada: o mapa semântico produzido por `normalizarLinha(linha, headers, "produtos")`.
 * Saída: contrato puro, sem `_raw.*`, sem slug, sem SKU fabricado.
 */

import { legibilizarCategoria, normalizarNomeCategoria } from "./categoria"
import { normalizeBarcode, normalizeImportSku } from "./sku"
import type {
  ProdutoImportFiscal,
  ProdutoImportFiscalInvalido,
  ProdutoImportLinha,
} from "./types"

function txt(v: unknown): string {
  return String(v ?? "").trim()
}

/** Número no formato brasileiro (1.234,56) ou americano. `null` quando não há número. */
export function numeroBr(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null
  const s = txt(raw).replace(/\s/g, "")
  if (!s) return null
  const limpo = s.replace(/^r\$\s*/i, "").replace(/[^0-9,.\-]/g, "")
  if (!limpo || limpo === "-") return null
  const temVirgula = limpo.includes(",")
  const temPonto = limpo.includes(".")
  let normalizado = limpo
  if (temVirgula && temPonto) {
    normalizado =
      limpo.lastIndexOf(",") > limpo.lastIndexOf(".")
        ? limpo.replace(/\./g, "").replace(",", ".")
        : limpo.replace(/,/g, "")
  } else if (temVirgula) {
    normalizado = limpo.replace(",", ".")
  }
  const n = parseFloat(normalizado)
  return Number.isFinite(n) ? n : null
}

/** NCM: vazio ou exatamente 8 dígitos após remover pontuação. */
export function validarNcm(raw: unknown): { valor: string; invalido: ProdutoImportFiscalInvalido | null } {
  const original = txt(raw)
  if (!original) return { valor: "", invalido: null }
  const digitos = original.replace(/\D/g, "")
  if (digitos.length === 8) return { valor: digitos, invalido: null }
  return {
    valor: "",
    invalido: {
      campo: "ncm",
      valorOriginal: original,
      motivo: `NCM precisa ter 8 dígitos (recebido: ${digitos.length})`,
    },
  }
}

/** CEST: vazio ou exatamente 7 dígitos após remover pontuação. Não completa com zero. */
export function validarCest(raw: unknown): { valor: string; invalido: ProdutoImportFiscalInvalido | null } {
  const original = txt(raw)
  if (!original) return { valor: "", invalido: null }
  const digitos = original.replace(/\D/g, "")
  if (digitos.length === 7) return { valor: digitos, invalido: null }
  return {
    valor: "",
    invalido: {
      campo: "cest",
      valorOriginal: original,
      motivo: `CEST precisa ter 7 dígitos (recebido: ${digitos.length})`,
    },
  }
}

function unidade(v: unknown): string {
  return txt(v).toUpperCase().slice(0, 6)
}

/**
 * Extrai a linha canônica. `fornecedorPadrao` vem do contexto do lote e só é usado
 * quando a planilha não trouxe fornecedor por linha.
 */
export function extrairLinhaProduto(
  campos: Record<string, unknown>,
  opts: { linhaOrigem: number; fornecedorPadrao?: string },
): ProdutoImportLinha {
  const nome = txt(campos["produto.nome"])
  const barcode = normalizeBarcode(campos["produto.barcode"])
  const sku = normalizeImportSku(campos["produto.sku"])
  const codigoFornecedor = txt(campos["produto.codigoFornecedor"]) || null

  const categoria = legibilizarCategoria(campos["produto.categoria"])
  const marca = normalizarNomeCategoria(campos["produto.marca"])
  const fornecedorNome =
    normalizarNomeCategoria(campos["produto.fornecedor"]) ||
    normalizarNomeCategoria(opts.fornecedorPadrao)

  const ncm = validarNcm(campos["produto.ncm"])
  const cest = validarCest(campos["produto.cest"])
  const fiscalInvalido = [ncm.invalido, cest.invalido].filter(
    (i): i is ProdutoImportFiscalInvalido => i !== null,
  )

  const gtinComercialExplicito = normalizeBarcode(campos["produto.gtinComercial"])
  const fiscal: ProdutoImportFiscal = {
    ncm: ncm.valor,
    cest: cest.valor,
    unidadeComercial: unidade(campos["produto.unidadeComercial"]),
    unidadeTributavel: unidade(campos["produto.unidadeTributavel"]),
    // cEAN da NF-e é o próprio código de barras comercial do item — não é invenção,
    // é o mesmo dado sob o nome fiscal. cEANTrib só entra quando informado.
    gtinComercial: gtinComercialExplicito ?? barcode ?? "",
    gtinTributavel: normalizeBarcode(campos["produto.gtinTributavel"]) ?? "",
  }

  const estoqueRaw = campos["produto.estoque"]
  const estoque = estoqueRaw === undefined || estoqueRaw === null || txt(estoqueRaw) === ""
    ? null
    : Math.max(0, Math.trunc(numeroBr(estoqueRaw) ?? 0))

  const garantiaRaw = campos["produto.garantiaDias"]
  const garantiaDias = garantiaRaw === undefined || garantiaRaw === null || txt(garantiaRaw) === ""
    ? null
    : Math.max(0, Math.trunc(numeroBr(garantiaRaw) ?? 0))

  return {
    linhaOrigem: opts.linhaOrigem,
    nome,
    sku,
    barcode,
    codigoFornecedor,
    categoria,
    marca,
    fornecedorNome,
    custo: Math.max(0, numeroBr(campos["financeiro.custo"]) ?? 0),
    preco: Math.max(0, numeroBr(campos["financeiro.precoVenda"]) ?? 0),
    estoque,
    garantiaDias,
    fiscal,
    fiscalInvalido,
  }
}
