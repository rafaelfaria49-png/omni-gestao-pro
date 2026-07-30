/**
 * Política ÚNICA de ativação/revisão do produto tocado por uma importação.
 *
 * Fecha o F-05 da readiness `CADASTROS_IMPORTACAO_PRODUTOS_REVIEW_HARDENING_READINESS_001`:
 * o reparo deixava os 13 produtos da NF-e Martins `active = true, price = 0` — vendáveis
 * a R$ 0,00 no PDV. A assimetria era real: produto NOVO sem preço nascia inativo, produto
 * EXISTENTE sem preço continuava ativo, porque `montarAtualizacaoProduto` omite `active`.
 *
 * Regra canônica (vale para criação, atualização, reparo e conferência):
 *
 *  1. Se a importação terminar com `preco <= 0` → FAIL-CLOSED:
 *     `active = false`, `status = "Incompleto"`, `statusRevisao = "pendente"`.
 *     O produto não fica vendável e só é ativado explicitamente na conferência,
 *     depois de receber preço válido.
 *  2. Se `preco > 0`:
 *     - criação: ativa quando apto (nome + categoria + preço), senão nasce inativo;
 *     - atualização: PRESERVA a situação atual. Produto já inativo NÃO é reativado
 *       automaticamente — ativar continua sendo decisão explícita do operador.
 *  3. Revisão já registrada não é perdida por importação que apenas enriquece campos.
 *     Volta a `pendente` somente quando o lote altera um CAMPO CRÍTICO
 *     (`CAMPOS_CRITICOS_IMPORT`: preço, barcode, SKU, categoria, NCM, CEST).
 *
 * A importação NUNCA olha nem altera estoque para decidir ativação — saldo só muda
 * por movimentação auditada.
 */

import { avaliarAptidaoAtivacao } from "./alertas"
import type { StatusRevisaoImport } from "./metadata"

/**
 * Campos cuja alteração pela importação invalida uma revisão anterior.
 * Mudam preço, identidade ou classificação fiscal — o operador precisa reconferir.
 * Marca, fornecedor, garantia e custo NÃO entram: enriquecem sem mudar a decisão.
 */
export const CAMPOS_CRITICOS_IMPORT = [
  "preco",
  "barcode",
  "sku",
  "categoria",
  "ncm",
  "cest",
] as const
export type CampoCriticoImport = (typeof CAMPOS_CRITICOS_IMPORT)[number]

/** Mensagem objetiva exibida quando se tenta ativar produto sem preço. */
export const MENSAGEM_PRECO_OBRIGATORIO = "Defina o preço de venda antes de ativar este produto."

export type OperacaoImport = "criacao" | "atualizacao"

export type EntradaAtivacaoImport = {
  operacao: OperacaoImport
  nome: string
  categoria: string | null
  /** Preço FINAL do produto depois de aplicar o patch da importação. */
  preco: number
  /** Situação atual no banco. Só faz sentido em `atualizacao`. */
  activeAtual?: boolean
  /** Revisão registrada ANTES deste lote. Só faz sentido em `atualizacao`. */
  statusRevisaoAtual?: StatusRevisaoImport
  /** Campos críticos que este lote realmente alterou. */
  camposCriticosAlterados?: readonly CampoCriticoImport[]
  /** Conflito de identidade (SKU/barcode duplicado) detectado pelo caller. */
  temConflitoIdentidade?: boolean
}

export type ResultadoAtivacaoImport = {
  /** `undefined` = não tocar a coluna (preserva o que está no banco). */
  active?: boolean
  /** `undefined` = não tocar a coluna. */
  status?: "Ativo" | "Inativo" | "Incompleto"
  statusRevisao: StatusRevisaoImport
  /** Pendências que impedem a ativação. Vazio quando apto. */
  pendencias: string[]
  /** `true` quando o produto fica vendável ao fim desta importação. */
  vendavel: boolean
  /** Por que a política decidiu assim — vai para o preview e para a conferência. */
  motivo: string
}

/**
 * Decide `active` / `status` / `statusRevisao` de um produto tocado pela importação.
 * Função pura: usada por criação, atualização, reparo, preview e conferência — nunca
 * reimplementada em componente nem no persistidor.
 */
