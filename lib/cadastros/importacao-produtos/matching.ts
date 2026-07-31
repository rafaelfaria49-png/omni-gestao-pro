/**
 * Política de matching da importação de produtos (pura — sem I/O).
 *
 * Ordem: código de barras → SKU real → código do fornecedor (mesmo fornecedor) →
 * nome normalizado exato sob condições restritas. Nome ambíguo NUNCA escolhe sozinho:
 * vira conflito e trava o botão Importar até decisão humana.
 */

import type {
  ContextoMatchProduto,
  PlanoMatchProduto,
  ProdutoCandidato,
  ProdutoImportLinha,
} from "./types"
import { chaveNomeProduto, chaveSku, isRealProductSku, isSyntheticImportSku, normalizeBarcode } from "./sku"

function plano(
  acao: PlanoMatchProduto["acao"],
  motivo: string,
  extra?: Partial<PlanoMatchProduto>,
): PlanoMatchProduto {
  return { acao, produtoId: null, matchPor: null, motivo, conflitos: [], ...extra }
}

/**
 * Um match por barcode e outro por SKU apontando para produtos DIFERENTES significa
 * que a linha carrega identidade de dois cadastros. Persistir qualquer um corromperia
 * a unique constraint da loja — então para.
 */
function conflitoDeIdentidade(ctx: ContextoMatchProduto): PlanoMatchProduto | null {
  const porBarcode = ctx.porBarcode
  const porSku = ctx.porSku
  if (porBarcode && porSku && porBarcode.id !== porSku.id) {
    return plano(
      "conflito",
      "Código de barras e SKU apontam para produtos diferentes desta loja",
      { conflitos: [porBarcode.id, porSku.id] },
    )
  }
  return null
}

/**
 * Condições do match por nome exato (o único match "fraco" permitido).
 * Todas precisam valer — basta uma falhar para a linha virar criação.
 */
export function podeCasarPorNomeExato(
  linha: ProdutoImportLinha,
  candidato: ProdutoCandidato,
  ctx: ContextoMatchProduto,
): { ok: boolean; motivo: string } {
  if (ctx.porNomeExato.length !== 1) {
    return { ok: false, motivo: "Mais de um produto com este nome — decisão humana obrigatória" }
  }
  // O produto atual precisa estar "aberto": sem barcode ou com SKU fabricado pelo importador.
  const semBarcode = !normalizeBarcode(candidato.barcode)
  const skuSintetico = isSyntheticImportSku(candidato.sku)
  if (!semBarcode && !skuSintetico) {
    return { ok: false, motivo: "Produto existente já tem identidade própria (barcode + SKU real)" }
  }
  // A linha precisa ACRESCENTAR identidade — importar por nome só se enriquece o cadastro.
  const enriquece = Boolean(normalizeBarcode(linha.barcode)) || Boolean(linha.fiscal.ncm)
  if (!enriquece) {
    return { ok: false, motivo: "Linha não traz código de barras nem NCM que enriqueça o cadastro" }
  }
  // Nem barcode nem SKU da linha podem pertencer a outro produto.
  if (ctx.porBarcode && ctx.porBarcode.id !== candidato.id) {
    return { ok: false, motivo: "Código de barras da linha já pertence a outro produto" }
  }
  if (ctx.porSku && ctx.porSku.id !== candidato.id) {
    return { ok: false, motivo: "SKU da linha já pertence a outro produto" }
  }
  return { ok: true, motivo: "Correspondência por nome exato" }
}

/**
 * Decide o destino da linha. O caller busca os candidatos já escopados por `storeId`
 * — o isolamento multi-loja é responsabilidade da consulta, não desta função.
 */
export function planejarMatchProduto(
  linha: ProdutoImportLinha,
  ctx: ContextoMatchProduto,
): PlanoMatchProduto {
  if (!linha.nome.trim()) {
    return plano("ignorar", "Linha sem nome de produto")
  }

  const conflito = conflitoDeIdentidade(ctx)
  if (conflito) return conflito

  // 1. Código de barras exato — chave mais forte.
  if (ctx.porBarcode) {
    return plano("atualizar", "Código de barras idêntico", {
      produtoId: ctx.porBarcode.id,
      matchPor: "barcode",
    })
  }

  // 2. SKU real exato (SKU sintético nunca casa).
  if (ctx.porSku && isRealProductSku(linha.sku)) {
    return plano("atualizar", "SKU idêntico", { produtoId: ctx.porSku.id, matchPor: "sku" })
  }

  // 3. Código do fornecedor — só vale com vínculo do MESMO fornecedor.
  if (linha.codigoFornecedor && linha.fornecedorNome.trim()) {
    const doMesmoFornecedor = ctx.porCodigoFornecedor.filter(
      (c) => chaveNomeProduto(c.supplierName) === chaveNomeProduto(linha.fornecedorNome),
    )
    if (doMesmoFornecedor.length > 1) {
      return plano("conflito", "Mais de um produto com este código do fornecedor", {
        conflitos: doMesmoFornecedor.map((c) => c.id),
      })
    }
    if (doMesmoFornecedor.length === 1) {
      return plano("atualizar", "Código do fornecedor idêntico (mesmo fornecedor)", {
        produtoId: doMesmoFornecedor[0]!.id,
        matchPor: "codigo_fornecedor",
      })
    }
  }

  // 4. Nome normalizado exato — restrito e sempre sinalizado no preview.
  if (ctx.porNomeExato.length > 1) {
    return plano("conflito", "Mais de um produto com este nome exato nesta loja", {
      conflitos: ctx.porNomeExato.map((c) => c.id),
    })
  }
  if (ctx.porNomeExato.length === 1) {
    const candidato = ctx.porNomeExato[0]!
    const veredito = podeCasarPorNomeExato(linha, candidato, ctx)
    if (veredito.ok) {
      return plano("atualizar", veredito.motivo, {
        produtoId: candidato.id,
        matchPor: "nome_exato",
      })
    }
    // Não casou por nome: se a linha tem identidade própria, criar é seguro.
    // Sem identidade própria, criar duplicaria o cadastro — melhor parar.
    if (!normalizeBarcode(linha.barcode) && !isRealProductSku(linha.sku)) {
      return plano("conflito", `${veredito.motivo} — e a linha não tem código próprio`, {
        conflitos: [candidato.id],
      })
    }
  }

  return plano("criar", "Nenhum produto correspondente nesta loja")
}

/** Chaves de busca que o caller deve usar para montar o `ContextoMatchProduto`. */
export function chavesDeBusca(linha: ProdutoImportLinha): {
  barcode: string | null
  sku: string | null
  skuComparavel: string
  nome: string
  codigoFornecedor: string | null
} {
  return {
    barcode: normalizeBarcode(linha.barcode),
    sku: isRealProductSku(linha.sku) ? linha.sku : null,
    skuComparavel: isRealProductSku(linha.sku) ? chaveSku(linha.sku) : "",
    nome: chaveNomeProduto(linha.nome),
    codigoFornecedor: linha.codigoFornecedor?.trim() || null,
  }
}
