/**
 * Alertas do preview e regras de ativação (Partes 8 e 10 do contrato de importação).
 *
 * Alerta ≠ bloqueio. Só `conflito` trava a importação; o resto é sinal para a
 * conferência pós-importação decidir.
 */

import { chaveCategoria } from "./categoria"
import { isSyntheticImportSku, normalizeBarcode } from "./sku"
import type { PlanoMatchProduto, ProdutoImportLinha } from "./types"

export type CodigoAlertaImport =
  | "sem_preco"
  | "sem_barcode"
  | "sem_categoria"
  | "sku_sintetico"
  | "marca_igual_categoria"
  | "ncm_invalido"
  | "cest_invalido"
  | "conflito_duplicidade"
  | "match_por_nome"

export type AlertaImport = {
  codigo: CodigoAlertaImport
  /** `erro` trava o import; `aviso` apenas informa. */
  severidade: "erro" | "aviso"
  mensagem: string
}

const TEXTO: Record<CodigoAlertaImport, string> = {
  sem_preco: "Sem preço de venda — produto entra inativo e pendente de revisão",
  sem_barcode: "Sem código de barras",
  sem_categoria: "Sem categoria",
  sku_sintetico: "SKU sintético do importador — será descartado",
  marca_igual_categoria: "Marca igual à categoria — marca não será gravada",
  ncm_invalido: "NCM inválido (esperado vazio ou 8 dígitos)",
  cest_invalido: "CEST inválido (esperado vazio ou 7 dígitos)",
  conflito_duplicidade: "Conflito de duplicidade — resolva antes de importar",
  match_por_nome: "Correspondência por nome exato — confira antes de importar",
}

function alerta(codigo: CodigoAlertaImport, severidade: AlertaImport["severidade"] = "aviso"): AlertaImport {
  return { codigo, severidade, mensagem: TEXTO[codigo] }
}

/** Alertas de uma linha do preview, já cruzados com o plano de match. */
export function alertasDaLinha(linha: ProdutoImportLinha, plano: PlanoMatchProduto): AlertaImport[] {
  const out: AlertaImport[] = []

  if (plano.acao === "conflito") out.push({ ...alerta("conflito_duplicidade", "erro"), mensagem: plano.motivo })
  if (plano.matchPor === "nome_exato") out.push(alerta("match_por_nome"))

  if (!(linha.preco > 0)) out.push(alerta("sem_preco"))
  if (!normalizeBarcode(linha.barcode)) out.push(alerta("sem_barcode"))
  if (!linha.categoria.trim()) out.push(alerta("sem_categoria"))
  if (linha.sku !== null && isSyntheticImportSku(linha.sku)) out.push(alerta("sku_sintetico"))
  if (
    linha.marca.trim() &&
    linha.categoria.trim() &&
    chaveCategoria(linha.marca) === chaveCategoria(linha.categoria)
  ) {
    out.push(alerta("marca_igual_categoria"))
  }

  for (const inv of linha.fiscalInvalido) {
    out.push({
      codigo: inv.campo === "ncm" ? "ncm_invalido" : "cest_invalido",
      severidade: "aviso",
      mensagem: `${TEXTO[inv.campo === "ncm" ? "ncm_invalido" : "cest_invalido"]}: "${inv.valorOriginal}"`,
    })
  }

  return out
}

/** `true` quando existe pelo menos um alerta bloqueante no lote. */
export function temBloqueio(alertas: ReadonlyArray<AlertaImport>): boolean {
  return alertas.some((a) => a.severidade === "erro")
}

// ── Regras de ativação (Parte 10) ────────────────────────────────────────────

export type AptidaoAtivacao = {
  apto: boolean
  /** Motivos que impedem a ativação. Vazio quando `apto`. */
  pendencias: string[]
}

/**
 * Um produto só pode ficar ativo/vendável com nome, categoria e preço > 0.
 * Barcode/fornecedor/NCM/CEST geram alerta, nunca bloqueio — há produtos que
 * legitimamente não têm código de barras.
 */
export function avaliarAptidaoAtivacao(p: {
  nome: string
  categoria: string | null
  preco: number
  temConflitoIdentidade?: boolean
}): AptidaoAtivacao {
  const pendencias: string[] = []
  if (!p.nome?.trim()) pendencias.push("Sem nome")
  if (!(p.categoria ?? "").trim()) pendencias.push("Sem categoria")
  if (!(p.preco > 0)) pendencias.push("Sem preço de venda")
  if (p.temConflitoIdentidade) pendencias.push("Conflito de SKU ou código de barras")
  return { apto: pendencias.length === 0, pendencias }
}

// `ativacaoDeProdutoNovo` foi REMOVIDA (F-05). Ela decidia a ativação só na criação e
// dizia, no próprio comentário, que produto existente nunca é inativado por falta de
// preço — a assimetria que deixou 13 produtos vendáveis a R$ 0,00. A decisão agora é
// única, em `./ativacao` → `resolveImportProductActivation`, para criação e atualização.

/** Estado operacional exibido na conferência. */
export type EstadoConferencia = "pendente" | "incompleto" | "revisado" | "conflito" | "erro"

export function estadoConferencia(p: {
  statusRevisao: "pendente" | "revisado"
  nome: string
  categoria: string | null
  preco: number
  conflito?: boolean
  erro?: boolean
}): EstadoConferencia {
  if (p.erro) return "erro"
  if (p.conflito) return "conflito"
  const { apto } = avaliarAptidaoAtivacao({ nome: p.nome, categoria: p.categoria, preco: p.preco })
  if (!apto) return "incompleto"
  return p.statusRevisao === "revisado" ? "revisado" : "pendente"
}