export function resolveImportProductActivation(
  entrada: EntradaAtivacaoImport,
): ResultadoAtivacaoImport {
  const aptidao = avaliarAptidaoAtivacao({
    nome: entrada.nome,
    categoria: entrada.categoria,
    preco: entrada.preco,
    temConflitoIdentidade: entrada.temConflitoIdentidade,
  })

  // ── 1. Fail-closed: sem preço válido o produto não pode ficar vendável ──────
  if (!(entrada.preco > 0)) {
    return {
      active: false,
      status: "Incompleto",
      statusRevisao: "pendente",
      pendencias: aptidao.pendencias,
      vendavel: false,
      motivo: MENSAGEM_PRECO_OBRIGATORIO,
    }
  }

  // ── 3. Revisão anterior sobrevive a lote que só enriquece campos ────────────
  const criticosAlterados = (entrada.camposCriticosAlterados ?? []).filter((c) =>
    (CAMPOS_CRITICOS_IMPORT as readonly string[]).includes(c),
  )
  const revisaoAnterior = entrada.statusRevisaoAtual ?? "pendente"
  const statusRevisao: StatusRevisaoImport =
    entrada.operacao === "atualizacao" && revisaoAnterior === "revisado" && criticosAlterados.length === 0
      ? "revisado"
      : "pendente"

  // ── 2a. Criação com preço válido ───────────────────────────────────────────
  if (entrada.operacao === "criacao") {
    return {
      active: aptidao.apto,
      status: aptidao.apto ? "Ativo" : "Inativo",
      statusRevisao,
      pendencias: aptidao.pendencias,
      vendavel: aptidao.apto,
      motivo: aptidao.apto
        ? "Produto novo apto: nome, categoria e preço presentes."
        : `Produto novo entra inativo: ${aptidao.pendencias.join(" · ")}`,
    }
  }

  // ── 2b. Atualização com preço válido: preserva a situação atual ─────────────
  // `active`/`status` ausentes = colunas não tocadas. Produto inativo continua
  // inativo; reativar é decisão explícita da conferência.
  return {
    active: undefined,
    status: undefined,
    statusRevisao,
    pendencias: aptidao.pendencias,
    vendavel: entrada.activeAtual === true && aptidao.apto,
    motivo:
      criticosAlterados.length > 0
        ? `Situação preservada; revisão reaberta por alteração de: ${criticosAlterados.join(", ")}.`
        : "Situação e revisão preservadas — o lote apenas enriqueceu campos não críticos.",
  }
}

/** Comparação normalizada de identificadores (`null`, `""` e ausência são o mesmo). */
function mesmoTexto(a: unknown, b: unknown): boolean {
  return String(a ?? "").trim() === String(b ?? "").trim()
}

/**
 * Quais CAMPOS CRÍTICOS este lote realmente altera no produto existente.
 * Compara o patch da importação com o estado atual — chave ausente no patch
 * significa "não tocar" e portanto nunca conta como alteração.
 */
export function camposCriticosAlteradosNaImportacao(input: {
  patch: {
    sku?: string | null
    barcode?: string
    category?: string
    price?: number
  }
  atual: {
    sku: string | null
    barcode: string | null
    category: string | null
    price: number
  }
  fiscalAtual: { ncm: string; cest: string }
  fiscalNovo: { ncm: string | null; cest: string | null }
}): CampoCriticoImport[] {
  const out: CampoCriticoImport[] = []
  const { patch, atual, fiscalAtual, fiscalNovo } = input

  if (patch.price !== undefined && Number(patch.price) !== Number(atual.price ?? 0)) out.push("preco")
  if (patch.barcode !== undefined && !mesmoTexto(patch.barcode, atual.barcode)) out.push("barcode")
  if (patch.sku !== undefined && !mesmoTexto(patch.sku, atual.sku)) out.push("sku")
  if (patch.category !== undefined && !mesmoTexto(patch.category, atual.category)) out.push("categoria")

  // Fiscal só conta quando a planilha TROUXE o campo e o valor muda de verdade.
  if (fiscalNovo.ncm && !mesmoTexto(fiscalNovo.ncm, fiscalAtual.ncm)) out.push("ncm")
  if (fiscalNovo.cest && !mesmoTexto(fiscalNovo.cest, fiscalAtual.cest)) out.push("cest")

  return out
}
